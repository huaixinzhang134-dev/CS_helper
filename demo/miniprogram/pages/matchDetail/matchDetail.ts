import {
  fetchMatchDetail,
  fetchMatchComments,
  addMatchComment,
  deleteMatchComment,
  fetchMatchPlayers,
  getCurrentUserOpenid,
  Match,
  MatchPlayerItem
} from '../../services/api';
import { matchWS } from '../../services/ws';
import { formatTime } from '../../utils/util';

interface DisplayComment {
  _id: string;
  playerId: string;
  content: string;
  userOpenid: string;
  createdAt: any;
  playerName: string;
  playerTeam: string;
  userNickName: string;
  userAvatarUrl: string;
}

interface PlayerTab {
  id: string;
  label: string;
  team: string;
}

Page({
  data: {
    matchId: '',
    match: null as Match | null,
    loading: true,
    comments: [] as DisplayComment[],
    refreshing: false,

    // WS 实时相关
    wsConnected: false,
    scoreAnimated: false,     // 触发比分变化动效

    // 选手 tab
    playerTabs: [{ id: 'all', label: '全部', team: '' }] as PlayerTab[],
    activePlayerId: 'all',

    // 评论输入
    selectedPlayer: null as MatchPlayerItem | null,
    draftContent: '',
    sending: false,
    showPlayerModal: false,
    team1: { name: '', players: [] as MatchPlayerItem[] },
    team2: { name: '', players: [] as MatchPlayerItem[] },
    playersLoading: false
  },

  // WS 取消订阅函数
  _unsubMatchUpdate: null as (() => void) | null,

  onLoad(options: any) {
    const matchId = options.id;
    if (!matchId) {
      wx.showToast({ title: '比赛不存在', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 1000);
      return;
    }
    this.setData({ matchId });
    this.loadAll();

    // 建立 WS 连接 + 订阅本场比赛
    this.setupWS(matchId);
  },

  onPullDownRefresh() {
    this.setData({ refreshing: true });
    this.loadAll().finally(() => {
      this.setData({ refreshing: false });
      wx.stopPullDownRefresh();
    });
  },

  /**
   * WS：订阅本场实时更新
   */
  setupWS(matchId: string) {
    matchWS.disconnect();

    this._unsubMatchUpdate = matchWS.on('match_update', (msg: { matchId: string; data: Match }) => {
      if (msg.matchId !== matchId) return;

      const oldMatch = this.data.match;
      const oldScoreA = oldMatch?.teamA.score;
      const oldScoreB = oldMatch?.teamB.score;
      const newScoreA = msg.data.teamA.score;
      const newScoreB = msg.data.teamB.score;

      // 更新比赛数据
      this.setData({
        match: msg.data,
        wsConnected: true
      });

      // 比分变化 → 触发动效 + 振动提示
      if (oldScoreA !== undefined && (newScoreA !== oldScoreA || newScoreB !== oldScoreB)) {
        this.setData({ scoreAnimated: true });
        wx.vibrateShort({ type: 'light' });

        // 清除动效
        setTimeout(() => {
          this.setData({ scoreAnimated: false });
        }, 1500);
      }
    });

    // 连接并订阅
    matchWS.connect();
    matchWS.send({ type: 'subscribe_match', matchId });
  },

  /**
   * 切前台：重连 + 重新订阅
   */
  onShow() {
    if (this.data.matchId) {
      matchWS.connect();
      matchWS.send({ type: 'subscribe_match', matchId: this.data.matchId });
    }
  },

  /**
   * 切后台：断开 WS（省流量）
   */
  onHide() {
    matchWS.disconnect();
  },

  /**
   * 页面卸载：取消订阅 + 断开 WS
   */
  onUnload() {
    if (this.data.matchId) {
      matchWS.send({ type: 'unsubscribe_match', matchId: this.data.matchId });
    }
    if (this._unsubMatchUpdate) {
      this._unsubMatchUpdate();
      this._unsubMatchUpdate = null;
    }
    matchWS.disconnect();
  },

  /**
   * 加载所有初始数据
   */
  async loadAll() {
    this.setData({ loading: true });
    try {
      const [matchRes, playersRes] = await Promise.all([
        fetchMatchDetail(this.data.matchId),
        this.loadMatchPlayersSafe()
      ]);

      if (!matchRes.success || !matchRes.data) {
        wx.showToast({ title: '比赛加载失败', icon: 'none' });
        return;
      }

      this.setData({ match: matchRes.data });

      if (playersRes.success && playersRes.data) {
        this.setData({
          team1: playersRes.data.team1,
          team2: playersRes.data.team2
        });
        this.buildPlayerTabs(playersRes.data.team1, playersRes.data.team2);
      }

      await this.loadComments();
    } catch (err) {
      console.error('loadAll error', err);
    } finally {
      this.setData({ loading: false });
    }
  },

  async loadComments(playerId?: string) {
    const target = playerId !== undefined ? playerId : this.data.activePlayerId;
    const filterPlayerId = target === 'all' ? undefined : target;
    const res = await fetchMatchComments(this.data.matchId, 0, 50, filterPlayerId);
    if (res.success && res.data) {
      const display = res.data.list.map((c) => this.buildDisplayComment(c));
      this.setData({ comments: display });
    }
  },

  buildDisplayComment(c: any): DisplayComment {
    const player = this.findPlayer(c.playerId);
    const me = wx.getStorageSync('userInfo') || {};
    return {
      _id: c._id,
      playerId: c.playerId,
      content: c.content,
      userOpenid: c.userOpenid,
      createdAt: c.createdAt,
      playerName: player?.name || '未知选手',
      playerTeam: player?.team || '',
      userNickName: this.isMyComment(c.userOpenid) ? (me.nickname || '我') : '匿名用户',
      userAvatarUrl: this.isMyComment(c.userOpenid) ? (me.avatarUrl || '') : '',
      formatTime: this.formatCommentTime(c.createdAt)
    } as any;
  },

  async loadMatchPlayersSafe() {
    const m = this.data.match;
    if (!m) {
      return { success: false, data: null } as any;
    }
    return await fetchMatchPlayers(m.teamA.name, m.teamB.name);
  },

  buildPlayerTabs(team1: { name: string; players: MatchPlayerItem[] }, team2: { name: string; players: MatchPlayerItem[] }) {
    const tabs: PlayerTab[] = [{ id: 'all', label: '全部', team: '' }];
    team1.players.forEach((p) => tabs.push({ id: p.playerId, label: p.name, team: team1.name }));
    team2.players.forEach((p) => tabs.push({ id: p.playerId, label: p.name, team: team2.name }));
    this.setData({ playerTabs: tabs });
  },

  onTabTap(e: any) {
    const playerId = e.currentTarget.dataset.id;
    if (playerId === this.data.activePlayerId) return;
    this.setData({ activePlayerId: playerId });
    this.loadComments(playerId);
  },

  onOpenPlayerModal() {
    if (!this.userInfo) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      return;
    }
    if (this.data.team1.players.length === 0 && this.data.team2.players.length === 0) {
      wx.showToast({ title: '暂无可选选手', icon: 'none' });
      return;
    }
    this.setData({ showPlayerModal: true });
  },

  onClosePlayerModal() {
    this.setData({ showPlayerModal: false });
  },

  onSelectPlayer(e: any) {
    const playerId = e.currentTarget.dataset.id;
    const teamKey = e.currentTarget.dataset.team;
    const team = teamKey === 'team1' ? this.data.team1 : this.data.team2;
    const player = team.players.find((p) => p.playerId === playerId);
    if (!player) return;
    this.setData({
      selectedPlayer: player,
      showPlayerModal: false
    });
  },

  onInputChange(e: any) {
    this.setData({ draftContent: e.detail.value });
  },

  async onSend() {
    if (this.data.sending) return;

    if (!this.data.selectedPlayer) {
      wx.showToast({ title: '请先选择选手', icon: 'none' });
      return;
    }
    const content = this.data.draftContent.trim();
    if (!content) {
      wx.showToast({ title: '请输入评论内容', icon: 'none' });
      return;
    }
    if (content.length > 500) {
      wx.showToast({ title: '评论最多 500 字', icon: 'none' });
      return;
    }

    this.setData({ sending: true });
    const res = await addMatchComment(
      this.data.matchId,
      this.data.selectedPlayer.playerId,
      content,
      getCurrentUserOpenid()
    );
    this.setData({ sending: false });

    if (res.success) {
      this.setData({ draftContent: '', selectedPlayer: null });
      wx.showToast({ title: '发送成功', icon: 'success' });
      await this.loadComments();
    } else {
      if (res.code === 401) {
        wx.showToast({ title: '请先登录', icon: 'none' });
      } else {
        wx.showToast({ title: res.message || '发送失败', icon: 'none' });
      }
    }
  },

  onCommentLongPress(e: any) {
    const commentId = e.currentTarget.dataset.id;
    const userOpenid = e.currentTarget.dataset.openid;
    if (!this.isMyComment(userOpenid)) return;

    wx.showActionSheet({
      itemList: ['删除评论'],
      success: async (res) => {
        if (res.tapIndex === 0) {
          await this.doDelete(commentId);
        }
      }
    });
  },

  async doDelete(commentId: string) {
    const res = await deleteMatchComment(commentId, getCurrentUserOpenid());
    if (res.success) {
      wx.showToast({ title: '已删除', icon: 'success' });
      await this.loadComments();
    } else {
      wx.showToast({ title: res.message || '删除失败', icon: 'none' });
    }
  },

  findPlayer(playerId: string): MatchPlayerItem | undefined {
    return (
      this.data.team1.players.find((p) => p.playerId === playerId) ||
      this.data.team2.players.find((p) => p.playerId === playerId)
    );
  },

  isMyComment(openid: string): boolean {
    const me = wx.getStorageSync('userInfo') || {};
    return !!(me.uid && me.uid === openid) || !!(me.openid && me.openid === openid);
  },

  get userInfo() {
    return wx.getStorageSync('userInfo') || null;
  },

  formatCommentTime(createdAt: any): string {
    let d: Date;
    if (createdAt instanceof Date) {
      d = createdAt;
    } else if (typeof createdAt === 'string' || typeof createdAt === 'number') {
      d = new Date(createdAt);
    } else {
      return '';
    }
    if (isNaN(d.getTime())) return '';
    return formatTime(d);
  }
});
