/**
 * 首页 —— 上三下二导航布局
 * 上排：赛事中心/猜一猜/选手资料库
 * 下排：商城/我的
 */
const VERSION = 'v1.4.0';
const VERSION_STORAGE_KEY = 'home_version_shown';

Page({
  data: {
    showUpdateModal: false,
    version: VERSION,
    updateContent: `欢迎也感谢各位使用云雪CS助手${VERSION}！
本次更新如下内容：

1. 添加了代币（本小程序虚拟货币）和代币商城功能，可以在之后的活动中获取代币以购买游戏道具

2. 添加了赛事评论功能，现在可以在单场比赛的详情页面选择选手评论啦

3. 添加了TOP30猜测界面，现在可以进行本年度TOP30的猜测啦，年末出结果，猜对越多，奖励越丰厚哦

4. 添加了小程序首页，这下大家使用会更加清晰，简洁明了啦

5. 优化了猜一猜好友对战的逻辑，现在双方对战完后都点击再来一局可以直接开始下一回合，无需重复分享即可继续游玩`,

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

  onShow() {},

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
