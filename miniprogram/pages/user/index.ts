/**
 * "我的"页面 —— 微信一键登录 + 用户信息展示
 *
 * 登录流程：
 *   1. 用户点击"微信一键登录"
 *   2. wx.login() 获取临时 code
 *   3. 调用后端 POST /api/users/login（服务端 code2session 换 openid）
 *   4. 后端返回 token + 用户信息
 *   5. 本地缓存 token 和用户信息
 *
 * 编辑信息：
 *   用户可修改昵称，从微信选择头像
 *   调用 PUT /api/users/profile 保存到后端
 */
import { loginWithWeChat, fetchUserProfile, updateUserProfile, UserInfo, fetchGuessRecords, GuessRecordItem } from '../../services/api';

Page({
  data: {
    userInfo: null as UserInfo | null,
    loading: false,
    isEditing: false,
    editNickname: '',
    editAvatarUrl: '',
    showGuessRecords: false,
    guessRecords: [] as GuessRecordItem[],
    recordPage: 0,
    recordHasMore: false,
    recordLoading: false,
    diffMap: {
      easy: '简单',
      hard: '困难',
      hell: '地狱',
      personal: '个人'
    }
  },

  onShow() {
    // 每次显示页面时从缓存拉取最新数据
    const cached = wx.getStorageSync('userInfo');
    if (cached && cached.openid) {
      this.setData({ userInfo: cached });
      // 异步刷新
      this.refreshUserInfo();
    }
  },

  onPullDownRefresh() {
    if (this.data.userInfo) {
      this.refreshUserInfo().finally(() => {
        wx.stopPullDownRefresh();
      });
    } else {
      wx.stopPullDownRefresh();
    }
  },

  /**
   * 从后端刷新用户信息
   */
  async refreshUserInfo() {
    const res = await fetchUserProfile();
    if (res.success && res.data) {
      wx.setStorageSync('userInfo', res.data);
      this.setData({ userInfo: res.data });
    }
  },

  /**
   * 微信一键登录
   */
  async handleLogin() {
    this.setData({ loading: true });

    try {
      // 1. wx.login() 获取临时 code
      const loginRes = await wx.login();
      if (!loginRes.code) {
        wx.showToast({ title: '获取登录凭证失败', icon: 'none' });
        return;
      }

      // 2. 将 code 发到后端换取 openid + token
      const result = await loginWithWeChat(loginRes.code);
      if (!result.success || !result.data) {
        wx.showToast({ title: result.message || '登录失败', icon: 'none' });
        return;
      }

      // 3. 登录成功，更新页面
      this.setData({ userInfo: result.data.user });
      wx.showToast({ title: '登录成功', icon: 'success' });

    } catch (err) {
      console.error('Login failed', err);
      wx.showToast({ title: '登录异常，请重试', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  /**
   * 打开编辑资料页面
   */
  onEditProfile() {
    if (!this.data.userInfo) return;
    this.setData({
      isEditing: true,
      editNickname: this.data.userInfo.nickname,
      editAvatarUrl: this.data.userInfo.avatarUrl || ''
    });
  },

  /**
   * 编辑页面：选择微信头像
   */
  onChooseAvatar(e: any) {
    // 微信新版 API：通过 button open-type="chooseAvatar" 获取
    const avatarUrl = e.detail.avatarUrl;
    if (avatarUrl) {
      this.setData({ editAvatarUrl: avatarUrl });
    }
  },

  /**
   * 编辑页面：输入昵称
   */
  onNicknameInput(e: any) {
    this.setData({ editNickname: e.detail.value });
  },

  /**
   * 保存编辑资料
   */
  async onSaveProfile() {
    const { editNickname, editAvatarUrl } = this.data;
    if (!editNickname.trim()) {
      wx.showToast({ title: '昵称不能为空', icon: 'none' });
      return;
    }

    wx.showLoading({ title: '保存中...' });

    const payload: { nickname?: string; avatarUrl?: string } = {};
    payload.nickname = editNickname.trim();
    if (editAvatarUrl && editAvatarUrl !== this.data.userInfo?.avatarUrl) {
      payload.avatarUrl = editAvatarUrl;
    }

    const res = await updateUserProfile(payload);
    wx.hideLoading();

    if (res.success && res.data) {
      wx.setStorageSync('userInfo', res.data);
      this.setData({
        userInfo: res.data,
        isEditing: false
      });
      wx.showToast({ title: '保存成功', icon: 'success' });
    } else {
      wx.showToast({ title: res.message || '保存失败', icon: 'none' });
    }
  },

  /**
   * 取消编辑
   */
  onCancelEdit() {
    this.setData({ isEditing: false });
  },

  /**
   * 打开竞猜记录
   */
  async onOpenGuessRecords() {
    if (!this.data.userInfo) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      return;
    }
    this.setData({
      showGuessRecords: true,
      guessRecords: [],
      recordPage: 0,
      recordHasMore: false,
      recordLoading: true
    });
    await this.loadGuessRecords(0);
  },

  /**
   * 加载竞猜记录
   */
  async loadGuessRecords(page: number) {
    this.setData({ recordLoading: true });
    const res = await fetchGuessRecords(page, 20);
    if (res.success && res.data) {
      const records = res.data.list.map(r => ({
        ...r,
        _dateStr: this._formatDate(r.playedAt)
      }));
      this.setData({
        guessRecords: page === 0 ? records : [...this.data.guessRecords, ...records],
        recordPage: page,
        recordHasMore: res.data.hasMore,
        recordLoading: false
      });
    } else {
      this.setData({ recordLoading: false });
    }
  },

  /**
   * 滚动加载更多记录
   */
  onRecordScrollToLower() {
    const { recordHasMore, recordLoading, recordPage } = this.data;
    if (recordHasMore && !recordLoading) {
      this.loadGuessRecords(recordPage + 1);
    }
  },

  /**
   * 关闭竞猜记录
   */
  onCloseGuessRecords() {
    this.setData({ showGuessRecords: false });
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
          wx.removeStorageSync('token');
          wx.showToast({ title: '已退出', icon: 'none' });
        }
      }
    });
  },

  /**
   * 格式化日期为短格式
   */
  _formatDate(isoStr: string): string {
    if (!isoStr) return '';
    try {
      const d = new Date(isoStr);
      const month = (d.getMonth() + 1).toString().padStart(2, '0');
      const day = d.getDate().toString().padStart(2, '0');
      const hour = d.getHours().toString().padStart(2, '0');
      const min = d.getMinutes().toString().padStart(2, '0');
      return `${month}-${day} ${hour}:${min}`;
    } catch {
      return isoStr.slice(5, 16) || '';
    }
  },

  /**
   * 关于我们
   */
  onAbout() {
    wx.showModal({
      title: '关于我们',
      content: '云雪CS助手 - 为CS玩家提供赛事查询、选手资料、竞猜互动等服务。',
      showCancel: false
    });
  }
});
