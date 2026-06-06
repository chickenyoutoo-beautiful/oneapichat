// rag-system.js — RAG 知识库 v1.0 (Phase 3)
// RAG面板 / 文件上传 / 知识库查询

// ==================== RAG 知识库系统 ====================

function initRAGPanel() {
    if (getEl('ragPanel')) return;
    var inputArea = getEl('inputWrapper') || document.querySelector('.input-wrapper');
    if (!inputArea || !inputArea.parentNode) return;

    var panel = document.createElement('div');
    panel.id = 'ragPanel';
    panel.className = 'rag-panel';
    panel.innerHTML = '<div class="rag-panel-header"><span style="display:inline-flex;align-items:center;gap:6px;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>知识库</span><button class="rag-close-btn" id="ragCloseBtn">×</button></div>' +
        '<div class="rag-panel-body">' +
        '<div class="rag-upload-area" id="ragUploadArea"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block;margin:0 auto 4px;opacity:0.5;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><polyline points="9 15 12 12 15 15"/></svg> 点击或拖拽上传文档</div>' +
        '<div id="ragProgressBar" class="rag-progress" style="display:none;"><div class="rag-progress-track"><div class="rag-progress-fill" id="ragProgressFill" style="width:0%;"></div></div><div class="rag-progress-text" id="ragProgressText"></div></div>' +
        '<div style="display:flex;align-items:center;gap:4px;margin:6px 0;">' +
        '<span style="font-size:10px;font-weight:600;white-space:nowrap;color:#6b7280;">当前合集</span>' +
        '<select id="ragCollectionSelect" style="flex:1;padding:2px 4px;border:1px solid #d1d5db;border-radius:4px;font-size:11px;background:var(--bg,#fff);"></select>' +
        '<button id="ragAddColl" style="padding:2px 6px;border:1px solid #d1d5db;border-radius:4px;font-size:12px;cursor:pointer;background:var(--bg,#fff);" title="新建知识库">+</button>' +
        '<button id="ragDelColl" style="padding:2px 6px;border:1px solid #d1d5db;border-radius:4px;font-size:12px;cursor:pointer;background:var(--bg,#fff);" title="删除当前知识库">-</button>' +
        '</div>' +
        '<div style="font-size:10px;color:#9ca3af;margin:2px 0 4px;"><span id="ragDocCount">0</span> 个文档 · <span id="ragChunkCount">0</span> 个片段</div>' +
        '<div class="rag-doc-list" id="ragDocList"><div class="rag-empty">加载中...</div></div>' +
        '<div class="rag-query-area"><input type="text" id="ragQueryInput" class="rag-query-input" placeholder="搜索知识库..."><button id="ragQueryBtn" class="rag-query-btn">搜索</button></div>' +
        '<details class="rag-embed-config" style="margin-top:6px;padding-top:6px;border-top:1px solid #e5e7eb;font-size:11px;">' +
        '<summary style="cursor:pointer;font-weight:600;outline:none;">嵌入模型设置</summary>' +
        '<div style="margin-top:4px;display:flex;gap:2px;flex-wrap:wrap;align-items:center;">' +
        '<select id="ragEmbedModel" style="flex:1;min-width:60px;padding:1px 3px;border:1px solid #d1d5db;border-radius:4px;font-size:10px;"></select>' +
        '<select id="ragSearchMode" style="flex:0 0 auto;padding:1px 3px;border:1px solid #d1d5db;border-radius:4px;font-size:10px;"><option value="hybrid">混合</option><option value="embedding">语义</option><option value="tfidf">词法</option></select>' +
        '<button id="ragApplyEmbed" style="padding:2px 8px;border:1px solid #3b82f6;border-radius:4px;font-size:10px;cursor:pointer;background:#3b82f6;color:#fff;">应用</button></div>' +
        '<div id="ragEmbedStatus" style="font-size:10px;color:#9ca3af;margin-top:2px;">未启用(纯词法检索)</div>' +
        '</details>' +
        '<div class="rag-helper-text">拖拽或点击上传文档,AI可搜索知识库内容</div>' +
        '</div>';
    inputArea.parentNode.insertBefore(panel, inputArea.nextSibling);

    getEl('ragCloseBtn').addEventListener('click', function(e) { e.stopPropagation(); panel.classList.toggle('open'); });
    panel.querySelector('.rag-panel-header').addEventListener('click', function(e) {
        if (e.target.tagName === 'BUTTON') return;
        panel.classList.toggle('open');
    });

    var ua = getEl('ragUploadArea');
    ua.addEventListener('click', function() { var f = document.createElement('input'); f.type = 'file'; f.multiple = true; f.accept = '.pdf,.txt,.md,.docx,.xlsx,.json,.html'; f.onchange = function() { enqueueUploads(f.files); }; f.click(); });
    ua.addEventListener('dragover', function(e) { e.preventDefault(); this.classList.add('dragover'); });
    ua.addEventListener('dragleave', function() { this.classList.remove('dragover'); });
    ua.addEventListener('drop', function(e) { e.preventDefault(); this.classList.remove('dragover'); enqueueUploads(e.dataTransfer.files); });

    // 集合选择器
    var collSel = getEl('ragCollectionSelect');
    loadCollections();
    collSel.onchange = function() {
        localStorage.setItem('ragCurrentCollection', this.value);
        loadKnowledgeList();
    };
    getEl('ragAddColl').addEventListener('click', function() {
        var name = prompt('请输入新知识库名称:');
        if (!name) return;
        var uid = localStorage.getItem('authUserId') || '';
        var nsName = encodeURIComponent(uid ? uid + '_' + name : name);
        var _token = getAuthToken();
        fetch(RAG_API + '?action=create_collection&name=' + nsName + '&auth_token=' + encodeURIComponent(_token))
            .then(function(r) { return r.json(); })
            .then(function(d) { if (d && d.success) { loadCollections(); showToast('创建成功', 'success'); } });
    });
    getEl('ragDelColl').addEventListener('click', function() {
        var cur = localStorage.getItem('ragCurrentCollection') || 'default';
        if (cur === 'default') { showToast('不能删除默认知识库', 'warning'); return; }
        if (!confirm('删除知识库「' + cur + '」?')) return;
        var uid = localStorage.getItem('authUserId') || '';
        var nsName = encodeURIComponent(uid ? uid + '_' + cur : cur);
        var _token = getAuthToken();
        fetch(RAG_API + '?action=delete_collection&name=' + nsName + '&auth_token=' + encodeURIComponent(_token))
            .then(function(r) { return r.json(); })
            .then(function(d) { if (d && d.success) { localStorage.setItem('ragCurrentCollection', 'default'); loadCollections(); showToast('已删除', 'success'); } });
    });
    getEl('ragQueryBtn').addEventListener('click', queryRAG);
    getEl('ragQueryInput').addEventListener('keydown', function(e) { if (e.key === 'Enter') queryRAG(); });

    loadKnowledgeList();

    // 嵌入配置初始化
    loadEmbedConfig();
    var ragApplyBtn = getEl('ragApplyEmbed');
    if (ragApplyBtn) {
        ragApplyBtn.addEventListener('click', function() {
            var model = getEl('ragEmbedModel').value;
            var mode = getEl('ragSearchMode').value;
            var coll = localStorage.getItem('ragCurrentCollection') || 'default';
            var uid = localStorage.getItem('authUserId') || '';
            var ns = uid ? encodeURIComponent(uid + '_' + coll) : encodeURIComponent(coll);
            var btn = this; btn.disabled = true; btn.textContent = '生成中...';
            var _token = getAuthToken();
            fetch(RAG_API + '?action=embed_config&collection=' + ns + '&embed_model=' + encodeURIComponent(model) + '&mode=' + encodeURIComponent(mode) + '&auth_token=' + encodeURIComponent(_token), {method: 'POST'})
                .then(function(r) { return r.json(); })
                .then(function(d) {
                    if (d && d.success) { showToast('嵌入配置已更新 (' + (d.embedded || 0) + ' 个向量)', d.embedded ? 'success' : 'warning'); loadEmbedConfig(); }
                    else showToast('配置失败', 'error');
                }).catch(function(e) { showToast('错误: ' + e.message, 'error'); })
                .finally(function() { btn.disabled = false; btn.textContent = '\u5e94\u7528'; });
        });
    }
}

function loadCollections() {
    var sel = getEl('ragCollectionSelect');
    if (!sel) return;
    var prev = localStorage.getItem('ragCurrentCollection') || 'default';
    var uid = localStorage.getItem('authUserId') || '';
    var _token = getAuthToken();
    var ns = encodeURIComponent(uid);
    fetch(RAG_API + '?action=collections&collection=' + ns + '&auth_token=' + encodeURIComponent(_token))
        .then(function(r) { return r.json(); })
        .then(function(d) {
            var cols = d && d.collections ? d.collections : ['default'];
            if (cols.indexOf('default') === -1) cols.unshift('default');
            sel.innerHTML = cols.map(function(c) {
                return '<option value="' + escapeHtml(c) + '">' + (c === 'default' ? '默认知识库' : escapeHtml(c)) + '</option>';
            }).join('');
            sel.value = cols.indexOf(prev) !== -1 ? prev : 'default';
            localStorage.setItem('ragCurrentCollection', sel.value);
            loadKnowledgeList();
        });
}

function loadKnowledgeList() {
    var list = getEl('ragDocList');
    if (!list) return;
    list.innerHTML = '<div class="rag-empty">加载中...</div>';
    var dcEl = getEl('ragDocCount'), ccEl = getEl('ragChunkCount');
    var uid = localStorage.getItem('authUserId') || '';
    var coll = localStorage.getItem('ragCurrentCollection') || 'default';
    var ns = uid ? uid + '_' + coll : coll;
    var _token = getAuthToken();
    fetch(RAG_API + '?action=knowledge&collection=' + encodeURIComponent(ns) + '&auth_token=' + encodeURIComponent(_token))
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (!list) return;
            if (data && data.documents && data.documents.length > 0) {
                var totalChunks = 0;
                list.innerHTML = data.documents.map(function(d) {
                    var docId = d.id || d.doc_id || '';
                    var safeDocId = (docId || '').replace(/'/g, "\\'");
                    totalChunks += d.chunks || 0;
                    return '<div class="rag-doc-item"><span class="rag-doc-name" title="' + escapeHtml(d.source) + '">' + escapeHtml(d.source) + '</span><span class="rag-doc-chunks">' + (d.chunks || 0) + '块</span><button class="rag-doc-delete" onclick="deleteDocument(\'' + safeDocId + '\')" title="删除此文档">✕</button></div>';
                }).join('');
                if (dcEl) dcEl.textContent = data.documents.length;
                if (ccEl) ccEl.textContent = totalChunks;
            } else {
                list.innerHTML = '<div class="rag-empty">暂无文档</div>';
                if (dcEl) dcEl.textContent = '0';
                if (ccEl) ccEl.textContent = '0';
            }
        })
        .catch(function() { if (list) list.innerHTML = '<div class="rag-empty">无法连接</div>'; });
}

// 上传队列:一次只传一个文件,避免并发搞崩 RAG 后端
let _ragUploadQueue = [];
let _ragUploadBusy = false;

function enqueueUploads(fileList) {
    for (var i = 0; i < fileList.length; i++) {
        _ragUploadQueue.push(fileList[i]);
    }
    processNextUpload();
}

function processNextUpload() {
    if (_ragUploadBusy || _ragUploadQueue.length === 0) return;
    _ragUploadBusy = true;
    var file = _ragUploadQueue.shift();
    // 完成回调:继续下一个
    uploadToRAG(file, function() {
        _ragUploadBusy = false;
        processNextUpload();
    });
}

function appendDocToList(docId, source, chunks) {
    var list = getEl('ragDocList');
    if (!list) return;
    // 移除占位符
    var emptyEl = list.querySelector('.rag-empty');
    if (emptyEl) emptyEl.remove();
    // 构造新文档条目并插入最前面
    var safeDocId = (docId || '').replace(/'/g, "\\'");
    var item = document.createElement('div');
    item.className = 'rag-doc-item';
    item.innerHTML = '<span class="rag-doc-name" title="' + escapeHtml(source) + '">' + escapeHtml(source) + '</span>' +
        '<span class="rag-doc-chunks">' + (chunks || 0) + '块</span>' +
        '<button class="rag-doc-delete" onclick="deleteDocument(\'' + safeDocId + '\')" title="删除此文档">✕</button>';
    list.insertBefore(item, list.firstChild);
    // 更新统计
    var dcEl = getEl('ragDocCount'), ccEl = getEl('ragChunkCount');
    if (dcEl) dcEl.textContent = parseInt(dcEl.textContent || '0') + 1;
    if (ccEl) ccEl.textContent = parseInt(ccEl.textContent || '0') + (chunks || 0);
}

function uploadToRAG(file, onDone) {
    if (!file) { if (onDone) onDone(); return; }
    var formData = new FormData();
    formData.append('file', file);
    var uid = localStorage.getItem('authUserId') || '';
    var coll = localStorage.getItem('ragCurrentCollection') || 'default';
    var ns = uid ? uid + '_' + coll : coll;

    var pb = getEl('ragProgressBar');
    var pf = getEl('ragProgressFill');
    var pt = getEl('ragProgressText');
    if (pb) pb.style.display = 'block';
    if (pf) pf.style.width = '0%';
    if (pt) pt.textContent = '上传中: ' + file.name;

    var _token = getAuthToken();
    var xhr = new XMLHttpRequest();
    xhr.open('POST', RAG_API + '?action=upload&collection=' + encodeURIComponent(ns) + '&mode=tfidf&auth_token=' + encodeURIComponent(_token), true);
    xhr.upload.onprogress = function(e) {
        if (e.lengthComputable && pf) { var pct = Math.round(e.loaded/e.total*60); pf.style.width = pct + '%'; if (pt) pt.textContent = '上传中 ' + pct + '% - ' + file.name; }
    };
    var doneFn = function() { if (onDone) onDone(); };
    xhr.onload = function() {
        if (pb) pb.style.display = 'none';
        try {
            var d = JSON.parse(xhr.responseText);
            if (d && d.success) {
                var chunks = d.chunks || 0;
                var sourceName = d.source || file.name;
                showToast('✓ 导入完成: ' + sourceName + ' (' + chunks + ' 片段)', 'success', 3000);
                // 直接插入新文档到列表
                appendDocToList(d.doc_id || d.source || file.name, sourceName, chunks);
                // 等后端落盘后再拉一次全量列表保证同步
                setTimeout(loadKnowledgeList, 1500);
            } else {
                showToast('导入失败: 服务器返回异常', 'error');
            }
        } catch(e) {
            showToast('导入失败: 服务器无响应,请重试', 'error');
            console.error('[RAG] upload error:', e.message, 'response:', xhr.responseText);
        }
        doneFn();
    };
    xhr.onerror = function() { if (pb) pb.style.display = 'none'; showToast('网络错误', 'error'); doneFn(); };
    xhr.ontimeout = function() { if (pb) pb.style.display = 'none'; showToast('上传超时,请重试', 'error'); doneFn(); };
    xhr.timeout = 300000; // 5分钟超时
    xhr.send(formData);
}


