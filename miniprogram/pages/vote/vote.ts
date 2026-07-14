/**
 * 年度投票页面（问卷形式）
 * 设置 top1 ~ top30，每人最多提交3次
 */
import { submitVotes, fetchMyVotes, searchPlayers, Player } from '../../services/api';

Page({
  data: {
    year: 2026,
    // 30个选择框 slotData[0]~slotData[29] 对应 top1~top30
    slots: Array.from({ length: 30 }, (_, i) => ({
      slot: i + 1,
      label: `Top${i + 1}`,
      playerGameId: '',
      playerName: '',
    })),
    // 当前正在搜索的 slot 索引（-1 表示无）
    activeSlot: -1,
    searchQuery: '',
    searchResults: [] as (Player & { avatarUrl: string })[],
    searchLoading: false,
    searchTimer: null as any,

    // 已填写的数量
    filledCount: 0,
    submissionNo: 0, // 当前第几次提交
    hasVoted: false,
    submitting: false,

    // 提交次数提示
    maxSubmissions: 3,
    submissionHint: '',
  },

  onLoad() {
    // 进入页面时弹出提示：仅三次投票机会
    wx.showModal({
      title: '投票须知',
      content: '每位用户仅有 3 次提交机会，每次提交将覆盖上一次结果，请谨慎选择！',
      confirmText: '我知道了',
      showCancel: false,
      success: () => {
        this.loadMyVotes();
      },
    });
  },

  /**
   * 加载我的当前投票
   */
  async loadMyVotes() {
    const res = await fetchMyVotes(this.data.year);
    if (res.success && res.data?.hasVoted) {
      const slots = [...this.data.slots];
      for (const sel of res.data.selections) {
        if (sel.slot >= 1 && sel.slot <= 30) {
          slots[sel.slot - 1] = {
            ...slots[sel.slot - 1],
            playerGameId: sel.playerGameId,
            playerName: sel.playerName,
          };
        }
      }
      const filledCount = slots.filter(s => s.playerName).length;
      this.setData({
        slots,
        filledCount,
        hasVoted: true,
        submissionNo: res.data.submissionNo,
        submissionHint: `已提交 ${res.data.submissionNo}/3 次，再次提交将覆盖上次`,
      });
    } else {
      this.setData({
        submissionHint: `可提交最多 ${this.data.maxSubmissions} 次，每次覆盖上次`,
      });
    }
  },

  /**
   * 点击某个 slot 的搜索框
   */
  onSlotTap(e: WechatMiniprogram.TouchEvent) {
    const slot = e.currentTarget.dataset.slot;
    this.setData({
      activeSlot: slot,
      searchQuery: '',
      searchResults: [],
    });
  },

  /**
   * 关闭搜索弹出层
   */
  onCloseSearch() {
    this.setData({
      activeSlot: -1,
      searchQuery: '',
      searchResults: [],
    });
  },

  /**
   * 搜索输入
   */
  onSearchInput(e: WechatMiniprogram.Input) {
    const query = e.detail.value.trim();
    this.setData({ searchQuery: query });

    if ((this as any).searchTimer) clearTimeout((this as any).searchTimer);

    if (!query) {
      this.setData({ searchResults: [] });
      return;
    }

    (this as any).searchTimer = setTimeout(async () => {
      this.setData({ searchLoading: true });
      const res = await searchPlayers(query, 0, 30);
      if (res.success && res.data) {
        this.setData({
          searchResults: res.data.map(p => ({
            ...p,
            avatarUrl: p.avatar || '',
          })),
          searchLoading: false,
        });
      } else {
        this.setData({ searchResults: [], searchLoading: false });
      }
    }, 300);
  },

  /**
   * 选择搜索到的选手
   */
  onSelectPlayer(e: WechatMiniprogram.TouchEvent) {
    const player = e.currentTarget.dataset.player as Player;
    const activeSlot = this.data.activeSlot;
    if (activeSlot < 1 || activeSlot > 30) return;

    const slots = [...this.data.slots];
    // 检查该选手是否已在其他 slot 被选
    const existingSlot = slots.find(s => s.playerGameId === player.playerId && s.slot !== activeSlot);
    if (existingSlot) {
      wx.showToast({ title: `该选手已在 Top${existingSlot.slot}`, icon: 'none' });
      return;
    }

    slots[activeSlot - 1] = {
      slot: activeSlot,
      label: `Top${activeSlot}`,
      playerGameId: player.playerId,
      playerName: player.name,
    };

    const filledCount = slots.filter(s => s.playerName).length;
    this.setData({
      slots,
      filledCount,
      activeSlot: -1,
      searchQuery: '',
      searchResults: [],
    });
  },

  /**
   * 清除某个 slot 的选择
   */
  onClearSlot(e: WechatMiniprogram.TouchEvent) {
    const slot = e.currentTarget.dataset.slot;
    if (slot < 1 || slot > 30) return;

    const slots = [...this.data.slots];
    slots[slot - 1] = {
      slot,
      label: `Top${slot}`,
      playerGameId: '',
      playerName: '',
    };

    const filledCount = slots.filter(s => s.playerName).length;
    this.setData({ slots, filledCount });
  },

  /**
   * 提交投票
   */
  async onSubmit() {
    const { slots, filledCount, submitting, hasVoted, submissionNo } = this.data;
    if (submitting) return;

    if (filledCount < 1) {
      wx.showToast({ title: '请至少选择一名选手', icon: 'none' });
      return;
    }

    if (submissionNo >= this.data.maxSubmissions) {
      wx.showToast({ title: `已达最大提交次数 ${this.data.maxSubmissions}`, icon: 'none' });
      return;
    }

    wx.showModal({
      title: hasVoted ? '确认覆盖' : '确认提交',
      content: hasVoted
        ? `这是第 ${submissionNo + 1} 次提交，将覆盖上次投票结果，确定提交吗？`
        : `确定提交你选择的 ${filledCount} 名选手吗？提交后不可修改（但可再次提交覆盖）`,
      success: async (res) => {
        if (!res.confirm) return;

        this.setData({ submitting: true });
        const selections = slots
          .filter(s => s.playerGameId)
          .map(s => ({ slot: s.slot, playerGameId: s.playerGameId, playerName: s.playerName }));

        const result = await submitVotes(selections, this.data.year);
        if (result.success) {
          wx.showToast({ title: `投票成功（第${result.data?.submissionNo}次）`, icon: 'success' });
          await this.loadMyVotes();
        } else {
          wx.showToast({ title: result.message || '投票失败', icon: 'none' });
        }
        this.setData({ submitting: false });
      },
    });
  },
});
