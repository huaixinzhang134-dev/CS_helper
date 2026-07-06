import { fetchPlayerListAll, searchPlayers, fetchRankedTeamNames, Player } from '../../services/api';
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
    allPlayers: [] as Player[], // 所有选手缓存
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
    difficulty: '' as 'easy' | 'hard' | 'hell' | '', // 难度等级
    rankedTeamNames: [] as string[], // 排名队伍名称缓存

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
  },

  onLoad(options: any) {
    // 检查是否通过分享进入PK模式
    if (options.pkRoomId && options.opponentId) {
      this.setData({
        showModeSelection: false,
        gameMode: 'friend',
        pkRoomId: options.pkRoomId,
        isRoomOwner: false
      });
      this.handleEnterPKRoom(options.pkRoomId, options.opponentId);
    }
    this.initGame();
  },

  onShow() {
    // 页面显示时检查用户登录状态
    this.checkUserLogin();
  },

  /**
   * 检查用户登录状态
   */
  checkUserLogin() {
    wx.checkSession({
      success: () => {
        // session_key 未过期，检查本地缓存
        const userInfo = wx.getStorageSync('userInfo');
        if (userInfo) {
          this.setData({ userInfo });
        } else {
          this.setData({ userInfo: null });
        }
      },
      fail: () => {
        // session_key 已过期，清除本地用户信息
        wx.removeStorageSync('userInfo');
        this.setData({ userInfo: null });
      }
    });
  },

  /**
   * 选择游戏模式
   */
  selectGameMode(e: any) {
    const mode = e.currentTarget.dataset.mode;
    this.setData({ showModeSelection: false, gameMode: mode, showDifficultySelection: true });
  },

  /**
   * 登录以进行好友PK
   */
  async selectDifficulty(e: any) {
    const diff = e.currentTarget.dataset.diff;
    this.setData({ difficulty: diff, showDifficultySelection: false });

    // 简单模式需要预取排名队伍名称
    if (diff === 'easy') {
      if (this.data.rankedTeamNames.length === 0) {
        wx.showLoading({ title: '加载排名数据...' });
        const res = await fetchRankedTeamNames();
        wx.hideLoading();
        if (res.success && res.data.length > 0) {
          this.setData({ rankedTeamNames: res.data });
        } else {
          wx.showToast({ title: '排名数据加载失败，使用默认难度', icon: 'none' });
          this.setData({ difficulty: 'hard' });
        }
      }
    }

    if (this.data.gameMode === 'personal') {
      this.startNewRound();
    } else if (this.data.gameMode === 'friend') {
      // 好友PK需要登录
      if (!this.data.userInfo) {
        this.loginForFriendPK();
      } else {
        this.setData({ showFriendInvite: true });
      }
    }
  },

  loginForFriendPK() {
    wx.getUserProfile({
      desc: '用于完善用户资料',
      success: (res) => {
        const userInfo = {
          openid: 'demo_' + Date.now(), // 实际需要调用后端获取
          nickName: res.userInfo.nickName,
          avatarUrl: res.userInfo.avatarUrl,
          winCount: 0
        };

        wx.setStorageSync('userInfo', userInfo);
        this.setData({
          userInfo,
          gameMode: 'friend',
          showFriendInvite: true
        });
      },
      fail: () => {
        wx.showToast({ title: '需要登录才能进行好友PK', icon: 'none' });
      }
    });
  },

  /**
   * 取消好友PK
   */
  cancelFriendPK() {
    this.setData({
      showFriendInvite: false,
      showModeSelection: true,
      gameMode: ''
    });
  },

  /**
   * 分享给好友
   */
  onShareAppMessage() {
    if (this.data.gameMode === 'friend') {
      const roomId = 'pk_' + Date.now();
      this.setData({
        pkRoomId: roomId,
        isRoomOwner: true,
        showFriendInvite: false
      });

      // 创建房间
      this.createPKRoom(roomId);

      return {
        title: 'CS Match Pro - 好友PK挑战',
        path: `/pages/guess/guess?pkRoomId=${roomId}&opponentId=${this.data.userInfo?.openid}`,
        imageUrl: '' // 可以设置分享图片
      };
    }
    return {};
  },

  /**
   * 创建PK房间
   */
  createPKRoom(roomId: string) {
    // 实际项目中应该调用后端API创建房间
    // 这里模拟本地存储
    const room = {
      roomId: roomId,
      owner: this.data.userInfo,
      opponent: null,
      targetPlayer: null,
      createdAt: Date.now()
    };
    wx.setStorageSync('pkRoom_' + roomId, room);
  },

  /**
   * 进入PK房间
   */
  handleEnterPKRoom(roomId: string, opponentId: string) {
    const room = wx.getStorageSync('pkRoom_' + roomId);
    if (room) {
      // 加入房间
      room.opponent = this.data.userInfo;
      wx.setStorageSync('pkRoom_' + roomId, room);

      // 更新对手信息
      this.setData({ opponentInfo: room.owner });

      // 开始PK游戏
      this.startNewRound();
    }
  },

  /**
   * 初始化游戏
   */
  async initGame() {
    this.setData({ loading: true });
    try {
      // 加载全部选手数据（共 4654 条），用于随机抽选和猜测匹配
      const res = await fetchPlayerListAll();
      if (res.success && res.data.length > 0) {
        this.setData({ allPlayers: res.data });
        if (this.data.gameMode === 'personal') {
          this.startNewRound();
        }
      }
    } catch (err) {
      console.error('Failed to load players', err);
      wx.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  /**
   * 开始新回合
   */
  startNewRound() {
    const { allPlayers, difficulty, rankedTeamNames } = this.data;
    if (allPlayers.length === 0) return;

    // 根据难度筛选目标池
    let pool = allPlayers;
    if (difficulty === 'easy' && rankedTeamNames.length > 0) {
      // 简单：目标选手的队伍必须在 team_ranking 表中
      pool = allPlayers.filter(p => p.team && rankedTeamNames.includes(p.team));
      if (pool.length === 0) {
        wx.showToast({ title: '当前排名数据为空，切换至普通难度', icon: 'none' });
        pool = allPlayers;
      }
    } else if (difficulty === 'hard') {
      // 困难：目标选手必须有现役队伍
      pool = allPlayers.filter(p => p.team && p.team.trim() !== '');
      if (pool.length === 0) {
        wx.showToast({ title: '没有符合条件的选手', icon: 'none' });
        pool = allPlayers;
      }
    }
    // 地狱：不做筛选，使用全部选手

    // 随机选择一个目标选手
    const randomIndex = Math.floor(Math.random() * pool.length);
    const target = pool[randomIndex];

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
      myAttempts: 0
    });

    // 如果是PK模式，保存目标选手到房间
    if (this.data.gameMode === 'friend' && this.data.pkRoomId) {
      const room = wx.getStorageSync('pkRoom_' + this.data.pkRoomId);
      if (room) {
        room.targetPlayer = target;
        wx.setStorageSync('pkRoom_' + this.data.pkRoomId, room);
      }
    }

  },

  /**
   * 搜索输入处理（防抖 + 云数据库分页搜索）
   */
  onSearchInput(e: WechatMiniprogram.Input) {
    const query = e.detail.value.trim();
    this.setData({ searchQuery: query });

    if (!query) {
      this.setData({ searchResults: [], searchPage: 0, searchHasMore: false });
      return;
    }

    // 清除之前的防抖定时器
    if ((this as any).searchTimer) {
      clearTimeout((this as any).searchTimer);
    }

    // 设置防抖定时器，400ms 后执行搜索
    (this as any).searchTimer = setTimeout(async () => {
      // 新的搜索关键词，重置页码
      this.setData({ searchPage: 0, searchResults: [], searchLoading: true });

      const res = await searchPlayers(query, 0, 20);
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
    console.log('playerId:', playerId);

    if (!playerId) return;

    const selectedPlayer = this.data.searchResults.find(p => p._id === playerId);
    console.log('selectedPlayer:', selectedPlayer);

    if (!selectedPlayer) return;

    // 如果没有目标选手，先开始一局游戏
    if (!this.data.targetPlayer) {
      this.setData({ gameMode: 'personal' });
      this.startNewRound();
      // 等待一下再处理选择
      setTimeout(() => {
        this.processGuess(selectedPlayer);
      }, 100);
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
    const target = this.data.targetPlayer!;
    const guesses = this.data.guesses;

    // 检查是否已经猜过
    if (guesses.some(g => g.player._id === player._id)) {
      wx.showToast({ title: '已经猜过该选手', icon: 'none' });
      return;
    }

    const feedback: GuessFeedback['status'] = {
      // 战队判断：双方当前所属战队相同=正确(绿)；答案选手当前战队曾出现在猜测选手历史战队中=接近(黄)
      team: player.team === target.team ? 'correct' :
        ((player.formerTeams || []).includes(target.team) ||
         (target.formerTeams || []).includes(player.team) ? 'close' : 'incorrect'),
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
        this.handlePKWin(myAttempts);
        pkResult = {
          type: 'win',
          message: `胜利！你在第${myAttempts}次猜中了！`
        };
      }
    } else if (!isUnlimitedMode && newAttempts <= 0) {
      newStatus = 'lost';

      // PK模式处理
      if (this.data.gameMode === 'friend') {
        pkResult = {
          type: 'lose',
          message: `你输了，答案是${target.name}`
        };
      }
    }

    this.setData({
      guesses: newGuesses,
      attemptsLeft: newAttempts,
      gameStatus: newStatus,
      myAttempts,
      pkResult
    });

    // 显示结果提示
    if (newStatus === 'won' || newStatus === 'lost') {
      if (this.data.gameMode === 'friend') {
        // PK模式的特殊处理
        setTimeout(() => {
          this.checkAdLogic();
        }, 2000);
      } else {
        // 个人游戏模式 - 使用自定义弹窗（点击空白可关闭）
        const isUnlimited = this.data.gameMode === 'personal';
        const title = newStatus === 'won' ? '恭喜胜利!' : '游戏结束';
        const content = newStatus === 'won'
          ? (isUnlimited
            ? `恭喜猜对了选手 ${target.name}！`
            : `你用了 ${this.data.attemptsLeft - 1} 次机会猜对了选手 ${target.name}！`)
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
   * 处理PK胜利
   */
  handlePKWin(attempts: number) {
    const userInfo = this.data.userInfo;
    if (userInfo && attempts <= MAX_PK_ATTEMPTS) {
      userInfo.winCount += 1;
      wx.setStorageSync('userInfo', userInfo);
      this.setData({ userInfo });
      wx.showToast({ title: '胜场+1！', icon: 'success' });
    }
  },

  /**
   * 广告/重置逻辑
   * 单人模式无限制，直接开始新游戏
   */
  checkAdLogic() {
    if (this.data.gameMode === 'personal') {
      // 单人模式无次数限制，直接开始新游戏
      this.startNewRound();
    } else {
      // 其他模式显示广告弹窗
      this.setData({ showAdModal: true });
    }
  },

  onWatchAd() {
    wx.showLoading({ title: '广告播放中...' });
    setTimeout(() => {
      wx.hideLoading();
      this.setData({ showAdModal: false });
      this.startNewRound();
      wx.showToast({ title: '获得新回合机会!', icon: 'success' });
    }, 2000); // 模拟2秒广告
  },

  onSkipAd() {
    // 假设可以跳过，或者跳过就不能玩了？这里设计为跳过也可以玩，但提示一下
    this.setData({ showAdModal: false });
    this.startNewRound();
  },

  /**
   * 结算弹窗：点击空白关闭
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
   */
  onResultRestart() {
    this.setData({ showResultModal: false });
    this.checkAdLogic();
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
  }
});