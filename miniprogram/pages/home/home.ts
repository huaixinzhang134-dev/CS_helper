/**
 * 首页 —— 上三下二导航布局
 * 上排：赛事中心/猜一猜/选手资料库
 * 下排：商城/我的
 */
const VERSION = 'v1.4.4';
const VERSION_STORAGE_KEY = 'home_version_shown';

Page({
  data: {
    showUpdateModal: false,
    version: VERSION,
    updateContent: `欢迎也感谢各位使用云雪CS助手${VERSION}！
本次更新如下内容：

1. 修复视觉混淆搜索（1↔i↔l、0↔o）变体逻辑错误导致搜不到结果的问题

2. 搜索从前缀匹配升级为包含匹配，搜 kk 可命中 BELCHONOKK，搜 zz 可命中 Twistzz

3. 修复一键登录及赛事/选手页面请求超时问题，新增网络请求超时保护

4. 搜索性能优化，移除冗余 COUNT 查询，提速约 50%

5. 服务器连接池增加超时保护，防止数据库连接耗尽导致服务挂死`,

    // 上排两个大框
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
    ],
    // 下排三个小框
    bottomMenus: [
      {
        id: 'players',
        title: '选手资料库',
        desc: '选手数据与排行榜',
        page: '/pages/player/list',
        isTab: true,
      },
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
    try {
      const shown = wx.getStorageSync(VERSION_STORAGE_KEY);
      // 确保类型安全比较：空值/未定义/类型不匹配都视作未读
      if (shown === '' || shown === undefined || shown === null || shown !== VERSION) {
        this.setData({ showUpdateModal: true });
      }
    } catch (e) {
      console.warn('[版本检测] 读取存储失败，默认显示更新公告', e);
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
