/**
 * src-manager.js — StarRailCopilot Management Panel v2
 * Tab-based UI: 状态 / 设置 / 日志
 */
(function() {
    'use strict';

    const API = '/src';
    const POLL_INTERVAL = 3000;
    const LOGS_INTERVAL = 2000;

    let _configName = 'src';
    let _pollTimer = null;
    let _logsTimer = null;
    let _visible = false;
    let _activeTab = 'status';
    let _configData = null;

    // ── DOM ──
    function $el(id) { return document.getElementById(id); }
    function $c(tag, attrs, kids) {
        var el = document.createElement(tag);
        if (attrs) for (var k in attrs) {
            if (k === 'c') el.className = attrs[k];
            else if (k === 'h') el.innerHTML = attrs[k];
            else if (k === 't') el.textContent = attrs[k];
            else el.setAttribute(k, attrs[k]);
        }
        if (kids) kids.forEach(function(c) {
            if (typeof c === 'string') el.appendChild(document.createTextNode(c));
            else el.appendChild(c);
        });
        return el;
    }

    // ── SVG ──
    var I = {};
    var _icons = {
        srclogo: '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5"><path d="M12 2a10 10 0 100 20 10 10 0 000-20z"/><path d="M12 6v6l4 2"/><path d="M8 12h8"/></svg>',
        play: '<svg fill="currentColor" viewBox="0 0 24 24"><path d="M6 3l15 9-15 9V3z"/></svg>',
        stop: '<svg fill="currentColor" viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="1"/></svg>',
        refresh: '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>',
        doubleLeft: '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5" stroke-linecap="round"><polyline points="11 17 6 12 11 7"/><polyline points="18 17 13 12 18 7"/></svg>',
        expand: '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>',
        chevron: '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>',
        check: '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>',
        trailblaze: '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>',
        activity: '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"/></svg>',
        jade: '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 22 12 18.56 5.82 22 7 14.14l-5-4.87 6.91-1.01L12 2z"/></svg>',
        fuel: '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5"><path d="M17 21v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6m10 0H7m10 0V5a2 2 0 00-2-2H9a2 2 0 00-2 2v16"/></svg>',
        credit: '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5"><circle cx="12" cy="12" r="9"/><path d="M14 8h-2.5a1.5 1.5 0 000 3h1a1.5 1.5 0 010 3H10m2 1v1m0-8v1"/></svg>',
        battlepass: '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5"><rect x="3" y="6" width="18" height="14" rx="2"/><path d="M7 3v3M12 3v3m5-3v3M3 10h18"/></svg>',
        gear: '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"/></svg>',
        phone: '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5"><rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>',
        terminal: '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>',
        save: '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>',
        download: '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
        git: '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5"><circle cx="12" cy="12" r="3"/><path d="M16.5 7.5l-9 9"/><path d="M10.5 5.5l-4 4"/><path d="M17.5 14.5l4-4"/><path d="M6.5 14.5l-4-4"/><path d="M17.5 5.5l4 4"/><path d="M6.5 9.5l-4-4"/></svg>',
        
        zap: '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
        globe: '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5"><circle cx="12" cy="12" r="9"/><path d="M3.6 9h16.8M3.6 15h16.8M12 3a15 15 0 000 18 15 15 0 000-18"/></svg>',
        chart: '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5"><rect x="3" y="14" width="4" height="6" rx="1"/><rect x="10" y="9" width="4" height="11" rx="1"/><rect x="17" y="4" width="4" height="16" rx="1"/></svg>',
        clipboard: '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/></svg>',
        scroll: '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5"><path d="M9 12h6M9 16h6M9 8h6"/><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M5 7h.01M5 11h.01M5 15h.01M5 19h.01"/></svg>',
        link: '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>',
        package: '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>',
        gamepad: '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5"><rect x="2" y="6" width="20" height="12" rx="3"/><circle cx="8" cy="12" r="1.5"/><circle cx="16" cy="12" r="1.5"/><path d="M10 9v3M13 9v3"/></svg>',
        warning: '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5"><path d="M12 9v4m0 4h.01M10.29 3.86l-8.6 14.86A2 2 0 003.43 22h17.14a2 2 0 001.74-3.28l-8.6-14.86a2 2 0 00-3.42 0z"/></svg>',
        swords: '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5"><path d="M8.5 3.5L5 7l3.5 3.5M15.5 3.5L19 7l-3.5 3.5"/><path d="M3 21l6-6M21 21l-6-6"/><line x1="8.5" y1="10.5" x2="15.5" y2="10.5"/><line x1="12" y1="7" x2="12" y2="14"/></svg>',
        sparkles: '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5"><path d="M12 3l1.5 5.5L19 10l-5.5 1.5L12 17l-1.5-5.5L5 10l5.5-1.5L12 3z"/><path d="M5 3l.5 2L7 5.5 5.5 6 5 8l-.5-2L3 5.5 4.5 5 5 3z"/><path d="M19 17l.5 2 1.5.5-1.5.5-.5 2-.5-2-1.5-.5 1.5-.5.5-2z"/></svg>',
        calendar: '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
        ring: '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/></svg>',
        mail: '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5"><path d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg>',
        gift: '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5"><rect x="3" y="8" width="18" height="12" rx="1"/><path d="M12 8V20M7 8c0-2 2-4 5-4s5 2 5 4"/><path d="M12 4c1 0 3 1 3 3"/></svg>',
        hourglass: '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5"><path d="M5 3h14M5 21h14M6 3v4a6 6 0 006 6 6 6 0 006 6v4M6 21v-4a6 6 0 016-6 6 6 0 006-6V3"/></svg>',
        plusbadge: '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5"><circle cx="12" cy="12" r="9"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>',
        close: '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    };
    Object.keys(_icons).forEach(function(k) { I[k] = _icons[k]; });

    // ── API ──
    async function api(path, opts) {
        try { var r = await fetch(API + path, opts); return await r.json(); }
        catch (e) { return { ok: false, error: e.message }; }
    }

    // ── Panel Setup ──
    function ensurePanel() {
        var wrapper = $el('srcPanelWrapper');
        if (!wrapper) {
            wrapper = $c('div', { id: 'srcPanelWrapper', c: 'src-panel-wrapper' });
            var panel = $c('div', { id: 'srcPanel', c: 'src-panel' });
            // Floating reopen trigger - shows when panel is collapsed
            var trigger = $c('div', { id: 'srcFloatingTrigger', c: 'src-floating-trigger', onclick: 'window.srcManager && srcManager.toggle()', title: '打开 SRC 控制台' });
            trigger.innerHTML = '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round"><polyline points="15 18 9 12 15 6"/></svg>';
            wrapper.appendChild(trigger);
            wrapper.appendChild(panel);
            document.body.appendChild(wrapper);
        }
        return $el('srcPanel');
    }

    function render(panel) {
        panel.innerHTML =
        '<div class="src-panel-header">' +
            '<span class="src-panel-title">' + I.srclogo + ' SRC 控制台</span>' +
            '<div style="display:flex;align-items:center;gap:4px">' +
                '<span id="srcConfigLabel" class="src-badge">' + _configName + '</span>' +
                '<button onclick="window.srcManager && srcManager.hide()" class="src-header-close-btn" title="收起控制台">' + I.doubleLeft + '</button>' +
            '</div>' +
        '</div>' +
        '<div class="src-tabs">' +
            '<button class="src-tab active" data-tab="status" onclick="srcManager.switchTab(\'status\')"><span class="src-tab-dot"></span>状态</button>' +
            '<button class="src-tab" data-tab="config" onclick="srcManager.switchTab(\'config\')">' + I.gear + '设置</button>' +
            '<button class="src-tab" data-tab="logs" onclick="srcManager.switchTab(\'logs\')">' + I.terminal + '日志</button>' +
            '<button class="src-tab" data-tab="upgrade" onclick="srcManager.switchTab(\'upgrade\')">' + I.refresh + '升级</button>' +
        '</div>' +
        '<div class="src-panel-body" id="srcPanelBody">' +
            // Status tab content (rendered on switch)
            '<div id="srcTabStatus" class="src-tab-content active">' + _buildStatusTab() + '</div>' +
            '<div id="srcTabConfig" class="src-tab-content">' + _buildConfigTabPlaceholder() + '</div>' +
            '<div id="srcTabLogs" class="src-tab-content">' + _buildLogsTab() + '</div>' +
            '<div id="srcTabUpgrade" class="src-tab-content">' + _buildUpgradeTab() + '</div>' +
            '<div id="srcTabWebui" class="src-tab-content" style="padding:8px;height:100%;display:flex;flex-direction:column">' + _buildWebuiTab() + '</div>' +
        '</div>';
        panel.dataset.rendered = '1';
    }

    // ═══════════════════════════════════════
    // STATUS TAB
    // ═══════════════════════════════════════
    function _buildStatusTab() {
        return '' +
        '<div class="src-card src-status-card">' +
            '<div class="src-card-header">' +
                '<span class="src-card-title">'+I.zap+' 运行状态</span>' +
            '</div>' +
            '<div class="src-status-row">' +
                '<span id="srcStatusDot" class="src-dot off"></span>' +
                '<span id="srcStatusText" class="src-status-text">已停止</span>' +
            '</div>' +
            '<div class="src-btn-row">' +
                '<button id="srcBtnRun" onclick="srcManager.runAlas()" class="src-btn src-btn-run">' + I.play + '启动</button>' +
                '<button id="srcBtnStop" onclick="srcManager.stop()" class="src-btn src-btn-stop" disabled>' + I.stop + '停止</button>' +
                '<button onclick="srcManager.openWebUI()" class="src-btn src-btn-webui" id="srcWebuiBtn" title="打开 SRC WebUI（需要SRC在运行中）">'+I.globe+' WebUI</button>' +
                '<button onclick="srcManager.refresh()" class="src-btn-icon" title="刷新">' + I.refresh + '</button>' +
            '</div>' +
        '</div>' +
        '<div class="src-card"><div class="src-card-header"><span class="src-card-title">'+I.chart+' 资源概览</span></div><div id="srcDashboard" class="src-dashboard-grid"></div></div>' +
        '<div class="src-card"><div class="src-card-header"><span class="src-card-title">'+I.clipboard+' 任务列表</span></div><div id="srcTaskList" class="src-task-list"></div></div>';
    }

    // ═══════════════════════════════════════
    // CONFIG TAB
    // ═══════════════════════════════════════
    var CONFIG_SECTIONS = [
        {
            id: 'emulator',
            label: I.phone + ' 模拟器 / 设备',
            desc: '配置游戏运行的模拟器平台、ADB 连接和截图方式',
            keys: [
                { path: 'Alas.Emulator.Serial', label: '设备序列号 (Serial)', type: 'text', placeholder: 'auto / 127.0.0.1:5555', help: 'auto=自动检测, 或填 IP:端口 连接远程设备' },
                { path: 'Alas.EmulatorInfo.Emulator', label: '模拟器类型', type: 'select', options: ['auto','BlueStacks5','Nox','MuMuPlayer','LDPlayer','MEmu','Leidian','QyStudio','OfficialEMU'] },
                { path: 'Alas.EmulatorInfo.name', label: '模拟器实例名称', type: 'text', placeholder: 'auto 或实例编号' },
                { path: 'Alas.EmulatorInfo.path', label: '模拟器安装路径', type: 'text', placeholder: '留空自动检测' },
                { path: 'Alas.Emulator.ControlMethod', label: '操控方式', type: 'select', options: ['MaaTouch','Minitouch','AdbShell','uiautomator2'], help: '推荐 MaaTouch (更稳定)' },
                { path: 'Alas.Emulator.ScreenshotMethod', label: '截图方式', type: 'select', options: ['scrcpy','nemu','uiautomator2','ADB','ADB_nc','DroidCast','DroidCast_raw'], help: '推荐 scrcpy (最快)' },
                { path: 'Alas.Emulator.AdbRestart', label: 'ADB 自动重启', type: 'bool', help: 'ADB 异常时自动重启服务' },
            ]
        },
        {
            id: 'game',
            label: I.gamepad + ' 游戏客户端',
            desc: '选择游戏版本和语言',
            keys: [
                { path: 'Alas.Emulator.GameClient', label: '游戏客户端', type: 'select', options: ['android','cloud_android','cloud_ios','ios'], help: 'android=本地客户端,cloud_*=云游戏' },
                { path: 'Alas.Emulator.GameLanguage', label: '游戏语言', type: 'select', options: ['auto','zh-CN','zh-TW','en-US','ja-JP','ko-KR'], help: 'auto=自动跟随系统' },
                { path: 'Alas.Emulator.PackageName', label: '包名', type: 'text', placeholder: 'auto', help: 'auto=自动检测包名' },
                { path: 'Alas.Emulator.CloudPriorQueue', label: '云游戏优先排队', type: 'bool', help: '云游戏排队时优先使用快速通道' },
            ]
        },
        {
            id: 'error',
            label: I.warning + ' 错误处理与通知',
            desc: '出现错误时的处理策略和通知方式',
            keys: [
                { path: 'Alas.Error.Restart', label: '错误时重启', type: 'select', options: ['game','emulator','alas','none'], help: 'game=重启游戏,emulator=重启模拟器,alas=重启脚本' },
                { path: 'Alas.Error.SaveError', label: '保存错误截图', type: 'bool' },
                { path: 'Alas.Error.ScreenshotLength', label: '截图保留数量', type: 'number', min: 0, max: 10, help: '出错时保留的最近截图数量' },
                { path: 'Alas.Error.OnePushConfig', label: '推送通知配置', type: 'text', placeholder: 'provider: null', help: '如provider: serverchan, sckey: xxx' },
            ]
        },
        {
            id: 'dungeon',
            label: I.swords + ' 副本 (Dungeon)',
            desc: '拟造花萼、侵蚀隧洞等副本刷取配置',
            keys: [
                { path: 'Dungeon.Dungeon.Name', label: '副本名称', type: 'text', placeholder: 'Calyx_Golden_Treasures_Jarilo_VI' },
                { path: 'Dungeon.Dungeon.NameAtDoubleCalyx', label: '双倍花萼副本', type: 'text', placeholder: 'do_not_use', help: '双倍活动时刷取的副本名' },
                { path: 'Dungeon.Dungeon.NameAtDoubleRelic', label: '双倍遗器副本', type: 'text', placeholder: 'do_not_use', help: '双倍活动时刷取的遗器本' },
                { path: 'Dungeon.Dungeon.Team', label: '使用队伍编号', type: 'number', min: 1, max: 9 },
                { path: 'Dungeon.TrailblazePower.UseFuel', label: '使用燃料', type: 'bool', help: '是否自动使用燃料恢复体力' },
                { path: 'Dungeon.TrailblazePower.FuelReserve', label: '燃料保留数量', type: 'number', min: 0, max: 100, help: '至少保留这么多燃料不消耗' },
                { path: 'Dungeon.TrailblazePower.ExtractReservedTrailblazePower', label: '使用后备开拓力', type: 'bool' },
                { path: 'Dungeon.TrailblazePower.FuelOnlyPlanner', label: '燃料仅用于养成', type: 'bool', help: '燃料只在养成材料刷取时使用' },
            ]
        },
        {
            id: 'rogue',
            label: I.sparkles + ' 模拟宇宙 (Rogue)',
            desc: '模拟宇宙/差分宇宙刷取配置',
            keys: [
                { path: 'Rogue.RogueWorld.World', label: '模拟宇宙世界', type: 'select', options: ['1','2','3','4','5','6','7','8','9'] },
                { path: 'Rogue.RogueWorld.Path', label: '命途', type: 'select', options: ['auto','Destruction','Hunt','Erudition','Harmony','Nihility','Preservation','Abundance','Remembrance','Elation','Propagation'] },
                { path: 'Rogue.RogueWorld.Team', label: '使用队伍编号', type: 'number', min: 1, max: 9 },
                { path: 'Rogue.RogueWorld.UseStamina', label: '使用开拓力', type: 'bool' },
                { path: 'Rogue.RogueWorld.UseImmersifier', label: '使用沉浸器', type: 'bool' },
                { path: 'Rogue.RogueWorld.DomainStrategy', label: '位面策略', type: 'select', options: ['auto','frist','random'] },
                { path: 'Rogue.RogueWorld.Bonus', label: '额外buff', type: 'text', placeholder: '如: ab7_thief_1', help: '可选额外增益代码' },
                { path: 'Rogue.RogueBlessing.SelectionStrategy', label: '祝福选择策略', type: 'select', options: ['auto','random','first'] },
            ]
        },
        {
            id: 'weekly',
            label: I.calendar + ' 周本 (Weekly)',
            desc: '历战余响刷取配置',
            keys: [
                { path: 'Weekly.Weekly.Name', label: '周本名称', type: 'text', placeholder: '如 Echo_of_War_xxx' },
                { path: 'Weekly.Weekly.Team', label: '使用队伍编号', type: 'number', min: 1, max: 9 },
                { path: 'Weekly.Scheduler.ServerUpdate', label: '每日重置时间', type: 'text', placeholder: '04:00' },
            ]
        },
        {
            id: 'ornament',
            label: I.ring + ' 内圈遗器 (Ornament)',
            desc: '差分宇宙遗器刷取',
            keys: [
                { path: 'Ornament.Ornament.Dungeon', label: '遗器副本', type: 'text', placeholder: '如 Ornament_Extraction_xxx' },
                { path: 'Ornament.Ornament.Team40', label: '使用队伍编号(40级)', type: 'number', min: 1, max: 9 },
                { path: 'Ornament.Ornament.UseStamina', label: '使用开拓力', type: 'bool' },
                { path: 'Ornament.Ornament.UseImmersifier', label: '使用沉浸器', type: 'bool' },
                { path: 'Ornament.Ornament.DoubleEvent', label: '双倍活动', type: 'text', placeholder: 'do_not_use' },
            ]
        },
        {
            id: 'assignment',
            label: I.mail + ' 委托派遣',
            desc: '每日委托和活动派遣',
            keys: [
                { path: 'Assignment.Assignment.Duration', label: '委托时长(分钟)', type: 'number', min: 4, max: 20 },
                { path: 'Assignment.Assignment.ClaimAll', label: '一键领取', type: 'bool' },
                { path: 'Assignment.Assignment.Event', label: '活动派遣', type: 'bool' },
                { path: 'Assignment.Assignment.Name_1', label: '委托1名称', type: 'text', help: 'Nameless_Land_Nameless_People' },
                { path: 'Assignment.Assignment.Name_2', label: '委托2名称', type: 'text' },
                { path: 'Assignment.Assignment.Name_3', label: '委托3名称', type: 'text' },
                { path: 'Assignment.Assignment.Name_4', label: '委托4名称', type: 'text' },
            ]
        },
        {
            id: 'freebies',
            label: I.gift + ' 免费奖励',
            desc: '邮件、兑换码等免费奖励自动领取',
            keys: [
                { path: 'Freebies.Freebies.MailReward', label: '邮件奖励', type: 'bool' },
                { path: 'Freebies.Freebies.RedemptionCode', label: '兑换码', type: 'bool', help: '自动使用内置兑换码' },
                { path: 'Freebies.Freebies.SupportReward', label: '支援奖励', type: 'bool' },
            ]
        },
        {
            id: 'optimization',
            label: I.zap + ' 性能优化',
            desc: '截图间隔和任务队列优化',
            keys: [
                { path: 'Alas.Optimization.ScreenshotInterval', label: '截图间隔(秒)', type: 'number', min: 0.1, max: 5, step: 0.1 },
                { path: 'Alas.Optimization.CombatScreenshotInterval', label: '战斗截图间隔(秒)', type: 'number', min: 0.5, max: 5, step: 0.1 },
                { path: 'Alas.Optimization.WhenTaskQueueEmpty', label: '任务队列空时行为', type: 'select', options: ['goto_main','close_game','do_nothing'], help: '所有任务完成后做什么' },
            ]
        },
    ];

    function _buildConfigTabPlaceholder() {
        return '<div class="src-config-placeholder">点击"设置"标签加载配置...</div>';
    }

    function _buildConfigTab() {
        if (!_configData) {
            return '<div class="src-config-empty">暂无配置数据，请先刷新状态获取配置。<br><button onclick="srcManager.loadConfig()" class="src-btn src-btn-run" style="margin-top:8px">加载配置</button></div>';
        }
        var html = '<div class="src-config-top"><button onclick="srcManager.saveAllConfig()" class="src-btn src-btn-run" style="width:auto;flex:none">' + I.save + ' 保存全部设置</button></div>';
        CONFIG_SECTIONS.forEach(function(sec) {
            html += '<details class="src-card src-config-section" ' + (sec.id === 'emulator' ? 'open' : '') + '>';
            html += '<summary class="src-card-header src-logs-summary"><span class="src-card-title">' + sec.label + '</span><span class="src-chevron">' + I.chevron + '</span></summary>';
            html += '<div class="src-config-desc">' + sec.desc + '</div>';
            html += '<div class="src-config-fields">';
            sec.keys.forEach(function(key) {
                var val = getCfgVal(key.path);
                html += '<div class="src-config-field">';
                html += '<label class="src-config-label" title="' + (key.help || '') + '">' + key.label + (key.help ? ' <span class="src-config-help">?</span>' : '') + '</label>';
                if (key.type === 'bool') {
                    html += '<label class="src-task-toggle ' + (val ? 'on' : '') + '" data-path="' + key.path + '" data-type="bool" onclick="srcManager.toggleCfg(this)"><span></span></label>';
                } else if (key.type === 'select') {
                    html += '<select class="src-config-select" data-path="' + key.path + '" data-type="select" onchange="srcManager.changeCfg(this)">';
                    (key.options || []).forEach(function(opt) {
                        html += '<option value="' + opt + '"' + (String(val) === opt ? ' selected' : '') + '>' + opt + '</option>';
                    });
                    html += '</select>';
                } else if (key.type === 'number') {
                    html += '<input class="src-config-input" data-path="' + key.path + '" data-type="number" type="number" value="' + val + '" min="' + (key.min || '') + '" max="' + (key.max || '') + '" step="' + (key.step || 1) + '" onchange="srcManager.changeCfg(this)">';
                } else {
                    html += '<input class="src-config-input" data-path="' + key.path + '" data-type="text" type="text" value="' + _escHtml(String(val || '')) + '" placeholder="' + (key.placeholder || '') + '" onchange="srcManager.changeCfg(this)">';
                }
                html += '</div>';
            });
            html += '</div></details>';
        });
        return html;
    }

    function getCfgVal(path) {
        if (!_configData) return '';
        var parts = path.split('.');
        var val = _configData;
        for (var i = 0; i < parts.length; i++) {
            if (!val || typeof val !== 'object') return '';
            val = val[parts[i]];
        }
        return val;
    }

    function setCfgVal(path, value) {
        if (!_configData) return;
        var parts = path.split('.');
        var obj = _configData;
        for (var i = 0; i < parts.length - 1; i++) {
            if (!obj[parts[i]]) obj[parts[i]] = {};
            obj = obj[parts[i]];
        }
        obj[parts[parts.length - 1]] = value;
    }

    function _escHtml(s) {
        return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    // ═══════════════════════════════════════
    // LOGS TAB
    // ═══════════════════════════════════════
    function _buildLogsTab() {
        return '<div class="src-card"><div class="src-card-header"><span class="src-card-title">'+I.scroll+' 运行日志</span><button onclick="srcManager.fetchLogs()" class="src-btn-icon" style="width:22px;height:22px" title="刷新日志">' + I.refresh + '</button></div><div id="srcLogViewer" class="src-log-viewer">(暂无日志)</div></div>';
    }

    // ═══════════════════════════════════════
    // UPGRADE TAB
    // ═══════════════════════════════════════
    function _buildWebuiTab() {
        return '<div style="padding:16px;text-align:center">' +
            '<p style="color:#888;margin-bottom:16px">SRC WebUI 是图形化管理面板，启动后自动打开</p>' +
            '<button onclick="srcManager.openWebUI()" class="src-btn src-btn-run" id="srcWebuiBtn2" style="width:auto;font-size:16px;padding:10px 24px">'+I.link+' 打开 WebUI</button>' +
        '</div>';
    }

    function _buildUpgradeTab() {
        return '' +
        '<div class="src-upgrade-card">' +
            '<div class="src-upgrade-inner">' +
                '<div class="src-upgrade-top">' +
                    '<div class="src-version-badge-group">' +
                        '<div class="src-version-badge">' +
                            '<span class="src-version-badge-label">' + I.git + ' 当前版本</span>' +
                            '<span id="srcVersionCurrent" class="src-version-badge-value">加载中...</span>' +
                        '</div>' +
                        '<div class="src-version-badge new">' +
                            '<span class="src-version-badge-label">落后</span>' +
                            '<span id="srcVersionBehind" class="src-version-badge-value">--</span>' +
                        '</div>' +
                    '</div>' +
                    '<div class="src-upgrade-actions">' +
                        '<button onclick="srcManager.checkVersion()" class="src-btn src-btn-run">' + I.refresh + ' 检查更新</button>' +
                        '<button id="srcBtnUpgrade" onclick="srcManager.doUpgrade()" class="src-btn src-btn-stop" disabled>' + I.download + ' 执行升级</button>' +
                    '</div>' +
                '</div>' +
                '<div class="src-upgrade-log-area">' +
                    '<div id="srcUpgradeLog" class="src-upgrade-log">点击"检查更新"查看是否有新版本。</div>' +
                '</div>' +
            '</div>' +
        '</div>' +
        '<div class="src-card">' +
            '<div class="src-upgrade-bottom">' +
                '<span class="src-upgrade-bottom-desc">'+I.package+' 插件可在 webui 的插件商店中安装。已安装的任务自动显示在状态栏。</span>' +
            '</div>' +
        '</div>';
    }

    // ═══════════════════════════════════════
    // RESOURCES
    // ═══════════════════════════════════════
    var RESOURCES = [
        { key: 'trailblaze_power', label: '开拓力', icon: 'trailblaze', max: 300 },
        { key: 'daily_activity', label: '活跃度', icon: 'activity', max: 500 },
        { key: 'credit', label: '信用点', icon: 'credit', max: null },
        { key: 'stellar_jade', label: '星琼', icon: 'jade', max: null },
        { key: 'battle_pass_level', label: '大月卡', icon: 'battlepass', max: 70 },
        { key: 'fuel', label: '燃料', icon: 'fuel', max: null },
    ];

    function fmtNum(n) {
        if (n === undefined || n === null) return '--';
        if (n >= 100000) return (n / 10000).toFixed(1) + 'w';
        if (n >= 10000) return (n / 10000).toFixed(2) + 'w';
        return String(n);
    }

    var _lastDashboardData = null;
    function updateDashboard(data) {
        var c = $el('srcDashboard'); if (!c) return;
        var res = data.resources || {};
        // ★ 数据没变时跳过重绘, 避免闪烁
        var _hash = JSON.stringify(res);
        if (_hash === _lastDashboardData) return;
        _lastDashboardData = _hash;
        c.innerHTML = RESOURCES.map(function(r) {
            var val = (res[r.key] || {}).value || 0;
            var total = (res[r.key] || {}).total;
            var pct = r.max ? Math.min(100, Math.round(val / r.max * 100)) : 0;
            var bar = r.max ? '<div class="src-resource-bar"><div class="src-resource-fill" style="width:' + pct + '%"></div></div>' : '';
            return '<div class="src-resource-card">' +
                '<div class="src-resource-icon">' + (I[r.icon] || '') + '</div>' +
                '<div class="src-resource-info">' +
                    '<span class="src-resource-value">' + fmtNum(val) + '</span>' +
                    (total ? '<span class="src-resource-total">/' + fmtNum(total) + '</span>' : '') +
                    '<span class="src-resource-label">' + r.label + '</span>' +
                '</div>' + bar +
            '</div>';
        }).join('');
    }

    // ═══════════════════════════════════════
    // TASKS
    // ═══════════════════════════════════════
    var TASK_GROUPS = [
        { label: '基础', tasks: ['Alas', 'Restart'] },
        { label: '日常', tasks: ['Dungeon', 'Ornament', 'DailyQuest', 'BattlePass', 'Assignment', 'DataUpdate', 'Freebies'] },
        { label: '周常', tasks: ['Weekly', 'Rogue'] },
        { label: '工具', tasks: ['Daemon', 'PlannerScan'] },
    ];
    var TASK_DESC = {
        Alas: '完整调度器，按优先级执行所有已启用任务',
        Restart: '重启游戏客户端',
        Dungeon: '刷副本：拟造花萼、侵蚀隧洞、凝滞虚影',
        Ornament: '刷内圈遗器：差分宇宙',
        DailyQuest: '完成每日实训，领取活跃度奖励',
        BattlePass: '领取无名勋礼奖励',
        Assignment: '收派委托',
        DataUpdate: '更新资源统计',
        Freebies: '领取免费奖励：邮件、兑换码',
        Weekly: '刷历战余响（周本）',
        Rogue: '刷模拟宇宙',
        Daemon: '后台托管：自动启停模拟器+游戏',
        PlannerScan: '角色养成规划扫描',
    };

    function updateTaskList(data) {
        var c = $el('srcTaskList'); if (!c) return;
        var tasks = {};
        (data.tasks || []).forEach(function(t) { tasks[t.name] = t; });
        c.innerHTML = TASK_GROUPS.map(function(g) {
            return '<div class="src-task-group">' +
                '<div class="src-task-group-label">' + g.label + '</div>' +
                g.tasks.map(function(name) {
                    var t = tasks[name] || { enable: false, name: name };
                    return '<div class="src-task-row" onclick="srcManager.toggleTask(\'' + name + '\',' + !t.enable + ')" title="' + (TASK_DESC[name] || '') + '">' +
                        '<div class="src-task-name-col"><span class="src-task-name">' + name + '</span><span class="src-task-desc">' + (TASK_DESC[name] || '') + '</span></div>' +
                        '<span class="src-task-toggle ' + (t.enable ? 'on' : '') + '"><span></span></span>' +
                    '</div>';
                }).join('') +
            '</div>';
        }).join('');
    }

    // ── Status ──
    function updateStatus(data) {
        var dot = $el('srcStatusDot'), txt = $el('srcStatusText'),
            run = $el('srcBtnRun'), stopBtn = $el('srcBtnStop');
        if (!txt) return;
        var labels = { running: '运行中', stopped: '已停止', error: '异常', updating: '更新中', unavailable: '不可用' };
        txt.textContent = (data.state === 3 && !data.alive) ? '已停止' : (labels[data.state_label] || data.state_label || '未知');
        dot.className = 'src-dot ' + (data.alive ? 'on' : 'off');
        if (data.alive) { dot.classList.add('pulse'); } else { dot.classList.remove('pulse'); }
        if (run) run.disabled = data.alive;
        if (stopBtn) stopBtn.disabled = !data.alive;
    }

    // ── Logs ──
    async function fetchLogs() {
        var v = $el('srcLogViewer'); if (!v) return;
        var logs = await api('/logs?config_name=' + _configName + '&limit=50');
        if (logs.ok && logs.lines && logs.lines.length > 0) {
            // 过滤掉 rich.table 对象引用, 显示实际文本
            var filtered = logs.lines.map(function(l) {
                return l.indexOf('<rich.table.Table object') === 0 ? '[渲染表格]' : l;
            });
            v.textContent = filtered.join('\n');
            v.scrollTop = v.scrollHeight;
        } else if (logs.lines && logs.lines.length === 0) {
            v.textContent = '(暂无日志)';
        }
    }

    // ── Config API ──
    async function saveConfig(path, value) {
        var res = await api('/config/' + _configName, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: path, value: value }),
        });
        return res;
    }

    // ═══════════════════════════════════════
    // PUBLIC API
    // ═══════════════════════════════════════
    window.srcManager = {
        toggle: function() {
            var panel = ensurePanel();
            var wrapper = document.getElementById('srcPanelWrapper');
            if (!panel.dataset.rendered) render(panel);
            if (wrapper) wrapper.classList.remove('src-collapsed');
            _visible = true;
            this.refresh();
            this.startPolling();
        },

        hide: function() {
            var wrapper = document.getElementById('srcPanelWrapper');
            if (wrapper) wrapper.classList.add('src-collapsed');
            _visible = false;
            this.stopPolling();
        },


        switchTab: function(tabName) {
            _activeTab = tabName;
            // WebUI tab: 直接显示说明（在新窗口打开）
            if (tabName === 'webui') {
                // 无需特殊处理，按钮直接 window.open
            }
            // Update tab buttons
            var tabs = document.querySelectorAll('.src-tab');
            tabs.forEach(function(t) { t.classList.remove('active'); });
            var activeBtn = document.querySelector('.src-tab[data-tab="' + tabName + '"]');
            if (activeBtn) activeBtn.classList.add('active');
            // Update tab content
            var contents = document.querySelectorAll('.src-tab-content');
            contents.forEach(function(c) { c.classList.remove('active'); });
            var content = $el('srcTab' + tabName.charAt(0).toUpperCase() + tabName.slice(1));
            if (content) content.classList.add('active');
            // Load config if switching to config tab
            if (tabName === 'config' && _configData) {
                var cfgEl = $el('srcTabConfig');
                if (cfgEl) cfgEl.innerHTML = _buildConfigTab();
            }
            // Auto-check version on upgrade tab
            if (tabName === 'upgrade') {
                var el = $el('srcUpgradeLog');
                if (el && (!el.textContent || el.textContent.indexOf('点击') >= 0 || el.textContent.indexOf('加载') >= 0)) {
                    this.checkVersion();
                }
            }
        },

        loadConfig: async function() {
            var res = await api('/config/' + _configName);
            if (res.ok && res.data) {
                _configData = res.data;
                if (_activeTab === 'config') {
                    var cfgEl = $el('srcTabConfig');
                    if (cfgEl) cfgEl.innerHTML = _buildConfigTab();
                }
            }
        },

        toggleCfg: function(el) {
            var path = el.dataset.path;
            var isOn = el.classList.contains('on');
            var newVal = !isOn;
            setCfgVal(path, newVal);
            if (newVal) el.classList.add('on'); else el.classList.remove('on');
            saveConfig(path, newVal).then(function(res) {
                if (!res.ok) {
                    // Revert on error
                    setCfgVal(path, !newVal);
                    if (newVal) el.classList.remove('on'); else el.classList.add('on');
                }
            });
        },

        changeCfg: function(el) {
            var path = el.dataset.path;
            var type = el.dataset.type;
            var val = type === 'number' ? parseFloat(el.value) : el.value;
            setCfgVal(path, val);
            saveConfig(path, val).then(function(res) {
                if (!res.ok) console.warn('[SRC] 配置保存失败:', path);
            });
        },

        saveAllConfig: async function() {
            if (!_configData) return;
            var btn = document.querySelector('.src-config-top .src-btn');
            if (btn) { btn.textContent = '保存中...'; btn.disabled = true; }
            // Save each config section
            var results = [];
            CONFIG_SECTIONS.forEach(function(sec) {
                sec.keys.forEach(function(key) {
                    var val = getCfgVal(key.path);
                    results.push(saveConfig(key.path, val));
                });
            });
            await Promise.all(results);
            if (btn) { btn.textContent = I.save + ' 保存全部设置'; btn.disabled = false; }
            alert('设置已保存');
        },

        refresh: async function() {
            var results = await Promise.all([
                api('/status?config_name=' + _configName),
                api('/dashboard?config_name=' + _configName),
                api('/tasks?config_name=' + _configName),
            ]);
            if (results[0].ok) updateStatus(results[0]);
            if (results[1].ok) updateDashboard(results[1]);
            if (results[2].ok) updateTaskList(results[2]);
            // Load config on first refresh
            if (!_configData) {
                var cfgRes = await api('/config/' + _configName);
                if (cfgRes.ok && cfgRes.data) {
                    _configData = cfgRes.data;
                    if (_activeTab === 'config') {
                        var cfgEl = $el('srcTabConfig');
                        if (cfgEl) cfgEl.innerHTML = _buildConfigTab();
                    }
                }
            }
        },

        startPolling: function() {
            this.stopPolling();
            _pollTimer = setInterval(function() { if (_visible) window.srcManager.refresh(); }, POLL_INTERVAL);
            _logsTimer = setInterval(function() { if (_visible && _activeTab === 'logs') fetchLogs(); }, LOGS_INTERVAL);
        },

        stopPolling: function() {
            clearInterval(_pollTimer); _pollTimer = null;
            clearInterval(_logsTimer); _logsTimer = null;
        },

        toggleTask: async function(name, enable) {
            var path = name + '.Scheduler.Enable';
            var res = await saveConfig(path, !!enable);
            if (res.ok) { this.refresh(); if (_configData) { setCfgVal(path, !!enable); } }
            else alert('更新失败: ' + (res.error || 'unknown'));
        },

        runAlas: async function() {
            var res = await api('/run', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ config_name: _configName, task: 'Alas' }),
            });
            if (res.ok) {
                this.refresh();
                // 启动成功后自动打开 WebUI
                // WebUI已通过按钮手动打开
            }
            else alert('启动失败: ' + (res.error || 'unknown'));
        },

        stop: async function() {
            var res = await api('/stop', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ config_name: _configName }),
            });
            if (res.ok) this.refresh();
            else alert('停止失败: ' + (res.error || 'unknown'));
        },

        fetchLogs: fetchLogs,

        openWebUI: function() {
            var url = 'https://www.naujtrats.xyz/srcwebui/';
            // 先ping看是否可达
            fetch(url, { mode: 'no-cors' }).then(function() {
                window.open(url, '_blank');
            }).catch(function() {
                alert('WebUI 当前不可用。\n\n可能原因：\n1. SRC服务未启动(请点击"启动")\n2. WebUI进程异常\n\n所有功能均可通过本控制台直接操作。');
            });
        },

        checkVersion: async function() {
            var logEl = $el('srcUpgradeLog');
            var curEl = $el('srcVersionCurrent');
            var behindEl = $el('srcVersionBehind');
            var btn = $el('srcBtnUpgrade');
            if (logEl) logEl.textContent = '正在检查更新...';
            try {
                var r = await fetch('/oneapichat/api/src_upgrade.php?action=check');
                var d = await r.json();
                if (d.ok) {
                    if (curEl) curEl.textContent = d.current || '未知';
                    if (behindEl) behindEl.textContent = d.behind + ' 个commit';
                    if (btn) btn.disabled = !d.need_update;
                    if (logEl) logEl.innerHTML = d.need_update ? '<span class="src-inline-icon">'+I.plusbadge+'</span> 发现 ' + d.behind + ' 个新版本，点击"执行升级"更新。' : '<span class="src-inline-icon">'+I.check+'</span> 已是最新版本';
                } else {
                    if (logEl) logEl.innerHTML = '<span class="src-inline-icon">'+I.close+'</span> 检查失败: ' + (d.error || '网络错误');
                }
            } catch(e) {
                if (logEl) logEl.innerHTML = '<span class="src-inline-icon">'+I.close+'</span> 请求失败: ' + e.message;
            }
        },

        doUpgrade: async function() {
            var logEl = $el('srcUpgradeLog');
            var btn = $el('srcBtnUpgrade');
            if (!confirm('确定要升级 SRC 吗？\n将执行以下操作：\n1. git pull 拉取最新代码\n2. pip install 更新依赖\n3. 重启 SRC')) return;
            if (logEl) logEl.innerHTML = '<span class="src-inline-icon">'+I.hourglass+'</span> 正在执行升级...';
            if (logEl) logEl.style.whiteSpace = 'pre-wrap';
            if (logEl) logEl.style.fontSize = '12px';
            if (btn) btn.disabled = true;
            try {
                var r = await fetch('/oneapichat/api/src_upgrade.php?action=upgrade');
                var d = await r.json();
                if (d.ok) {
                    var output = d.output || '';
                    if (logEl) {
                        logEl.innerHTML = '<span class="src-inline-icon">'+I.check+'</span> ' + (d.message || '升级成功') + '\n\n' + d.output;
                        logEl.scrollTop = logEl.scrollHeight;
                    }
                    // Auto refresh version after 5s
                    setTimeout(function() { window.srcManager.checkVersion(); }, 5000);
                } else {
                    if (logEl) logEl.innerHTML = '<span class="src-inline-icon">'+I.close+'</span> ' + (d.message || '升级失败') + '\n\n' + (d.output || '') + '\n\n错误: ' + (d.error || '');
                    if (btn) btn.disabled = false;
                }
            } catch(e) {
                if (logEl) logEl.innerHTML = '<span class="src-inline-icon">'+I.close+'</span> 请求失败: ' + e.message;
                if (btn) btn.disabled = false;
            }
        },

        isVisible: function() { return _visible; },
    };
})();
