import vm from 'node:vm';
import readline from 'node:readline';

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
const pending = new Map();
let initialized = false;
let sequence = 0;

function emit(value) { process.stdout.write(JSON.stringify(value) + '\n'); }
function safeValue(value) {
  if (value === undefined) return null;
  return JSON.parse(JSON.stringify(value));
}
function callTool(name, args) {
  return new Promise((resolve, reject) => {
    const id = 'call_' + (++sequence);
    pending.set(id, { resolve, reject });
    emit({ type: 'call', id, name, args: args || {} });
  });
}
const tools = Object.freeze({
  read: args => callTool('read', args),
  write: args => callTool('write', args),
  edit: args => callTool('edit', args),
  grep: args => callTool('grep', args),
  glob: args => callTool('glob', args),
  bash: args => callTool('bash', args),
  todo_write: args => callTool('todo_write', args),
});
const safeConsole = Object.freeze({
  log: (...args) => emit({ type: 'log', level: 'info', args: safeValue(args) }),
  info: (...args) => emit({ type: 'log', level: 'info', args: safeValue(args) }),
  warn: (...args) => emit({ type: 'log', level: 'warn', args: safeValue(args) }),
  error: (...args) => emit({ type: 'log', level: 'error', args: safeValue(args) }),
});

async function start(code) {
  const context = vm.createContext({ tools, console: safeConsole }, {
    name: 'oneapichat-run-code',
    codeGeneration: { strings: false, wasm: false },
  });
  try {
    const source = '(async () => {\n' + String(code || '') + '\n})()';
    const script = new vm.Script(source, { filename: 'agent-run-code.js' });
    const value = await script.runInContext(context, { timeout: 1500 });
    emit({ type: 'result', value: safeValue(value) });
  } catch (error) {
    emit({ type: 'error', error: { name: error?.name || 'Error', message: String(error?.message || error), stack: String(error?.stack || '').slice(0, 5000), code: error?.code || '' } });
  } finally {
    process.exit(0);
  }
}

rl.on('line', line => {
  let message;
  try { message = JSON.parse(line); } catch { return; }
  if (!initialized && message.type === 'init') {
    initialized = true;
    start(message.code);
    return;
  }
  if (message.type === 'response' && pending.has(message.id)) {
    const task = pending.get(message.id);
    pending.delete(message.id);
    if (message.ok) task.resolve(message.value);
    else {
      const error = new Error(message.error?.message || 'tool call failed');
      error.code = message.error?.code || '';
      error.details = message.error || null;
      task.reject(error);
    }
  }
});
