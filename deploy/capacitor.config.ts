import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.oneapichat.client',
  appName: 'OneAPIChat',
  webDir: '../public',

  // 服务器地址配置（运行时可通过 Preferences 持久化）
  serverUrl: 'https://naujtrats.xyz/oneapichat/',

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
