import { fetchRandomPlayerByDifficulty, searchPlayers, submitGuessRecord, fetchDifficultyProgress, createPkRoom, joinPkRoom, getPkRoom, reportPkResult, reportPkAttempt, readyForNextRound, startNextRound, Player, fetchUserItems, useItem } from '../../services/api';
import { STATIC_BASE } from '../../config';

const SILHOUETTE_URLS = [
  'https://www.hltv.org/img/static/player/player_silhouette.png',
  'https://www.hltv.org/img/static/player/player_silhouette_fe.png'
];

function normalizeAvatarUrl(avatar: string): string {
  if (!avatar) return '/assets/icons/user.png';
  if (SILHOUETTE_URLS.indexOf(avatar) >= 0) return '/assets/icons/user.png';
  if (avatar.startsWith('http://') || avatar.startsWith('https://')) return avatar;
  if (avatar.startsWith('/static/')) return `${STATIC_BASE}${avatar}`;
  return '/assets/icons/user.png';
}

const MAX_ATTEMPTS = 10;
const MAX_PK_ATTEMPTS = 8;
const UNLIMITED_ATTEMPTS = -1;

const DIFFICULTIES = [
  { key: 'trivial',  icon: '🌱', name: '极简', desc: '世界排名前10队伍的选手（不含教练）', unlockNeed: '-' },
  { key: 'easy',     icon: '🌟', name: '简单', desc: 'Major>5次且有战队的选手（不含教练）', unlockNeed: '猜对10次解锁' },
  { key: 'normal',   icon: '⚔️', name: '普通', desc: '世界排名前30队伍的选手（不含教练）', unlockNeed: '猜对10次解锁' },
  { key: 'hard',     icon: '🔥', name: '困难', desc: 'Major>5次（含教练/自由人/退役）', unlockNeed: '猜对10次解锁' },
  { key: 'hell',     icon: '💀', name: '炼狱', desc: 'Major>0次（无论是否现役）', unlockNeed: '猜对10次解锁' },
  { key: 'challenge',icon: '🏆', name: '挑战', desc: '所有选手无限制', unlockNeed: '猜对10次解锁' },
];

const RULES_CONTENT = `🎮 玩法说明

选手猜猜看游戏，通过搜索选手并对比信息，猜出系统选中的目标选手！

🟢 绿色 = 该信息正确
🟡 黄色 = 接近正确（战队→曾效力；国籍→同赛区；年龄/Major差≤3）
⚪ 无色 = 不正确

↑↓ 箭头表示数值比目标大/小

📊 难度说明
${DIFFICULTIES.map(d => `${d.icon} ${d.name}：${d.desc}`).join('\n')}

🔓 解锁机制
需在前一难度累计猜对10次，才能解锁下一难度
每档难度独立统计猜对次数`;

interface GuessFeedback {
  player: Player;
  status: {
    team: 'correct' | 'close' | 'incorrect';
    country: 'correct' | 'close' | 'incorrect';
    age: 'correct' | 'close' | 'incorrect';
    ageDir: 'up' | 'down' | '';
    major: 'correct' | 'close' | 'incorrect';
    majorDir: 'up' | 'down' | '';
    position: 'correct' | 'incorrect';
  };
}

interface UserInfo {
  openid: string;
  nickName: string;
  avatarUrl: string;
  winCount: number;
}

Page({
  data: {
    loading: true,
    targetPlayer: null as Player | null,
    targetAvatarUrl: '',
    searchResults: [] as Player[],
    searchQuery: '',
    searchPage: 0,
    searchHasMore: false,
    searchLoading: false,
    guesses: [] as GuessFeedback[],
    attemptsLeft: MAX_ATTEMPTS,
    gameStatus: 'playing' as 'playing' | 'won' | 'lost',
    showAdModal: false,
    showResultModal: false,
    resultTitle: '',
    resultContent: '',

    // 难度选择
    showDifficultySelection: false,
    difficulties: DIFFICULTIES.map((d, i) => ({ ...d, correctCount: 0, unlocked: i === 0 })),
    difficulty: '' as string,

    // 游戏模式
    showModeSelection: true,
    gameMode: '' as 'personal' | 'friend' | '',
    showFriendInvite: false,
    userInfo: null as UserInfo | null,
    opponentInfo: null as UserInfo | null,
    pkRoomId: '',
    isRoomOwner: false,
    pkResult: null as { type: string; message: string } | null,
    myAttempts: 0,
    opponentAttempts: 0,
    myAvatar: '/assets/icons/user.png',
    myName: '我',
    opponentAvatar: '/assets/icons/user.png',
    opponentName: '对手',

    pkRound: 1,
    showPkWaittingNext: false,
    myReady: false,
    pkGameOver: false,

    hintUsed: false,
    showHintModal: false,
    hintContent: '',

    // 玩法说明（每次进入页面自动弹出）
    showRulesModal: false,
    rulesContent: RULES_CONTENT,

    // 难度锁定弹窗
    showLockModal: false,
    lockMessage: '',

    // 道具系统
    showItemModal: false,
    userItems: [] as { itemType: string; quantity: number; itemLabel: string; desc: string }[],
    userItemCount: 0,
  },

  onLoad(options: any) {
    if (options.pkRoomId && options.opponentId) {
      this.setData({ loading: false, showModeSelection: false, gameMode: 'friend', pkRoomId: options.pkRoomId, isRoomOwner: false });
      const token = wx.getStorageSync('token');
      const cachedUser = wx.getStorageSync('userInfo');
      if (token && cachedUser && cachedUser.openid) {
        this.handleEnterPKRoom(options.pkRoomId, options.opponentId);
      } else {
        wx.showModal({
          title: '需要登录',
          content: '好友PK需要先登录，请前往"我的"页面进行微信登录后，重新点击分享链接加入',
          success: (res) => { if (res.confirm) wx.switchTab({ url: '/pages/user/index' }); }
        });
      }
      return;
    }
    this.initGame();
  },

  onShow() {
    this.checkUserLogin();
    // 每次进入猜一猜页面都弹出玩法说明
    if (!this.data.showModeSelection && !this.data.showDifficultySelection) {
      // 如果游戏已在进行中，不重复弹
    }
  },

  onUnload() {
    this._stopPollingForJoiner();
    this._stopPollingForPkProgress();
    this._stopPollingForPkResult();
    this._stopPollingForNextPKRound();
  },

  checkUserLogin() {
    const token = wx.getStorageSync('token');
    const cachedUser = wx.getStorageSync('userInfo');
    if (token && cachedUser && cachedUser.openid) {
      const nickName = cachedUser.nickname || cachedUser.nickName || '微信用户';
      const avatarUrl = cachedUser.avatarUrl || '/assets/icons/user.png';
      this.setData({
        userInfo: { openid: cachedUser.openid, nickName, avatarUrl, winCount: cachedUser.winCount || 0 },
        myName: nickName,
        myAvatar: avatarUrl,
      });
    } else {
      this.setData({ userInfo: null });
    }
  },

  selectGameMode(e: any) {
    const mode = e.currentTarget.dataset.mode;
    if (mode === 'friend') {
      const token = wx.getStorageSync('token');
      const cachedUser = wx.getStorageSync('userInfo');
      if (!token || !cachedUser || !cachedUser.openid) {
        wx.showModal({
          title: '需要登录',
          content: '好友PK需要先登录，请前往"我的"页面进行微信登录',
          success: (res) => { if (res.confirm) wx.switchTab({ url: '/pages/user/index' }); }
        });
        return;
      }
    }
    this.setData({ showModeSelection: false, gameMode: mode, showDifficultySelection: true });
    this.loadDifficultyProgress();
  },

  /** 加载各难度猜对次数和解锁状态 */
  async loadDifficultyProgress() {
    const token = wx.getStorageSync('token');
    if (!token) {
      // 未登录：所有难度默认未解锁（除 trivial）
      this.setData({
        difficulties: DIFFICULTIES.map((d, i) => ({
          ...d,
          correctCount: 0,
          unlocked: i === 0,
        }))
      });
      return;
    }
    try {
      const res = await fetchDifficultyProgress();
      const progress = res.data || [];
      const progressMap: Record<string, number> = {};
      for (const p of progress) progressMap[p.difficulty] = p.correctCount;

      this.setData({
        difficulties: DIFFICULTIES.map((d, i) => ({
          ...d,
          correctCount: progressMap[d.key] || 0,
          unlocked: i === 0 ? true : (progressMap[DIFFICULTIES[i - 1].key] || 0) >= 10,
        }))
      });
    } catch {
      this.setData({
        difficulties: DIFFICULTIES.map((d, i) => ({ ...d, correctCount: 0, unlocked: i === 0 }))
      });
    }
  },

  selectDifficulty(e: any) {
    const diff = e.currentTarget.dataset.diff;
    const item = this.data.difficulties.find((d: any) => d.key === diff);
    // 好友PK不设难度限制，直接跳过解锁检查
    if (this.data.gameMode === 'friend') {
      this.setData({ difficulty: diff, showDifficultySelection: false });
      if (!this.data.userInfo) this.loginForFriendPK();
      else this.createPkRoomOnServer(diff);
      return;
    }
    if (!item || !item.unlocked) {
      this.setData({
        showLockModal: true,
        lockMessage: `请先在前一难度猜对10次后再来挑战！`
      });
      return;
    }
    this.setData({ difficulty: diff, showDifficultySelection: false });
    if (this.data.gameMode === 'personal') {
      this.startNewRound();
      wx.showToast({ title: '游戏已开始', icon: 'none', duration: 1500 });
    } else if (this.data.gameMode === 'friend') {
      if (!this.data.userInfo) this.loginForFriendPK();
      else this.createPkRoomOnServer(diff);
    }
  },

  onLockModalClose() {
    this.setData({ showLockModal: false });
  },

  loginForFriendPK() {
    const token = wx.getStorageSync('token');
    const cachedUser = wx.getStorageSync('userInfo');
    if (token && cachedUser && cachedUser.openid) {
      this.setData({
        userInfo: { openid: cachedUser.openid, nickName: cachedUser.nickname || cachedUser.nickName || '微信用户', avatarUrl: cachedUser.avatarUrl || '', winCount: cachedUser.winCount || 0 },
        gameMode: 'friend', showFriendInvite: true
      });
      return;
    }
    wx.showModal({
      title: '提示', content: '好友PK需要先登录，请前往"我的"页面进行微信一键登录',
      success: (res) => { if (res.confirm) wx.switchTab({ url: '/pages/user/index' }); }
    });
  },

  cancelFriendPK() {
    this._stopPollingForJoiner();
    this._stopPollingForPkProgress();
    if ((this as any)._pkResultTimer) { clearInterval((this as any)._pkResultTimer); (this as any)._pkResultTimer = null; }
    this.setData({ showFriendInvite: false, showModeSelection: true, gameMode: '', pkRoomId: '', isRoomOwner: false, targetPlayer: null, opponentAttempts: 0 });
  },

  async createPkRoomOnServer(difficulty: string) {
    wx.showLoading({ title: '创建房间...' });
    try {
      const res = await createPkRoom(difficulty, this.data.myName, this.data.myAvatar);
      wx.hideLoading();
      if (res.success && res.data) {
        const roomId = res.data.roomId;
        const target = res.data.targetPlayer;
        this.setData({
          pkRoomId: roomId, isRoomOwner: true, showFriendInvite: true,
          targetPlayer: target, targetAvatarUrl: normalizeAvatarUrl(target.avatar),
          guesses: [], attemptsLeft: MAX_PK_ATTEMPTS, gameStatus: 'playing', myAttempts: 0,
          hintUsed: false, showHintModal: false, hintContent: '',
        });
        this._startPollingForJoiner();
        setTimeout(() => { wx.showShareMenu({ withShareTicket: true, menus: ['shareAppMessage'] }); }, 300);
      } else {
        wx.showToast({ title: res.message || '创建房间失败', icon: 'none' });
        this.setData({ showModeSelection: true, gameMode: '' });
      }
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: '创建房间失败', icon: 'none' });
      this.setData({ showModeSelection: true, gameMode: '' });
    }
  },

  _startPollingForJoiner() {
    this._stopPollingForJoiner();
    const maxWait = 5 * 60 * 1000;
    const startedAt = Date.now();
    (this as any)._pkPollTimer = setInterval(async () => {
      if (Date.now() - startedAt > maxWait) {
        this._stopPollingForJoiner();
        wx.showToast({ title: '等待超时，请重新创建房间', icon: 'none' });
        this.cancelFriendPK();
        return;
      }
      if (!this.data.pkRoomId) { this._stopPollingForJoiner(); return; }
      try {
        const res = await getPkRoom(this.data.pkRoomId);
        if (res.success && res.data && res.data.joiner) {
          const joiner = res.data.joiner;
          this.setData({ showFriendInvite: false, opponentInfo: joiner, opponentName: joiner.nickname || '对手', opponentAvatar: joiner.avatar || '/assets/icons/user.png' });
          wx.showToast({ title: '对手已加入！', icon: 'success' });
          this._stopPollingForJoiner();
          this._startPollingForPkProgress();
        }
      } catch (err) {}
    }, 2000);
  },

  _stopPollingForJoiner() {
    if ((this as any)._pkPollTimer) { clearInterval((this as any)._pkPollTimer); (this as any)._pkPollTimer = null; }
  },

  _startPollingForPkProgress() {
    this._stopPollingForPkProgress();
    if (!this.data.pkRoomId) return;
    (this as any)._pkProgressTimer = setInterval(async () => {
      if (!this.data.pkRoomId || this.data.gameStatus === 'won' || this.data.gameStatus === 'lost') return;
      try {
        const res = await getPkRoom(this.data.pkRoomId);
        if (res.success && res.data) {
          const room = res.data;
          const role = this.data.isRoomOwner ? 'creator' : 'joiner';
          const opponentRole = this.data.isRoomOwner ? 'joiner' : 'creator';
          const oppAttempts = opponentRole === 'joiner' ? (room.joinerAttempts || 0) : (room.creatorAttempts || 0);
          if (oppAttempts !== this.data.opponentAttempts) this.setData({ opponentAttempts: oppAttempts });
          const oppResult = opponentRole === 'joiner' ? room.joinerResult : room.creatorResult;
          if (oppResult && oppResult.won && this.data.gameStatus === 'playing') {
            this.setData({
              gameStatus: 'lost', pkResult: { type: 'lose', message: `对手已猜中！答案是${room.targetPlayer?.name || ''}` },
              showResultModal: true, resultTitle: '😞 你输了', resultContent: `对手在第${oppResult.attempts}次猜中了答案！`,
            });
            this._stopPollingForPkProgress();
            this.submitGameResult(false, this.data.myAttempts);
            this.reportPkGameResult(false, this.data.myAttempts);
          }
        }
      } catch (err) {}
    }, 2000);
  },

  _stopPollingForPkProgress() {
    if ((this as any)._pkProgressTimer) { clearInterval((this as any)._pkProgressTimer); (this as any)._pkProgressTimer = null; }
  },

  _stopPollingForPkResult() {
    if ((this as any)._pkResultTimer) { clearInterval((this as any)._pkResultTimer); (this as any)._pkResultTimer = null; }
  },

  _startPollingForPkResult() {
    this._stopPollingForPkProgress();
    this._stopPollingForPkResult();
    if (!this.data.pkRoomId) return;
    let pollCount = 0;
    (this as any)._pkResultTimer = setInterval(async () => {
      pollCount++;
      if (pollCount > 30) { clearInterval((this as any)._pkResultTimer); (this as any)._pkResultTimer = null; return; }
      try {
        const res = await getPkRoom(this.data.pkRoomId);
        if (res.success && res.data) {
          const room = res.data;
          if (room.creatorResult && room.joinerResult) {
            clearInterval((this as any)._pkResultTimer);
            (this as any)._pkResultTimer = null;
          }
        }
      } catch (err) {}
    }, 2000);
  },

  cancelWaitForJoiner() { this._stopPollingForJoiner(); this.cancelFriendPK(); },

  onShareAppMessage() {
    if (this.data.gameMode === 'friend' && this.data.pkRoomId) {
      return { title: 'CS Match Pro - 好友PK挑战', path: `/pages/guess/guess?pkRoomId=${this.data.pkRoomId}&opponentId=${this.data.userInfo?.openid}`, imageUrl: '' };
    }
    return {};
  },

  async handleEnterPKRoom(roomId: string, opponentId: string) {
    wx.showLoading({ title: '加入房间...' });
    try {
      const userInfo = wx.getStorageSync('userInfo');
      const nickname = userInfo?.nickname || userInfo?.nickName || '玩家';
      const avatar = userInfo?.avatarUrl || '';
      const res = await joinPkRoom(roomId, nickname, avatar);
      wx.hideLoading();
      if (res.success && res.data) {
        const room = res.data;
        const target = room.targetPlayer;
        this.setData({
          pkRoomId: roomId, isRoomOwner: false, opponentInfo: room.creator,
          opponentName: room.creator?.nickname || '对手', opponentAvatar: room.creator?.avatar || '/assets/icons/user.png',
          targetPlayer: target, targetAvatarUrl: normalizeAvatarUrl(target.avatar),
          difficulty: room.difficulty || '',  // 保存难度，确保搜索时按当前选手池过滤
          guesses: [], attemptsLeft: MAX_PK_ATTEMPTS, gameStatus: 'playing', myAttempts: 0,
          hintUsed: false, showHintModal: false, hintContent: '',
          showModeSelection: false,
        });
        this._startPollingForPkProgress();
      } else {
        wx.showToast({ title: res.message || '加入房间失败', icon: 'none' });
      }
    } catch (err) { wx.hideLoading(); wx.showToast({ title: '加入房间失败', icon: 'none' }); }
  },

  async initGame() {
    this.setData({ loading: false });
  },

  /** 开始新回合 */
  async startNewRound() {
    const difficulty = this.data.difficulty || 'challenge';
    wx.showLoading({ title: '加载选手...' });
    try {
      const res = await fetchRandomPlayerByDifficulty(difficulty);
      wx.hideLoading();
      if (!res.success || !res.data) {
        wx.showToast({ title: '该难度暂无可用选手，请换一个难度', icon: 'none' });
        this.setData({ showDifficultySelection: true });
        return;
      }
      const target = res.data;
      const maxAttempts = this.data.gameMode === 'friend' ? MAX_PK_ATTEMPTS : UNLIMITED_ATTEMPTS;
      this.setData({
        targetPlayer: target, targetAvatarUrl: normalizeAvatarUrl(target.avatar),
        guesses: [], attemptsLeft: maxAttempts, gameStatus: 'playing',
        searchQuery: '', searchResults: [], showAdModal: false,
        pkResult: null, myAttempts: 0, hintUsed: false, showHintModal: false, hintContent: '',
      });
      // 加载道具数量
      this.loadUserItemCount();
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: '加载失败，请重试', icon: 'none' });
      this.setData({ showDifficultySelection: true });
    }
  },

  onSearchInput(e: WechatMiniprogram.Input) {
    const query = e.detail.value.trim();
    (this.data as any)._pendingQuery = query;
    if (!query) { this.setData({ searchQuery: query, searchResults: [], searchPage: 0, searchHasMore: false }); return; }
    if ((this as any).searchTimer) clearTimeout((this as any).searchTimer);
    (this as any).searchTimer = setTimeout(async () => {
      const q = (this.data as any)._pendingQuery || query;
      this.setData({ searchQuery: q, searchPage: 0, searchResults: [], searchLoading: true });
      const res = await searchPlayers(q, 0, 20, this.data.difficulty);
      if (res.success && res.data.length > 0) {
        this.setData({ searchResults: res.data.map(p => ({ ...p, avatarUrl: normalizeAvatarUrl(p.avatar) })), searchPage: 0, searchHasMore: res.hasMore, searchLoading: false });
      } else { this.setData({ searchResults: [], searchHasMore: false, searchLoading: false }); }
    }, 400);
  },

  onSearchScrollToLower() {
    const { searchQuery, searchPage, searchHasMore, searchLoading } = this.data;
    if (!searchQuery || !searchHasMore || searchLoading) return;
    this.setData({ searchLoading: true });
    searchPlayers(searchQuery, searchPage + 1, 20, this.data.difficulty).then(res => {
      if (res.success && res.data.length > 0) {
        this.setData({ searchResults: [...this.data.searchResults, ...res.data.map(p => ({ ...p, avatarUrl: normalizeAvatarUrl(p.avatar) }))], searchPage: searchPage + 1, searchHasMore: res.hasMore, searchLoading: false });
      } else { this.setData({ searchHasMore: false, searchLoading: false }); }
    });
  },

  selectPlayer(e: WechatMiniprogram.TouchEvent) {
    const playerId = e.currentTarget.dataset.id;
    if (!playerId) return;
    const selectedPlayer = this.data.searchResults.find(p => p._id === playerId);
    if (!selectedPlayer) return;
    if (this.data.loading) { wx.showToast({ title: '数据加载中，请稍候...', icon: 'none' }); return; }
    if (!this.data.targetPlayer) { wx.showToast({ title: '请先选择难度开始游戏', icon: 'none' }); return; }
    this.setData({ searchQuery: '', searchResults: [], searchPage: 0, searchHasMore: false });
    this.processGuess(selectedPlayer);
  },

  processGuess(player: Player) {
    const target = this.data.targetPlayer;
    if (!target) { wx.showToast({ title: '数据未就绪，请稍候...', icon: 'none' }); return; }
    if (this.data.guesses.some(g => g.player._id === player._id)) { wx.showToast({ title: '已经猜过该选手', icon: 'none' }); return; }

    const feedback: GuessFeedback['status'] = {
      team: player.team === target.team ? 'correct' : ((target.formerTeams || []).includes(player.team) ? 'close' : 'incorrect'),
      country: player.country === target.country ? 'correct' : (player.region && target.region && player.region === target.region ? 'close' : 'incorrect'),
      age: player.age === target.age ? 'correct' : (Math.abs(player.age - target.age) <= 2 ? 'close' : 'incorrect'),
      ageDir: player.age < target.age ? 'up' : (player.age > target.age ? 'down' : ''),
      major: player.majorAppearances === target.majorAppearances ? 'correct' : (Math.abs(player.majorAppearances - target.majorAppearances) <= 2 ? 'close' : 'incorrect'),
      majorDir: player.majorAppearances < target.majorAppearances ? 'up' : (player.majorAppearances > target.majorAppearances ? 'down' : ''),
      position: player.position === target.position ? 'correct' : 'incorrect',
    };

    const newGuess: GuessFeedback = { player, status: feedback };
    const newGuesses = [newGuess, ...this.data.guesses];
    const myAttempts = this.data.myAttempts + 1;
    let newStatus = this.data.gameStatus;
    let pkResult = null;

    if (player._id === target._id) {
      newStatus = 'won';
      if (this.data.gameMode === 'friend') { pkResult = { type: 'win', message: `胜利！你在第${myAttempts}次猜中了！` }; this.reportPkGameResult(true, myAttempts); }
    }

    this.setData({ guesses: newGuesses, gameStatus: newStatus, myAttempts, pkResult });
    if (this.data.gameMode === 'friend' && this.data.pkRoomId) this.syncPkAttempts(myAttempts);
    if (newStatus === 'won' || newStatus === 'lost') this.submitGameResult(newStatus === 'won', myAttempts);

    if (newStatus === 'won' || newStatus === 'lost') {
      if (this.data.gameMode === 'friend') {
        this._startPollingForPkResult();
        setTimeout(() => { this.setData({ showResultModal: true, resultTitle: pkResult?.type === 'win' ? '🎉 你赢了！' : '😞 你输了', resultContent: pkResult?.message || `答案选手: ${target.name}` }); }, 500);
      } else {
        this.setData({ showResultModal: true, resultTitle: newStatus === 'won' ? '🎉 恭喜胜利!' : '😞 游戏结束', resultContent: newStatus === 'won' ? `恭喜猜对了选手 ${target.name}！` : `很遗憾，正确答案是 ${target.name}` });
      }
    }
  },

  async syncPkAttempts(attempts: number) {
    if (!this.data.pkRoomId || !this.data.userInfo) return;
    const role = this.data.isRoomOwner ? 'creator' : 'joiner';
    try {
      const res = await reportPkAttempt(this.data.pkRoomId, role, attempts);
      if (res.success && res.data) {
        this.setData({ opponentAttempts: role === 'creator' ? res.data.joinerAttempts : res.data.creatorAttempts });
      }
    } catch (err) {}
  },

  async reportPkGameResult(won: boolean, attempts: number) {
    if (!this.data.pkRoomId || !this.data.userInfo) return;
    const role = this.data.isRoomOwner ? 'creator' : 'joiner';
    try { await reportPkResult(this.data.pkRoomId, role, won, attempts); } catch (err) { console.error(err); }
  },

  onResultMaskTap() { this.setData({ showResultModal: false }); },
  onResultContentTap() {},

  onResultRestart() {
    this.setData({ showResultModal: false });
    if (this.data.gameMode === 'friend') { this._readyForNextPKRound(); }
    else { this.startNewRound(); }
  },

  async _readyForNextPKRound() {
    const { pkRoomId, isRoomOwner, userInfo } = this.data;
    if (!pkRoomId || !userInfo) return;
    const role = isRoomOwner ? 'creator' : 'joiner';
    this.setData({ myReady: true, showPkWaittingNext: true });
    const res = await readyForNextRound(pkRoomId, role);
    if (!res.success) { wx.showToast({ title: '操作失败', icon: 'none' }); this.setData({ myReady: false, showPkWaittingNext: false }); return; }
    if (res.data?.bothReady) { await this._doNextPKRound(); }
    else { wx.showToast({ title: '已准备，等待对手...', icon: 'none' }); this._startPollingForNextPKRound(); }
  },

  _startPollingForNextPKRound() {
    this._stopPollingForNextPKRound();
    if (!this.data.pkRoomId) return;
    (this as any)._pkNextRoundTimer = setInterval(async () => {
      if (!this.data.pkRoomId) { this._stopPollingForNextPKRound(); return; }
      try {
        const res = await getPkRoom(this.data.pkRoomId);
        if (!res.success || !res.data) return;
        const room = res.data;
        const currentRound = room.round || 1;
        // 如果新一轮已经开始了（对手触发了 next-round 并重置了 ready 标志），
        // 直接用房间里的新目标进入下一局，不再调用 /next-round（会因标志已重置而失败）
        if (currentRound > this.data.pkRound) {
          this._stopPollingForNextPKRound();
          this._applyNextRoundFromRoom(room);
          return;
        }
        const myRole = this.data.isRoomOwner ? 'creator' : 'joiner';
        const oppRole = this.data.isRoomOwner ? 'joiner' : 'creator';
        const oppReady = oppRole === 'joiner' ? room.joinerReadyForNext : room.creatorReadyForNext;
        if (oppReady) { this._stopPollingForNextPKRound(); wx.showToast({ title: '对手已准备！', icon: 'success' }); await this._doNextPKRound(); }
      } catch (err) {}
    }, 2000);
  },

  _stopPollingForNextPKRound() {
    if ((this as any)._pkNextRoundTimer) { clearInterval((this as any)._pkNextRoundTimer); (this as any)._pkNextRoundTimer = null; }
  },

  async _doNextPKRound() {
    const { pkRoomId } = this.data;
    if (!pkRoomId) return;
    this._stopPollingForPkProgress();
    this._stopPollingForPkResult();
    wx.showLoading({ title: '加载下一局...' });
    try {
      const res = await startNextRound(pkRoomId);
      wx.hideLoading();
      if (!res.success || !res.data) { wx.showToast({ title: '开启下一局失败', icon: 'none' }); return; }
      const target = res.data.targetPlayer;
      this.setData({
        targetPlayer: target, targetAvatarUrl: normalizeAvatarUrl(target.avatar),
        guesses: [], attemptsLeft: MAX_PK_ATTEMPTS, gameStatus: 'playing', myAttempts: 0, opponentAttempts: 0,
        hintUsed: false, showHintModal: false, hintContent: '',
        pkRound: res.data.round || (this.data.pkRound + 1), showPkWaittingNext: false, myReady: false, pkResult: null, showResultModal: false,
      });
      this._startPollingForPkProgress();
    } catch (err) { wx.hideLoading(); wx.showToast({ title: '加载失败', icon: 'none' }); }
  },

  /** 当对手已触发下一局时，直接用房间数据进入新回合（不再调 /next-round） */
  _applyNextRoundFromRoom(room: any) {
    this._stopPollingForPkProgress();
    this._stopPollingForPkResult();
    const target = room.targetPlayer;
    this.setData({
      targetPlayer: target, targetAvatarUrl: normalizeAvatarUrl(target?.avatar),
      guesses: [], attemptsLeft: MAX_PK_ATTEMPTS, gameStatus: 'playing', myAttempts: 0, opponentAttempts: 0,
      hintUsed: false, showHintModal: false, hintContent: '',
      pkRound: room.round || (this.data.pkRound + 1), showPkWaittingNext: false, myReady: false, pkResult: null, showResultModal: false,
    });
    wx.showToast({ title: '对手已准备，开始新一局！', icon: 'success' });
    this._startPollingForPkProgress();
  },

  onCancelWaitNext() {
    this._stopPollingForNextPKRound();
    this.setData({ showPkWaittingNext: false, myReady: false, showResultModal: true });
  },

  async submitGameResult(won: boolean, attempts: number) {
    const token = wx.getStorageSync('token');
    if (!token) return;
    const target = this.data.targetPlayer;
    if (!target) return;
    try {
      await submitGuessRecord({ won, attempts, difficulty: this.data.difficulty, targetPlayerId: target.playerId || target._id || '', targetPlayerName: target.name || '', gameMode: this.data.gameMode || 'personal' });
    } catch (err) { console.error(err); }
  },

  onGiveUp() {
    if (!this.data.targetPlayer) return;
    const target = this.data.targetPlayer;
    this.setData({ gameStatus: 'lost', resultTitle: '😞 游戏结束', resultContent: `很遗憾，正确答案是 ${target.name}`, showResultModal: true });
    this.submitGameResult(false, this.data.myAttempts || 0);
  },

  onGetHint() {
    const target = this.data.targetPlayer;
    if (!target || this.data.hintUsed || this.data.myAttempts <= 5) return;
    const hints: { key: string; text: string }[] = [];
    if (target.team) hints.push({ key: 'team', text: `该选手的战队为：${target.team}` });
    if (target.country) hints.push({ key: 'country', text: `该选手的国家为：${target.country}` });
    if (target.age != null) hints.push({ key: 'age', text: `该选手的年龄为：${target.age}` });
    if (target.majorAppearances != null) hints.push({ key: 'major', text: `该选手的Major参赛次数为：${target.majorAppearances}` });
    if (hints.length === 0) return;
    const pick = hints[Math.floor(Math.random() * hints.length)];
    this.setData({ hintUsed: true, showHintModal: true, hintContent: pick.text });
  },

  onHintMaskTap() { this.setData({ showHintModal: false }); },
  onHintContentTap() {},

  // ============ 道具系统 ============
  async onShowItems() {
    const token = wx.getStorageSync('token');
    if (!token) { wx.showToast({ title: '请先登录', icon: 'none' }); return; }
    const res = await fetchUserItems();
    const items = (res.success ? res.data || [] : []).filter(i => i.quantity > 0);
    const LABELS: Record<string, string> = { hint_ticket: '提示券', extra_chance: '额外机会' };
    const DESCS: Record<string, string> = { hint_ticket: '获得一条关于目标选手的提示信息', extra_chance: 'PK模式中增加一次猜测机会' };
    this.setData({
      showItemModal: true,
      userItems: items.map(i => ({
        ...i,
        itemLabel: LABELS[i.itemType] || i.itemType,
        desc: DESCS[i.itemType] || '',
      }))
    });
  },

  async onUseItem(e: any) {
    const itemType = e.currentTarget.dataset.type;
    if (itemType === 'hint_ticket') {
      const res = await useItem('hint_ticket');
      if (!res.success) { wx.showToast({ title: res.message || '使用失败', icon: 'none' }); return; }
      const target = this.data.targetPlayer;
      if (!target) return;
      const hints: string[] = [];
      if (target.team) hints.push(`该选手的战队为：${target.team}`);
      if (target.country) hints.push(`该选手的国家为：${target.country}`);
      if (target.age != null) hints.push(`该选手的年龄为：${target.age}`);
      if (target.majorAppearances != null) hints.push(`该选手的Major参赛次数为：${target.majorAppearances}`);
      if (!hints.length) { wx.showToast({ title: '暂无可用提示', icon: 'none' }); return; }
      const hint = hints[Math.floor(Math.random() * hints.length)];
      this.setData({
        showItemModal: false,
        hintUsed: true,
        showHintModal: true,
        hintContent: hint,
        userItemCount: this.data.userItemCount - 1,
      });
    } else if (itemType === 'extra_chance') {
      if (this.data.gameMode !== 'friend') { wx.showToast({ title: '仅好友PK模式可用', icon: 'none' }); return; }
      const res = await useItem('extra_chance');
      if (!res.success) { wx.showToast({ title: res.message || '使用失败', icon: 'none' }); return; }
      this.setData({ showItemModal: false });
      wx.showToast({ title: '已使用额外机会', icon: 'none' });
    }
  },

  onItemModalClose() { this.setData({ showItemModal: false }); },

  async loadUserItemCount() {
    const token = wx.getStorageSync('token');
    if (!token) { this.setData({ userItemCount: 0 }); return; }
    const res = await fetchUserItems();
    const count = (res.success ? res.data || [] : []).reduce((sum, i) => sum + i.quantity, 0);
    this.setData({ userItemCount: count });
  },

  // ============ 难度选择 ============
  async onChangeDifficulty() {
    if (this.data.gameMode !== 'personal') return;
    // 弹出难度选择弹窗（覆盖层，不重置游戏状态）
    await this.loadDifficultyProgress();
    this.setData({ showDifficultySelection: true });
  },

  onCloseDifficultySelection() {
    this.setData({ showDifficultySelection: false });
  },

  // ============ 玩法说明 ============
  onShowRules() { this.setData({ showRulesModal: true }); },
  onRulesMaskTap() { this.setData({ showRulesModal: false }); },
  onRulesContentTap() {},
  onRulesClose() { this.setData({ showRulesModal: false }); },
});
