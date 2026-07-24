/**
 * API Service（REST 重写版）
 * 通过自建 Node.js 后端（server/）访问 MySQL
 */
import { API_BASE } from '../config';

// ---------- 类型 ----------

export interface Player {
  _id?: string;
  playerId: string;
  name: string;
  realName: string;
  team: string;
  formerTeams?: string[];
  country: string;
  countryCode: string;
  region?: string;
  age: number;
  majorAppearances: number;
  position: '狙击手' | '步枪手' | '教练' | string;
  status: 'active' | 'retired' | 'coach' | 'free_agent' | 'unknown' | string;
  avatar: string;
}

export interface Match {
  _id: string;
  event: string;
  roundName?: string;
  status: 'Live' | 'Upcoming' | 'Finished';
  grade?: number;
  teamA: { name: string; logo: string; score: number };
  teamB: { name: string; logo: string; score: number };
  time: string;
  roundScores?: { map: string; team1Score: number; team2Score: number }[];
}

// ---------- 通用请求封装 ----------

interface ApiResp<T> {
  code: number;
  message: string;
  data: T;
}

/**
 * wx.request Promise 化
 */
function request<T>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, data?: any) {
  return new Promise<{ success: boolean; data: T | null; message?: string; code?: number }>((resolve) => {
    wx.request({
      url: `${API_BASE}${path}`,
      method,
      data,
      timeout: 18000,
      header: { 'content-type': 'application/json' },
      success: (res: any) => {
        const body = res.data as ApiResp<T>;
        if (body && body.code === 0) {
          resolve({ success: true, data: body.data });
        } else {
          resolve({
            success: false,
            data: null,
            message: body?.message || '后端返回错误',
            code: body?.code
          });
        }
      },
      fail: (err: any) => {
        console.error(`[request ${method} ${path}] fail`, err);
        resolve({ success: false, data: null, message: err.errMsg || '网络请求失败' });
      }
    });
  });
}

const get  = <T>(p: string, q?: Record<string, any>) => request<T>('GET', `${p}${queryString(q)}`);
const post = <T>(p: string, body?: any) => request<T>('POST', p, body);
const put  = <T>(p: string, body?: any) => request<T>('PUT', p, body);
const del  = <T>(p: string, q?: Record<string, any>) => request<T>('DELETE', `${p}${queryString(q)}`);

// ---------- 带 token 的请求封装 ----------

function requestWithToken<T>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, token: string, data?: any) {
  return new Promise<{ success: boolean; data: T | null; message?: string; code?: number }>((resolve) => {
    const reqData = (method === 'PUT' || method === 'POST') && data !== undefined
      ? JSON.stringify(data)
      : data;
    wx.request({
      url: `${API_BASE}${path}`,
      method,
      data: reqData,
      timeout: 18000,
      header: {
        'content-type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      success: (res: any) => {
        const body = res.data as ApiResp<T>;
        if (body && body.code === 0) {
          resolve({ success: true, data: body.data });
        } else {
          resolve({
            success: false,
            data: null,
            message: body?.message || '后端返回错误',
            code: body?.code
          });
        }
      },
      fail: (err: any) => {
        console.error(`[auth request ${method} ${path}] fail`, err);
        resolve({ success: false, data: null, message: err.errMsg || '网络请求失败' });
      }
    });
  });
}

function getAuth<T>(p: string, token?: string) {
  return requestWithToken<T>('GET', p, token || getToken());
}
function postAuth<T>(p: string, body?: any, token?: string) {
  return requestWithToken<T>('POST', p, token || getToken(), body);
}
function putAuth<T>(p: string, body?: any, token?: string) {
  return requestWithToken<T>('PUT', p, token || getToken(), body);
}

function queryString(q?: Record<string, any>) {
  if (!q) return '';
  const parts: string[] = [];
  for (const [k, v] of Object.entries(q)) {
    if (v === undefined || v === null || v === '') continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return parts.length ? `?${parts.join('&')}` : '';
}


// ============================================================
// 选手 API
// ============================================================

/**
 * 获取选手列表（指定 skip / limit）
 */
export const fetchPlayerList = async (
  skip: number = 0,
  limit: number = 20
): Promise<{ success: boolean; data: Player[] }> => {
  const res = await get<Player[]>('/players', { skip, limit });
  return { success: res.success, data: res.data ?? [] };
};

/**
 * 获取全部选手（原 wx.cloud 全量循环拉的兼容接口）
 * 后端分批拉取后拼接
 */
export const fetchPlayerListAll = async (): Promise<{ success: boolean; data: Player[] }> => {
  try {
    const PAGE = 100;
    let all: Player[] = [];
    let skip = 0;
    let hasMore = true;
    while (hasMore) {
      const res = await fetchPlayerList(skip, PAGE);
      if (!res.success || !res.data) break;
      all = all.concat(res.data);
      if (res.data.length < PAGE) hasMore = false;
      else skip += PAGE;
    }
    return { success: true, data: all };
  } catch (err) {
    console.error('fetchPlayerListAll failed', err);
    return { success: false, data: [] };
  }
};

/**
 * 根据难度获取选手池（替代全量 fetchPlayerListAll）
 * easy：world top 60 排名战队内选手
 * hard：所有现役选手
 * hell：所有选手（含退役/自由人）
 */
export const fetchPlayerPoolByDifficulty = async (
  difficulty: string
): Promise<{ success: boolean; data: Player[] }> => {
  const res = await get<Player[]>('/players/pool', { difficulty });
  return { success: res.success, data: res.data ?? [] };
};

/**
 * 根据难度随机选一个目标选手（单人模式和PK模式共用同一套难度逻辑）
 */
export const fetchRandomPlayerByDifficulty = async (
  difficulty: string
): Promise<{ success: boolean; data: Player | null }> => {
  const res = await get<Player>('/players/random-by-difficulty', { difficulty });
  return { success: res.success, data: res.data };
};

/**
 * 分页获取选手
 */
export const fetchPlayerListPaginated = async (
  page: number,
  pageSize: number
): Promise<{ success: boolean; data: Player[]; hasMore: boolean }> => {
  const actualPageSize = Math.min(pageSize, 100);
  const res = await get<Player[]>('/players', { skip: page * actualPageSize, limit: actualPageSize });
  const data = res.data ?? [];
  return { success: res.success, data, hasMore: data.length === actualPageSize };
};

/**
 * 选手详情（按 playerId = game_id）
 */
export const fetchPlayerDetail = async (
  playerId: string
): Promise<{ success: boolean; data: Player | null }> => {
  const res = await get<Player>(`/players/${encodeURIComponent(playerId)}`);
  return { success: res.success, data: res.data };
};

/**
 * 选手总数
 */
export const fetchPlayerCount = async (): Promise<{ success: boolean; data: { total: number } | null }> => {
  return await get<{ total: number }>('/players/count');
};

/**
 * 模糊搜索选手（name / real_name / game_id 前缀匹配）
 * @param difficulty 可选，限定到指定难度选手池
 */
export const searchPlayers = async (
  keyword: string,
  page: number = 0,
  pageSize: number = 20,
  difficulty?: string
): Promise<{ success: boolean; data: Player[]; hasMore: boolean; total?: number }> => {
  if (!keyword || !keyword.trim()) {
    return { success: true, data: [], hasMore: false };
  }
  // 手动请求以获取响应根层级的 total / hasMore（get 封装会丢失它们）
  return new Promise((resolve) => {
    const params: Record<string, any> = { q: keyword, page, pageSize };
    if (difficulty) params.difficulty = difficulty;
    const qs = queryString(params);
    wx.request({
      url: `${API_BASE}/players/search${qs}`,
      method: 'GET',
      timeout: 18000,
      header: { 'content-type': 'application/json' },
      success: (res: any) => {
        const body = res.data;
        if (body && body.code === 0) {
          resolve({
            success: true,
            data: body.data ?? [],
            hasMore: !!body.hasMore,
            total: body.total
          });
        } else {
          resolve({ success: false, data: [], hasMore: false, total: 0 });
        }
      },
      fail: () => {
        resolve({ success: false, data: [], hasMore: false, total: 0 });
      }
    });
  });
};

/**
 * 高级搜索选手（支持多个筛选条件组合）
 * 可选条件：name, ageMin, ageMax, country, team, formerTeam
 */
export interface AdvancedSearchParams {
  q?: string;          // 关键词（可选，与 name 不同：q 搜索 name/real_name/game_id）
  name?: string;       // 游戏 ID 模糊搜索
  ageMin?: number | string;
  ageMax?: number | string;
  country?: string;
  team?: string;
  formerTeam?: string;
  page?: number;
  pageSize?: number;
}

export const advancedSearchPlayers = async (
  params: AdvancedSearchParams
): Promise<{ success: boolean; data: Player[]; hasMore: boolean; total?: number }> => {
  // 手动请求以获取响应根层级的 hasMore / total 字段（get 封装会丢失它们）
  return new Promise((resolve) => {
    const qs = queryString(params as any);
    wx.request({
      url: `${API_BASE}/players/search${qs}`,
      method: 'GET',
      timeout: 18000,
      header: { 'content-type': 'application/json' },
      success: (res: any) => {
        const body = res.data;
        if (body && body.code === 0) {
          resolve({
            success: true,
            data: body.data ?? [],
            hasMore: !!body.hasMore,
            total: body.total
          });
        } else {
          resolve({ success: false, data: [], hasMore: false, total: 0 });
        }
      },
      fail: () => {
        resolve({ success: false, data: [], hasMore: false, total: 0 });
      }
    });
  });
};

/**
 * 随机一个选手
 */
export const getRandomPlayer = async (): Promise<{ success: boolean; data: Player | null }> => {
  const res = await get<Player>('/players/random');
  return { success: res.success, data: res.data };
};

// ============================================================
// 比赛 API
// ============================================================

/**
 * 赛事列表（按 event_name 分组）
 */
export interface MatchEvent {
  name: string;
  matchCount: number;
  latestDate: string;
  grade?: number;
}

export const fetchMatchEvents = async (grade?: number): Promise<{ success: boolean; data: MatchEvent[] }> => {
  const params = grade ? { grade: String(grade) } : {};
  const res = await get<MatchEvent[]>('/matches/events', params);
  return { success: res.success, data: res.data ?? [] };
};

/**
 * 比赛列表（可选按赛事名称过滤）
 */
export const fetchLiveMatches = async (event?: string): Promise<{ success: boolean; data: Match[] }> => {
  const query = event ? `?event=${encodeURIComponent(event)}` : '';
  const res = await get<Match[]>(`/matches${query}`);
  return { success: res.success, data: res.data ?? [] };
};

/**
 * 比赛详情
 */
export const fetchMatchDetail = async (
  id: string
): Promise<{ success: boolean; data: Match | null }> => {
  const res = await get<Match>(`/matches/${id}`);
  return { success: res.success, data: res.data };
};


// ============================================================
// 评论区 API（新版 player_comments 表）
// ============================================================

export interface CommentItem {
  _id: string;
  userId: string;
  userName: string;
  playerGameId: string;
  content: string;
  createdAt: string | Date;
}

export interface CommentListResp {
  list: CommentItem[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface MatchPlayerItem {
  _id: string;
  playerId: string;
  name: string;
  team: string;
  avatar: string;
  country?: string;
  countryCode?: string;
  position?: string;
  /** 本场击杀 */
  kills?: number | null;
  /** 本场死亡 */
  deaths?: number | null;
  /** 本场助攻 */
  assists?: number | null;
  /** 本场 Rating */
  rating?: number | null;
}

export interface MatchPlayersResp {
  team1: { name: string; players: MatchPlayerItem[] };
  team2: { name: string; players: MatchPlayerItem[] };
  total: number;
}

/**
 * 查询选手评论
 */
export const fetchPlayerComments = async (
  playerGameId: string,
  page: number = 0,
  pageSize: number = 20
): Promise<{ success: boolean; data: CommentListResp | null; message?: string; code?: number }> => {
  return await get<CommentListResp>('/comments', { playerGameId, page, pageSize });
};

/**
 * 发评论
 */
export const addPlayerComment = async (
  playerGameId: string,
  content: string,
  userId: string
): Promise<{ success: boolean; data: CommentItem | null; message?: string; code?: number }> => {
  return await post<CommentItem>('/comments', { playerGameId, content, userId });
};

/**
 * 删除自己评论
 */
export const deletePlayerComment = async (
  commentId: string,
  userId: string
): Promise<{ success: boolean; data: any; message?: string; code?: number }> => {
  return await del<any>(`/comments/${commentId}`, { userId });
};

/**
 * 比赛两队选手
 */
export const fetchMatchPlayers = async (
  _team1Name: string,
  _team2Name: string,
  matchId?: string
): Promise<{ success: boolean; data: MatchPlayersResp | null; message?: string }> => {
  if (!matchId) {
    return { success: false, data: null, message: 'matchId 必填' };
  }
  return await get<MatchPlayersResp>(`/matches/${matchId}/players`);
};


// ============================================================
// 用户类型
// ============================================================

export interface GuessRecordItem {
  id: string;
  won: boolean;
  attempts: number;
  difficulty: string;
  targetPlayerId: string;
  targetPlayerName: string;
  playedAt: string;
}

export interface UserInfo {
  id: string;
  openid: string;
  nickname: string;
  avatarUrl: string | null;
  winCount: number;
  totalGames: number;
  winRate: number;
  guessRecords: GuessRecordItem[];
  coins?: number;
  totalCoinsEarned?: number;
  createdAt: string;
  updatedAt: string;
}

export interface LoginResult {
  token: string;
  user: UserInfo;
}

export interface GuessRecordListResp {
  list: GuessRecordItem[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

// ============================================================
// 用户 / 微信登录
// ============================================================

/**
 * 微信登录：发送 wx.login() 得到的 code 到后端换 token + 用户信息
 */
export const loginWithWeChat = async (
  code: string
): Promise<{ success: boolean; data: LoginResult | null; message?: string }> => {
  const res = await post<LoginResult>('/users/login', { code });
  if (res.success && res.data) {
    // 保存 token
    wx.setStorageSync('token', res.data.token);
    // 保存用户信息
    wx.setStorageSync('userInfo', res.data.user);
  }
  return { success: res.success, data: res.data, message: res.message };
};

/**
 * 获取当前 token
 */
export const getToken = (): string => {
  return wx.getStorageSync('token') || '';
};

/**
 * 获取当前用户信息（先从本地缓存取，没有则从后端拉）
 */
export const getCurrentUserInfo = async (): Promise<{ success: boolean; data: UserInfo | null }> => {
  const cached = wx.getStorageSync('userInfo');
  if (cached && cached.openid) {
    return { success: true, data: cached };
  }
  // 本地没有则从后端拉
  return await fetchUserProfile();
};

/**
 * 获取当前用户 openid（同步从缓存取）
 */
export const getCurrentUserOpenid = (): string => {
  const cached = wx.getStorageSync('userInfo');
  return (cached && cached.openid) || 'guest';
};

/**
 * 从后端拉取用户信息（需 token）
 */
export const fetchUserProfile = async (): Promise<{ success: boolean; data: UserInfo | null }> => {
  const token = getToken();
  if (!token) return { success: false, data: null };
  return await getAuth<UserInfo>('/users/profile', token);
};

/**
 * 更新用户信息（昵称/头像）
 */
export const updateUserProfile = async (
  data: { nickname?: string; avatarUrl?: string }
): Promise<{ success: boolean; data: UserInfo | null; message?: string }> => {
  return await putAuth<UserInfo>('/users/profile', data);
};

/**
 * 记录猜一猜结果
 */
/**
 * 排行榜用户条目
 */
export interface RankingUser {
  openid: string;
  nickname: string;
  avatarUrl: string;
  winCount: number;
  totalGames: number;
  winRate: number;
}

/**
 * 记录猜一猜结果
 */
export const submitGuessRecord = async (data: {
  won: boolean;
  attempts: number;
  difficulty: string;
  targetPlayerId: string;
  targetPlayerName: string;
  gameMode?: 'personal' | 'friend';
}): Promise<{ success: boolean; data: UserInfo | null; message?: string }> => {
  return await postAuth<UserInfo>('/users/guess/record', data);
};

/**
 * 获取各难度猜对次数（用于解锁判断）
 */
export const fetchDifficultyProgress = async (): Promise<{
  success: boolean;
  data: { difficulty: string; correctCount: number; unlocked: boolean; needPrevCorrect: number }[];
}> => {
  const res = await getAuth<any>('/users/guess/difficulty-progress');
  return { success: !!res.data, data: res.data || [] };
};

/**
 * 获取排行榜（PK 或 Solo 胜率）
 */
export const fetchRanking = async (
  mode: 'pk' | 'solo'
): Promise<{ success: boolean; data: RankingUser[] }> => {
  const res = await getAuth<RankingUser[]>(`/users/ranking?mode=${mode}`);
  return { success: res.success, data: res.data ?? [] };
};

/**
 * 获取竞猜记录列表
 */
export const fetchGuessRecords = async (
  page: number = 0,
  pageSize: number = 20
): Promise<{ success: boolean; data: GuessRecordListResp | null }> => {
  return await getAuth<GuessRecordListResp>(`/users/guess/records?page=${page}&pageSize=${pageSize}`);
};


// ============================================================
// 队伍 API
// ============================================================

/**
 * 获取 team_ranking 表中的排名队伍名称列表
 * 用于猜选手游戏的"简单"模式：目标选手仅限于排名队伍中的选手
 */
export const fetchRankedTeamNames = async (): Promise<{ success: boolean; data: string[] }> => {
  const res = await get<string[]>('/teams/ranked');
  return { success: res.success, data: res.data ?? [] };
};


// ============================================================
// Admin CRUD（管理后台用）
// ============================================================

export const adminPlayerCreate = (data: Partial<Player>) =>
  post<{ id: number; _id: string }>('/players', data);

export const adminPlayerUpdate = (playerId: string, data: Partial<Player>) =>
  put<{ affected: number }>(`/players/${encodeURIComponent(playerId)}`, data);

export const adminPlayerDelete = (playerId: string) =>
  del<{ affected: number }>(`/players/${encodeURIComponent(playerId)}`);

export const adminMatchCreate = (data: any) =>
  post<{ id: number; _id: string }>('/matches', data);

export const adminMatchUpdate = (id: string, data: any) =>
  put<{ affected: number }>(`/matches/${id}`, data);

export const adminMatchDelete = (id: string) =>
  del<{ affected: number }>(`/matches/${id}`);

// ============================================================
// PK 好友对战 API
// ============================================================

export interface PkRoom {
  roomId: string;
  difficulty: string;
  creator: { nickname: string; avatar: string };
  joiner: { nickname: string; avatar: string } | null;
  targetPlayer: any;
  creatorResult: { won: boolean; attempts: number } | null;
  joinerResult: { won: boolean; attempts: number } | null;
  createdAt: number;
}

/**
 * 创建 PK 房间
 */
export const createPkRoom = async (
  difficulty: string,
  creatorNickname: string,
  creatorAvatar: string
): Promise<{ success: boolean; data: { roomId: string; targetPlayer: any } | null; message?: string }> => {
  return await post<PkRoom>('/pk/rooms', { difficulty, creatorNickname, creatorAvatar });
};

/**
 * 加入 PK 房间
 */
export const joinPkRoom = async (
  roomId: string,
  joinerNickname: string,
  joinerAvatar: string
): Promise<{ success: boolean; data: PkRoom | null; message?: string }> => {
  return await post<PkRoom>(`/pk/rooms/${roomId}/join`, { joinerNickname, joinerAvatar });
};

/**
 * 查询房间状态
 */
export const getPkRoom = async (
  roomId: string
): Promise<{ success: boolean; data: PkRoom | null; message?: string }> => {
  return await get<PkRoom>(`/pk/rooms/${roomId}`);
};

/**
 * 报告游戏结果
 */
export const reportPkResult = async (
  roomId: string,
  role: 'creator' | 'joiner',
  won: boolean,
  attempts: number
): Promise<{ success: boolean; data: { winner: string | null } | null; message?: string }> => {
  return await post<PkRoom>(`/pk/rooms/${roomId}/result`, { roomId, role, won, attempts });
};

/**
 * 报告当前尝试次数（用于同步双方进度条）
 */
export const reportPkAttempt = async (
  roomId: string,
  role: 'creator' | 'joiner',
  attempts: number
): Promise<{ success: boolean; data: { creatorAttempts: number; joinerAttempts: number } | null }> => {
  return await post<{ creatorAttempts: number; joinerAttempts: number }>(`/pk/rooms/${roomId}/attempt`, { role, attempts });
};

/**
 * 标记玩家准备开始下一局
 */
export const readyForNextRound = async (
  roomId: string,
  role: 'creator' | 'joiner'
): Promise<{ success: boolean; data: { creatorReady: boolean; joinerReady: boolean; bothReady: boolean } | null; message?: string }> => {
  return await post<{ creatorReady: boolean; joinerReady: boolean; bothReady: boolean }>(`/pk/rooms/${roomId}/ready`, { role });
};

/**
 * 双方都准备后，开始新一局
 */
export const startNextRound = async (
  roomId: string
): Promise<{ success: boolean; data: { round: number; targetPlayer: any } | null; message?: string }> => {
  return await post<{ round: number; targetPlayer: any }>(`/pk/rooms/${roomId}/next-round`);
};

// ============================================================
// 代币系统 API
// ============================================================

export interface ShopItem {
  id: number;
  name: string;
  description: string;
  price: number;
  icon: string;
  itemType: string;
  maxPerUser: number;
}

export interface UserItem {
  itemType: string;
  quantity: number;
}

/**
 * 获取代币余额
 */
export const fetchCoinBalance = async (): Promise<{ success: boolean; data: { coins: number; totalCoinsEarned: number } | null }> => {
  return await getAuth<{ coins: number; totalCoinsEarned: number }>('/coins/balance');
};

/**
 * 获取交易记录
 */
export const fetchCoinTransactions = async (
  page: number = 0,
  pageSize: number = 20
): Promise<{ success: boolean; data: any | null }> => {
  return await getAuth<any>(`/coins/transactions?page=${page}&pageSize=${pageSize}`);
};

/**
 * 获取商品列表
 */
export const fetchShopItems = async (): Promise<{ success: boolean; data: ShopItem[] | null }> => {
  const res = await get<ShopItem[]>('/coins/shop');
  return { success: res.success, data: res.data ?? [] };
};

/**
 * 购买道具
 */
export const buyShopItem = async (
  itemId: number,
  quantity: number = 1
): Promise<{ success: boolean; data: { coins: number; itemType: string } | null; message?: string }> => {
  return await postAuth<{ coins: number; itemType: string }>('/coins/shop/buy', { itemId, quantity });
};

/**
 * 获取用户道具库存
 */
export const fetchUserItems = async (): Promise<{ success: boolean; data: UserItem[] | null }> => {
  const res = await getAuth<UserItem[]>('/coins/items');
  return { success: res.success, data: res.data ?? [] };
};

// ============================================================
// 猜测 API
// ============================================================

export interface PickSelection {
  slot: number;
  playerGameId: string;
  playerName: string;
}

/**
 * 提交单个 top 的选择（覆盖式）
 */
export const submitPick = async (
  slot: number,
  playerGameId: string,
  playerName: string,
  year: number = 2026
): Promise<{ success: boolean; data: { slot: number; submissionNo: number; maxSubmissions: number } | null; message?: string }> => {
  return await postAuth<{ slot: number; submissionNo: number; maxSubmissions: number }>('/picks/submit-slot', { year, slot, playerGameId, playerName });
};

/**
 * 查询我的全部票选
 */
export const fetchMyPicks = async (
  year: number = 2026
): Promise<{ success: boolean; data: { hasPicked: boolean; selections: (PickSelection & { submissionNo: number; maxSubmissions: number })[] } | null }> => {
  return await getAuth<any>(`/picks/my-picks?year=${year}`);
};

/**
 * 查看猜测统计
 */
export const fetchPickStatistics = async (
  year: number = 2026
): Promise<{ success: boolean; data: any | null }> => {
  return await getAuth<any>(`/picks/statistics?year=${year}`);
};

/**
 * 获取各 top 提交开关
 */
export const fetchPickConfig = async (
  year: number = 2026
): Promise<{ success: boolean; data: { year: number; config: Record<number, boolean> } | null }> => {
  return await get<any>(`/picks/config?year=${year}`);
};

// ============================================================
// 管理后台 API
// ============================================================

export interface AdminUser {
  id: number;
  openid: string;
  nickname: string;
  avatarUrl: string | null;
  winCount: number;
  totalGames: number;
  winRate: number;
  coins: number;
  createdAt: string;
}

/**
 * 获取用户列表（管理员）
 */
export const fetchAdminUsers = async (
  page: number = 0,
  pageSize: number = 20
): Promise<{ success: boolean; data: { list: AdminUser[]; total: number; hasMore: boolean } | null }> => {
  return await getAuth<any>(`/users/admin/list?page=${page}&pageSize=${pageSize}`);
};

/**
 * 编辑用户（管理员）
 */
export const adminUpdateUser = async (
  openid: string,
  data: { nickname?: string; coins?: number }
): Promise<{ success: boolean; data: any; message?: string }> => {
  return await putAuth<any>(`/users/admin/${encodeURIComponent(openid)}`, data);
};

/**
 * 删除用户（管理员）
 */
export const adminDeleteUser = async (
  openid: string
): Promise<{ success: boolean; data: any; message?: string }> => {
  return await del<any>(`/users/admin/${encodeURIComponent(openid)}`);
};

/**
 * 获取待审核评论
 */
export const fetchPendingComments = async (
  page: number = 0,
  pageSize: number = 20
): Promise<{ success: boolean; data: { list: any[]; total: number; hasMore: boolean } | null }> => {
  return await get<any>(`/comments/admin/pending?page=${page}&pageSize=${pageSize}`);
};

/**
 * 审核评论
 */
export const reviewComment = async (
  commentId: string,
  status: 'approved' | 'rejected',
  reviewer: string = 'admin'
): Promise<{ success: boolean; data: any; message?: string }> => {
  return await post<any>(`/comments/${commentId}/review`, { status, reviewer });
};

/**
 * 获取猜测管理数据
 */
export const fetchOfficialTop30 = async (
  year: number = 2026
): Promise<{ success: boolean; data: any | null }> => {
  return await get<any>(`/picks/admin/official?year=${year}`);
};

/**
 * 设定官方Top30（管理员）
 */
export const adminSetOfficialTop30 = async (
  year: number,
  winners: { rank: number; playerGameId: string; playerName: string }[],
  adminOpenid: string = 'admin'
): Promise<{ success: boolean; data: any; message?: string }> => {
  return await post<any>('/picks/admin/official', { year, winners, adminOpenid });
};

/**
 * 核对猜测结果（管理员）
 */
export const adminCheckPicks = async (
  year: number = 2026,
  matchThreshold: number = 0,
  page: number = 0
): Promise<{ success: boolean; data: any | null }> => {
  return await get<any>(`/picks/admin/check?year=${year}&matchThreshold=${matchThreshold}&page=${page}`);
};

/**
 * 设置提交开关（管理员）
 */
export const adminSetPickConfig = async (
  year: number,
  config: Record<number, boolean>
): Promise<{ success: boolean; data: any; message?: string }> => {
  return await postAuth<any>('/picks/admin/config', { year, config });
};

/**
 * 管理员登录
 */
export const adminLogin = async (
  username: string,
  password: string
): Promise<{ success: boolean; data: { token: string; username: string } | null; message?: string }> => {
  return await post<{ token: string; username: string }>('/admin/login', { username, password });
};

/**
 * 验证管理员 token
 */
export const adminVerifyToken = async (): Promise<{ success: boolean; data: { username: string } | null }> => {
  const token = wx.getStorageSync('adminToken');
  if (!token) return { success: false, data: null };
  return await getAuth<{ username: string }>('/admin/verify', token);
};

export const adminAwardPicks = async (
  year: number = 2026,
  matchThreshold: number = 15,
  coinsPerMatch: number = 10,
  adminOpenid: string = 'admin'
): Promise<{ success: boolean; data: any; message?: string }> => {
  return await post<any>('/picks/admin/award', { year, matchThreshold, coinsPerMatch, adminOpenid });
};