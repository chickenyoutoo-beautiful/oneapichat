(function() {
    if (window._autoAnswerLoaded) return;
    window._autoAnswerLoaded = true;
    
    var s = document.createElement('script');
    s.src = 'https://115.29.211.17/oneapichat/auto_answer.js';
    document.body.appendChild(s);
    
    // 显示提示
    var div = document.createElement('div');
    div.style.cssText = 'position:fixed;top:10px;left:50%;transform:translateX(-50%);z-index:999999;background:#6366f1;color:#fff;padding:8px 20px;border-radius:8px;font-size:13px;box-shadow:0 4px 12px rgba(0,0,0,0.3)';
    div.textContent = '🤖 自动答题脚本已加载，过验证码后自动答题';
    document.body.appendChild(div);
    setTimeout(function() { div.remove(); }, 5000);
})();
