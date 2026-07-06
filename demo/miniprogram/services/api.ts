/**
 * API Service（REST 版）
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
  position: '狙击手' | '步枪手' | '指挥' | '教练' | string;
  avatar: string;
}

export interface Match {
  _id: string;
  event: string;
  status: 'Live' | 'Upcoming' | 'Finished';
  teamA: { name: string; logo: string; score: number };
  teamB: { name: string; logo: string; score: number };
  time: string;
}

export interface UserProfile {
  uid: string;
  nickname: string;
  avatarUrl: string;
  token: string;
  level: number;
  points: number;
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
 * 获取全部选手
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
): Promise<{ success: boolean; data: Player[]; hasMore: boolean }> => {
  if (!keyword || !keyword.trim()) {
    return { success: true, data: [], hasMore: false };
  }
  const res = await get<Player[]>('/players/search', { q: keyword, page, pageSize });
  const data = res.data ?? [];
  return { success: res.success, data, hasMore: data.length === pageSize };
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
 * 比赛列表
 */
export const fetchLiveMatches = async (): Promise<{ success: boolean; data: Match[] }> => {
  const res = await get<Match[]>('/matches');
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
// 评论区 API
// ============================================================

export interface CommentItem {
  _id: string;
  id: string;
  matchId: string;
  playerId: string;
  content: string;
  userOpenid: string;
  createdAt: string | Date;
  status: number;
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
}

export interface MatchPlayersResp {
  team1: { name: string; players: MatchPlayerItem[] };
  team2: { name: string; players: MatchPlayerItem[] };
  total: number;
}

/**
 * 评论列表
 */
export const fetchMatchComments = async (
  matchId: string,
  page: number = 0,
  pageSize: number = 20,
  playerId?: string
): Promise<{ success: boolean; data: CommentListResp | null; message?: string; code?: number }> => {
  return await get<CommentListResp>('/comments', { matchId, page, pageSize, playerId });
};

/**
 * 发评论（userOpenid 必传：本地用 wx.getStorageSync('userInfo').uid）
 */
export const addMatchComment = async (
  matchId: string,
  playerId: string,
  content: string,
  userOpenid: string
): Promise<{ success: boolean; data: CommentItem | null; message?: string; code?: number }> => {
  return await post<CommentItem>('/comments', { matchId, playerId, content, userOpenid });
};

/**
 * 删除自己评论
 */
export const deleteMatchComment = async (
  commentId: string,
  userOpenid: string
): Promise<{ success: boolean; data: any; message?: string; code?: number }> => {
  return await del<any>(`/comments/${commentId}`, { userOpenid });
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
// 用户 / 登录（mock）
// ============================================================

export const login = async (): Promise<{ success: boolean; data: UserProfile | null }> => {
  const mockUser: UserProfile = {
    uid: 'u888',
    nickname: 'CS_Fanatic',
    avatarUrl: '/assets/icons/game_active.png',
    token: 'mock_token_xyz123',
    level: 5,
    points: 1280
  };
  return Promise.resolve({ success: true, data: mockUser });
};

/**
 * 取当前用户 openid
 */
export const getCurrentUserOpenid = (): string => {
  const me = wx.getStorageSync('userInfo') || {};
  return me.uid || me.openid || 'guest';
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
