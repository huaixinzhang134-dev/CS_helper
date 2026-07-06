// miniprogram/pages/admin/index.ts
// 后端切换为自建 Node.js + MySQL（见 server/），本页面走 REST API
import {
  Player,
  Match,
  fetchPlayerListAll,
  fetchLiveMatches,
  fetchPlayerCount,
  adminPlayerCreate,
  adminPlayerUpdate,
  adminPlayerDelete,
  adminMatchCreate,
  adminMatchUpdate,
  adminMatchDelete
} from '../../services/api';

Page({
  data: {
    players: [] as (Player & { _id: string })[],
    matches: [] as (Match & { _id: string })[],
    showPlayerModal: false,
    showMatchModal: false,
    isEditingPlayer: false,
    isEditingMatch: false,
    playerForm: {
      playerId: '',
      name: '',
      realName: '',
      team: '',
      country: '',
      countryCode: '',
      age: '',
      position: '步枪手',
      avatar: ''
    },
    matchForm: {
      event: '',
      status: 'Upcoming',
      match_date: '',
      match_time: '',
      match_type: 'BO3',
      teamA: { name: '', score: 0 },
      teamB: { name: '', score: 0 },
    },
    positions: ['步枪手', '狙击手', '指挥', '教练'] as string[],
    statuses: ['Upcoming', 'Live', 'Finished'] as string[],
    editingPlayerId: '',
    editingMatchId: '',
    dbCount: 0
  },

  onLoad() {
    this.loadData();
    this.checkDBCount();
  },

  // 查询数据库总数
  async checkDBCount() {
    try {
      const res = await fetchPlayerCount();
      this.setData({ dbCount: res.success && res.data ? res.data.total : 0 });
    } catch (err) {
      console.log('查询总数失败', err);
    }
  },

  // 清空选手数据
  clearPlayers() {
    wx.showModal({
      title: '警告',
      content: '确定要清空所有选手数据吗？此操作不可恢复！',
      confirmText: '确定清空',
      confirmColor: '#ff0000',
      success: async (res) => {
        if (!res.confirm) return;
        wx.showLoading({ title: '清空中...' });
        try {
          const list = await fetchPlayerListAll();
          if (!list.success) throw new Error('拉取选手列表失败');
          let deletedCount = 0;
          for (const p of list.data) {
            const d = await adminPlayerDelete(p.playerId);
            if (d.success) deletedCount++;
          }
          wx.hideLoading();
          wx.showToast({ title: `已清空 ${deletedCount} 条`, icon: 'success' });
          this.setData({ dbCount: 0 });
          this.loadData();
        } catch (err: any) {
          wx.hideLoading();
          console.error('清空失败:', err);
          wx.showModal({
            title: '清空失败',
            content: `错误: ${err.message || '未知错误'}`,
            showCancel: false
          });
        }
      }
    });
  },

  async loadData() {
    // 选手
    const playersRes = await fetchPlayerListAll();
    if (playersRes.success) {
      this.setData({
        players: (playersRes.data as (Player & { _id: string })[]) || []
      });
    } else {
      console.error('加载选手失败', playersRes);
    }

    // 比赛
    const matchesRes = await fetchLiveMatches();
    if (matchesRes.success) {
      this.setData({
        matches: (matchesRes.data as (Match & { _id: string })[]) || []
      });
    } else {
      this.setData({ matches: [] });
    }
  },

  onFormFieldChange(e: WechatMiniprogram.Input) {
    const { field } = e.currentTarget.dataset;
    const { value } = e.detail;
    this.setData({
      [`${this.data.showPlayerModal ? 'playerForm' : 'matchForm'}.${field}`]: value
    });
  },

  onPositionChange(e: WechatMiniprogram.PickerChange) {
    this.setData({
      'playerForm.position': this.data.positions[Number(e.detail.value)]
    });
  },

  onStatusChange(e: WechatMiniprogram.PickerChange) {
    this.setData({
      'matchForm.status': this.data.statuses[Number(e.detail.value)]
    });
  },

  onAddPlayer() {
    this.setData({
      showPlayerModal: true,
      isEditingPlayer: false,
      editingPlayerId: '',
      playerForm: {
        playerId: '',
        name: '',
        realName: '',
        team: '',
        country: '',
        countryCode: '',
        age: '',
        position: '步枪手',
        avatar: ''
      }
    });
  },

  onEditPlayer(e: WechatMiniprogram.TouchEvent) {
    const item = e.currentTarget.dataset.item as (Player & { _id: string });
    this.setData({
      showPlayerModal: true,
      isEditingPlayer: true,
      editingPlayerId: item._id,
      playerForm: {
        playerId: item.playerId,
        name: item.name,
        realName: item.realName,
        team: item.team,
        country: item.country,
        countryCode: item.countryCode,
        age: String(item.age),
        position: item.position,
        avatar: item.avatar
      }
    });
  },

  async onSavePlayer() {
    const { playerForm, isEditingPlayer, editingPlayerId } = this.data;
    const data: any = {
      name: playerForm.name,
      real_name: playerForm.realName,
      current_team: playerForm.team,
      country: playerForm.country,
      country_code: playerForm.countryCode,
      age: parseInt(playerForm.age) || 0,
      position: playerForm.position,
      avatar: playerForm.avatar
    };
    if (!isEditingPlayer) {
      data.game_id = playerForm.playerId;
    }

    const res = isEditingPlayer
      ? await adminPlayerUpdate(editingPlayerId, data)
      : await adminPlayerCreate(data);

    if (res.success) {
      this.onCloseModal();
      this.loadData();
      this.checkDBCount();
    } else {
      wx.showToast({ title: res.message || '保存失败', icon: 'none' });
    }
  },

  async onDeletePlayer(e: WechatMiniprogram.TouchEvent) {
    const { id } = e.currentTarget.dataset;
    const res = await adminPlayerDelete(id);
    if (res.success) {
      this.loadData();
      this.checkDBCount();
    } else {
      wx.showToast({ title: res.message || '删除失败', icon: 'none' });
    }
  },

  onAddMatch() {
    this.setData({
      showMatchModal: true,
      isEditingMatch: false,
      editingMatchId: '',
      matchForm: {
        event: '',
        status: 'Upcoming',
        match_date: '',
        match_time: '',
        match_type: 'BO3',
        teamA: { name: '', score: 0 },
        teamB: { name: '', score: 0 },
      }
    });
  },

  onEditMatch(e: WechatMiniprogram.TouchEvent) {
    const item = e.currentTarget.dataset.item as (Match & { _id: string });
    const [date, timeWithZ] = (item.time || '').split('T');
    const time = (timeWithZ || '').split('.')[0]; // 去掉 .000Z
    this.setData({
      showMatchModal: true,
      isEditingMatch: true,
      editingMatchId: item._id,
      matchForm: {
        event: item.event,
        status: item.status,
        match_date: date || '',
        match_time: time || '',
        match_type: 'BO3',
        teamA: { ...item.teamA, score: Number(item.teamA.score) || 0 },
        teamB: { ...item.teamB, score: Number(item.teamB.score) || 0 },
      }
    });
  },

  async onSaveMatch() {
    const { matchForm, isEditingMatch, editingMatchId } = this.data;
    if (!matchForm.match_date || !matchForm.match_time) {
      wx.showToast({ title: '请填写比赛日期和时间', icon: 'none' });
      return;
    }
    const data: any = {
      event_name: matchForm.event,
      status: matchForm.status,
      match_date: matchForm.match_date,
      match_time: matchForm.match_time,
      match_type: matchForm.match_type,
      team1_score: Number(matchForm.teamA.score) || 0,
      team2_score: Number(matchForm.teamB.score) || 0
    };
    const res = isEditingMatch
      ? await adminMatchUpdate(editingMatchId, data)
      : await adminMatchCreate(data);

    if (res.success) {
      this.onCloseModal();
      this.loadData();
    } else {
      wx.showToast({ title: res.message || '保存失败', icon: 'none' });
    }
  },

  async onDeleteMatch(e: WechatMiniprogram.TouchEvent) {
    const { id } = e.currentTarget.dataset;
    const res = await adminMatchDelete(id);
    if (res.success) {
      this.loadData();
    } else {
      wx.showToast({ title: res.message || '删除失败', icon: 'none' });
    }
  },

  onCloseModal() {
    this.setData({
      showPlayerModal: false,
      showMatchModal: false,
    });
  }
});