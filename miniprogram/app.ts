// app.ts
App<IAppOption>({
  globalData: {
    isDarkMode: false
  },
  onLaunch() {
    // 后端已切换到自建 Node.js + MySQL（见 server/），不再依赖 CloudBase

    // 展示本地存储能力
    const logs = wx.getStorageSync('logs') || []
    logs.unshift(Date.now())
    wx.setStorageSync('logs', logs)

    // 登录（延迟到"我的"页面用户主动点击微信一键登录）
    // 不再自动 wx.login，由 pages/user/index.ts handleLogin 统一管理

    // 初始化深色模式适配
    this.initDarkMode();
  },

  // 初始化深色模式
  initDarkMode() {
    // 获取当前系统主题
    const systemInfo = wx.getSystemInfoSync();
    const isDark = systemInfo.theme === 'dark';
    this.globalData.isDarkMode = isDark;
    this.updateTabBarStyle(isDark);

    // 监听系统主题变化
    wx.onThemeChange((res) => {
      const isDarkMode = res.theme === 'dark';
      this.globalData.isDarkMode = isDarkMode;
      this.updateTabBarStyle(isDarkMode);
    });
  },

  // 更新 tabBar 样式
  updateTabBarStyle(isDark: boolean) {
    if (isDark) {
      wx.setTabBarStyle({
        color: '#B0BEC5',
        selectedColor: '#00E5FF',
        backgroundColor: '#1E212B',
        borderStyle: 'black'
      });
    } else {
      wx.setTabBarStyle({
        color: '#666666',
        selectedColor: '#0066CC',
        backgroundColor: '#FFFFFF',
        borderStyle: 'white'
      });
    }
  },
})