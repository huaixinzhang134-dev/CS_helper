/**
 * 年度猜测页面（每位 top 独立提交，覆盖式，每 slot 最多 3 次）
 */
import { submitPick, fetchMyPicks, fetchPickConfig, searchPlayers, Player } from '../../services/api';

Page({
  data: {
    year: 2026,
    slots: [] as {
      slot: number;
      label: string;
      playerGameId: string;
      playerName: string;
      submissionNo: number;
      maxSubmissions: number;
      canSubmit: boolean;
    }[],
    activeSlot: -1,
    searchQuery: '',
    searchResults: [] as (Player & { avatarUrl: string })[],
    searchLoading: false,
    searchTimer: null as any,
    submitting: false,
    loaded: false,
    filledCount: 0,

    // 暂存当前选择的选手（选选手后不立即提交，需点击"提交"按钮）
    selectedPlayer: null as { playerId: string; name: string } | null,
    // 搜索请求版本号，用于丢弃过期响应的竞态防护
    searchVersion: 0,
  },

  onLoad() {
    wx.showModal({
      title: '猜测须知',
      content: '每位用户对每个 top 位置有 3 次独立提交机会，每次提交覆盖上一次结果，请谨慎选择！',
      confirmText: '我知道了',
      showCancel: false,
      success: () => this.loadAll(),
    });
  },

  async loadAll() {
    wx.showLoading({ title: '加载中...' });
    await this.loadMyPicks();      // 先初始化 slots 数组
    await this.loadPickConfig();   // 再读 slots 设置开关状态
    wx.hideLoading();
    this.setData({ loaded: true });
  },

  async loadMyPicks() {
    const res = await fetchMyPicks(this.data.year);
    const slots = Array.from({ length: 30 }, (_, i) => ({
      slot: i + 1, label: `Top${i + 1}`, playerGameId: '', playerName: '',
      submissionNo: 0, maxSubmissions: 3, canSubmit: true,
    }));
    if (res.success && res.data?.selections) {
      for (const sel of res.data.selections) {
        if (sel.slot >= 1 && sel.slot <= 30) {
          slots[sel.slot - 1] = { ...slots[sel.slot - 1], playerGameId: sel.playerGameId, playerName: sel.playerName, submissionNo: sel.submissionNo, maxSubmissions: sel.maxSubmissions || 3 };
        }
      }
    }
    this.setData({ slots, filledCount: slots.filter(s => s.playerName).length });
  },

  async loadPickConfig() {
    const res = await fetchPickConfig(this.data.year);
    if (res.success && res.data?.config) {
      const slots = [...this.data.slots];
      for (let i = 0; i < 30; i++) {
        const slotNum = i + 1;
        if (res.data.config[slotNum] !== undefined) slots[i].canSubmit = res.data.config[slotNum];
      }
      this.setData({ slots });
    }
  },

  /** 点击某个 slot → 打开搜索弹窗 */
  onSlotTap(e: WechatMiniprogram.TouchEvent) {
    const slot = parseInt(e.currentTarget.dataset.slot, 10);
    const slotData = this.data.slots[slot - 1];
    if (!slotData.canSubmit) {
      wx.showToast({ title: '提交时间已过，不可提交', icon: 'none' });
      return;
    }
    if (slotData.submissionNo >= slotData.maxSubmissions) {
      wx.showToast({ title: `Top${slot} 已达最大提交次数 ${slotData.maxSubmissions}`, icon: 'none' });
      return;
    }
    this.setData({ activeSlot: slot, searchQuery: '', searchResults: [], selectedPlayer: null });
  },

  /** 关闭搜索弹窗（不提交） */
  onCloseSearch() {
    this.setData({ activeSlot: -1, searchQuery: '', searchResults: [], selectedPlayer: null });
  },

  onSearchInput(e: WechatMiniprogram.Input) {
    const query = e.detail.value.trim();
    this.setData({ searchQuery: query });
    if ((this as any).searchTimer) clearTimeout((this as any).searchTimer);
    if (!query) { this.setData({ searchResults: [] }); return; }

    // 递增版本号，用于在异步回调中判断响应是否已过期
    const thisVersion = this.data.searchVersion + 1;
    this.setData({ searchVersion: thisVersion });

    (this as any).searchTimer = setTimeout(async () => {
      this.setData({ searchLoading: true });
      const res = await searchPlayers(query, 0, 30);
      // 竞态防护：只有当前版本号匹配时才更新搜索结果
      if (this.data.searchVersion === thisVersion) {
        this.setData({
          searchResults: res.success && res.data ? res.data.map(p => ({ ...p, avatarUrl: p.avatar || '' })) : [],
          searchLoading: false,
        });
      } else {
        // 过期响应，忽略
        this.setData({ searchLoading: false });
      }
    }, 300);
  },

  /** 点选选手 → 暂存到 selectedPlayer，不立即提交 */
  onSelectPlayer(e: WechatMiniprogram.TouchEvent) {
    const playerId = e.currentTarget?.dataset?.playerId as string;
    const slot = this.data.activeSlot;
    if (!playerId || !slot) {
      console.warn('[pick] onSelectPlayer 缺少 playerId 或 slot', { playerId, slot });
      return;
    }

    // 从 searchResults 中查找完整的选手信息
    const player = this.data.searchResults.find(p => p.playerId === playerId);
    if (!player) {
      console.warn('[pick] 选手未在 searchResults 中找到', { playerId, searchResultsLen: this.data.searchResults.length });
      wx.showToast({ title: '搜索结果已过期，请重新搜索', icon: 'none' });
      return;
    }

    // 检查是否在其他 slot 已选
    const existing = this.data.slots.find(s => s.playerGameId === playerId && s.slot !== slot);
    if (existing) {
      wx.showToast({ title: `该选手已在 Top${existing.slot}`, icon: 'none' });
      return;
    }

    this.setData({ selectedPlayer: { playerId: player.playerId, name: player.name } });
  },

  /** 点击"提交"按钮 → 正式提交该 slot */
  async onSubmitSlot() {
    const { activeSlot: slot, selectedPlayer } = this.data;
    if (!slot || slot < 1 || slot > 30 || !selectedPlayer) return;

    this.setData({ submitting: true });
    const result = await submitPick(slot, selectedPlayer.playerId, selectedPlayer.name, this.data.year);

    if (result.success && result.data) {
      wx.showToast({ title: `Top${slot} 第 ${result.data.submissionNo} 次提交成功`, icon: 'success' });
      await this.loadMyPicks();
    } else {
      wx.showToast({ title: result.message || '提交失败', icon: 'none' });
    }

    this.setData({ submitting: false, activeSlot: -1, searchQuery: '', searchResults: [], selectedPlayer: null });
  },

  /** 清除某个 slot 的选择 */
  async onClearSlot(e: WechatMiniprogram.TouchEvent) {
    const slot = parseInt(e.currentTarget.dataset.slot, 10);
    if (slot < 1 || slot > 30) return;
    this.setData({ submitting: true });
    const result = await submitPick(slot, '', '', this.data.year);
    if (result.success) await this.loadMyPicks();
    else wx.showToast({ title: result.message || '清除失败', icon: 'none' });
    this.setData({ submitting: false });
  },
});
