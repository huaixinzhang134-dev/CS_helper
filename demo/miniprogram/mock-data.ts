/**
 * 本地 Mock 数据 —— Demo 模式下替代后端 API
 *
 * 包含：比赛数据、选手数据、评论数据
 * 所有数据在内存中操作，评论写入 localStorage 以保持会话内持久
 *
 * 选手数据已从 crawler 导入全部 4654 条（来源：HLTV），
 * 替换了原先的 50 条硬编码数据。
 */

import { PLAYER_DATA } from './playerbase-data';

// ======================== 比赛数据 ========================

export interface MockMatch {
  _id: string;
  event: string;
  status: 'Live' | 'Upcoming' | 'Finished';
  teamA: { name: string; logo: string; score: number };
  teamB: { name: string; logo: string; score: number };
  time: string;
}

const MATCHES: MockMatch[] = [
  // ---- Live 比赛（3 场）----
  {
    _id: 'm1', event: 'IEM 科隆 2026 小组赛', status: 'Live',
    teamA: { name: 'Natus Vincere',   logo: '', score: 12 },
    teamB: { name: 'FaZe Clan',       logo: '', score: 9  },
    time: '2026-07-03T20:15'
  },
  {
    _id: 'm2', event: 'ESL Pro League S21', status: 'Live',
    teamA: { name: 'Team Spirit',     logo: '', score: 7  },
    teamB: { name: 'Vitality',        logo: '', score: 10 },
    time: '2026-07-03T19:45'
  },
  {
    _id: 'm3', event: '5Eplay 公开赛', status: 'Live',
    teamA: { name: 'TYLOO',           logo: '', score: 4  },
    teamB: { name: 'LVG',             logo: '', score: 10 },
    time: '2026-07-03T14:30'
  },

  // ---- Upcoming 比赛（6 场）----
  {
    _id: 'm4', event: 'BLAST Premier Fall Finals', status: 'Upcoming',
    teamA: { name: 'G2 Esports',      logo: '', score: 0 },
    teamB: { name: 'Team Liquid',     logo: '', score: 0 },
    time: '2026-07-03T21:00'
  },
  {
    _id: 'm5', event: 'IEM 科隆 2026 小组赛', status: 'Upcoming',
    teamA: { name: 'MOUZ',            logo: '', score: 0 },
    teamB: { name: 'Cloud9',          logo: '', score: 0 },
    time: '2026-07-03T22:30'
  },
  {
    _id: 'm6', event: 'ESL Pro League S21', status: 'Upcoming',
    teamA: { name: 'fnatic',          logo: '', score: 0 },
    teamB: { name: 'Astralis',        logo: '', score: 0 },
    time: '2026-07-04T00:00'
  },
  {
    _id: 'm7', event: '5Eplay 公开赛', status: 'Upcoming',
    teamA: { name: 'Rare Atom',       logo: '', score: 0 },
    teamB: { name: 'Wings Up',        logo: '', score: 0 },
    time: '2026-07-03T17:00'
  },
  {
    _id: 'm8', event: 'PGL Major Antwerp', status: 'Upcoming',
    teamA: { name: 'Heroic',          logo: '', score: 0 },
    teamB: { name: 'Ninjas in Pyjamas', logo: '', score: 0 },
    time: '2026-07-04T02:00'
  },
  {
    _id: 'm9', event: 'CCT 全球总决赛', status: 'Upcoming',
    teamA: { name: 'ENCE',            logo: '', score: 0 },
    teamB: { name: 'BIG',             logo: '', score: 0 },
    time: '2026-07-04T04:00'
  },

  // ---- Finished 比赛（5 场）----
  {
    _id: 'm10', event: 'IEM 科隆 2026 小组赛', status: 'Finished',
    teamA: { name: 'Team Spirit',     logo: '', score: 2 },
    teamB: { name: 'MOUZ',            logo: '', score: 1 },
    time: '2026-07-02T20:00'
  },
  {
    _id: 'm11', event: 'ESL Pro League S21', status: 'Finished',
    teamA: { name: 'FaZe Clan',       logo: '', score: 2 },
    teamB: { name: 'G2 Esports',      logo: '', score: 0 },
    time: '2026-07-02T17:30'
  },
  {
    _id: 'm12', event: '5Eplay 公开赛', status: 'Finished',
    teamA: { name: 'TYLOO',           logo: '', score: 13 },
    teamB: { name: 'Rare Atom',       logo: '', score: 6 },
    time: '2026-07-02T14:00'
  },
  {
    _id: 'm13', event: 'BLAST Premier Fall Finals', status: 'Finished',
    teamA: { name: 'Vitality',        logo: '', score: 2 },
    teamB: { name: 'Natus Vincere',   logo: '', score: 1 },
    time: '2026-07-01T21:00'
  },
  {
    _id: 'm14', event: 'IEM 科隆 2026 小组赛', status: 'Finished',
    teamA: { name: 'Cloud9',          logo: '', score: 0 },
    teamB: { name: 'Team Liquid',     logo: '', score: 2 },
    time: '2026-07-01T18:00'
  }
];

// ======================== 选手数据 ========================

export interface MockPlayer {
  _id: string;
  playerId: string;
  name: string;
  realName: string;
  team: string;
  formerTeams?: string[];
  country: string;
  countryCode: string;
  age: number;
  majorAppearances: number;
  position: string;
  avatar: string;
  rating?: number;
}

/** 全部选手数据（导入自 playerbase-data.ts，来自 HLTV 爬虫） */
const PLAYERS: MockPlayer[] = PLAYER_DATA;

// ======================== 评论数据（localStorage 持久化）=====

const COMMENTS_KEY = 'demo_match_comments';

interface MockComment {
  _id: string;
  id: string;
  matchId: string;
  playerId: string;
  content: string;
  userOpenid: string;
  createdAt: string;
  status: number;
}

function loadComments(): MockComment[] {
  try {
    const raw = wx.getStorageSync(COMMENTS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveComments(comments: MockComment[]) {
  wx.setStorageSync(COMMENTS_KEY, JSON.stringify(comments));
}

// ======================== Mock API 实现 ========================

export function getAllMatches(): MockMatch[] {
  // Live > Upcoming > Finished
  const order = { 'Live': 0, 'Upcoming': 1, 'Finished': 2 };
  return [...MATCHES].sort((a, b) => order[a.status] - order[b.status]);
}

export function getMatchById(id: string): MockMatch | undefined {
  return MATCHES.find(m => m._id === id);
}

export function getPlayers(skip: number = 0, limit: number = 20): MockPlayer[] {
  return PLAYERS.slice(skip, skip + limit);
}

export function getPlayerCount(): number {
  return PLAYERS.length;
}

export function getPlayerByGameId(gameId: string): MockPlayer | undefined {
  return PLAYERS.find(p => p.playerId === gameId);
}

export function searchPlayers(query: string): MockPlayer[] {
  const q = query.toLowerCase();
  return PLAYERS.filter(p =>
    p.name.toLowerCase().includes(q) ||
    p.realName.toLowerCase().includes(q) ||
    p.playerId.includes(q)
  );
}

export function getRandomPlayer(): MockPlayer {
  return PLAYERS[Math.floor(Math.random() * PLAYERS.length)];
}

// ---- 管理端 CRUD ----

let playersCopy: MockPlayer[] | null = null;
let nextPlayerId = 200;

function getPlayersCopy(): MockPlayer[] {
  if (!playersCopy) playersCopy = JSON.parse(JSON.stringify(PLAYERS));
  return playersCopy;
}

export function adminCreatePlayer(data: any): MockPlayer {
  const list = getPlayersCopy();
  const newPlayer: MockPlayer = {
    _id: `p${nextPlayerId++}`,
    playerId: data.game_id || String(Date.now()),
    name: data.name || '',
    realName: data.real_name || '',
    team: data.current_team || '',
    country: data.country || '',
    countryCode: data.country_code || '',
    age: data.age || 0,
    majorAppearances: data.majorAppearances || 0,
    position: data.position || '步枪手',
    avatar: data.avatar || '',
  };
  list.push(newPlayer);
  return newPlayer;
}

export function adminUpdatePlayer(playerId: string, data: any): boolean {
  const list = getPlayersCopy();
  const idx = list.findIndex(p => p.playerId === playerId);
  if (idx === -1) return false;
  Object.assign(list[idx], data);
  return true;
}

export function adminDeletePlayer(playerId: string): boolean {
  const list = getPlayersCopy();
  const idx = list.findIndex(p => p.playerId === playerId);
  if (idx === -1) return false;
  list.splice(idx, 1);
  return true;
}

// ---- 评论 CRUD ----

export function getComments(matchId: string, playerId?: string, page: number = 0, pageSize: number = 20) {
  const all = loadComments();
  let filtered = all.filter(c => c.matchId === matchId && c.status === 1);
  if (playerId) filtered = filtered.filter(c => c.playerId === playerId);
  filtered.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const start = page * pageSize;
  const list = filtered.slice(start, start + pageSize);
  return { list, total: filtered.length, page, pageSize, hasMore: (page + 1) * pageSize < filtered.length };
}

export function addComment(matchId: string, playerId: string, content: string, userOpenid: string): MockComment {
  const all = loadComments();
  const cmt: MockComment = {
    _id: `c${Date.now()}`,
    id: `c${Date.now()}`,
    matchId,
    playerId,
    content,
    userOpenid,
    createdAt: new Date().toISOString(),
    status: 1
  };
  all.push(cmt);
  saveComments(all);
  return cmt;
}

export function deleteComment(id: string, userOpenid: string): boolean {
  const all = loadComments();
  const idx = all.findIndex(c => c._id === id && c.userOpenid === userOpenid);
  if (idx === -1) return false;
  all[idx].status = 0;
  saveComments(all);
  return true;
}
