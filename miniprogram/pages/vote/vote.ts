/**
 * 年度投票页面（每位 top 独立提交，覆盖式，每 slot 最多 3 次）
 */
import { submitVoteSlot, fetchMyVotes, fetchVoteSlotConfig, searchPlayers, Player } from '../../services/api';

Page({
  data: {
    year: 2026,
    // 30 个 slot 数据
    slots: [] as {
      slot: number;
      label: string;
      playerGameId: string;
      playerName: string;
      submissionNo: number;
      maxSubmissions: number;
      canSubmit: boolean; // 管理员是否开启该位置
    }[],
    // 当前正在搜索的 slot（-1 表示无）
    activeSlot: -1,
    searchQuery: '',
    searchResults: [] as (Player & { avatarUrl: string })[],
    searchLoading: false,
    searchTimer: null as any,
    submitting: false,
    loaded: false,
    filledCount: 0,
  },

  onLoad() {
    wx.showModal({
      title: '投票须知',
      content: '每位用户对每个 top 位置有 3 次独立提交机会，每次提交覆盖上一次结果，请谨慎选择！',
      confirmText: '我知道了',
      showCancel: false,
      success: () => {
        this.loadAll();
      },
    });
  },

  async loadAll() {
    wx.showLoading({ title: '加载中...' });
    await Promise.all([this.loadMyVotes(), this.loadSlotConfig()]);
    wx.hideLoading();
    this.setData({ loaded: true });
  },

  /** 加载我的当前投票 */
  async loadMyVotes() {
    const res = await fetchMyVotes(this.data.year);
    const slots = Array.from({ length: 30 }, (_, i) => ({
      slot: i + 1,
      label: `Top${i + 1}`,
      playerGameId: '',
      playerName: '',
      submissionNo: 0,
      maxSubmissions: 3,
      canSubmit: true,
    }));

    if (res.success && res.data?.selections) {
      for (const sel of res.data.selections) {
        if (sel.slot >= 1 && sel.slot <= 30) {
          slots[sel.slot - 1] = {
            ...slots[sel.slot - 1],
            playerGameId: sel.playerGameId,
            playerName: sel.playerName,
            submissionNo: sel.submissionNo,
            maxSubmissions: sel.maxSubmissions || 3,
          };
        }
      }
    }
    const filledCount = slots.filter(s => s.playerName).length;
    this.setData({ slots, filledCount });
  },

  /** 加载各 top 提交开关 */
  async loadSlotConfig() {
    const res = await fetchVoteSlotConfig(this.data.year);
    if (res.success && res.data?.config) {
      const slots = [...this.data.slots];
      for (let i = 0; i < 30; i++) {
        const slotNum = i + 1;
        if (res.data.config[slotNum] !== undefined) {
          slots[i].canSubmit = res.data.config[slotNum];
        }
      }
      this.setData({ slots });
    }
  },

  /** 点击某个 slot */
  onSlotTap(e: WechatMiniprogram.TouchEvent) {
    const slot = parseInt(e.currentTarget.dataset.slot, 10);
    const slotData = this.data.slots[slot - 1];

    // 检查是否可提交
    if (!slotData.canSubmit) {
      wx.showToast({ title: '提交时间已过，不可提交', icon: 'none' });
      return;
    }

    // 检查提交次数
    if (slotData.submissionNo >= slotData.maxSubmissions) {
      wx.showToast({ title: `Top${slot} 已达最大提交次数 ${slotData.maxSubmissions}`, icon: 'none' });
      return;
    }

    this.setData({
      activeSlot: slot,
      searchQuery: '',
      searchResults: [],
    });
  },

  onCloseSearch() {
    this.setData({ activeSlot: -1, searchQuery: '', searchResults: [] });
  },

  onSearchInput(e: WechatMiniprogram.Input) {
    const query = e.detail.value.trim();
    this.setData({ searchQuery: query });
    if ((this as any).searchTimer) clearTimeout((this as any).searchTimer);
    if (!query) { this.setData({ searchResults: [] }); return; }

    (this as any).searchTimer = setTimeout(async () => {
      this.setData({ searchLoading: true });
      const res = await searchPlayers(query, 0, 30);
      if (res.success && res.data) {
        this.setData({ searchResults: res.data.map(p => ({ ...p, avatarUrl: p.avatar || '' })), searchLoading: false });
      } else {
        this.setData({ searchResults: [], searchLoading: false });
      }
    }, 300);
  },

  /** 选择选手 → 立即提交该 slot */
  async onSelectPlayer(e: WechatMiniprogram.TouchEvent) {
    const player = e.currentTarget.dataset.player as Player;
    const slot = this.data.activeSlot;
    if (slot < 1 || slot > 30) return;

    // 检查是否在其他 slot 已选
    const existing = this.data.slots.find(s => s.playerGameId === player.playerId && s.slot !== slot);
    if (existing) {
      wx.showToast({ title: `该选手已在 Top${existing.slot}`, icon: 'none' });
      return;
    }

    this.setData({ submitting: true });

    const result = await submitVoteSlot(slot, player.playerId, player.name, this.data.year);

    if (result.success && result.data) {
      wx.showToast({ title: `Top${slot} 第 ${result.data.submissionNo} 次提交成功`, icon: 'success' });
      await this.loadMyVotes(); // 刷新
    } else {
      wx.showToast({ title: result.message || '提交失败', icon: 'none' });
    }

    this.setData({ submitting: false, activeSlot: -1, searchQuery: '', searchResults: [] });
  },

  /** 清除某个 slot 的选择 */
  async onClearSlot(e: WechatMiniprogram.TouchEvent) {
    const slot = parseInt(e.currentTarget.dataset.slot, 10);
    if (slot < 1 || slot > 30) return;

    // 清除：用空字符串覆盖
    this.setData({ submitting: true });
    const result = await submitVoteSlot(slot, '', '', this.data.year);
    if (result.success) {
      await this.loadMyVotes();
    } else {
      wx.showToast({ title: result.message || '清除失败', icon: 'none' });
    }
    this.setData({ submitting: false });
  },
});
