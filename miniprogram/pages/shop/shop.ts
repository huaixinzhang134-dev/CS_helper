/**
 * 商城页面 —— 代币消费
 */
import { fetchShopItems, fetchUserItems, fetchCoinBalance, fetchCoinTransactions, buyShopItem, adRewardCoins, ShopItem, UserItem } from '../../services/api';
import { playRewardedAd } from '../../services/ad';

Page({
  data: {
    coins: 0,
    shopItems: [] as (ShopItem & { bought: number })[],
    userItems: [] as UserItem[],
    loading: true,
    buying: false,
    isAdWatching: false,
    showRecordsModal: false,
    coinRecords: [] as { amount: number; typeLabel: string; isIncome: boolean; description: string; time: string }[],
  },

  onLoad() {
    this.loadData();
  },

  onShow() {
    // 每次回来看余额是否变了
    this.loadCoinBalance();
  },

  async loadData() {
    this.setData({ loading: true });
    await Promise.all([
      this.loadCoinBalance(),
      this.loadShopItems(),
    ]);
    this.setData({ loading: false });
  },

  async loadCoinBalance() {
    const token = wx.getStorageSync('token');
    if (!token) return;
    const res = await fetchCoinBalance();
    if (res.success && res.data) {
      this.setData({ coins: res.data.coins });
    }
  },

  async loadShopItems() {
    const token = wx.getStorageSync('token');
    const [shopRes, itemsRes] = await Promise.all([
      fetchShopItems(),
      token ? fetchUserItems() : Promise.resolve({ success: true, data: [] }),
    ]);

    const userItems: UserItem[] = itemsRes.success ? (itemsRes.data || []) : [];
    const shopItems = (shopRes.success ? (shopRes.data || []) : []).map(item => {
      const owned = userItems.find(u => u.itemType === item.itemType);
      return { ...item, bought: owned?.quantity || 0 };
    });

    this.setData({ shopItems, userItems });
  },

  /** 观看广告获取66代币 */
  async onWatchAd() {
    const token = wx.getStorageSync('token');
    if (!token) { wx.showToast({ title: '请先登录', icon: 'none' }); return; }
    if (this.data.isAdWatching) return;
    this.setData({ isAdWatching: true });
    const adResult = await playRewardedAd();
    if (adResult !== 'completed') {
      this.setData({ isAdWatching: false });
      if (adResult === 'closed_early') {
        wx.showToast({ title: '请完整观看广告', icon: 'none' });
      } else {
        wx.showToast({ title: '广告加载失败，请重试', icon: 'none' });
      }
      return;
    }
    const res = await adRewardCoins();
    this.setData({ isAdWatching: false });
    if (res.success) {
      wx.showToast({ title: '获得66代币！', icon: 'success' });
      await this.loadCoinBalance();
    } else {
      wx.showToast({ title: res.message || '领取失败', icon: 'none' });
    }
  },

  /** 查看代币记录 */
  async onShowRecords() {
    const token = wx.getStorageSync('token');
    if (!token) { wx.showToast({ title: '请先登录', icon: 'none' }); return; }
    wx.showLoading({ title: '加载中...' });
    const res = await fetchCoinTransactions(0, 50);
    wx.hideLoading();
    const records = res.success && res.data ? res.data.list || [] : [];
    const typeLabels: Record<string, string> = {
      guess_reward: '猜对奖励',
      ad_reward: '广告奖励',
      spend: '兑换道具',
      game_fee: '挑战入场费',
    };
    const items = records.map((r: any) => ({
      amount: r.amount,
      typeLabel: typeLabels[r.type] || r.type,
      isIncome: r.amount > 0,
      description: r.description || '',
      time: r.createdAt ? r.createdAt.slice(0, 16).replace('T', ' ') : '',
    }));
    if (!items.length) {
      wx.showToast({ title: '暂无记录', icon: 'none' });
      return;
    }
    this.setData({ showRecordsModal: true, coinRecords: items });
  },

  onRecordsModalClose() {
    this.setData({ showRecordsModal: false });
  },

  async onBuy(e: WechatMiniprogram.TouchEvent) {
    const itemId = e.currentTarget.dataset.id;
    const item = this.data.shopItems.find(i => i.id === itemId);
    if (!item) return;

    if (this.data.coins < item.price) {
      wx.showToast({ title: '代币不足', icon: 'none' });
      return;
    }

    if (this.data.buying) return;
    this.setData({ buying: true });

    wx.showModal({
      title: '确认购买',
      content: `确定花费 ${item.price} 代币购买「${item.name}」吗？`,
      success: async (res) => {
        if (res.confirm) {
          const result = await buyShopItem(itemId);
          if (result.success && result.data) {
            wx.showToast({ title: '购买成功', icon: 'success' });
            await this.loadData();
          } else {
            wx.showToast({ title: result.message || '购买失败', icon: 'none' });
          }
        }
        this.setData({ buying: false });
      },
      fail: () => {
        this.setData({ buying: false });
      }
    });
  },
});
