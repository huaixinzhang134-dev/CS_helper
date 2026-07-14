/**
 * 管理后台 —— 用户/选手/赛事/评论/投票 管理
 */
import {
  Player,
  Match,
  AdminUser,
  fetchPlayerListAll,
  fetchLiveMatches,
  fetchPlayerCount,
  adminPlayerCreate,
  adminPlayerUpdate,
  adminPlayerDelete,
  adminMatchCreate,
  adminMatchUpdate,
  adminMatchDelete,
  fetchAdminUsers,
  adminUpdateUser,
  adminDeleteUser,
  fetchPendingComments,
  reviewComment,
  fetchVoteWinners,
  adminSetVoteWinners,
  adminCheckVotes,
  adminAwardVotes,
  searchPlayers,
} from '../../services/api';

const TABS = [
  { key: 'users', label: '用户管理' },
  { key: 'players', label: '选手管理' },
  { key: 'matches', label: '赛事管理' },
  { key: 'comments', label: '评论审核' },
  { key: 'votes', label: '投票管理' },
];

Page({
  data: {
    tabs: TABS,
    activeTab: 'users',

    // ====== 用户管理 ======
    users: [] as AdminUser[],
    usersPage: 0,
    usersHasMore: false,
    usersLoading: false,
    editUserModal: false,
    editUserOpenid: '',
    editUserNickname: '',
    editUserCoins: 0,

    // ====== 选手管理 ======
    players: [] as (Player & { _id: string })[],
    showPlayerModal: false,
    isEditingPlayer: false,
    editingPlayerId: '',
    playerForm: {
      playerId: '', name: '', realName: '', team: '',
      country: '', countryCode: '', age: '', position: '步枪手', avatar: ''
    },
    positions: ['步枪手', '狙击手', '指挥', '教练'],

    // ====== 赛事管理 ======
    matches: [] as (Match & { _id: string })[],
    showMatchModal: false,
    isEditingMatch: false,
    editingMatchId: '',
    matchForm: {
      event: '', status: 'Upcoming', match_date: '', match_time: '',
      match_type: 'BO3', teamA: { name: '', score: 0 }, teamB: { name: '', score: 0 },
    },
    statuses: ['Upcoming', 'Live', 'Finished'],

    // ====== 评论审核 ======
    pendingComments: [] as any[],
    commentsPage: 0,
    commentsHasMore: false,
    commentsLoading: false,

    // ====== 投票管理 ======
    voteYear: 2026,
    voteWinners: [] as { rank: number; playerGameId: string; playerName: string }[],
    voteSlots: [] as { slot: number; winnerName: string }[], // 预处理后的显示数据
    showVoteSearch: false,
    voteSearchQuery: '',
    voteSearchResults: [] as Player[],
    voteSlot: 0, // 当前设置的 slot
    checkThreshold: 15,
    checkResults: null as any,
    awardResult: null as any,
  },

  onLoad() {
    this.loadUsers();
  },

  switchTab(e: any) {
    const tab = e.currentTarget.dataset.tab;
    this.setData({ activeTab: tab });
    if (tab === 'users') this.loadUsers();
    else if (tab === 'players') this.loadPlayers();
    else if (tab === 'matches') this.loadMatches();
    else if (tab === 'comments') this.loadPendingComments();
  },

  // ==================== 用户管理 ====================

  async loadUsers(append: boolean = false) {
    const page = append ? this.data.usersPage + 1 : 0;
    this.setData({ usersLoading: true });
    const res = await fetchAdminUsers(page, 20);
    if (res.success && res.data) {
      this.setData({
        users: append ? [...this.data.users, ...res.data.list] : res.data.list,
        usersPage: page,
        usersHasMore: res.data.hasMore,
        usersLoading: false,
      });
    } else {
      this.setData({ usersLoading: false });
    }
  },

  onUsersScrollToLower() {
    if (this.data.usersHasMore && !this.data.usersLoading) {
      this.loadUsers(true);
    }
  },

  onEditUser(e: WechatMiniprogram.TouchEvent) {
    const user = e.currentTarget.dataset.user as AdminUser;
    this.setData({
      editUserModal: true,
      editUserOpenid: user.openid,
      editUserNickname: user.nickname,
      editUserCoins: user.coins,
    });
  },

  onEditUserFieldChange(e: WechatMiniprogram.Input) {
    const field = e.currentTarget.dataset.field;
    const value = e.detail.value;
    this.setData({ [`editUser${field}`]: value } as any);
  },

  async onSaveUser() {
    const { editUserOpenid, editUserNickname, editUserCoins } = this.data;
    const res = await adminUpdateUser(editUserOpenid, { nickname: editUserNickname, coins: editUserCoins });
    if (res.success) {
      wx.showToast({ title: '更新成功', icon: 'success' });
      this.setData({ editUserModal: false });
      this.loadUsers();
    } else {
      wx.showToast({ title: res.message || '更新失败', icon: 'none' });
    }
  },

  async onDeleteUser(e: WechatMiniprogram.TouchEvent) {
    const openid = e.currentTarget.dataset.openid;
    wx.showModal({
      title: '确认删除',
      content: '确定删除此用户吗？',
      success: async (res) => {
        if (res.confirm) {
          const result = await adminDeleteUser(openid);
          if (result.success) {
            wx.showToast({ title: '删除成功', icon: 'success' });
            this.loadUsers();
          }
        }
      },
    });
  },

  onCloseUserModal() {
    this.setData({ editUserModal: false });
  },

  // ==================== 选手管理 ====================

  async loadPlayers() {
    const res = await fetchPlayerListAll();
    if (res.success) {
      this.setData({ players: (res.data as (Player & { _id: string })[]) || [] });
    }
  },

  onAddPlayer() {
    this.setData({
      showPlayerModal: true, isEditingPlayer: false, editingPlayerId: '',
      playerForm: { playerId: '', name: '', realName: '', team: '', country: '', countryCode: '', age: '', position: '步枪手', avatar: '' }
    });
  },

  onEditPlayer(e: WechatMiniprogram.TouchEvent) {
    const item = e.currentTarget.dataset.item as (Player & { _id: string });
    this.setData({
      showPlayerModal: true, isEditingPlayer: true, editingPlayerId: item._id,
      playerForm: {
        playerId: item.playerId, name: item.name, realName: item.realName,
        team: item.team, country: item.country, countryCode: item.countryCode,
        age: String(item.age), position: item.position, avatar: item.avatar
      }
    });
  },

  onPlayerFieldChange(e: WechatMiniprogram.Input) {
    const field = e.currentTarget.dataset.field;
    this.setData({ [`playerForm.${field}`]: e.detail.value } as any);
  },

  onPositionChange(e: WechatMiniprogram.PickerChange) {
    this.setData({ 'playerForm.position': this.data.positions[Number(e.detail.value)] });
  },

  async onSavePlayer() {
    const { playerForm, isEditingPlayer, editingPlayerId } = this.data;
    const data: any = {
      name: playerForm.name, real_name: playerForm.realName,
      current_team: playerForm.team, country: playerForm.country,
      country_code: playerForm.countryCode, age: parseInt(playerForm.age) || 0,
      position: playerForm.position, avatar: playerForm.avatar
    };
    if (!isEditingPlayer) data.game_id = playerForm.playerId;

    const res = isEditingPlayer
      ? await adminPlayerUpdate(editingPlayerId, data)
      : await adminPlayerCreate(data);

    if (res.success) {
      this.setData({ showPlayerModal: false });
      this.loadPlayers();
    } else {
      wx.showToast({ title: res.message || '保存失败', icon: 'none' });
    }
  },

  async onDeletePlayer(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id;
    const res = await adminPlayerDelete(id);
    if (res.success) {
      this.loadPlayers();
    } else {
      wx.showToast({ title: res.message || '删除失败', icon: 'none' });
    }
  },

  // ==================== 赛事管理 ====================

  async loadMatches() {
    const res = await fetchLiveMatches();
    this.setData({ matches: (res.success ? (res.data || []) : []) as (Match & { _id: string })[] });
  },

  onAddMatch() {
    this.setData({
      showMatchModal: true, isEditingMatch: false, editingMatchId: '',
      matchForm: { event: '', status: 'Upcoming', match_date: '', match_time: '', match_type: 'BO3', teamA: { name: '', score: 0 }, teamB: { name: '', score: 0 } }
    });
  },

  onEditMatch(e: WechatMiniprogram.TouchEvent) {
    const item = e.currentTarget.dataset.item as (Match & { _id: string });
    const [date, timeWithZ] = (item.time || '').split('T');
    const time = (timeWithZ || '').split('.')[0];
    this.setData({
      showMatchModal: true, isEditingMatch: true, editingMatchId: item._id,
      matchForm: {
        event: item.event, status: item.status, match_date: date || '', match_time: time || '',
        match_type: 'BO3', teamA: { ...item.teamA, score: Number(item.teamA.score) || 0 },
        teamB: { ...item.teamB, score: Number(item.teamB.score) || 0 }
      }
    });
  },

  onMatchFieldChange(e: WechatMiniprogram.Input) {
    const field = e.currentTarget.dataset.field;
    this.setData({ [`matchForm.${field}`]: e.detail.value } as any);
  },

  onStatusChange(e: WechatMiniprogram.PickerChange) {
    this.setData({ 'matchForm.status': this.data.statuses[Number(e.detail.value)] });
  },

  async onSaveMatch() {
    const { matchForm, isEditingMatch, editingMatchId } = this.data;
    const data: any = {
      event_name: matchForm.event, status: matchForm.status,
      match_date: matchForm.match_date, match_time: matchForm.match_time,
      match_type: matchForm.match_type, team1_score: Number(matchForm.teamA.score) || 0,
      team2_score: Number(matchForm.teamB.score) || 0
    };
    const res = isEditingMatch ? await adminMatchUpdate(editingMatchId, data) : await adminMatchCreate(data);
    if (res.success) {
      this.setData({ showMatchModal: false });
      this.loadMatches();
    } else {
      wx.showToast({ title: res.message || '保存失败', icon: 'none' });
    }
  },

  async onDeleteMatch(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id;
    const res = await adminMatchDelete(id);
    if (res.success) this.loadMatches();
  },

  onCloseModal() {
    this.setData({ showPlayerModal: false, showMatchModal: false });
  },

  // ==================== 评论审核 ====================

  async loadPendingComments(append: boolean = false) {
    const page = append ? this.data.commentsPage + 1 : 0;
    this.setData({ commentsLoading: true });
    const res = await fetchPendingComments(page, 20);
    if (res.success && res.data) {
      this.setData({
        pendingComments: append ? [...this.data.pendingComments, ...res.data.list] : res.data.list,
        commentsPage: page,
        commentsHasMore: res.data.hasMore,
        commentsLoading: false,
      });
    } else {
      this.setData({ commentsLoading: false });
    }
  },

  onCommentsScrollToLower() {
    if (this.data.commentsHasMore && !this.data.commentsLoading) {
      this.loadPendingComments(true);
    }
  },

  async onReviewComment(e: WechatMiniprogram.TouchEvent) {
    const { id, status } = e.currentTarget.dataset;
    wx.showModal({
      title: status === 'approved' ? '通过审核' : '驳回评论',
      content: status === 'approved' ? '确定通过该评论？' : '确定驳回该评论？',
      success: async (res) => {
        if (res.confirm) {
          const result = await reviewComment(id, status);
          if (result.success) {
            wx.showToast({ title: '操作成功', icon: 'success' });
            this.loadPendingComments();
          }
        }
      },
    });
  },

  // ==================== 投票管理 ====================

  async loadVoteWinners() {
    const res = await fetchVoteWinners(this.data.voteYear);
    if (res.success && res.data) {
      const winners: { rank: number; playerGameId: string; playerName: string }[] = res.data.winners || [];
      // 预处理：生成 slot 1~30 显示数据
      const voteSlots = Array.from({ length: 30 }, (_, i) => {
        const w = winners.find(w => w.rank === i + 1);
        return { slot: i + 1, winnerName: w ? w.playerName : '' };
      });
      this.setData({ voteWinners: winners, voteSlots });
    }
  },

  onVoteSetWinner(e: WechatMiniprogram.TouchEvent) {
    const slot = e.currentTarget.dataset.slot;
    this.setData({ showVoteSearch: true, voteSlot: slot, voteSearchQuery: '', voteSearchResults: [] });
  },

  onVoteSearchInput(e: WechatMiniprogram.Input) {
    const query = e.detail.value.trim();
    this.setData({ voteSearchQuery: query });
    if (!query) { this.setData({ voteSearchResults: [] }); return; }

    searchPlayers(query, 0, 20).then(res => {
      if (res.success) {
        this.setData({ voteSearchResults: res.data || [] });
      }
    });
  },

  onVoteSelectPlayer(e: WechatMiniprogram.TouchEvent) {
    const player = e.currentTarget.dataset.player as Player;
    const slot = this.data.voteSlot;
    const winners = [...this.data.voteWinners];
    const idx = winners.findIndex(w => w.rank === slot);
    if (idx >= 0) {
      winners[idx] = { rank: slot, playerGameId: player.playerId, playerName: player.name };
    } else {
      winners.push({ rank: slot, playerGameId: player.playerId, playerName: player.name });
    }
    winners.sort((a, b) => a.rank - b.rank);
    this._updateVoteSlots(winners);
    this.setData({ showVoteSearch: false });
  },

  onVoteRemoveWinner(e: WechatMiniprogram.TouchEvent) {
    const slot = e.currentTarget.dataset.slot;
    const winners = this.data.voteWinners.filter(w => w.rank !== slot);
    this._updateVoteSlots(winners);
  },

  /** 根据 winners 更新 voteSlots */
  _updateVoteSlots(winners: { rank: number; playerGameId: string; playerName: string }[]) {
    const voteSlots = Array.from({ length: 30 }, (_, i) => {
      const w = winners.find(w => w.rank === i + 1);
      return { slot: i + 1, winnerName: w ? w.playerName : '' };
    });
    this.setData({ voteWinners: winners, voteSlots });
  },

  async onSaveVoteWinners() {
    const { voteYear, voteWinners } = this.data;
    if (voteWinners.length === 0) {
      wx.showToast({ title: '请至少设置一个名次', icon: 'none' });
      return;
    }
    const res = await adminSetVoteWinners(voteYear, voteWinners);
    if (res.success) {
      wx.showToast({ title: '已保存', icon: 'success' });
    } else {
      wx.showToast({ title: res.message || '保存失败', icon: 'none' });
    }
  },

  async onCheckVoteResults() {
    const res = await adminCheckVotes(this.data.voteYear, this.data.checkThreshold);
    if (res.success && res.data) {
      this.setData({ checkResults: res.data });
      wx.showToast({ title: `共 ${res.data.total} 名用户达标`, icon: 'none' });
    } else {
      wx.showToast({ title: res.message || '查询失败', icon: 'none' });
    }
  },

  onCloseSearch() {
    this.setData({ showVoteSearch: false });
  },

  onThresholdChange(e: WechatMiniprogram.Input) {
    this.setData({ checkThreshold: parseInt(e.detail.value) || 0 });
  },

  async onAwardVotes() {
    wx.showModal({
      title: '确认发奖',
      content: '将向猜对阈值以上的用户发放代币奖励，不可重复发放，确定执行？',
      success: async (res) => {
        if (!res.confirm) return;
        const result = await adminAwardVotes(this.data.voteYear, this.data.checkThreshold, 10);
        if (result.success && result.data) {
          this.setData({ awardResult: result.data });
          wx.showToast({ title: `已向 ${result.data.awardedUsers} 人发放 ${result.data.totalCoinsAwarded} 代币`, icon: 'success' });
        } else {
          wx.showToast({ title: result.message || '发奖失败', icon: 'none' });
        }
      },
    });
  },
});
