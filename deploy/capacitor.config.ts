import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.oneapichat.client',
  appName: 'OneAPIChat',
  webDir: '../public',

  // ★ 远程服务器模式：WebView 直接从服务器加载页面（与 Electron 一致）
  server: {
    url: 'https://naujtrats.xyz/oneapichat/',
    // Android WebView 的 Origin 为 capacitor://localhost，需加入 CORS 白名单
    androidScheme: 'https',
  },

  android: {
    buildType: 'release',
    backgroundColor: '#0f172a',
    // 允许 Cleartext 调试（生产环境走 HTTPS 不需要）
    allowMixedContent: false,
    // WebView 初始缩放
    initialFocus: true,
    // 最小 SDK（Android 7.0+）
    minSdkVersion: 24,
    // 目标 SDK
    targetSdkVersion: 34,
  },

  plugins: {
    SplashScreen: {
      launchShowDuration: 1200,
      backgroundColor: '#0f172a',
      showSpinner: false,
      androidSplashResourceName: 'splash',
      splashFullScreen: true,
      splashImmersive: true,
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#0f172a',
    },
    // 浏览器插件：外部链接在系统浏览器打开
    Browser: {
      presentationStyle: 'popover',
    },
  },
};

export default config;
