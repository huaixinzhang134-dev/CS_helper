/**
 * 首页 —— 上三下二导航布局
 * 上排：赛事中心/猜一猜/选手资料库
 * 下排：商城/我的
 */
const VERSION = 'v1.5.0';
const VERSION_STORAGE_KEY = 'home_version_shown';

Page({
  data: {
    showUpdateModal: false,
    version: VERSION,
    updateContent: `欢迎也感谢各位使用云雪CS助手${VERSION}！
本次更新内容如下：

1. 优化了版本更新弹窗的显示逻辑，现在每次进入首页都会检测弹窗，不再有部分设备不显示的问题

2. 网页端已同步更新，新增了版本更新公告弹窗功能，以及关于我们页面

3. 在"关于我们"中增加了联系方式，方便大家反馈问题

4. 修复了若干已知问题，提升了整体稳定性`,

    // 上排三个
    topMenus: [
      {
        id: 'events',
        title: '赛事中心',
        desc: '查看比赛与赛事信息',
        page: '/pages/events/events',
        isTab: true,
      },
      {
        id: 'guess',
        title: '猜一猜',
        desc: '看看你对CS职业有多了解',
        page: '/pages/guess/guess',
        isTab: true,
      },
      {
        id: 'players',
        title: '选手资料库',
        desc: '选手数据与排行榜',
        page: '/pages/player/list',
        isTab: true,
      },
    ],
    // 下排两个
    bottomMenus: [
      {
        id: 'shop',
        title: '道具商城',
        desc: '代币购买道具',
        page: '/pages/shop/shop',
        isTab: false,
      },
      {
        id: 'profile',
        title: '我的',
        desc: '个人信息与代币管理',
        page: '/pages/user/index',
        isTab: true,
      },
    ],
  },

  onLoad() {
    this.checkShowUpdate();
  },

  onShow() {
    // 每次切回首页都检测弹窗（tab 页 onShow 每次触发）
    this.checkShowUpdate();
  },

  /**
   * 检查并显示版本更新公告
   */
  checkShowUpdate() {
    const shown = wx.getStorageSync(VERSION_STORAGE_KEY);
    if (shown !== VERSION) {
      this.setData({ showUpdateModal: true });
    }
  },

  /** 关闭更新公告 */
  onCloseUpdate() {
    wx.setStorageSync(VERSION_STORAGE_KEY, VERSION);
    this.setData({ showUpdateModal: false });
  },

  onUpdateMaskTap() {
    // 点击蒙层不关闭，必须点击按钮
  },

  /**
   * 点击菜单项 → 跳转对应页面
   */
  onTapMenu(e: WechatMiniprogram.TouchEvent) {
    const item = e.currentTarget.dataset.item;
    if (!item) return;

    if (item.isTab) {
      wx.switchTab({ url: item.page });
    } else {
      wx.navigateTo({ url: item.page });
    }
  },
});
