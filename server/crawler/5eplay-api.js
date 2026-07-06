/**
 * 5eplay 赛事数据 API 封装
 *
 * 5eplay 赛事页是 Vue SPA，实际数据来自内部 API。
 * 本模块封装了发现 API 和解析响应的逻辑。
 *
 * --- 如何获取真实 API 地址 ---
 * 1. 用 Chrome 打开 https://event.5eplay.com/csgo/matches?grade=1%2C7%2C2%2C3%2C8%2C9
 * 2. F12 → Network → 筛选 XHR/Fetch
 * 3. 在页面中点击"赛程"或"赛果"tab
 * 4. 找到返回比赛数据的请求，复制其 URL
 * 5. 将 URL 填入下方的 API_ENDPOINTS
 *
 * 常见模式（猜测，需实际验证）：
 *   https://event.5eplay.com/api/csgo/match/list
 *   https://api.5eplay.com/csgo/v1/matches
 */

const axios = require('axios');

// ======================== 配置 ========================

/** 5eplay 需要模拟的浏览器 User-Agent */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
           'AppleWebKit/537.36 (KHTML, like Gecko) ' +
           'Chrome/125.0.0.0 Safari/537.36';

/** 备选 API 端点（按优先级尝试） */
const API_ENDPOINTS = [
  // 5eplay 公开赛事列表 API（需验证）
  // 格式1: 带 grade 筛选
  'https://event.5eplay.com/api/csgo/match/list?grade=1,7,2,3,8,9',
  // 格式2: REST 风格
  'https://api.5eplay.com/v1/csgo/matches?grade=1,7,2,3,8,9',
];

/** 请求超时时间 */
const TIMEOUT = 15000;

// ======================== 数据抓取 ========================

/**
 * 从 5eplay 获取赛事数据
 * 依次尝试各 API 端点，第一个成功的返回
 *
 * @returns {Promise<{ source: string, matches: Array }>}
 */
async function fetchFrom5eplay() {
  let lastError = null;

  // ----- 方式1: 尝试 JSON API -----
  for (const endpoint of API_ENDPOINTS) {
    try {
      console.log(`[5eplay] 尝试 API: ${endpoint}`);
      const resp = await axios.get(endpoint, {
        headers: {
          'User-Agent': UA,
          'Referer': 'https://event.5eplay.com/',
          'Origin': 'https://event.5eplay.com',
          'Accept': 'application/json, text/plain, */*'
        },
        timeout: TIMEOUT
      });

      const data = resp.data;
      const matches = parseApiResponse(data);
      if (matches && matches.length > 0) {
        console.log(`[5eplay] API ${endpoint} 成功，获取 ${matches.length} 场比赛`);
        return { source: endpoint, matches };
      }
    } catch (err) {
      lastError = err;
      console.log(`[5eplay] API ${endpoint} 失败: ${err.message}`);
    }
  }

  // ----- 方式2: 尝试 SSR 页面抓取（如果 API 不可用，5eplay 可能有服务端渲染的页面）-----
  try {
    console.log('[5eplay] 尝试 SSR 页面抓取');
    const resp = await axios.get('https://event.5eplay.com/csgo/matches', {
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml'
      },
      timeout: TIMEOUT,
      // 不验证 SSL
      httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false })
    });

    const html = resp.data;
    // 尝试从页面中提取 JSON 数据（Vue/Nuxt SSR 通常把数据嵌入到 <script> 或 __NUXT__ 中）
    const matches = extractFromSSR(html);
    if (matches && matches.length > 0) {
      console.log(`[5eplay] SSR 抓取成功，获取 ${matches.length} 场比赛`);
      return { source: 'ssr', matches };
    }
  } catch (err) {
    lastError = err;
    console.log('[5eplay] SSR 抓取失败:', err.message);
  }

  // ----- 全部失败 -----
  throw new Error(
    `所有 5eplay 数据源均不可用: ${lastError?.message || 'unknown'}`
  );
}

// ======================== 解析器 ========================

/**
 * 解析 JSON API 响应为统一格式
 * 兼容不同 API 返回结构
 */
function parseApiResponse(data) {
  if (!data) return [];

  // 可能嵌套在 data / result / list 等字段中
  let list = data;
  if (data.data) list = data.data;
  if (data.result) list = data.result;
  if (data.list) list = data.list;
  if (data.matches) list = data.matches;
  if (data.records) list = data.records;

  if (!Array.isArray(list)) return [];

  return list
    .map(item => normalizeMatch(item))
    .filter(Boolean);
}

/**
 * 从 SSR HTML 中提取 JSON 数据
 */
function extractFromSSR(html) {
  if (!html) return [];

  let matches = [];

  // 尝试提取 __NUXT__ 状态（Nuxt.js 框架）
  const nuxtMatch = html.match(/window\.__NUXT__\s*=\s*(\{[\s\S]*?\});/);
  if (nuxtMatch) {
    try {
      const nuxtData = JSON.parse(nuxtMatch[1]);
      matches = extractFromObject(nuxtData);
    } catch (e) {
      console.log('[5eplay] __NUXT__ 解析失败:', e.message);
    }
  }

  // 尝试提取 __INITIAL_STATE__（Vue SSR）
  if (matches.length === 0) {
    const stateMatch = html.match(/window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\});/);
    if (stateMatch) {
      try {
        const stateData = JSON.parse(stateMatch[1]);
        matches = extractFromObject(stateData);
      } catch (e) {
        console.log('[5eplay] __INITIAL_STATE__ 解析失败:', e.message);
      }
    }
  }

  // 尝试提取嵌入的 JSON（<script type="application/json">）
  if (matches.length === 0) {
    const jsonBlocks = html.matchAll(
      /<script[^>]*type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/g
    );
    for (const block of jsonBlocks) {
      try {
        const jsonData = JSON.parse(block[1]);
        const extracted = extractFromObject(jsonData);
        if (extracted.length > 0) {
          matches = extracted;
          break;
        }
      } catch (e) {
        // 跳过解析失败的块
      }
    }
  }

  return matches;
}

/**
 * 从对象中递归查找比赛数组
 * 遍历对象，找到看起来像比赛列表的数组
 */
function extractFromObject(obj) {
  if (!obj || typeof obj !== 'object') return [];

  let results = [];

  function walk(current, depth) {
    if (depth > 6) return; // 限制深度
    if (!current || typeof current !== 'object') return;

    if (Array.isArray(current)) {
      if (current.length > 0 && current[0].team1 && current[0].team2) {
        // 看起来是比赛数组
        const normalized = current.map(normalizeMatch).filter(Boolean);
        if (normalized.length > results.length) {
          results = normalized;
        }
      }
      // 不递归遍历数组元素（避免浅层匹配干扰）
      return;
    }

    for (const key of Object.keys(current)) {
      walk(current[key], depth + 1);
    }
  }

  walk(obj, 0);
  return results;
}

// ======================== 数据归一化 ========================

/**
 * 将 5eplay 的不同数据格式归一化为统一格式
 */
function normalizeMatch(raw) {
  try {
    // 兼容不同字段名
    const date = raw.date || raw.match_date || raw.matchDate || raw.Date || '';
    const time = raw.time || raw.match_time || raw.matchTime || raw.Time || '';
    const matchType = raw.matchType || raw.match_type || raw.type || raw.bo || 'BO1';
    const team1 = raw.team1 || raw.home_team || raw.homeTeam || raw.teamA ||
                  (raw.teams ? raw.teams[0] : '') || '';
    const team2 = raw.team2 || raw.away_team || raw.awayTeam || raw.teamB ||
                  (raw.teams ? raw.teams[1] : '') || '';
    const eventName = raw.eventName || raw.event_name || raw.tournament ||
                      raw.series || raw.event || '';
    const status = raw.status || 'upcoming';
    const tab = raw.tab || (raw.status === 'finished' ? 'results' : 'schedule');

    // 比分可能在不同字段中
    let team1Score = null;
    let team2Score = null;

    if (raw.team1Score != null) team1Score = raw.team1Score;
    else if (raw.team1_score != null) team1Score = raw.team1_score;
    else if (raw.home_score != null) team1Score = raw.home_score;
    else if (raw.homeScore != null) team1Score = raw.homeScore;
    else if (raw.score1 != null) team1Score = raw.score1;
    else if (raw.teamA && raw.teamA.score != null) team1Score = raw.teamA.score;

    if (raw.team2Score != null) team2Score = raw.team2Score;
    else if (raw.team2_score != null) team2Score = raw.team2_score;
    else if (raw.away_score != null) team2Score = raw.away_score;
    else if (raw.awayScore != null) team2Score = raw.awayScore;
    else if (raw.score2 != null) team2Score = raw.score2;
    else if (raw.teamB && raw.teamB.score != null) team2Score = raw.teamB.score;

    if (!team1 || !team2) return null;
    if (!date || !time) return null;

    return {
      date: normalizeDate(date),
      time: normalizeTime(time),
      matchType: matchType.replace(/^bo/i, 'BO'),
      team1: String(team1).trim(),
      team2: String(team2).trim(),
      team1Score: team1Score != null ? Number(team1Score) : null,
      team2Score: team2Score != null ? Number(team2Score) : null,
      eventName: String(eventName).trim(),
      status: normalizeStatus(status, team1Score, team2Score),
      tab
    };
  } catch (e) {
    console.error('[5eplay] 归一化失败:', e.message, JSON.stringify(raw).slice(0, 200));
    return null;
  }
}

/**
 * 归一化日期格式为 YYYY-MM-DD
 */
function normalizeDate(date) {
  if (!date) return '';
  const d = String(date).trim();
  // 已经是 YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}/.test(d)) return d.slice(0, 10);
  // 时间戳
  if (/^\d{10,13}$/.test(d)) {
    return new Date(Number(d)).toISOString().slice(0, 10);
  }
  return d;
}

/**
 * 归一化时间为 HH:mm
 */
function normalizeTime(time) {
  if (!time) return '';
  const t = String(time).trim();
  if (/^\d{2}:\d{2}/.test(t)) return t.slice(0, 5);
  return t;
}

/**
 * 根据比分推断状态
 */
function normalizeStatus(status, score1, score2) {
  if (!status) return 'upcoming';
  const s = String(status).toLowerCase().trim();
  if (s === 'live' || s === 'playing' || s === 'ongoing') return 'Live';
  if (s === 'finished' || s === 'completed' || s === 'ended' || s === 'results') return 'Finished';
  // 如果有比分，自动推断为 finished
  if (score1 != null && score2 != null) return 'Finished';
  return 'Upcoming';
}

module.exports = { fetchFrom5eplay, normalizeMatch };
