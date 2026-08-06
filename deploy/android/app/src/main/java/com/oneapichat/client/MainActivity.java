package com.oneapichat.client;

import android.os.Bundle;
import android.webkit.WebSettings;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // WebView 性能优化
        WebView webView = getBridge().getWebView();
        if (webView != null) {
            WebSettings settings = webView.getSettings();
            // 启用 JavaScript（必须）
            settings.setJavaScriptEnabled(true);
            // 启用 DOM Storage（localStorage 支持）
            settings.setDomStorageEnabled(true);
            // 启用数据库
            settings.setDatabaseEnabled(true);
            // 自适应屏幕
            settings.setUseWideViewPort(true);
            settings.setLoadWithOverviewMode(true);
            // 支持缩放
            settings.setBuiltInZoomControls(true);
            settings.setDisplayZoomControls(false);
            // 允许文件访问
            settings.setAllowFileAccess(true);
            // 混合内容模式（HTTPS 页面加载 HTTPS 资源）
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
            // 缓存模式
            settings.setCacheMode(WebSettings.LOAD_DEFAULT);
            // 用户代理标识
            settings.setUserAgentString(settings.getUserAgentString() + " OneAPIChat-Android/4.0.0");
        }
    }
}
