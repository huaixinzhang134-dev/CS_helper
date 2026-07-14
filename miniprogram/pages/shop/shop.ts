/**
 * 商城页面 —— 代币消费
 */
import { fetchShopItems, fetchUserItems, fetchCoinBalance, buyShopItem, ShopItem, UserItem } from '../../services/api';

Page({
  data: {
    coins: 0,
    shopItems: [] as (ShopItem & { bought: number })[],
    userItems: [] as UserItem[],
    loading: true,
    buying: false,
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
