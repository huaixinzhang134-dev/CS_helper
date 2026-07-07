import {
  fetchMatchDetail,
  fetchPlayerComments,
  addPlayerComment,
  deletePlayerComment,
  fetchMatchPlayers,
  getCurrentUserOpenid,
  Match,
  MatchPlayerItem,
  CommentItem
} from '../../services/api';
import { matchWS } from '../../services/ws';
import { formatTime } from '../../utils/util';

interface DisplayComment {
  _id: string;
  playerGameId: string;
  content: string;
  userId: string;
  createdAt: any;
  playerName: string;
  playerTeam: string;
  formatTime: string;
}

Page({
  data: {
    matchId: '',
    match: null as any,
    loading: true,
    comments: [] as DisplayComment[],
    refreshing: false,

    // WS
    wsConnected: false,
    scoreAnimated: false,

    // 选手 tab
    playerTabs: [{ id: 'all', label: '全部', team: '' }] as any[],
    activePlayerGameId: 'all',

    // 评论输入
    selectedPlayer: null as MatchPlayerItem | null,
    draftContent: '',
    sending: false,
    showPlayerModal: false,
    team1: { name: '', players: [] as MatchPlayerItem[] },
    team2: { name: '', players: [] as MatchPlayerItem[] },
    playersLoading: false,

    // 登录状态
    userInfo: null as any,
  },

  onLoad(options: any) {
    const matchId = options.id;
    if (!matchId) {
      wx.showToast({ title: '比赛不存在', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 1000);
      return;
    }
    const userInfo = wx.getStorageSync('userInfo') || null;
    this.setData({ matchId, userInfo });
    this.loadAll();
    this.setupWS(matchId);
  },

  onPullDownRefresh() {
    this.setData({ refreshing: true });
    this.loadAll().finally(() => {
      this.setData({ refreshing: false });
      wx.stopPullDownRefresh();
    });
  },

  setupWS(matchId: string) {
    matchWS.disconnect();
    this._unsubMatchUpdate = matchWS.on('match_update', (msg: any) => {
      if (msg.matchId !== matchId) return;
      const old = this.data.match;
      const oldA = old?.teamA.score;
      const oldB = old?.teamB.score;
      const newA = msg.data.teamA.score;
      const newB = msg.data.teamB.score;
      this.setData({ match: msg.data, wsConnected: true });
      if (oldA !== undefined && (newA !== oldA || newB !== oldB)) {
        this.setData({ scoreAnimated: true });
        wx.vibrateShort({ type: 'light' });
        setTimeout(() => this.setData({ scoreAnimated: false }), 1500);
      }
    });
    matchWS.connect();
    matchWS.send({ type: 'subscribe_match', matchId });
  },

  onShow() {
    if (this.data.matchId) {
      matchWS.connect();
      matchWS.send({ type: 'subscribe_match', matchId: this.data.matchId });
    }
  },

  onHide() { matchWS.disconnect(); },
  onUnload() {
    if (this.data.matchId) matchWS.send({ type: 'unsubscribe_match', matchId: this.data.matchId });
    if (this._unsubMatchUpdate) { this._unsubMatchUpdate(); this._unsubMatchUpdate = null; }
    matchWS.disconnect();
  },

  async loadAll() {
    this.setData({ loading: true });
    try {
      // 1. 先拉比赛详情（需要拿到 team 名）
      const matchRes = await fetchMatchDetail(this.data.matchId);
      if (!matchRes.success || !matchRes.data) {
        wx.showToast({ title: '比赛加载失败', icon: 'none' });
        return;
      }
      this.setData({ match: matchRes.data });

      // 2. 再拉选手数据（后端通过 matchId 联表查询，无需传队名）
      const playersRes = await fetchMatchPlayers('', '', this.data.matchId);
      if (playersRes.success && playersRes.data) {
        this.setData({ team1: playersRes.data.team1, team2: playersRes.data.team2 });
        this.buildPlayerTabs(playersRes.data.team1, playersRes.data.team2);
      }
      await this.loadComments();
    } catch (err) {
      console.error('loadAll error', err);
    } finally {
      this.setData({ loading: false });
    }
  },

  async loadComments(playerGameId?: string) {
    const target = playerGameId !== undefined ? playerGameId : this.data.activePlayerGameId;
    if (target === 'all') {
      // 加载所有选手的评论
      const allPlayers = [...this.data.team1.players, ...this.data.team2.players];
      const allComments: DisplayComment[] = [];
      for (const p of allPlayers) {
        const res = await fetchPlayerComments(p.playerId, 0, 20);
        if (res.success && res.data) {
          res.data.list.forEach(c => {
            allComments.push(this.buildDisplayComment(c, p));
          });
        }
      }
      allComments.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      this.setData({ comments: allComments });
    } else {
      const res = await fetchPlayerComments(target, 0, 50);
      if (res.success && res.data) {
        const display = res.data.list.map((c: CommentItem) => {
          const player = this.findPlayer(c.playerGameId);
          return this.buildDisplayComment(c, player);
        });
        this.setData({ comments: display });
      }
    }
  },

  buildDisplayComment(c: CommentItem, player?: MatchPlayerItem): DisplayComment {
    return {
      _id: c._id,
      playerGameId: c.playerGameId,
      content: c.content,
      userId: c.userId,
      createdAt: c.createdAt,
      playerName: player?.name || c.playerGameId,
      playerTeam: player?.team || '',
      formatTime: this.formatCommentTime(c.createdAt)
    };
  },

  async loadMatchPlayersSafe() {
    return await fetchMatchPlayers('', '', this.data.matchId);
  },

  buildPlayerTabs(team1: any, team2: any) {
    const tabs: any[] = [{ id: 'all', label: '全部', team: '' }];
    team1.players.forEach((p: any) => tabs.push({ id: p.playerId, label: p.name, team: team1.name }));
    team2.players.forEach((p: any) => tabs.push({ id: p.playerId, label: p.name, team: team2.name }));
    this.setData({ playerTabs: tabs });
  },

  onTabTap(e: any) {
    const playerGameId = e.currentTarget.dataset.id;
    if (playerGameId === this.data.activePlayerGameId) return;
    this.setData({ activePlayerGameId: playerGameId });
    this.loadComments(playerGameId);
  },

  onOpenPlayerModal() {
    if (!this.data.userInfo) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      return;
    }
    this.setData({ showPlayerModal: true });
  },

  onClosePlayerModal() { this.setData({ showPlayerModal: false }); },

  onSelectPlayer(e: any) {
    const playerId = e.currentTarget.dataset.id;
    const teamKey = e.currentTarget.dataset.team;
    const team = teamKey === 'team1' ? this.data.team1 : this.data.team2;
    const player = team.players.find((p: any) => p.playerId === playerId);
    if (!player) return;
    this.setData({ selectedPlayer: player, showPlayerModal: false });
  },

  onInputChange(e: any) { this.setData({ draftContent: e.detail.value }); },

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
    const userId = getCurrentUserOpenid();
    if (!userId || userId === 'guest') {
      wx.showToast({ title: '请先登录', icon: 'none' });
      return;
    }

    this.setData({ sending: true });
    const res = await addPlayerComment(
      this.data.selectedPlayer.playerId,
      content,
      userId
    );
    this.setData({ sending: false });

    if (res.success) {
      this.setData({ draftContent: '', selectedPlayer: null });
      wx.showToast({ title: '发送成功', icon: 'success' });
      await this.loadComments(this.data.activePlayerGameId);
    } else {
      wx.showToast({ title: res.message || '发送失败', icon: 'none' });
    }
  },

  onCommentLongPress(e: any) {
    const commentId = e.currentTarget.dataset.id;
    const userId = e.currentTarget.dataset.userid;
    const me = getCurrentUserOpenid();
    if (userId !== me) return;
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
    const res = await deletePlayerComment(commentId, getCurrentUserOpenid());
    if (res.success) {
      wx.showToast({ title: '已删除', icon: 'success' });
      await this.loadComments(this.data.activePlayerGameId);
    } else {
      wx.showToast({ title: res.message || '删除失败', icon: 'none' });
    }
  },

  findPlayer(playerGameId: string): MatchPlayerItem | undefined {
    return (
      this.data.team1.players.find((p: any) => p.playerId === playerGameId) ||
      this.data.team2.players.find((p: any) => p.playerId === playerGameId)
    );
  },

  formatCommentTime(createdAt: any): string {
    let d: Date;
    if (createdAt instanceof Date) d = createdAt;
    else if (typeof createdAt === 'string' || typeof createdAt === 'number') d = new Date(createdAt);
    else return '';
    if (isNaN(d.getTime())) return '';
    return formatTime(d);
  }
} as any);
