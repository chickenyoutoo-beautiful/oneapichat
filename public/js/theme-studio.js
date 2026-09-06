/*
 * OneAPIChat Theme Studio
 * Shared skin registry + customization runtime for chat and first-party subprojects.
 * Deliberately standalone: subpages can load it without the main SPA runtime.
 */
(function (global, document) {
    'use strict';

    var THEME_VERSION = '2.0.0';
    var STORAGE = {
        theme: 'chatThemeStyle',
        accentMode: 'themeAccentMode',
        accentColor: 'themeAccentColor',
        density: 'themeDensity',
        radius: 'themeRadius',
        motion: 'themeMotion',
        contentWidth: 'themeContentWidth',
        backgroundFx: 'themeBackgroundFx'
    };

    var THEMES = {
        dsh: {
            name: 'DSH Studio',
            shortName: 'DSH',
            category: '智能体工作台',
            description: '冷白蓝灰工作台、无气泡助手排版与清晰工具时间线，还原 DSH 原版的克制工程视觉。',
            accent: '#4f46e5',
            accentStrong: '#3730a3',
            swatches: ['#f8fafc', '#4f46e5', '#93c5fd']
        },
        classic: {
            name: 'Classic Conversation',
            shortName: 'Classic',
            category: '经典对话',
            description: '清爽双向气泡、柔和层次与熟悉的即时通讯节奏，轻松耐看。',
            accent: '#2563eb',
            accentStrong: '#1d4ed8',
            swatches: ['#eff6ff', '#2563eb', '#60a5fa']
        },
        minimal: {
            name: 'Minimal Focus',
            shortName: 'Minimal',
            category: '专注阅读',
            description: '低装饰、强留白、细分隔线和文档式输出，让内容成为唯一焦点。',
            accent: '#475569',
            accentStrong: '#334155',
            swatches: ['#fafafa', '#475569', '#a3a3a3']
        },
        codex: {
            name: 'Codex Forge',
            shortName: 'Codex',
            category: '工程控制台',
            description: '石墨黑、构建绿与命令面板语言，信息密度高，专为编码和工具链打造。',
            accent: '#22c55e',
            accentStrong: '#16a34a',
            swatches: ['#111315', '#22c55e', '#f59e0b']
        },
        claude: {
            name: 'Claude Atelier',
            shortName: 'Claude',
            category: '温暖编辑部',
            description: '象牙纸张、陶土橙与编辑式排版，温润克制，适合深度阅读和创作。',
            accent: '#c15f3c',
            accentStrong: '#9f492e',
            swatches: ['#f7f1e8', '#c15f3c', '#6f5b4b']
        },
        opencode: {
            name: 'OpenCode Matrix',
            shortName: 'OpenCode',
            category: '开源终端',
            description: '近黑终端、青柠信号与网格结构，锐利、直接、充满实时系统感。',
            accent: '#00d6b4',
            accentStrong: '#00a98f',
            swatches: ['#070a0d', '#00d6b4', '#b6f36b']
        },
        aurora: {
            name: 'Aurora Glass',
            shortName: 'Aurora',
            category: '沉浸玻璃',
            description: '极光渐变、通透玻璃和柔和光晕，兼顾未来感、层次与舒适度。',
            accent: '#8b5cf6',
            accentStrong: '#7c3aed',
            swatches: ['#11152b', '#8b5cf6', '#22d3ee']
        }
    };

    var VALID = {
        density: ['compact', 'comfortable', 'spacious'],
        radius: ['sharp', 'soft', 'round'],
        motion: ['full', 'subtle', 'none'],
        backgroundFx: ['on', 'off'],
        accentMode: ['auto', 'custom']
    };

    var DEFAULTS = {
        theme: 'dsh',
        accentMode: 'auto',
        accentColor: '#6366f1',
        density: 'comfortable',
        radius: 'soft',
        motion: 'subtle',
        contentWidth: 920,
        backgroundFx: 'on'
    };

    function safeGet(key) {
        try { return global.localStorage ? global.localStorage.getItem(key) : null; } catch (e) { return null; }
    }

    function safeSet(key, value) {
        try {
            if (global.localStorage) global.localStorage.setItem(key, String(value));
            return true;
        } catch (e) { return false; }
    }

    function safeRemove(key) {
        try {
            if (global.localStorage) global.localStorage.removeItem(key);
            return true;
        } catch (e) { return false; }
    }

    function isValidChoice(group, value) {
        return VALID[group] && VALID[group].indexOf(value) !== -1;
    }

    function normalizeHex(value, fallback) {
        var raw = String(value || '').trim();
        if (/^#[0-9a-fA-F]{3}$/.test(raw)) {
            return '#' + raw.charAt(1) + raw.charAt(1) + raw.charAt(2) + raw.charAt(2) + raw.charAt(3) + raw.charAt(3);
        }
        if (/^#[0-9a-fA-F]{6}$/.test(raw)) return raw.toLowerCase();
        return fallback || DEFAULTS.accentColor;
    }

    function hexToRgb(value) {
        var hex = normalizeHex(value, DEFAULTS.accentColor).slice(1);
        return {
            r: parseInt(hex.slice(0, 2), 16),
            g: parseInt(hex.slice(2, 4), 16),
            b: parseInt(hex.slice(4, 6), 16)
        };
    }

    function mixHex(hex, target, amount) {
        var a = hexToRgb(hex);
        var b = hexToRgb(target);
        var t = Math.max(0, Math.min(1, Number(amount) || 0));
        function channel(x, y) { return Math.round(x + (y - x) * t); }
        return '#' + [channel(a.r, b.r), channel(a.g, b.g), channel(a.b, b.b)].map(function (n) {
            return n.toString(16).padStart(2, '0');
        }).join('');
    }

    function clampWidth(value) {
        var number = parseInt(value, 10);
        if (!Number.isFinite(number)) number = DEFAULTS.contentWidth;
        return Math.max(720, Math.min(1280, number));
    }

    function detectPage() {
        var root = document && document.documentElement;
        var explicit = root && root.getAttribute('data-theme-page');
        if (explicit) return explicit;
        var path = String(global.location && global.location.pathname || '').toLowerCase();
        if (path.indexOf('chaoxing') !== -1) return 'chaoxing';
        if (path.indexOf('developer') !== -1) return 'developer';
        if (path.indexOf('profile') !== -1) return 'profile';
        if (path.indexOf('reset_password') !== -1) return 'reset';
        if (path.indexOf('robot_face') !== -1) return 'robot';
        if (path.indexOf('exam_wrapper') !== -1) return 'exam-wrapper';
        if (path.indexOf('manual_exam') !== -1) return 'manual-exam';
        if (path.indexOf('index_root') !== -1 || path === '/' || path === '') return 'landing';
        return 'chat';
    }

    function syncStandaloneColorMode() {
        var root = document && document.documentElement;
        if (!root) return;
        var page = detectPage();
        // Main chat and Chaoxing own their color-mode bootstrap and toggle lifecycle.
        if (page === 'chat' || page === 'chaoxing' || page === 'manual-exam') return;
        var storedDark = safeGet('dark');
        var legacyTheme = safeGet('theme');
        var shouldBeDark = storedDark !== null
            ? storedDark === 'true'
            : legacyTheme !== 'light';
        root.classList.toggle('dark', shouldBeDark);
    }

    function readSettings(themeOverride) {
        syncStandaloneColorMode();
        var requestedTheme = themeOverride || safeGet(STORAGE.theme) || DEFAULTS.theme;
        var theme = THEMES[requestedTheme] ? requestedTheme : DEFAULTS.theme;
        var accentMode = safeGet(STORAGE.accentMode) || DEFAULTS.accentMode;
        var density = safeGet(STORAGE.density) || DEFAULTS.density;
        var radius = safeGet(STORAGE.radius) || DEFAULTS.radius;
        var motion = safeGet(STORAGE.motion) || DEFAULTS.motion;
        var backgroundFx = safeGet(STORAGE.backgroundFx) || DEFAULTS.backgroundFx;
        if (!isValidChoice('accentMode', accentMode)) accentMode = DEFAULTS.accentMode;
        if (!isValidChoice('density', density)) density = DEFAULTS.density;
        if (!isValidChoice('radius', radius)) radius = DEFAULTS.radius;
        if (!isValidChoice('motion', motion)) motion = DEFAULTS.motion;
        if (!isValidChoice('backgroundFx', backgroundFx)) backgroundFx = DEFAULTS.backgroundFx;
        var themeMeta = THEMES[theme];
        var customAccent = normalizeHex(safeGet(STORAGE.accentColor), themeMeta.accent);
        var accent = accentMode === 'custom' ? customAccent : themeMeta.accent;
        var dark = !!(document && document.documentElement && document.documentElement.classList.contains('dark'));
        return {
            theme: theme,
            accentMode: accentMode,
            accentColor: customAccent,
            accent: accent,
            accentStrong: accentMode === 'custom'
                ? mixHex(accent, dark ? '#ffffff' : '#000000', dark ? 0.12 : 0.16)
                : themeMeta.accentStrong,
            density: density,
            radius: radius,
            motion: motion,
            contentWidth: clampWidth(safeGet(STORAGE.contentWidth) || DEFAULTS.contentWidth),
            backgroundFx: backgroundFx,
            page: detectPage(),
            dark: dark
        };
    }

    function setRootStyle(root, name, value) {
        if (root && root.style && typeof root.style.setProperty === 'function') root.style.setProperty(name, value);
    }

    function applyAttributes(target, settings) {
        if (!target || typeof target.setAttribute !== 'function') return;
        target.setAttribute('data-theme-scope', 'oneapi');
        target.setAttribute('data-chat-theme', settings.theme);
        target.setAttribute('data-theme-page', settings.page);
        target.setAttribute('data-theme-density', settings.density);
        target.setAttribute('data-theme-radius', settings.radius);
        target.setAttribute('data-theme-motion', settings.motion);
        target.setAttribute('data-theme-fx', settings.backgroundFx);
        target.setAttribute('data-theme-accent', settings.accentMode);
    }

    function updateMetaThemeColor(settings) {
        if (!document || !document.querySelector) return;
        var meta = document.querySelector('meta[name="theme-color"]');
        if (!meta && document.head && document.createElement) {
            meta = document.createElement('meta');
            meta.setAttribute('name', 'theme-color');
            document.head.appendChild(meta);
        }
        if (!meta) return;
        var color = settings.dark ? mixHex(settings.accent, '#000000', 0.72) : mixHex(settings.accent, '#ffffff', 0.9);
        meta.setAttribute('content', color);
    }

    function syncControls(settings) {
        if (!document || !document.getElementById) return;
        var values = {
            chatThemeStyle: settings.theme,
            themeAccentMode: settings.accentMode,
            themeAccentColor: settings.accentColor,
            themeDensity: settings.density,
            themeRadius: settings.radius,
            themeMotion: settings.motion,
            themeContentWidth: String(settings.contentWidth)
        };
        Object.keys(values).forEach(function (id) {
            var control = document.getElementById(id);
            if (control && String(control.value) !== String(values[id])) control.value = values[id];
        });
        var widthLabel = document.getElementById('themeContentWidthValue');
        if (widthLabel) widthLabel.textContent = settings.contentWidth + 'px';
        var fx = document.getElementById('themeBackgroundFx');
        if (fx) fx.checked = settings.backgroundFx === 'on';
        var color = document.getElementById('themeAccentColor');
        if (color) color.disabled = settings.accentMode !== 'custom';
        var summary = document.getElementById('themeStudioSummary');
        if (summary) {
            var meta = THEMES[settings.theme];
            summary.innerHTML = '<strong>' + meta.name + '</strong><span>' + meta.description + '</span>';
        }
        if (document.querySelectorAll) {
            var cards = document.querySelectorAll('[data-theme-preset]');
            Array.prototype.forEach.call(cards, function (card) {
                var active = card.getAttribute('data-theme-preset') === settings.theme;
                card.classList.toggle('active', active);
                card.setAttribute('aria-pressed', active ? 'true' : 'false');
            });
        }
    }

    function emitChange(settings) {
        if (!global || typeof global.dispatchEvent !== 'function') return;
        try {
            global.dispatchEvent(new CustomEvent('oneapi:themechange', { detail: settings }));
        } catch (e) {
            try {
                var event = document.createEvent('CustomEvent');
                event.initCustomEvent('oneapi:themechange', false, false, settings);
                global.dispatchEvent(event);
            } catch (ignored) {}
        }
    }

    function apply(themeOverride, options) {
        options = options || {};
        var settings = readSettings(themeOverride);
        var root = document && document.documentElement;
        if (!root) return settings;
        applyAttributes(root, settings);
        applyAttributes(document.body, settings);
        var rgb = hexToRgb(settings.accent);
        setRootStyle(root, '--oac-accent', settings.accent);
        setRootStyle(root, '--oac-accent-strong', settings.accentStrong);
        setRootStyle(root, '--oac-accent-rgb', rgb.r + ' ' + rgb.g + ' ' + rgb.b);
        setRootStyle(root, '--oac-content-width', settings.contentWidth + 'px');
        setRootStyle(root, '--oac-density-scale', settings.density === 'compact' ? '0.88' : (settings.density === 'spacious' ? '1.12' : '1'));
        updateMetaThemeColor(settings);
        syncControls(settings);
        if (options.persistTheme && themeOverride && THEMES[themeOverride]) safeSet(STORAGE.theme, themeOverride);
        if (!options.silent) emitChange(settings);
        return settings;
    }

    function scheduleSync() {
        if (typeof global._scheduleConfigSync === 'function') global._scheduleConfigSync();
    }

    function setTheme(theme) {
        var normalized = THEMES[theme] ? theme : DEFAULTS.theme;
        safeSet(STORAGE.theme, normalized);
        var settings = apply(normalized, { persistTheme: false });
        scheduleSync();
        return settings;
    }

    function update(key, value, options) {
        options = options || {};
        if (!Object.prototype.hasOwnProperty.call(STORAGE, key) || key === 'theme') return apply(null, { silent: true });
        var normalized = value;
        if (key === 'contentWidth') normalized = clampWidth(value);
        else if (key === 'accentColor') normalized = normalizeHex(value, DEFAULTS.accentColor);
        else if (key === 'backgroundFx') normalized = (value === true || value === 'true' || value === 'on') ? 'on' : 'off';
        else if (VALID[key] && !isValidChoice(key, value)) normalized = DEFAULTS[key];
        safeSet(STORAGE[key], normalized);
        var settings = apply();
        if (!options.skipSync) scheduleSync();
        return settings;
    }

    function resetCustomization() {
        ['accentMode', 'accentColor', 'density', 'radius', 'motion', 'contentWidth', 'backgroundFx'].forEach(function (key) {
            safeRemove(STORAGE[key]);
        });
        var settings = apply();
        scheduleSync();
        return settings;
    }

    function renderPresetGrid() {
        if (!document || !document.getElementById || !document.createElement) return;
        var grid = document.getElementById('themePresetGrid');
        if (!grid || grid.getAttribute('data-theme-rendered') === THEME_VERSION) return;
        grid.innerHTML = '';
        Object.keys(THEMES).forEach(function (id) {
            var meta = THEMES[id];
            var button = document.createElement('button');
            button.type = 'button';
            button.className = 'theme-preset-card';
            button.setAttribute('data-theme-preset', id);
            button.setAttribute('aria-pressed', 'false');
            button.setAttribute('title', meta.description);
            var swatches = meta.swatches.map(function (color) {
                return '<i style="--theme-swatch:' + color + '"></i>';
            }).join('');
            button.innerHTML = '<span class="theme-preset-swatches">' + swatches + '</span>' +
                '<span class="theme-preset-copy"><strong>' + meta.shortName + '</strong><small>' + meta.category + '</small></span>' +
                '<span class="theme-preset-check" aria-hidden="true">✓</span>';
            button.addEventListener('click', function () { setTheme(id); });
            grid.appendChild(button);
        });
        grid.setAttribute('data-theme-rendered', THEME_VERSION);
    }

    function bindControl(id, eventName, handler) {
        if (!document || !document.getElementById) return;
        var element = document.getElementById(id);
        var bindingKey = 'data-theme-bound-' + eventName;
        if (!element || element.getAttribute(bindingKey) === '1') return;
        element.setAttribute(bindingKey, '1');
        element.addEventListener(eventName, handler);
    }

    function bindControls() {
        renderPresetGrid();
        bindControl('themeAccentMode', 'change', function () { update('accentMode', this.value); });
        bindControl('themeAccentColor', 'input', function () {
            safeSet(STORAGE.accentMode, 'custom');
            update('accentColor', this.value);
        });
        bindControl('themeDensity', 'change', function () { update('density', this.value); });
        bindControl('themeRadius', 'change', function () { update('radius', this.value); });
        bindControl('themeMotion', 'change', function () { update('motion', this.value); });
        bindControl('themeContentWidth', 'input', function () { update('contentWidth', this.value, { skipSync: true }); });
        bindControl('themeContentWidth', 'change', function () { update('contentWidth', this.value); });
        bindControl('themeBackgroundFx', 'change', function () { update('backgroundFx', this.checked ? 'on' : 'off'); });
        bindControl('themeStudioReset', 'click', function () { resetCustomization(); });
        syncControls(readSettings());
    }

    var api = {
        version: THEME_VERSION,
        themes: THEMES,
        defaults: DEFAULTS,
        storage: STORAGE,
        apply: apply,
        setTheme: setTheme,
        update: update,
        resetCustomization: resetCustomization,
        readSettings: readSettings,
        normalizeHex: normalizeHex,
        clampWidth: clampWidth,
        detectPage: detectPage,
        bindControls: bindControls
    };

    global.OneAPIThemeStudio = api;
    global.applyChatTheme = setTheme;
    global.onChatThemeChange = setTheme;

    apply(null, { silent: true });

    if (document && document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () {
            apply(null, { silent: true });
            bindControls();
        }, { once: true });
    } else {
        bindControls();
    }

    if (global && typeof global.addEventListener === 'function') {
        global.addEventListener('storage', function (event) {
            var relevant = Object.keys(STORAGE).some(function (key) { return STORAGE[key] === event.key; });
            if (relevant || event.key === 'dark' || event.key === 'theme') apply();
        });
    }

    if (typeof MutationObserver !== 'undefined' && document && document.documentElement) {
        var darkObserver = new MutationObserver(function (records) {
            var changed = records.some(function (record) { return record.attributeName === 'class'; });
            if (changed) apply(null, { silent: true });
        });
        darkObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    }
})(window, document);
