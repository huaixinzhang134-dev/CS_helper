import { login, UserProfile } from '../../services/api';

Page({
  data: {
    userInfo: null as UserProfile | null,
    loading: false
  },

  onLoad() {
    // 检查本地存储是否有用户信息
    const storedUser = wx.getStorageSync('userInfo');
    if (storedUser) {
      this.setData({ userInfo: storedUser });
    }
  },

  /**
   * 处理登录
   */
  async handleLogin() {
    this.setData({ loading: true });
    try {
      // 模拟登录过程
      const res = await login();
      if (res.success) {
        this.setData({ userInfo: res.data });
        wx.setStorageSync('userInfo', res.data);
        wx.showToast({ title: '登录成功', icon: 'success' });
      }
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