// skills.js — ClawHub 兼容的技能系统 v1.0
// 技能自动匹配 + 注入提示词, 指导模型何时用何工具完成何任务

window._skillsCache = null;
window._skillsLoadTime = 0;
window._skillsFailCount = 0;

window.loadSkills = async function() {
    // 2分钟内有缓存直接用
    if (window._skillsCache && Date.now() - window._skillsLoadTime < 120000) {
        return window._skillsCache;
    }
    // 连续失败3次以上才进入退避(30s后重试)
    if (window._skillsFailCount >= 3 && Date.now() - window._skillsLoadTime < 30000) {
        return window._skillsCache || [];
    }
    try {
        var apiBase = (typeof SERVER_API_BASE !== 'undefined' ? SERVER_API_BASE : '/oneapichat/api');
        var resp = await fetch(apiBase + '/skills_api.php?action=list', {
            signal: AbortSignal.timeout(15000),
            cache: 'no-store',
        });
        var data = await resp.json();
        window._skillsCache = data.skills || [];
        window._skillsLoadTime = Date.now();
        window._skillsFailCount = 0;
        return window._skillsCache;
    } catch(e) {
        window._skillsLoadTime = Date.now();
        window._skillsFailCount++;
        if (window._skillsFailCount <= 1) {
            console.warn('[Skills] 加载失败 (' + e.message + ')，将自动重试');
        }
        return window._skillsCache || [];
    }
};

// ── 根据用户输入匹配技能 ──
window.matchSkills = async function(userText) {
    if (!userText || userText.trim().length < 2) return [];
    try {
        var apiBase = (typeof SERVER_API_BASE !== 'undefined' ? SERVER_API_BASE : '/oneapichat/api');
        // 用户消息可能包含很长的历史/提示词注入文本；使用 POST，避免 GET URL 超过 nginx
        // 的 request line 限制而返回 414，随后把 HTML 错误页误当 JSON 解析。
        var resp = await fetch(apiBase + '/skills_api.php?action=match', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: userText.slice(0, 12000) }),
            signal: AbortSignal.timeout(6000),
        });
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        var data = await resp.json();
        return data.matched || [];
    } catch(e) {
        return [];
    }
};

// ── 获取所有技能的系统提示词(静态部分) ──
// v2: 精简模式 — 只输出技能名+一行描述, 不展开详细内容
// 详细内容仅在 matchSkills 匹配成功后注入(getMatchedSkillsPrompt)
window.getSkillsSystemPrompt = function() {
    var skills = window._skillsCache || [];
    if (!skills.length) return '';

    var lines = ['\n## 可用技能 (Skills)\n'];
    lines.push('以下技能指导你何时使用哪些工具。匹配到技能后按技能步骤执行：\n');
    skills.forEach(function(s) {
        var emoji = (s.meta && s.meta.oneapichat && s.meta.oneapichat.emoji) || '📦';
        var tools = (s.meta && s.meta.oneapichat && s.meta.oneapichat.tools) || [];
        // 精简: 只显示名称+描述+工具数量(不列出全部工具名)
        lines.push('- ' + emoji + ' **' + s.name + '**: ' + s.description + (tools.length ? ' (' + tools.length + '个工具)' : ''));
    });
    lines.push('\n当用户请求匹配某个技能时，请严格遵循该技能的步骤和输出格式。');
    return lines.join('\n');
};

// ── 获取匹配技能的详细指令 ──
// v2: 只注入得分最高的TOP3技能, 避免prompt膨胀导致注意力分散
window.getMatchedSkillsPrompt = function(matchedSkills) {
    if (!matchedSkills || !matchedSkills.length) return '';

    // 按score降序, 最多取3个
    var top = matchedSkills.slice().sort(function(a, b) { return (b.score || 0) - (a.score || 0); }).slice(0, 3);

    var lines = ['\n## 🎯 匹配到相关技能\n'];
    lines.push('以下技能与用户请求最相关，请参考其指导：\n');

    top.forEach(function(s) {
        lines.push('### ' + (s.emoji || '📦') + ' ' + s.name);
        if (s.tools && s.tools.length) {
            lines.push('推荐工具: ' + s.tools.join(', '));
        }
        lines.push('');
        lines.push(s.content);
        lines.push('');
    });

    if (matchedSkills.length > top.length) {
        lines.push('(另有 ' + (matchedSkills.length - top.length) + ' 个相关技能未展开, 需要时可参考)');
    }

    return lines.join('\n');
};
