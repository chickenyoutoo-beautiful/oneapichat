// workspace.js — DSH 风格工作区机制 (Workspace Management System) v1.0
// 负责 Agent 模式与日常对话下的工作区切换、CWD 动态注入、沙箱隔离与 DSH 胶囊交互

(function() {
    'use strict';

    var STORAGE_KEY_WORKSPACES = 'agent_workspaces_v1';
    var STORAGE_KEY_CURRENT = 'agent_current_workspace_id';
    var STORAGE_KEY_CHAT_MAP = 'agent_chat_workspace_map';

    // ★ 默认预设工作区列表
    var DEFAULT_WORKSPACES = [
        {
            id: 'oneapichat',
            name: 'oneapichat',
            path: '/var/www/html/oneapichat',
            icon: 'folder-code',
            description: 'OneAPIChat 项目代码仓库主工作区',
            isDefault: true,
            isPreset: true,
            createdAt: 1700000000000,
            lastUsedAt: Date.now()
        },
        {
            id: 'workspace',
            name: 'workspace',
            path: '/var/www/html/oneapichat/workspace',
            icon: 'layers',
            description: '隔离安全沙箱与生成物工作空间',
            isDefault: false,
            isPreset: true,
            createdAt: 1700000000000,
            lastUsedAt: Date.now() - 1000
        },
        {
            id: 'html_root',
            name: 'html',
            path: '/var/www/html',
            icon: 'globe',
            description: 'Web 服务器根目录 (全站站点与静态资源)',
            isDefault: false,
            isPreset: true,
            createdAt: 1700000000000,
            lastUsedAt: Date.now() - 2000
        },
        {
            id: 'home_dir',
            name: 'home',
            path: '/home/naujtrats',
            icon: 'user',
            description: 'Linux 用户系统主目录',
            isDefault: false,
            isPreset: true,
            createdAt: 1700000000000,
            lastUsedAt: Date.now() - 3000
        }
    ];

    // SVG 矢量图标集 (DSH 现代风格)
    var ICONS = {
        'folder-code': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path><polyline points="10 13 8 15 10 17"></polyline><polyline points="14 13 16 15 14 17"></polyline></svg>',
        'layers': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"></polygon><polyline points="2 17 12 22 22 17"></polyline><polyline points="2 12 12 17 22 12"></polyline></svg>',
        'globe': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>',
        'user': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>',
        'folder': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>',
        'plus': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>',
        'check': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>',
        'trash': '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>',
        'chevron-down': '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>',
        'external-link': '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>',
        'copy': '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>'
    };

    var WorkspaceManager = {
        _workspaces: [],
        _currentId: 'oneapichat',
        _isDropdownOpen: false,
        _searchQuery: '',

        init: function() {
            this._loadWorkspaces();
            this._loadCurrentWorkspace();
            this._bindEvents();
            this.renderUI();
            console.log('[WorkspaceManager] 初始化完成, 当前工作区:', this.getCurrentWorkspace());
        },

        _loadWorkspaces: function() {
            try {
                var stored = localStorage.getItem(STORAGE_KEY_WORKSPACES);
                if (stored) {
                    var list = JSON.parse(stored);
                    if (Array.isArray(list) && list.length > 0) {
                        // 确保内置预设存在并更新
                        var merged = [];
                        var seenPaths = {};
                        
                        // 先放预设
                        DEFAULT_WORKSPACES.forEach(function(def) {
                            var custom = list.find(function(item) { return item.id === def.id || item.path === def.path; });
                            merged.push(custom ? Object.assign({}, def, custom) : def);
                            seenPaths[def.path] = true;
                        });
                        
                        // 再放自定义工作区
                        list.forEach(function(item) {
                            if (!seenPaths[item.path]) {
                                merged.push(item);
                                seenPaths[item.path] = true;
                            }
                        });
                        this._workspaces = merged;
                        return;
                    }
                }
            } catch (e) {
                console.warn('[WorkspaceManager] 恢复工作区列表失败, 使用默认列表:', e);
            }
            this._workspaces = JSON.parse(JSON.stringify(DEFAULT_WORKSPACES));
            this._saveWorkspaces();
        },

        _saveWorkspaces: function() {
            try {
                localStorage.setItem(STORAGE_KEY_WORKSPACES, JSON.stringify(this._workspaces));
            } catch (e) {
                console.error('[WorkspaceManager] 保存工作区列表失败:', e);
            }
        },

        _loadCurrentWorkspace: function() {
            var savedId = localStorage.getItem(STORAGE_KEY_CURRENT);
            if (savedId && this._workspaces.some(function(w) { return w.id === savedId; })) {
                this._currentId = savedId;
            } else {
                this._currentId = 'oneapichat';
            }
        },

        getWorkspaces: function() {
            return this._workspaces.slice();
        },

        getCurrentWorkspace: function() {
            var cur = this._workspaces.find(function(w) { return w.id === WorkspaceManager._currentId; });
            if (!cur) {
                cur = this._workspaces[0] || DEFAULT_WORKSPACES[0];
                this._currentId = cur.id;
            }
            return cur;
        },

        getWorkspaceCwd: function() {
            var ws = this.getCurrentWorkspace();
            return ws ? ws.path : '/var/www/html/oneapichat';
        },

        setCurrentWorkspace: function(idOrPath, silent) {
            var target = this._workspaces.find(function(w) { return w.id === idOrPath || w.path === idOrPath; });
            if (!target) {
                // 如果是新路径，自动尝试添加为临时/自定义工作区
                if (typeof idOrPath === 'string' && idOrPath.startsWith('/')) {
                    target = this.addWorkspace('', idOrPath, '动态工作区');
                }
            }

            if (!target) return false;

            var prevId = this._currentId;
            this._currentId = target.id;
            target.lastUsedAt = Date.now();
            this._saveWorkspaces();
            localStorage.setItem(STORAGE_KEY_CURRENT, this._currentId);

            // 绑定当前会话
            if (window.currentChatId) {
                this.bindChatWorkspace(window.currentChatId, target.id);
            }

            this.renderUI();

            // 派发事件
            var event = new CustomEvent('workspace:change', {
                detail: {
                    workspace: target,
                    prevId: prevId
                }
            });
            window.dispatchEvent(event);

            if (!silent && window.showToast) {
                showToast('已切换至工作区: ' + target.name, 'success', 2000);
            }
            return true;
        },

        addWorkspace: function(name, path, description) {
            if (!path || typeof path !== 'string') return null;
            path = path.trim();
            if (!path.startsWith('/')) path = '/' + path;
            // 去除结尾斜杠 (除非就是根目录 '/')
            if (path.length > 1 && path.endsWith('/')) {
                path = path.replace(/\/+$/, '');
            }

            // 检查是否已存在同路径
            var existing = this._workspaces.find(function(w) { return w.path === path; });
            if (existing) {
                if (name && existing.name !== name) {
                    existing.name = name;
                    this._saveWorkspaces();
                    this.renderUI();
                }
                return existing;
            }

            if (!name) {
                var segments = path.split('/').filter(Boolean);
                name = segments.length > 0 ? segments[segments.length - 1] : 'root';
            }

            var id = 'ws_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 4);
            var newWs = {
                id: id,
                name: name,
                path: path,
                icon: 'folder',
                description: description || ('自定义目录: ' + path),
                isDefault: false,
                isPreset: false,
                createdAt: Date.now(),
                lastUsedAt: Date.now()
            };

            this._workspaces.push(newWs);
            this._saveWorkspaces();
            this.renderUI();
            return newWs;
        },

        removeWorkspace: function(id) {
            var idx = this._workspaces.findIndex(function(w) { return w.id === id; });
            if (idx === -1) return false;
            var ws = this._workspaces[idx];
            if (ws.isPreset || ws.isDefault) {
                if (window.showToast) showToast('预设工作区不可删除', 'warning', 2000);
                return false;
            }

            this._workspaces.splice(idx, 1);
            this._saveWorkspaces();

            // 若删除的是当前工作区，回退到默认
            if (this._currentId === id) {
                this.setCurrentWorkspace('oneapichat', true);
            } else {
                this.renderUI();
            }
            if (window.showToast) showToast('工作区已移除', 'info', 1500);
            return true;
        },

        // 会话与工作区映射
        bindChatWorkspace: function(chatId, wsId) {
            if (!chatId) return;
            try {
                var map = JSON.parse(localStorage.getItem(STORAGE_KEY_CHAT_MAP) || '{}');
                map[chatId] = wsId;
                localStorage.setItem(STORAGE_KEY_CHAT_MAP, JSON.stringify(map));
                if (window.chats && window.chats[chatId]) {
                    window.chats[chatId].workspaceId = wsId;
                }
            } catch (e) {}
        },

        getChatWorkspaceId: function(chatId) {
            if (!chatId) return null;
            try {
                if (window.chats && window.chats[chatId] && window.chats[chatId].workspaceId) {
                    return window.chats[chatId].workspaceId;
                }
                var map = JSON.parse(localStorage.getItem(STORAGE_KEY_CHAT_MAP) || '{}');
                return map[chatId] || null;
            } catch (e) {
                return null;
            }
        },

        syncWithCurrentChat: function(chatId) {
            var wsId = this.getChatWorkspaceId(chatId);
            if (wsId && wsId !== this._currentId) {
                var ws = this._workspaces.find(function(w) { return w.id === wsId; });
                if (ws) {
                    this.setCurrentWorkspace(wsId, true);
                }
            }
        },

        // 异步验证路径
        validatePath: async function(path) {
            try {
                var resp = await fetch('/oneapichat/api/engine_api.php?action=file_read&path=' + encodeURIComponent(path) + '&max_lines=1', {
                    headers: { 'Authorization': 'Bearer ' + (window.getAuthToken ? window.getAuthToken() : '') }
                });
                var data = await resp.json();
                return { ok: data.ok, error: data.error };
            } catch (e) {
                return { ok: false, error: e.message };
            }
        },

        // 在沙箱创建新项目工作区目录
        createProjectWorkspace: async function(projectName) {
            if (!projectName || !/^[a-zA-Z0-9_-]+$/.test(projectName)) {
                throw new Error('项目名称仅支持字母、数字、下划线和连字符');
            }
            var targetPath = '/var/www/html/oneapichat/workspace/projects/' + projectName;
            try {
                // 通过 engine/exec 创建目录并写入初始 README.md
                var cmd = 'mkdir -p ' + targetPath + ' && touch ' + targetPath + '/README.md';
                var resp = await fetch('/oneapichat/api/engine_api.php?action=exec', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': 'Bearer ' + (window.getAuthToken ? window.getAuthToken() : '')
                    },
                    body: JSON.stringify({ cmd: cmd, cwd: '/var/www/html/oneapichat' })
                });
                var res = await resp.json();
                if (!res.ok && res.exit_code !== 0) {
                    throw new Error(res.error || res.stderr || '创建目录失败');
                }
                var ws = this.addWorkspace(projectName, targetPath, '项目工作区: ' + projectName);
                this.setCurrentWorkspace(ws.id);
                return ws;
            } catch (e) {
                console.error('[WorkspaceManager] 创建项目工作区失败:', e);
                throw e;
            }
        },

        // 渲染与 UI 控制
        renderUI: function() {
            var cur = this.getCurrentWorkspace();
            var capsule = document.getElementById('workspaceCapsule');
            var capsuleText = document.getElementById('workspaceCapsuleName');
            var capsuleIcon = document.getElementById('workspaceCapsuleIcon');

            if (capsuleText) {
                capsuleText.textContent = cur.name;
            }
            if (capsuleIcon) {
                capsuleIcon.innerHTML = ICONS[cur.icon] || ICONS['folder'];
            }
            if (capsule) {
                capsule.title = '当前工作区: ' + cur.name + ' (' + cur.path + ') · 点击切换';
            }
            // 同步更新欢迎看板上的工作区名字
            var heroWsName = document.getElementById('dshHeroWsName');
            if (heroWsName) {
                heroWsName.textContent = cur.name;
            }

            // 更新下拉列表（如果展开）
            if (this._isDropdownOpen) {
                this._renderDropdownContent();
            }
        },

        toggleDropdown: function(e) {
            if (e) {
                e.stopPropagation();
                e.preventDefault();
            }
            // 先关闭其它弹出层
            if (window._closeAllDshPopups) window._closeAllDshPopups('workspace');

            this._isDropdownOpen = !this._isDropdownOpen;
            var dd = document.getElementById('workspaceDropdown');
            var capsule = document.getElementById('workspaceCapsule');
            if (dd) {
                if (this._isDropdownOpen) {
                    this._renderDropdownContent();
                    dd.classList.remove('hidden');
                    if (capsule) capsule.classList.add('active');

                    // ★ 精准计算屏幕位置 (向上浮动展开，支持 fixed 定位防裁剪)
                    var triggerEl = (e && e.currentTarget) ? e.currentTarget : capsule;
                    if (!triggerEl) triggerEl = document.querySelector('.dsh-hero-capsule') || capsule;
                    if (triggerEl) {
                        var rect = triggerEl.getBoundingClientRect();
                        dd.style.position = 'fixed';
                        dd.style.zIndex = '999999';
                        var margin = 12;
                        var panelWidth = Math.min(370, window.innerWidth - margin * 2);
                        var spaceAbove = Math.max(0, rect.top - margin);
                        var spaceBelow = Math.max(0, window.innerHeight - rect.bottom - margin);
                        var openAbove = spaceAbove >= 300 || spaceAbove >= spaceBelow;
                        var available = Math.max(180, openAbove ? spaceAbove - 8 : spaceBelow - 8);
                        dd.style.maxHeight = Math.min(560, available) + 'px';
                        if (openAbove) {
                            dd.style.bottom = (window.innerHeight - rect.top + 8) + 'px';
                            dd.style.top = 'auto';
                        } else {
                            dd.style.top = (rect.bottom + 8) + 'px';
                            dd.style.bottom = 'auto';
                        }
                        var leftPos = Math.max(margin, Math.min(rect.left, window.innerWidth - panelWidth - margin));
                        dd.style.left = leftPos + 'px';
                        dd.style.right = 'auto';
                    }

                    // 自动聚焦搜索框
                    setTimeout(function() {
                        var inp = document.getElementById('wsSearchInput');
                        if (inp) inp.focus();
                    }, 50);
                } else {
                    dd.classList.add('hidden');
                    if (capsule) capsule.classList.remove('active');
                }
            }
        },

        closeDropdown: function() {
            if (!this._isDropdownOpen) return;
            this._isDropdownOpen = false;
            var dd = document.getElementById('workspaceDropdown');
            var capsule = document.getElementById('workspaceCapsule');
            if (dd) dd.classList.add('hidden');
            if (capsule) capsule.classList.remove('active');
        },

        _renderDropdownContent: function() {
            var dd = document.getElementById('workspaceDropdown');
            if (!dd) return;

            var cur = this.getCurrentWorkspace();
            var q = (this._searchQuery || '').toLowerCase().trim();
            var list = this._workspaces.filter(function(w) {
                if (!q) return true;
                return w.name.toLowerCase().indexOf(q) !== -1 ||
                       w.path.toLowerCase().indexOf(q) !== -1 ||
                       (w.description && w.description.toLowerCase().indexOf(q) !== -1);
            });

            var html = '';

            // 头部搜索栏
            html += '<div class="ws-dropdown-header">';
            html += '  <div class="ws-search-box">';
            html += '    <svg class="ws-search-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>';
            html += '    <input type="text" id="wsSearchInput" class="ws-search-input" placeholder="搜索工作区或路径..." value="' + (this._searchQuery || '') + '" oninput="window.WorkspaceManager._onSearch(this.value)">';
            if (this._searchQuery) {
                html += '    <button class="ws-search-clear" onclick="window.WorkspaceManager._onSearch(\'\');">&#x2715;</button>';
            }
            html += '  </div>';
            html += '</div>';

            // 当前激活卡片
            html += '<div class="ws-current-card">';
            html += '  <div class="ws-current-badge"><span class="ws-live-dot"></span>当前工作区</div>';
            html += '  <div class="ws-current-row">';
            html += '    <div class="ws-current-icon">' + (ICONS[cur.icon] || ICONS['folder']) + '</div>';
            html += '    <div class="ws-current-info">';
            html += '      <div class="ws-current-name">' + cur.name + '</div>';
            html += '      <div class="ws-current-path" title="' + cur.path + '">' + cur.path + '</div>';
            html += '    </div>';
            html += '    <button class="ws-copy-btn" onclick="window.WorkspaceManager._copyCurrentPath(event)" title="复制路径">' + ICONS['copy'] + '</button>';
            html += '  </div>';
            html += '</div>';

            // 工作区列表
            html += '<div class="ws-dropdown-list-section">';
            html += '  <div class="ws-list-title">工作区列表 (' + list.length + ')</div>';
            html += '  <div class="ws-dropdown-list custom-scrollbar">';

            if (list.length === 0) {
                html += '    <div class="ws-empty-hint">没有匹配的工作区</div>';
            } else {
                list.forEach(function(item) {
                    var isActive = item.id === cur.id;
                    html += '    <div class="ws-item ' + (isActive ? 'active' : '') + '" onclick="window.WorkspaceManager.setCurrentWorkspace(\'' + item.id + '\'); window.WorkspaceManager.closeDropdown();">';
                    html += '      <div class="ws-item-icon">' + (ICONS[item.icon] || ICONS['folder']) + '</div>';
                    html += '      <div class="ws-item-info">';
                    html += '        <div class="ws-item-name-row">';
                    html += '          <span class="ws-item-name">' + item.name + '</span>';
                    if (item.isPreset) {
                        html += '          <span class="ws-tag-preset">预设</span>';
                    }
                    if (isActive) {
                        html += '          <span class="ws-tag-active">' + ICONS['check'] + ' 当前</span>';
                    }
                    html += '        </div>';
                    html += '        <div class="ws-item-path" title="' + item.path + '">' + item.path + '</div>';
                    html += '      </div>';
                    if (!item.isPreset && !item.isDefault) {
                        html += '      <button class="ws-item-del-btn" onclick="event.stopPropagation(); window.WorkspaceManager.removeWorkspace(\'' + item.id + '\')" title="删除此工作区">' + ICONS['trash'] + '</button>';
                    }
                    html += '    </div>';
                });
            }

            html += '  </div>';
            html += '</div>';

            // 底部操作区
            html += '<div class="ws-dropdown-footer">';
            html += '  <button class="ws-action-btn" onclick="window.WorkspaceManager.showAddModal()">';
            html += '    ' + ICONS['plus'] + ' <span>添加自定义目录</span>';
            html += '  </button>';
            html += '  <button class="ws-action-btn secondary" onclick="window.WorkspaceManager.showCreateProjectModal()">';
            html += '    ' + ICONS['folder-code'] + ' <span>新建沙箱项目</span>';
            html += '  </button>';
            html += '</div>';

            dd.innerHTML = html;
        },

        _onSearch: function(val) {
            this._searchQuery = val || '';
            this._renderDropdownContent();
            var inp = document.getElementById('wsSearchInput');
            if (inp) {
                inp.focus();
                inp.setSelectionRange(inp.value.length, inp.value.length);
            }
        },

        _copyCurrentPath: function(e) {
            if (e) e.stopPropagation();
            var cur = this.getCurrentWorkspace();
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(cur.path).then(function() {
                    if (window.showToast) showToast('已复制工作区路径: ' + cur.path, 'success', 1500);
                });
            } else {
                var ta = document.createElement('textarea');
                ta.value = cur.path;
                document.body.appendChild(ta);
                ta.select();
                document.execCommand('copy');
                document.body.removeChild(ta);
                if (window.showToast) showToast('已复制工作区路径', 'success', 1500);
            }
        },

        _browseDirectory: async function(path) {
            var browser = document.getElementById('wsDirectoryBrowser');
            if (!browser) return;
            browser.innerHTML = '<div class="ws-browser-state">正在读取目录…</div>';
            try {
                var resp = await fetch('/oneapichat/api/engine_api.php?action=workspace_browse&path=' + encodeURIComponent(path || '/var/www/html/oneapichat'), {
                    headers: { 'Authorization': 'Bearer ' + (window.getAuthToken ? window.getAuthToken() : '') }
                });
                var data = await resp.json();
                if (!resp.ok || !data.ok) throw new Error(data.error || '目录读取失败');
                this._browserPath = data.path;
                var pathInp = document.getElementById('wsInputPath');
                if (pathInp) pathInp.value = data.path;
                var html = '<div class="ws-browser-toolbar">';
                html += '<button type="button" class="ws-browser-up" data-ws-browse="' + (data.parent || '') + '"' + (!data.parent ? ' disabled' : '') + '>' + ICONS['folder'] + '<span>上级目录</span></button>';
                html += '<div class="ws-browser-path" title="' + data.path + '">' + data.path + '</div></div>';
                html += '<div class="ws-browser-list custom-scrollbar">';
                if (!data.directories || !data.directories.length) {
                    html += '<div class="ws-browser-state">此目录没有可浏览的子目录</div>';
                } else {
                    data.directories.forEach(function(dir) {
                        html += '<button type="button" class="ws-browser-item" data-ws-browse="' + dir.path + '">' + ICONS['folder'] + '<span>' + dir.name + '</span><span class="ws-browser-chevron">›</span></button>';
                    });
                }
                html += '</div><button type="button" class="ws-browser-select" data-ws-select="' + data.path + '">选择当前目录</button>';
                browser.innerHTML = html;
                browser.querySelectorAll('[data-ws-browse]').forEach(function(btn) {
                    btn.addEventListener('click', function(event) {
                        event.preventDefault();
                        event.stopPropagation();
                        if (!btn.disabled && btn.dataset.wsBrowse) WorkspaceManager._browseDirectory(btn.dataset.wsBrowse);
                    });
                });
                var select = browser.querySelector('[data-ws-select]');
                if (select) select.addEventListener('click', function(event) {
                    event.preventDefault();
                    var input = document.getElementById('wsInputPath');
                    if (input) input.value = select.dataset.wsSelect || '';
                    var name = document.getElementById('wsInputName');
                    if (name && !name.value.trim()) {
                        var parts = String(select.dataset.wsSelect || '').split('/').filter(Boolean);
                        name.value = parts.pop() || 'root';
                    }
                });
            } catch (e) {
                browser.innerHTML = '<div class="ws-browser-state error">' + (e.message || '目录读取失败') + '</div>';
            }
        },

        // 添加自定义目录弹窗
        showAddModal: function() {
            this.closeDropdown();
            var overlay = document.getElementById('wsModalOverlay');
            if (!overlay) return;

            var html = '';
            html += '<div class="ws-modal-card">';
            html += '  <div class="ws-modal-header">';
            html += '    <div class="ws-modal-title">添加工作区目录</div>';
            html += '    <button class="ws-modal-close" onclick="window.WorkspaceManager.closeModal()">&#x2715;</button>';
            html += '  </div>';
            html += '  <div class="ws-modal-body">';
            html += '    <div class="ws-form-group">';
            html += '      <label class="ws-form-label">工作区名称 <span class="text-gray-400 font-normal">(可选，缺省取目录名)</span></label>';
            html += '      <input type="text" id="wsInputName" class="ws-form-input" placeholder="例如: my-project">';
            html += '    </div>';
            html += '    <div class="ws-form-group">';
            html += '      <label class="ws-form-label">绝对路径 <span class="text-red-500">*</span></label>';
            html += '      <input type="text" id="wsInputPath" class="ws-form-input" placeholder="/var/www/html/... 或 /home/naujtrats/...">';
            html += '      <div class="ws-form-tip">可手动输入，也可以从下面浏览服务器目录并选择当前目录。</div>';
            html += '      <div id="wsDirectoryBrowser" class="ws-directory-browser"></div>';
            html += '    </div>';
            html += '    <div class="ws-form-group">';
            html += '      <label class="ws-form-label">描述备注 <span class="text-gray-400 font-normal">(可选)</span></label>';
            html += '      <input type="text" id="wsInputDesc" class="ws-form-input" placeholder="简短描述该工作区用途">';
            html += '    </div>';
            html += '  </div>';
            html += '  <div class="ws-modal-footer">';
            html += '    <button class="ws-btn cancel" onclick="window.WorkspaceManager.closeModal()">取消</button>';
            html += '    <button class="ws-btn primary" onclick="window.WorkspaceManager._submitAddModal()">确认添加</button>';
            html += '  </div>';
            html += '</div>';

            overlay.innerHTML = html;
            overlay.classList.remove('hidden');
            setTimeout(function() {
                var p = document.getElementById('wsInputPath');
                if (p) p.focus();
                WorkspaceManager._browseDirectory(WorkspaceManager.getWorkspaceCwd() || '/var/www/html/oneapichat');
            }, 50);
        },

        _submitAddModal: async function() {
            var nameInp = document.getElementById('wsInputName');
            var pathInp = document.getElementById('wsInputPath');
            var descInp = document.getElementById('wsInputDesc');

            var path = pathInp ? pathInp.value.trim() : '';
            var name = nameInp ? nameInp.value.trim() : '';
            var desc = descInp ? descInp.value.trim() : '';

            if (!path) {
                if (window.showToast) showToast('请输入工作区绝对路径', 'error', 2000);
                return;
            }

            var ws = this.addWorkspace(name, path, desc);
            if (ws) {
                this.setCurrentWorkspace(ws.id);
                this.closeModal();
            }
        },

        // 新建沙箱项目弹窗
        showCreateProjectModal: function() {
            this.closeDropdown();
            var overlay = document.getElementById('wsModalOverlay');
            if (!overlay) return;

            var html = '';
            html += '<div class="ws-modal-card">';
            html += '  <div class="ws-modal-header">';
            html += '    <div class="ws-modal-title">新建沙箱项目工作区</div>';
            html += '    <button class="ws-modal-close" onclick="window.WorkspaceManager.closeModal()">&#x2715;</button>';
            html += '  </div>';
            html += '  <div class="ws-modal-body">';
            html += '    <div class="ws-form-group">';
            html += '      <label class="ws-form-label">项目目录名 <span class="text-red-500">*</span></label>';
            html += '      <input type="text" id="wsProjectNameInput" class="ws-form-input" placeholder="例如: web-app 或 ai-agent-demo">';
            html += '      <div class="ws-form-tip">系统将在 <code>/var/www/html/oneapichat/workspace/projects/&lt;项目名&gt;/</code> 自动创建物理目录，并切换为当前工作区。</div>';
            html += '    </div>';
            html += '  </div>';
            html += '  <div class="ws-modal-footer">';
            html += '    <button class="ws-btn cancel" onclick="window.WorkspaceManager.closeModal()">取消</button>';
            html += '    <button class="ws-btn primary" id="wsCreateProjBtn" onclick="window.WorkspaceManager._submitCreateProjectModal()">一键创建并切换</button>';
            html += '  </div>';
            html += '</div>';

            overlay.innerHTML = html;
            overlay.classList.remove('hidden');
            setTimeout(function() {
                var p = document.getElementById('wsProjectNameInput');
                if (p) p.focus();
            }, 50);
        },

        _submitCreateProjectModal: async function() {
            var inp = document.getElementById('wsProjectNameInput');
            var btn = document.getElementById('wsCreateProjBtn');
            var val = inp ? inp.value.trim() : '';

            if (!val) {
                if (window.showToast) showToast('请输入项目名称', 'error', 2000);
                return;
            }

            if (btn) {
                btn.disabled = true;
                btn.textContent = '创建中...';
            }

            try {
                await this.createProjectWorkspace(val);
                this.closeModal();
                if (window.showToast) showToast('沙箱项目工作区创建成功: ' + val, 'success', 2500);
            } catch (e) {
                if (window.showToast) showToast('创建失败: ' + e.message, 'error', 3000);
                if (btn) {
                    btn.disabled = false;
                    btn.textContent = '一键创建并切换';
                }
            }
        },

        closeModal: function() {
            var overlay = document.getElementById('wsModalOverlay');
            if (overlay) overlay.classList.add('hidden');
        },

        _bindEvents: function() {
            var self = this;
            // 点击外部自动收起下拉
            document.addEventListener('click', function(e) {
                if (!self._isDropdownOpen) return;
                var dd = document.getElementById('workspaceDropdown');
                var capsule = document.getElementById('workspaceCapsule');
                if (dd && !dd.contains(e.target) && capsule && !capsule.contains(e.target)) {
                    self.closeDropdown();
                }
            });

            // ESC 键关闭
            document.addEventListener('keydown', function(e) {
                if (e.key === 'Escape') {
                    if (self._isDropdownOpen) self.closeDropdown();
                    self.closeModal();
                }
            });
        }
    };

    // 暴露到全局
    window.WorkspaceManager = WorkspaceManager;
    window.getCurrentWorkspace = function() { return WorkspaceManager.getCurrentWorkspace(); };
    window.setCurrentWorkspace = function(idOrPath, silent) { return WorkspaceManager.setCurrentWorkspace(idOrPath, silent); };
    window.getWorkspaceCwd = function() { return WorkspaceManager.getWorkspaceCwd(); };

    // DOM 加载就绪后自动启动
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() { WorkspaceManager.init(); });
    } else {
        WorkspaceManager.init();
    }
})();
