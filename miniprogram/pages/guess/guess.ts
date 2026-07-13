import { fetchRandomPlayerByDifficulty, searchPlayers, submitGuessRecord, createPkRoom, joinPkRoom, getPkRoom, reportPkResult, reportPkAttempt, Player } from '../../services/api';
import { STATIC_BASE } from '../../config';

// HLTV 占位剪影 URL
const SILHOUETTE_URLS = [
  'https://www.hltv.org/img/static/player/player_silhouette.png',
  'https://www.hltv.org/img/static/player/player_silhouette_fe.png'
];

// 头像 URL 归一化：见 player/list.ts 注释
function normalizeAvatarUrl(avatar: string): string {
  if (!avatar) return '/assets/icons/user.png';
  if (SILHOUETTE_URLS.indexOf(avatar) >= 0) return '/assets/icons/user.png';
  if (avatar.startsWith('http://') || avatar.startsWith('https://')) {
    return avatar;
  }
  if (avatar.startsWith('/static/')) {
    return `${STATIC_BASE}${avatar}`;
  }
  return '/assets/icons/user.png';
}

const MAX_ATTEMPTS = 10;
const MAX_PK_ATTEMPTS = 8; // PK模式最大尝试次数
const UNLIMITED_ATTEMPTS = -1; // 单人模式无限次

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
    targetPlayer: null as Player | null, // 目标选手
    targetAvatarUrl: '', // 目标选手头像URL
    searchResults: [] as Player[], // 搜索结果
    searchQuery: '', // 搜索关键词
    searchPage: 0, // 当前搜索页码
    searchHasMore: false, // 搜索是否还有更多
    searchLoading: false, // 搜索加载中
    guesses: [] as GuessFeedback[], // 已猜测记录
    attemptsLeft: MAX_ATTEMPTS, // 剩余次数
    gameStatus: 'playing' as 'playing' | 'won' | 'lost', // 游戏状态
    showAdModal: false, // 广告弹窗
    showResultModal: false, // 结算弹窗（替代 wx.showModal）
    resultTitle: '',
    resultContent: '',

    // 难度选择
    showDifficultySelection: false, // 显示难度选择弹窗
    difficulty: '' as 'trivial' | 'easy' | 'hard' | 'hell' | '', // 难度等级

    // 新增游戏模式相关
    showModeSelection: true, // 显示模式选择弹窗
    gameMode: '' as 'personal' | 'friend' | '', // 游戏模式
    showFriendInvite: false, // 显示好友邀请弹窗
    userInfo: null as UserInfo | null, // 用户信息
    opponentInfo: null as UserInfo | null, // 对手信息
    pkRoomId: '', // PK房间ID
    isRoomOwner: false, // 是否是房主
    pkResult: null as { type: string; message: string } | null, // PK结果
    myAttempts: 0, // 我在PK模式中的尝试次数
    opponentAttempts: 0, // 对手在PK模式中的尝试次数
    myAvatar: '/assets/icons/user.png', // 当前用户头像（安全取值，避免WXML中?.语法不支持）
    myName: '我',
    opponentAvatar: '/assets/icons/user.png',
    opponentName: '对手',

    // 提示功能
    hintUsed: false,         // 本局是否已用过提示
    showHintModal: false,    // 提示弹窗
    hintContent: '',         // 提示内容（完整文本）

    // 玩法说明
    showRulesModal: false,
    rulesContent: `猜选手游戏：点击搜索框输入选手ID（无大小写区分），选择你要猜测的选手，根据下方的信息提示猜出正确选手吧！

绿色：该选手的此项信息正确
黄色：该选手的此项信息接近正确（战队黄色→目标选手在该战队待过；国籍黄色→同V社赛区；年龄/Major差≤3）
无色：该选手的此项信息不正确

数值信息的上下箭头表示更大/更小
战队栏为空则表明该选手现在无战队
选手位置包括：步枪手、狙击手、教练`,
  },

  onLoad(options: any) {
    // 检查是否通过分享进入PK模式
    if (options.pkRoomId && options.opponentId) {
      this.setData({
        loading: false,
        showModeSelection: false,
        gameMode: 'friend',
        pkRoomId: options.pkRoomId,
        isRoomOwner: false
      });
      // 先检查登录状态，再加入房间
      const token = wx.getStorageSync('token');
      const cachedUser = wx.getStorageSync('userInfo');
      if (token && cachedUser && cachedUser.openid) {
        this.handleEnterPKRoom(options.pkRoomId, options.opponentId);
      } else {
        // 未登录，引导去登录后再回来
        wx.showModal({
          title: '需要登录',
          content: '好友PK需要先登录，请前往"我的"页面进行微信登录后，重新点击分享链接加入',
          success: (res) => {
            if (res.confirm) {
              wx.switchTab({ url: '/pages/user/index' });
            }
          }
        });
      }
      return;
    }
    this.initGame();
  },

  onShow() {
    // 页面显示时检查用户登录状态
    this.checkUserLogin();
  },

  onUnload() {
    // 离开页面时清理所有轮询
    this._stopPollingForJoiner();
    this._stopPollingForPkProgress();
    if ((this as any)._pkResultTimer) {
      clearInterval((this as any)._pkResultTimer);
      (this as any)._pkResultTimer = null;
    }
  },

  /**
   * 检查用户登录状态
   */
  checkUserLogin() {
    const token = wx.getStorageSync('token');
    const cachedUser = wx.getStorageSync('userInfo');
    if (token && cachedUser && cachedUser.openid) {
      const nickName = cachedUser.nickname || cachedUser.nickName || '微信用户';
      const avatarUrl = cachedUser.avatarUrl || '/assets/icons/user.png';
      this.setData({
        userInfo: {
          openid: cachedUser.openid,
          nickName,
          avatarUrl,
          winCount: cachedUser.winCount || 0
        },
        myName: nickName,
        myAvatar: avatarUrl,
      });
    } else {
      this.setData({ userInfo: null });
    }
  },

  /**
   * 选择游戏模式 → 弹出难度选择
   * 好友PK必须先登录
   */
  selectGameMode(e: any) {
    const mode = e.currentTarget.dataset.mode;
    if (mode === 'friend') {
      const token = wx.getStorageSync('token');
      const cachedUser = wx.getStorageSync('userInfo');
      if (!token || !cachedUser || !cachedUser.openid) {
        wx.showModal({
          title: '需要登录',
          content: '好友PK需要先登录，请前往"我的"页面进行微信登录',
          success: (res) => {
            if (res.confirm) {
              wx.switchTab({ url: '/pages/user/index' });
            }
          }
        });
        return;
      }
    }
    this.setData({ showModeSelection: false, gameMode: mode, showDifficultySelection: true });
  },

  /**
   * 选择难度 → 加载选手池 → 开始游戏
   */
  async selectDifficulty(e: any) {
    const diff = e.currentTarget.dataset.diff;
    this.setData({ difficulty: diff, showDifficultySelection: false });

    if (this.data.gameMode === 'personal') {
      // 个人模式：由服务端根据难度随机选择目标选手
      await this.startNewRound();
      wx.showToast({ title: '游戏已开始', icon: 'none', duration: 1500 });
    } else if (this.data.gameMode === 'friend') {
      // PK模式：不需要前端加载选手池，服务端选择目标
      if (!this.data.userInfo) {
        this.loginForFriendPK();
      } else {
        await this.createPkRoomOnServer(diff);
      }
    }
  },

  /**
   * 登录以进行好友PK
   */
  async loginForFriendPK() {
    // 检查是否已有登录 token
    const token = wx.getStorageSync('token');
    const cachedUser = wx.getStorageSync('userInfo');
    if (token && cachedUser && cachedUser.openid) {
      this.setData({
        userInfo: {
          openid: cachedUser.openid,
          nickName: cachedUser.nickname || cachedUser.nickName || '微信用户',
          avatarUrl: cachedUser.avatarUrl || '',
          winCount: cachedUser.winCount || 0
        },
        gameMode: 'friend',
        showFriendInvite: true
      });
      return;
    }

    // 未登录，引导用户去"我的"页面登录
    wx.showModal({
      title: '提示',
      content: '好友PK需要先登录，请前往"我的"页面进行微信一键登录',
      success: (res) => {
        if (res.confirm) {
          wx.switchTab({ url: '/pages/user/index' });
        }
      }
    });
  },

  /**
   * 取消好友PK
   */
  cancelFriendPK() {
    this._stopPollingForJoiner();
    this._stopPollingForPkProgress();
    if ((this as any)._pkResultTimer) {
      clearInterval((this as any)._pkResultTimer);
      (this as any)._pkResultTimer = null;
    }
    this.setData({
      showFriendInvite: false,
      showModeSelection: true,
      gameMode: '',
      pkRoomId: '',
      isRoomOwner: false,
      targetPlayer: null,
      opponentAttempts: 0,
    });
  },

  /**
   * 在服务端创建PK房间
   */
  async createPkRoomOnServer(difficulty: string) {
    wx.showLoading({ title: '创建房间...' });
    try {
      const res = await createPkRoom(difficulty, this.data.myName, this.data.myAvatar);
      wx.hideLoading();

      if (res.success && res.data) {
        const roomId = res.data.roomId;
        const target = res.data.targetPlayer;
        // 用服务端选的选手开始游戏
        this.setData({
          pkRoomId: roomId,
          isRoomOwner: true,
          showFriendInvite: true,
          targetPlayer: target,
          targetAvatarUrl: normalizeAvatarUrl(target.avatar),
          guesses: [],
          attemptsLeft: MAX_PK_ATTEMPTS,
          gameStatus: 'playing',
          myAttempts: 0,
          hintUsed: false,
          showHintModal: false,
          hintContent: '',
        });

        // 开始轮询等待对手加入
        this._startPollingForJoiner();

        // 自动弹出分享面板引导分享
        setTimeout(() => {
          wx.showShareMenu({
            withShareTicket: true,
            menus: ['shareAppMessage']
          });
        }, 300);
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

  /**
   * 开始轮询等待对手加入
   */
  _startPollingForJoiner() {
    this._stopPollingForJoiner(); // 清除旧轮询
    const maxWait = 5 * 60 * 1000; // 最多等待 5 分钟
    const startedAt = Date.now();
    (this as any)._pkPollTimer = setInterval(async () => {
      // 超时检查
      if (Date.now() - startedAt > maxWait) {
        this._stopPollingForJoiner();
        wx.showToast({ title: '等待超时，请重新创建房间', icon: 'none' });
        this.cancelFriendPK();
        return;
      }
      if (!this.data.pkRoomId) {
        this._stopPollingForJoiner();
        return;
      }
      try {
        const res = await getPkRoom(this.data.pkRoomId);
        if (res.success && res.data && res.data.joiner) {
          // 对手已加入！
          const joiner = res.data.joiner;
          this.setData({
            showFriendInvite: false,
            opponentInfo: joiner,
            opponentName: joiner.nickname || '对手',
            opponentAvatar: joiner.avatar || '/assets/icons/user.png',
          });
          wx.showToast({ title: '对手已加入！', icon: 'success' });
          this._stopPollingForJoiner();
          // 开始轮询PK游戏进度（对手尝试次数、是否已猜中）
          this._startPollingForPkProgress();
        }
      } catch (err) {
        // 轮询失败静默处理
      }
    }, 2000); // 每 2 秒轮询一次
  },

  /**
   * 停止轮询
   */
  _stopPollingForJoiner() {
    if ((this as any)._pkPollTimer) {
      clearInterval((this as any)._pkPollTimer);
      (this as any)._pkPollTimer = null;
    }
  },

  /**
   * 开始轮询PK游戏进度（获取对方尝试次数、检查对方是否已猜中）
   */
  _startPollingForPkProgress() {
    this._stopPollingForPkProgress();
    if (!this.data.pkRoomId) return;

    (this as any)._pkProgressTimer = setInterval(async () => {
      if (!this.data.pkRoomId || this.data.gameStatus === 'won' || this.data.gameStatus === 'lost') {
        return; // 游戏已结束，停止轮询
      }
      try {
        const res = await getPkRoom(this.data.pkRoomId);
        if (res.success && res.data) {
          const room = res.data;
          const role = this.data.isRoomOwner ? 'creator' : 'joiner';
          const opponentRole = this.data.isRoomOwner ? 'joiner' : 'creator';

          // 更新对方尝试次数
          const oppAttempts = opponentRole === 'joiner' ? (room.joinerAttempts || 0) : (room.creatorAttempts || 0);
          if (oppAttempts !== this.data.opponentAttempts) {
            this.setData({ opponentAttempts: oppAttempts });
          }

          // 检查对方是否已猜中（对方 result.won === true）
          const oppResult = opponentRole === 'joiner' ? room.joinerResult : room.creatorResult;
          if (oppResult && oppResult.won && this.data.gameStatus === 'playing') {
            // 对方已猜中，当前玩家判负
            this.setData({
              gameStatus: 'lost',
              pkResult: {
                type: 'lose',
                message: `对手已猜中！答案是${room.targetPlayer?.name || ''}`
              },
              showResultModal: true,
              resultTitle: '😞 你输了',
              resultContent: `对手在第${oppResult.attempts}次猜中了答案！`,
            });
            this._stopPollingForPkProgress();
            this.submitGameResult(false, this.data.myAttempts);
            // 同时向服务端报告失败结果，确保双方结果都记录在服务端
            this.reportPkGameResult(false, this.data.myAttempts);
          }
        }
      } catch (err) {
        // 静默处理
      }
    }, 2000); // 每2秒轮询一次
  },

  /**
   * 停止PK进度轮询
   */
  _stopPollingForPkProgress() {
    if ((this as any)._pkProgressTimer) {
      clearInterval((this as any)._pkProgressTimer);
      (this as any)._pkProgressTimer = null;
    }
  },

  /**
   * 开始轮询PK最终结果（自己已结束后，等待对方结果）
   */
  _startPollingForPkResult() {
    // 先清除进度轮询
    this._stopPollingForPkProgress();

    if ((this as any)._pkResultTimer) clearInterval((this as any)._pkResultTimer);
    if (!this.data.pkRoomId) return;

    let pollCount = 0;
    (this as any)._pkResultTimer = setInterval(async () => {
      pollCount++;
      if (pollCount > 30) { // 最多等60秒
        clearInterval((this as any)._pkResultTimer);
        (this as any)._pkResultTimer = null;
        return;
      }
      try {
        const res = await getPkRoom(this.data.pkRoomId);
        if (res.success && res.data) {
          const room = res.data;
          // 如果双方都完成，显示最终胜负
          if (room.creatorResult && room.joinerResult) {
            clearInterval((this as any)._pkResultTimer);
            (this as any)._pkResultTimer = null;
          }
        }
      } catch (err) {}
    }, 2000);
  },

  /**
   * 取消等待对手（关闭邀请弹窗）
   */
  cancelWaitForJoiner() {
    this._stopPollingForJoiner();
    this.cancelFriendPK();
  },

  /**
   * 分享给好友（由右上角菜单或 open-type=share 按钮触发）
   */
  onShareAppMessage() {
    if (this.data.gameMode === 'friend' && this.data.pkRoomId) {
      return {
        title: 'CS Match Pro - 好友PK挑战',
        path: `/pages/guess/guess?pkRoomId=${this.data.pkRoomId}&opponentId=${this.data.userInfo?.openid}`,
        imageUrl: ''
      };
    }
    return {};
  },

  /**
   * 进入PK房间（通过分享链接打开）
   */
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
          pkRoomId: roomId,
          isRoomOwner: false,
          opponentInfo: room.creator,
          opponentName: room.creator?.nickname || '对手',
          opponentAvatar: room.creator?.avatar || '/assets/icons/user.png',
          targetPlayer: target,
          targetAvatarUrl: normalizeAvatarUrl(target.avatar),
          guesses: [],
          attemptsLeft: MAX_PK_ATTEMPTS,
          gameStatus: 'playing',
          myAttempts: 0,
          hintUsed: false,
          showHintModal: false,
          hintContent: '',
          showModeSelection: false,
        });
        // 开始轮询PK游戏进度
        this._startPollingForPkProgress();
      } else {
        wx.showToast({ title: res.message || '加入房间失败', icon: 'none' });
      }
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: '加入房间失败', icon: 'none' });
    }
  },

  /**
   * 初始化游戏（不再全量加载选手，改为难度选择后懒加载）
   */
  async initGame() {
    this.setData({ loading: false });
  },

  /**
   * 开始新回合（由服务端根据难度随机选目标）
   */
  async startNewRound() {
    const difficulty = this.data.difficulty || 'hell';
    wx.showLoading({ title: '加载选手...' });
    try {
      const res = await fetchRandomPlayerByDifficulty(difficulty);
      wx.hideLoading();
      if (!res.success || !res.data) {
        wx.showToast({ title: '获取选手失败', icon: 'none' });
        return;
      }
      const target = res.data;

      // 单人模式无限次，PK模式8次
      const maxAttempts = this.data.gameMode === 'friend' ? MAX_PK_ATTEMPTS :
                         (this.data.gameMode === 'personal' ? UNLIMITED_ATTEMPTS : MAX_ATTEMPTS);

      this.setData({
        targetPlayer: target,
        targetAvatarUrl: normalizeAvatarUrl(target.avatar),
        guesses: [],
        attemptsLeft: maxAttempts,
        gameStatus: 'playing',
        searchQuery: '',
        searchResults: [],
        showAdModal: false,
        pkResult: null,
        myAttempts: 0,
        hintUsed: false,
        showHintModal: false,
        hintContent: '',
      });
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  /**
   * 搜索输入处理（防抖 + 云数据库分页搜索）
   * 仅在关键路径 setData，避免不必要重绘导致闪烁
   */
  onSearchInput(e: WechatMiniprogram.Input) {
    const query = e.detail.value.trim();
    // 先只更新 searchQuery，不触发搜索列表重绘
    // 等防抖触发后再批量更新 searchResults
    (this.data as any)._pendingQuery = query;
    if (!query) {
      this.setData({
        searchQuery: query,
        searchResults: [],
        searchPage: 0,
        searchHasMore: false
      });
      return;
    }

    // 清除之前的防抖定时器
    if ((this as any).searchTimer) {
      clearTimeout((this as any).searchTimer);
    }

    // 设置防抖定时器，400ms 后执行搜索
    (this as any).searchTimer = setTimeout(async () => {
      const q = (this.data as any)._pendingQuery || query;
      // 新的搜索关键词，重置页码
      this.setData({ searchQuery: q, searchPage: 0, searchResults: [], searchLoading: true });

      const res = await searchPlayers(q, 0, 20);
      if (res.success && res.data.length > 0) {
        const results = res.data.map(player => ({
          ...player,
          avatarUrl: normalizeAvatarUrl(player.avatar)
        }));
        this.setData({
          searchResults: results,
          searchPage: 0,
          searchHasMore: res.hasMore,
          searchLoading: false
        });
      } else {
        this.setData({ searchResults: [], searchHasMore: false, searchLoading: false });
      }
    }, 400);
  },

  /**
   * 滚动到底部加载更多搜索结果
   */
  onSearchScrollToLower() {
    const { searchQuery, searchPage, searchHasMore, searchLoading } = this.data;
    if (!searchQuery || !searchHasMore || searchLoading) return;

    this.setData({ searchLoading: true });
    const nextPage = searchPage + 1;

    searchPlayers(searchQuery, nextPage, 20).then(res => {
      if (res.success && res.data.length > 0) {
        const newResults = res.data.map(player => ({
          ...player,
          avatarUrl: normalizeAvatarUrl(player.avatar)
        }));
        this.setData({
          searchResults: [...this.data.searchResults, ...newResults],
          searchPage: nextPage,
          searchHasMore: res.hasMore,
          searchLoading: false
        });
      } else {
        this.setData({ searchHasMore: false, searchLoading: false });
      }
    });
  },

  /**
   * 玩家选择猜测对象
   */
  selectPlayer(e: WechatMiniprogram.TouchEvent) {
    const playerId = e.currentTarget.dataset.id;
    if (!playerId) return;

    const selectedPlayer = this.data.searchResults.find(p => p._id === playerId);
    if (!selectedPlayer) return;

    // 如果选手数据还没加载完，提示等待
    if (this.data.loading) {
      wx.showToast({ title: '数据加载中，请稍候...', icon: 'none' });
      return;
    }

    // 如果没有目标选手，先开始一局游戏
    if (!this.data.targetPlayer) {
      this.setData({ gameMode: 'personal' });
      wx.showToast({ title: '请先选择难度开始游戏', icon: 'none' });
      this.setData({ gameMode: '' });
      return;
    }

    // 清除搜索结果和输入
    this.setData({
      searchQuery: '',
      searchResults: [],
      searchPage: 0,
      searchHasMore: false
    });

    this.processGuess(selectedPlayer);
  },

  /**
   * 处理猜测逻辑
   */
  processGuess(player: Player) {
    const target = this.data.targetPlayer;
    // 防御：targetPlayer 为空时（数据还没加载完）禁止猜测
    if (!target) {
      wx.showToast({ title: '数据未就绪，请稍候...', icon: 'none' });
      return;
    }

    // PK模式：校验登录
    if (this.data.gameMode === 'friend' && !this.data.userInfo) {
      wx.showModal({
        title: '需要登录',
        content: 'PK模式需要先登录，请前往"我的"页面进行微信登录',
        success: (res) => {
          if (res.confirm) {
            wx.switchTab({ url: '/pages/user/index' });
          }
        }
      });
      return;
    }

    const guesses = this.data.guesses;

    // 检查是否已经猜过
    if (guesses.some(g => g.player._id === player._id)) {
      wx.showToast({ title: '已经猜过该选手', icon: 'none' });
      return;
    }

    const feedback: GuessFeedback['status'] = {
      // 战队判断：当前战队相同=正确(绿)；猜测选手的当前战队是目标选手的曾经所属战队=接近(黄)
      team: player.team === target.team ? 'correct' :
        ((target.formerTeams || []).includes(player.team) ? 'close' : 'incorrect'),
      // 国家判断：国家相同=绿；region相同但国家不同=黄；均不同=无色
      country: player.country === target.country ? 'correct' :
        (player.region && target.region && player.region === target.region ? 'close' : 'incorrect'),

      age: player.age === target.age ? 'correct' : (Math.abs(player.age - target.age) <= 2 ? 'close' : 'incorrect'),
      ageDir: player.age < target.age ? 'up' : (player.age > target.age ? 'down' : ''),

      major: player.majorAppearances === target.majorAppearances ? 'correct' : (Math.abs(player.majorAppearances - target.majorAppearances) <= 2 ? 'close' : 'incorrect'),
      majorDir: player.majorAppearances < target.majorAppearances ? 'up' : (player.majorAppearances > target.majorAppearances ? 'down' : ''),

      position: player.position === target.position ? 'correct' : 'incorrect',
    };

    const newGuess: GuessFeedback = { player, status: feedback };
    const newGuesses = [newGuess, ...guesses]; // 新猜测排在前面
    const isUnlimitedMode = this.data.attemptsLeft === UNLIMITED_ATTEMPTS;
    const newAttempts = isUnlimitedMode ? UNLIMITED_ATTEMPTS : this.data.attemptsLeft - 1;
    const myAttempts = this.data.myAttempts + 1;

    let newStatus = this.data.gameStatus;
    let pkResult = null;

    if (player._id === target._id) {
      newStatus = 'won';

      // PK模式处理
      if (this.data.gameMode === 'friend') {
        pkResult = {
          type: 'win',
          message: `胜利！你在第${myAttempts}次猜中了！`
        };
        // 向服务端报告胜利
        this.reportPkGameResult(true, myAttempts);
      }
    } else if (!isUnlimitedMode && newAttempts <= 0) {
      newStatus = 'lost';

      // PK模式处理
      if (this.data.gameMode === 'friend') {
        pkResult = {
          type: 'lose',
          message: `你输了，答案是${target.name}`
        };
        // 向服务端报告失败
        this.reportPkGameResult(false, myAttempts);
      }
    }

    this.setData({
      guesses: newGuesses,
      attemptsLeft: newAttempts,
      gameStatus: newStatus,
      myAttempts,
      pkResult
    });

    // PK模式：每次猜测后上报尝试次数，并拉取对方进度
    if (this.data.gameMode === 'friend' && this.data.pkRoomId) {
      this.syncPkAttempts(myAttempts);
    }

    // 游戏结束时提交记录
    if (newStatus === 'won' || newStatus === 'lost') {
      this.submitGameResult(newStatus === 'won', myAttempts);
    }

    // 显示结果提示
    if (newStatus === 'won' || newStatus === 'lost') {
      if (this.data.gameMode === 'friend') {
        // PK模式：显示结果，同时开始轮询对方是否也已结束
        this._startPollingForPkResult();
        setTimeout(() => {
          this.setData({
            showResultModal: true,
            resultTitle: pkResult?.type === 'win' ? '🎉 你赢了！' : '😞 你输了',
            resultContent: pkResult?.message || `答案选手: ${target.name}`,
          });
        }, 500);
      } else {
        // 个人游戏模式 - 使用自定义弹窗（点击空白可关闭）
        const isUnlimited = this.data.gameMode === 'personal';
        const title = newStatus === 'won' ? '恭喜胜利!' : '游戏结束';
        const content = newStatus === 'won'
          ? (isUnlimited
            ? `恭喜猜对了选手 ${target.name}！`
            : `你用了 ${myAttempts} 次机会猜对了选手 ${target.name}！`)
          : `很遗憾，正确答案是 ${target.name}`;

        this.setData({
          resultTitle: title,
          resultContent: content,
          showResultModal: true
        });
      }
    }
  },

  /**
   * PK模式：上报当前尝试次数到服务端
   */
  async syncPkAttempts(attempts: number) {
    if (!this.data.pkRoomId || !this.data.userInfo) return;
    const role = this.data.isRoomOwner ? 'creator' : 'joiner';
    try {
      const res = await reportPkAttempt(this.data.pkRoomId, role, attempts);
      if (res.success && res.data) {
        // 更新对方的尝试次数
        if (role === 'creator') {
          this.setData({ opponentAttempts: res.data.joinerAttempts });
        } else {
          this.setData({ opponentAttempts: res.data.creatorAttempts });
        }
      }
    } catch (err) {
      // 静默失败
    }
  },

  /**
   * PK模式：向服务端报告游戏结果
   */
  async reportPkGameResult(won: boolean, attempts: number) {
    if (!this.data.pkRoomId || !this.data.userInfo) return;
    const role = this.data.isRoomOwner ? 'creator' : 'joiner';
    try {
      await reportPkResult(this.data.pkRoomId, role, won, attempts);
    } catch (err) {
      console.error('reportPkResult failed', err);
    }
  },

  /**
   * 广告/重置逻辑
   * 单人模式无限制，直接开始新游戏
   */
  // async checkAdLogic() {
  //   if (this.data.gameMode === 'personal') {
  //     await this.startNewRound();
  //   } else {
  //     this.setData({ showAdModal: true });
  //   }
  // },

  // onWatchAd() {
  //   wx.showLoading({ title: '广告播放中...' });
  //   setTimeout(() => {
  //     wx.hideLoading();
  //     this.setData({ showAdModal: false });
  //     this.startNewRound();
  //     wx.showToast({ title: '获得新回合机会!', icon: 'success' });
  //   }, 2000);
  // },

  // onSkipAd() {
  //   this.setData({ showAdModal: false });
  //   this.startNewRound();
  // },

  /**
   * 结算弹窗：点击空白仅关闭弹窗，保留当前页面
   */
  onResultMaskTap() {
    this.setData({ showResultModal: false });
  },

  /**
   * 结算弹窗：点击内容区域不关闭（阻止冒泡）
   */
  onResultContentTap() {
    // 不做任何事，阻止冒泡到 mask
  },

  /**
   * 结算弹窗：再来一局按钮 → 重置并开始新回合
   * PK模式结算后回到模式选择
   */
  async onResultRestart() {
    this.setData({ showResultModal: false });
    if (this.data.gameMode === 'friend') {
      // PK模式回到选择界面
      this._stopPollingForJoiner();
      this._stopPollingForPkProgress();
      if ((this as any)._pkResultTimer) {
        clearInterval((this as any)._pkResultTimer);
        (this as any)._pkResultTimer = null;
      }
      this.setData({
        showModeSelection: true,
        gameMode: '',
        pkRoomId: '',
        isRoomOwner: false,
        opponentInfo: null,
        myAttempts: 0,
        opponentAttempts: 0,
        hintUsed: false,
        showHintModal: false,
        hintContent: '',
        targetPlayer: null,
        targetAvatarUrl: '',
        guesses: [],
        gameStatus: 'playing' as 'playing',
        pkResult: null,
      });
    } else {
      await this.startNewRound();
    }
  },

  /**
   * 提交游戏结果到后端（fire-and-forget）
   */
  async submitGameResult(won: boolean, attempts: number) {
    const token = wx.getStorageSync('token');
    if (!token) return; // 未登录不记录

    const target = this.data.targetPlayer;
    if (!target) return;

    try {
      await submitGuessRecord({
        won,
        attempts,
        difficulty: this.data.difficulty,
        targetPlayerId: target.playerId || target._id || '',
        targetPlayerName: target.name || '',
        gameMode: this.data.gameMode || 'personal'
      });
    } catch (err) {
      console.error('submitGuessRecord failed', err);
    }
  },

  /**
   * 认输按钮 - 直接结束游戏显示答案
   */
  onGiveUp() {
    if (!this.data.targetPlayer) return;

    const target = this.data.targetPlayer;

    this.setData({
      gameStatus: 'lost',
      attemptsLeft: 0,
      resultTitle: '游戏结束',
      resultContent: `很遗憾，正确答案是 ${target.name}`,
      showResultModal: true
    });

    // 记录失败结果（认输，尝试次数=当前已猜次数）
    this.submitGameResult(false, this.data.myAttempts || 0);
  },

  /**
   * 获取提示：猜测次数 > 6 后才能使用，每局限一次
   * 随机展示目标选手的战队/国家/年龄/Major次数（不含姓名）
   */
  onGetHint() {
    const target = this.data.targetPlayer;
    if (!target || this.data.hintUsed || this.data.myAttempts <= 5) return;

    // 随机选取一个属性（排除姓名）
    const hints: { key: string; text: string }[] = [];
    if (target.team) hints.push({ key: 'team', text: `该选手的战队为：${target.team}` });
    if (target.country) hints.push({ key: 'country', text: `该选手的国家为：${target.country}` });
    if (target.age != null) hints.push({ key: 'age', text: `该选手的年龄为：${target.age}` });
    if (target.majorAppearances != null) hints.push({ key: 'major', text: `该选手的Major参赛次数为：${target.majorAppearances}` });

    if (hints.length === 0) return;

    const pick = hints[Math.floor(Math.random() * hints.length)];

    this.setData({
      hintUsed: true,
      showHintModal: true,
      hintContent: pick.text,
    });
  },

  /** 点击弹窗空白处 / "我知道了" — 关闭提示弹窗 */
  onHintMaskTap() {
    this.setData({ showHintModal: false });
  },

  /** 阻止事件冒泡到 mask */
  onHintContentTap() {},

  // ============ 玩法说明 ============

  onShowRules() {
    this.setData({ showRulesModal: true });
  },

  onRulesMaskTap() {
    this.setData({ showRulesModal: false });
  },

  onRulesContentTap() {},

  onRulesClose() {
    this.setData({ showRulesModal: false });
  },
});