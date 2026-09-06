const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'js', 'resume-stream.js'),
    'utf8'
);

function makeStorage(seed) {
    const values = seed || {};
    return {
        values,
        get length() { return Object.keys(values).length; },
        key(index) { return Object.keys(values)[index] || null; },
        getItem(key) { return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : null; },
        setItem(key, value) { values[key] = String(value); },
        removeItem(key) { delete values[key]; }
    };
}

function boot(sharedValues, options) {
    options = options || {};
    const localStorage = makeStorage(sharedValues);
    localStorage.setItem('authUserId', 'user-1');
    const pending = { role: 'assistant', content: 'partial answer', reasoning: '', partial: true };
    const context = {
        console,
        localStorage,
        chats: options.chats || { chat1: { messages: [pending] } },
        currentChatId: options.currentChatId || 'another-chat',
        activeBubbleMap: {},
        isTypingMap: {},
        userScrolled: false,
        $: {},
        location: { origin: 'https://example.test' },
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        AbortController,
        TextDecoder,
        Response,
        fetch: options.fetch || (async function() { throw new Error('network is not used in this test'); }),
        slimSaveChats: function() {},
        saveChats: function() {},
        loadChat: function() {},
        appendMessage: function() { return null; },
        cleanupStreamState: function() {},
        showToast: function() {},
        followToBottom: function() {}
    };
    context.window = context;
    context.window._updateQueueUI = function() {};
    if (options.executeToolCallForRetry) context.window.executeToolCallForRetry = options.executeToolCallForRetry;
    if (options.sendMessage) context.window.sendMessage = options.sendMessage.bind(null, context);
    context.window.addEventListener = function() {};
    vm.createContext(context);
    vm.runInContext(source, context, { filename: 'resume-stream.js' });
    return { context, pending, localStorage };
}

const sharedValues = {};
const first = boot(sharedValues);
const call = {
    id: 'call_1',
    type: 'function',
    function: { name: 'server_exec', arguments: '{"cmd":"date"}' }
};

first.context.window.ResumeStream.prepareTools('chat1', first.pending, [call]);
first.context.window.ResumeStream.markToolRunning('chat1', call, 0);
let state = first.context.window.ResumeStream.peek('chat1');
assert.strictEqual(state.phase, 'tools');
assert.strictEqual(state.tools[0].status, 'running');
assert.strictEqual(state.tools[0].name, 'server_exec');

first.context.window.ResumeStream.markToolResult('chat1', call, 0, 'ok', false);
state = first.context.window.ResumeStream.peek('chat1');
assert.strictEqual(state.phase, 'tools_done');
assert.strictEqual(state.tools[0].status, 'success');
assert.strictEqual(state.tools[0].result, 'ok');

// 模拟整页刷新：重新执行模块，但复用同一个 localStorage 数据集。
const refreshed = boot(sharedValues);
state = refreshed.context.window.ResumeStream.peek('chat1');
assert.strictEqual(state.tools[0].status, 'success');
assert.strictEqual(state.tools[0].result, 'ok');
assert.strictEqual(refreshed.context.window.ResumeStream.hasPending('chat1'), true);

refreshed.context.window.ResumeStream.complete('chat1');
assert.strictEqual(refreshed.context.window.ResumeStream.peek('chat1'), null);

async function testRecoveredToolHandoff() {
    const call = {
        id: 'call_resume', type: 'function',
        function: { name: 'server_exec', arguments: '{"cmd":"date"}' }
    };
    const now = Date.now();
    const values = {
        authUserId: 'user-1',
        _rs_sid: 'stream_resume',
        _rs_cid: 'chat1',
        _rs_msgid: 'msg_resume',
        _rs_ts: String(now),
        _rs_state_v3: JSON.stringify({
            version: 3,
            chats: {
                chat1: {
                    version: 3, chatId: 'chat1', sid: 'stream_resume', msgId: 'msg_resume',
                    userId: 'user-1', phase: 'tools', content: '', reasoning: '',
                    toolCalls: [call],
                    tools: [{ id: call.id, name: 'server_exec', preview: 'date', call, status: 'running', attempts: 1 }],
                    createdAt: now, updatedAt: now
                }
            }
        })
    };
    const assistant = {
        role: 'assistant', content: ' ', reasoning: '', tool_calls: [call],
        _rsStreamId: 'stream_resume', _rsMsgId: 'msg_resume'
    };
    let sendCalls = 0;
    let typingSeenBySend = null;
    const snapshot = {
        stream_id: 'stream_resume', msg_id: 'msg_resume', full_text: '', reasoning_text: '',
        tool_calls: [call], usage: null, finished: true, error: '', offset: 1
    };
    const app = boot(values, {
        currentChatId: 'chat1',
        chats: { chat1: { messages: [assistant] } },
        fetch: async function() {
            return new Response(
                'event: snapshot\ndata: ' + JSON.stringify(snapshot) + '\n\n',
                { status: 200, headers: { 'content-type': 'text/event-stream' } }
            );
        },
        executeToolCallForRetry: async function() { return { result: 'tool-ok' }; },
        sendMessage: async function(context) {
            sendCalls++;
            typingSeenBySend = !!context.isTypingMap.chat1;
            context.isTypingMap.chat1 = true;
        }
    });

    const resumed = await app.context.window.ResumeStream.resume('chat1');
    assert.strictEqual(resumed, true);
    await new Promise(function(resolve) { setTimeout(resolve, 10); });
    assert.strictEqual(sendCalls, 1);
    assert.strictEqual(typingSeenBySend, false, 'continuation must not be rejected as an already-busy send');
    assert.strictEqual(app.context.isTypingMap.chat1, true, 'new request keeps ownership after resume.finally');
    assert.strictEqual(
        app.context.chats.chat1.messages.some(function(message) {
            return message.role === 'tool' && message.tool_call_id === call.id && message.content === 'tool-ok';
        }),
        true
    );
}

async function testPendingCreateHandshake() {
    const now = Date.now();
    const values = {
        authUserId: 'user-1',
        _rs_sid: 'pending_msg_create',
        _rs_cid: 'chat1',
        _rs_msgid: 'msg_create',
        _rs_ts: String(now),
        _rs_state_v3: JSON.stringify({
            version: 3,
            chats: {
                chat1: {
                    version: 3, chatId: 'chat1', sid: 'pending_msg_create', msgId: 'msg_create',
                    userId: 'user-1', phase: 'creating', content: '', reasoning: '',
                    toolCalls: [], tools: [], createdAt: now, updatedAt: now
                }
            }
        })
    };
    const assistant = {
        role: 'assistant', content: '', reasoning: '', partial: true,
        _rsStreamId: 'pending_msg_create', _rsMsgId: 'msg_create'
    };
    let requests = 0;
    const app = boot(values, {
        currentChatId: 'chat1',
        chats: { chat1: { messages: [assistant] } },
        fetch: async function() {
            requests++;
            if (requests < 3) {
                return new Response('{"error":"stream not found"}', {
                    status: 404, headers: { 'content-type': 'application/json' }
                });
            }
            const snapshot = {
                stream_id: 'stream_created', msg_id: 'msg_create', full_text: 'created answer',
                reasoning_text: '', tool_calls: [], usage: null, finished: true, error: '', offset: 1
            };
            return new Response(
                'event: snapshot\ndata: ' + JSON.stringify(snapshot) + '\n\n',
                { status: 200, headers: { 'content-type': 'text/event-stream' } }
            );
        }
    });

    const resumed = await app.context.window.ResumeStream.resume('chat1');
    assert.strictEqual(resumed, true);
    assert.strictEqual(requests, 3);
    assert.strictEqual(assistant.content, 'created answer');
    assert.strictEqual(app.context.window.ResumeStream.peek('chat1'), null);
}

async function testCreateForwardsSafeProviderOptionsAndRuntimeIds() {
    const values = { authUserId: 'user-1', authToken: 'token-1' };
    const assistant = { role: 'assistant', content: '', reasoning: '', partial: true };
    let createBody = null;
    let requests = 0;
    const app = boot(values, {
        currentChatId: 'chat1',
        chats: { chat1: { messages: [assistant] } },
        fetch: async function(url, options) {
            requests++;
            if (String(url).indexOf('chat_create') !== -1) {
                createBody = JSON.parse(options.body);
                return new Response(JSON.stringify({
                    stream_id: 'stream_full', msg_id: 'msg_full', task_id: 'task_full',
                    runtime_session_id: 'session_full', runtime_job_id: 'job_full'
                }), { status: 200, headers: { 'content-type': 'application/json' } });
            }
            const snapshot = {
                stream_id: 'stream_full', msg_id: 'msg_full', full_text: 'done',
                reasoning_text: '', tool_calls: [], usage: null, finished: true, error: '', offset: 1
            };
            return new Response('event: snapshot\ndata: ' + JSON.stringify(snapshot) + '\n\n', {
                status: 200, headers: { 'content-type': 'text/event-stream' }
            });
        }
    });
    const result = await app.context.window.ResumeStream.create([{ role: 'user', content: 'hi' }], {
        model: 'gpt-5', apiKey: 'provider-key', baseUrl: 'https://api.example/v1', tokens: 1234,
        requestBody: {
            model: 'gpt-5', messages: [], max_completion_tokens: 777, tool_choice: 'required',
            modalities: ['text', 'audio'], audio: { voice: 'alloy' },
            image_config: { size: '1024x1024' }, custom_sampling: 0.2, access_token: 'do-not-forward'
        }
    }, 'chat1', assistant);
    assert.strictEqual(result.completed, true);
    assert.strictEqual(requests, 2);
    assert.strictEqual(createBody.max_completion_tokens, 777);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(createBody, 'max_tokens'), false);
    assert.strictEqual(createBody.tool_choice, 'required');
    assert.deepStrictEqual(Array.from(createBody.modalities), ['text', 'audio']);
    assert.strictEqual(createBody.image_config.size, '1024x1024');
    assert.strictEqual(createBody.custom_sampling, 0.2);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(createBody, 'access_token'), false);
    assert.strictEqual(createBody.api_key, 'provider-key');
    assert.strictEqual(assistant.task_id, 'task_full');
    assert.strictEqual(assistant.runtime_session_id, 'session_full');
    assert.strictEqual(assistant.runtime_job_id, 'job_full');
}

function testDirectRequestTimeoutDoesNotCancelDurableCreate() {
    assert.ok(source.indexOf('var _CREATE_ACK_TIMEOUT_MS = 30000;') !== -1, 'durable create must have its own acknowledgement timeout');
    assert.strictEqual(/setTimeout\([^;]*config\.requestTimeout/.test(source), false, 'direct request timeout must not abort a durable engine job');
}

function testStateRemainsResumableForEngineWindow() {
    const now = Date.now();
    const values = {
        authUserId: 'user-1',
        _rs_state_v3: JSON.stringify({
            version: 3,
            chats: {
                chat1: {
                    version: 3, chatId: 'chat1', sid: 'stream_long', msgId: 'msg_long',
                    userId: 'user-1', phase: 'streaming', content: 'partial', reasoning: '',
                    toolCalls: [], tools: [], createdAt: now - 20 * 60 * 1000,
                    updatedAt: now - 20 * 60 * 1000
                }
            }
        })
    };
    const app = boot(values);
    const state = app.context.window.ResumeStream.peek('chat1');
    assert.ok(state, 'a stream inside the engine 30-minute retention window must remain resumable');
    assert.strictEqual(state.sid, 'stream_long');
}

async function testCreateTreatsAuthFailuresAsTerminal() {
    const assistant = { role: 'assistant', content: '', reasoning: '', partial: true };
    let requests = 0;
    const app = boot({ authUserId: 'user-1', authToken: 'expired' }, {
        currentChatId: 'chat1', chats: { chat1: { messages: [assistant] } },
        fetch: async function() {
            requests++;
            return new Response(JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'session expired' } }), {
                status: 401, headers: { 'content-type': 'application/json' }
            });
        }
    });
    const result = await app.context.window.ResumeStream.create([], { model: 'gpt-5' }, 'chat1', assistant);
    assert.strictEqual(requests, 1);
    assert.strictEqual(result.authFailure, true);
    assert.strictEqual(result.terminal, true);
    assert.strictEqual(result.status, 401);
    assert.strictEqual(result.errorCode, 'UNAUTHORIZED');
}

Promise.resolve()
    .then(testRecoveredToolHandoff)
    .then(testPendingCreateHandshake)
    .then(testCreateForwardsSafeProviderOptionsAndRuntimeIds)
    .then(testDirectRequestTimeoutDoesNotCancelDurableCreate)
    .then(testStateRemainsResumableForEngineWindow)
    .then(testCreateTreatsAuthFailuresAsTerminal)
    .then(function() {
        console.log('resume stream state journal/tool handoff/create handshake: ok');
    }).catch(function(error) {
        console.error(error);
        process.exitCode = 1;
    });
