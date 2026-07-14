/**
 * 首页 —— 上三下二导航布局
 * 上排：赛事中心/猜一猜/选手资料库
 * 下排：商城/我的
 */
Page({
  data: {
    // 上排三个
    topMenus: [
      {
        id: 'events',
        icon: '/assets/icons/SS.png',
        title: '赛事中心',
        desc: '查看比赛与赛事信息',
        page: '/pages/events/events',
        isTab: true,
      },
      {
        id: 'guess',
        icon: '/assets/icons/guess.png',
        title: '猜一猜',
        desc: '看看你对CS职业有多了解',
        page: '/pages/guess/guess',
        isTab: true,
      },
      {
        id: 'players',
        icon: '/assets/icons/playerbase.png',
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
        icon: '/assets/icons/game.png',
        title: '道具商城',
        desc: '代币购买道具',
        page: '/pages/shop/shop',
        isTab: false,
      },
      {
        id: 'profile',
        icon: '/assets/icons/mine.png',
        title: '我的',
        desc: '个人信息与代币管理',
        page: '/pages/user/index',
        isTab: true,
      },
    ],
  },

  onLoad() {},

  onShow() {},

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
