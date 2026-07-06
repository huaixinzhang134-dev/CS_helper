/**
 * "我的"页面 —— 微信登录流程
 *
 * 登录流程：
 *   1. wx.login() 获取临时 code
 *   2. 将 code 发送到后端换取 openid（后续对接 WeChat API）
 *   3. 使用 <button open-type="getUserInfo"> 获取昵称和头像
 */
Page({
  data: {
    userInfo: null as any,
    loading: false
  },

  onLoad() {
    const storedUser = wx.getStorageSync('userInfo');
    if (storedUser) {
      this.setData({ userInfo: storedUser });
    } else {
      // 尝试恢复上次的匿名登录状态
      const openid = wx.getStorageSync('openid');
      if (openid) {
        this.setData({
          userInfo: {
            uid: openid,
            openid: openid,
            nickname: '微信用户',
            avatarUrl: '/assets/icons/game.png',
            level: 1,
            points: 0
          }
        });
      }
    }
  },

  /**
   * 微信登录流程
   */
  async handleLogin() {
    this.setData({ loading: true });

    try {
      // 1. 获取微信登录 code
      const loginRes = await wx.login();
      if (!loginRes.code) {
        wx.showToast({ title: '登录失败', icon: 'none' });
        return;
      }

      // 2. 获取用户头像昵称（新版微信需通过 button open-type 获取）
      //    这里先使用 code 作为临时 uid，后续可对接后端 code2session
      const tempUid = loginRes.code.slice(-16);

      // 3. 尝试调用 wx.getUserProfile（部分版本仍可用）
      let nickname = '微信用户';
      let avatarUrl = '/assets/icons/game.png';

      try {
        const profileRes = await wx.getUserProfile({ desc: '用于展示用户信息' });
        if (profileRes && profileRes.userInfo) {
          nickname = profileRes.userInfo.nickName || nickname;
          avatarUrl = profileRes.userInfo.avatarUrl || avatarUrl;
        }
      } catch {
        // getUserProfile 不可用时用默认值
      }

      const userInfo = {
        uid: tempUid,
        openid: tempUid,
        nickname,
        avatarUrl,
        level: 1,
        points: 0
      };

      this.setData({ userInfo });
      wx.setStorageSync('userInfo', userInfo);
      wx.setStorageSync('openid', tempUid);
      wx.showToast({ title: '登录成功', icon: 'success' });

    } catch (err) {
      console.error('Login failed', err);
      wx.showToast({ title: '登录失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  /**
   * 退出登录
   */
  handleLogout() {
    wx.showModal({
      title: '提示',
      content: '确定要退出登录吗？',
      success: (res) => {
        if (res.confirm) {
          this.setData({ userInfo: null });
          wx.removeStorageSync('userInfo');
          wx.showToast({ title: '已退出', icon: 'none' });
        }
      }
    });
  }
});
