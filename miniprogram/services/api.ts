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
 */
export const searchPlayers = async (
  keyword: string,
  page: number = 0,
  pageSize: number = 20
): Promise<{ success: boolean; data: Player[]; hasMore: boolean; total?: number }> => {
  if (!keyword || !keyword.trim()) {
    return { success: true, data: [], hasMore: false };
  }
  // 手动请求以获取响应根层级的 total / hasMore（get 封装会丢失它们）
  return new Promise((resolve) => {
    const qs = queryString({ q: keyword, page, pageSize });
    wx.request({
      url: `${API_BASE}/players/search${qs}`,
      method: 'GET',
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
}

export const fetchMatchEvents = async (): Promise<{ success: boolean; data: MatchEvent[] }> => {
  const res = await get<MatchEvent[]>('/matches/events');
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
export const submitGuessRecord = async (data: {
  won: boolean;
  attempts: number;
  difficulty: string;
  targetPlayerId: string;
  targetPlayerName: string;
}): Promise<{ success: boolean; data: UserInfo | null; message?: string }> => {
  return await postAuth<UserInfo>('/users/guess/record', data);
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