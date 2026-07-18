// skills.js — ClawHub 兼容的技能系统 v1.0
// 技能自动匹配 + 注入提示词, 指导模型何时用何工具完成何任务

window._skillsCache = null;
window._skillsLoadTime = 0;

// ── 加载技能列表 ──
window.loadSkills = async function() {
    if (window._skillsCache && Date.now() - window._skillsLoadTime < 60000) {
        return window._skillsCache; // 60s 缓存
    }
    try {
        var apiBase = (typeof SERVER_API_BASE !== 'undefined' ? SERVER_API_BASE : '/oneapichat/api');
        var resp = await fetch(apiBase + '/skills_api.php?action=list', {
            signal: AbortSignal.timeout(5000),
        });
        var data = await resp.json();
        window._skillsCache = data.skills || [];
        window._skillsLoadTime = Date.now();
        return window._skillsCache;
    } catch(e) {
        console.warn('[Skills] 加载失败:', e.message);
        return [];
    }
};

// ── 根据用户输入匹配技能 ──
window.matchSkills = async function(userText) {
    if (!userText || userText.trim().length < 2) return [];
    try {
        var apiBase = (typeof SERVER_API_BASE !== 'undefined' ? SERVER_API_BASE : '/oneapichat/api');
        var resp = await fetch(apiBase + '/skills_api.php?action=match&query=' + encodeURIComponent(userText), {
            signal: AbortSignal.timeout(3000),
        });
        var data = await resp.json();
        return data.matched || [];
    } catch(e) {
        console.warn('[Skills] 匹配失败:', e.message);
        return [];
    }
};

// ── 获取所有技能的系统提示词(静态部分) ──
window.getSkillsSystemPrompt = function() {
    var skills = window._skillsCache || [];
    if (!skills.length) return '';

    var lines = ['\n## 可用技能 (Skills)\n'];
    lines.push('以下技能指导你何时使用哪些工具来完成特定任务：\n');
    skills.forEach(function(s) {
        var emoji = (s.meta && s.meta.oneapichat && s.meta.oneapichat.emoji) || '📦';
        lines.push('- ' + emoji + ' **' + s.name + '**: ' + s.description);
    });
    lines.push('\n当用户请求匹配某个技能时，请严格遵循该技能的步骤和输出格式。');
    return lines.join('\n');
};

// ── 获取匹配技能的详细指令 ──
window.getMatchedSkillsPrompt = function(matchedSkills) {
    if (!matchedSkills || !matchedSkills.length) return '';

    var lines = ['\n## 🎯 匹配到相关技能\n'];
    lines.push('以下技能可能与用户当前请求相关，请参考其指导：\n');

    matchedSkills.forEach(function(s) {
        lines.push('### ' + (s.emoji || '📦') + ' ' + s.name);
        if (s.tools && s.tools.length) {
            lines.push('推荐工具: ' + s.tools.join(', '));
        }
        lines.push('');
        lines.push(s.content);
        lines.push('');
    });

    return lines.join('\n');
};
