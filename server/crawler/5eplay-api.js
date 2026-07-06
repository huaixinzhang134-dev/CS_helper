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
  // 5eplay CDN 即将开始的比赛
  'https://esports-data.5eplaycdn.com/v1/api/csgo/matches?page=1&limit=50',
  // 5eplay APP 已结束的比赛（page_token 使用当天日期）
  function() {
    const today = new Date();
    const dateStr = today.getFullYear() + '-' +
      String(today.getMonth() + 1).padStart(2, '0') + '-' +
      String(today.getDate()).padStart(2, '0');
    return 'https://app.5eplay.com/api/tournament/session_result_list'
      + '?game_type=1&order_by=asc&grades=1,7,2,3,8,9&page_size=50'
      + '&page_token=' + encodeURIComponent(dateStr + ' 23:59:59');
  },
];

/** 请求超时时间 */
const TIMEOUT = 15000;

// ======================== 数据抓取 ========================

/**
 * 从 5eplay 获取赛事数据
 * 合并即将开始 + 已结束的比赛
 *
 * @returns {Promise<{ source: string, matches: Array }>}
 */
async function fetchFrom5eplay() {
  const allMatches = [];

  // ----- 抓取所有 JSON API（合并结果）-----
  for (const ep of API_ENDPOINTS) {
    const endpoint = typeof ep === 'function' ? ep() : ep;
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

      const matches = parseApiResponse(resp.data);
      if (matches && matches.length > 0) {
        console.log(`[5eplay] API 成功，获取 ${matches.length} 场比赛`);
        allMatches.push(...matches);
      }
    } catch (err) {
      console.log(`[5eplay] API 失败: ${err.message}`);
    }
  }

  // ----- 合并结果后返回 -----
  if (allMatches.length > 0) {
    console.log(`[5eplay] 总共获取 ${allMatches.length} 场比赛（合并）`);
    return { source: 'merged', matches: allMatches };
  }

  // ----- 兜底: SSR 页面抓取 -----
  try {
    console.log('[5eplay] 尝试 SSR 页面抓取');
    const resp = await axios.get('https://event.5eplay.com/csgo/matches', {
      headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml' },
      timeout: TIMEOUT,
      httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false })
    });
    const matches = extractFromSSR(resp.data);
    if (matches && matches.length > 0) {
      console.log(`[5eplay] SSR 抓取成功，获取 ${matches.length} 场比赛`);
      return { source: 'ssr', matches };
    }
  } catch (err) {
    console.log('[5eplay] SSR 抓取失败:', err.message);
  }

  throw new Error('所有 5eplay 数据源均不可用');
}

// ======================== 解析器 ========================

/**
 * 解析 JSON API 响应为统一格式
 * 兼容不同 API 返回结构
 */
function parseApiResponse(data) {
  if (!data) return [];

  let list = data;
  if (data.data) {
    // 新版 CDN API: data.matches 是比赛数组
    if (Array.isArray(data.data.matches)) list = data.data.matches;
    else if (Array.isArray(data.data.live_matches)) list = data.data.live_matches;
    else list = data.data;
  }
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
 * 增强版：额外提取局分(roundScores)和选手数据(playerStats)
 */
function normalizeMatch(raw) {
  try {
    // 新版 CDN API: 数据在 mc_info 里面
    const info = raw.mc_info || raw;
    const score = raw.match_score || {};

    // 5eplay 比赛 ID
    const eplayId = info.id || raw.id || raw.match_id || raw._id || raw.matchId || raw.gameId || '';

    // 日期时间（从时间戳或字符串）
    let date = info.date || raw.date || raw.match_date || '';
    let time = info.time || raw.time || raw.match_time || '';
    if (info.plan_ts && !date) {
      const d = new Date(parseInt(info.plan_ts) * 1000);
      date = d.toISOString().slice(0, 10);
      time = d.toTimeString().slice(0, 5);
    }

    const matchType = info.format
      ? 'BO' + info.format
      : (raw.matchType || raw.match_type || raw.type || raw.bo || 'BO1');

    // 队伍信息（兼容新旧格式）
    const t1 = info.t1_info || {};
    const t2 = info.t2_info || {};
    const team1 = t1.disp_name || raw.team1 || raw.home_team || raw.homeTeam || raw.teamA || '';
    const team2 = t2.disp_name || raw.team2 || raw.away_team || raw.awayTeam || raw.teamB || '';
    const team1Logo = t1.logo || '';
    const team2Logo = t2.logo || '';

    // 赛事名称
    let eventName = raw.eventName || raw.event_name || raw.tournament || raw.series || raw.event || '';
    if (info.round_name && !eventName) eventName = info.round_name;
    if (info.grade) eventName = (eventName ? eventName + ' ' : '') + 'G' + info.grade;

    // state（结果 API 返回的比赛状态）
    const st = raw.state || {};

    // 状态推断
    const display = info.display || raw.display || '0';
    let status = raw.status || 'upcoming';
    if (display === '2' || display === '3') status = 'Live';
    if (display === '4') status = 'Finished';
    // 结果 API 的 matches 有 state.bout_states 但 display=1，强制标记为 Finished
    // 只在 state.status 不为 '0' 且有实际局分时标记为已完成
    if (st.bout_states && Array.isArray(st.bout_states) && st.bout_states.length > 0) {
      status = 'Finished';
    }
    // CDN API 的 state.t1_score='0' 只是默认值，不应用作已结束判断
    const stateHasScore = st.status && st.status !== '0' && st.t1_score && st.t2_score;
    const tab = (status === 'Finished' || status === 'finished') ? 'results' : 'schedule';

    let team1Score = null;
    let team2Score = null;

    // 新版 CDN API: match_score 里面有比分
    if (score) {
      if (score.t1_score != null) team1Score = parseInt(score.t1_score);
      else if (score.team1_score != null) team1Score = parseInt(score.team1_score);
      else if (score.t1 != null) team1Score = parseInt(score.t1);
      if (score.t2_score != null) team2Score = parseInt(score.t2_score);
      else if (score.team2_score != null) team2Score = parseInt(score.team2_score);
      else if (score.t2 != null) team2Score = parseInt(score.t2);
    }
    // 只在 state 有真实比分时使用（排除 CDN API 的 state.t1_score='0' 默认值）
    if (stateHasScore && team1Score == null) team1Score = parseInt(st.t1_score);
    if (stateHasScore && team2Score == null) team2Score = parseInt(st.t2_score);
    // 旧版格式兜底
    if (team1Score == null) {
      if (raw.team1Score != null) team1Score = raw.team1Score;
      else if (raw.team1_score != null) team1Score = raw.team1_score;
      else if (raw.home_score != null) team1Score = raw.home_score;
      else if (raw.homeScore != null) team1Score = raw.homeScore;
      else if (raw.score1 != null) team1Score = raw.score1;
      else if (raw.teamA && raw.teamA.score != null) team1Score = raw.teamA.score;
    }
    if (team2Score == null) {
      if (raw.team2Score != null) team2Score = raw.team2Score;
      else if (raw.team2_score != null) team2Score = raw.team2_score;
      else if (raw.away_score != null) team2Score = raw.away_score;
      else if (raw.awayScore != null) team2Score = raw.awayScore;
      else if (raw.score2 != null) team2Score = raw.score2;
      else if (raw.teamB && raw.teamB.score != null) team2Score = raw.teamB.score;
    }

    if (!team1 || !team2) return null;
    if (!date || !time) return null;

    // === 提取局分（小分）===
    let roundScores = [];
    // 结果 API: state.bout_states 包含每局比分
    if (st.bout_states && Array.isArray(st.bout_states)) {
      roundScores = st.bout_states.map(b => ({
        map: b.map_name || '',
        team1Score: parseInt(b.t1_score) || 0,
        team2Score: parseInt(b.t2_score) || 0
      }));
    }
    if (roundScores.length === 0 && raw.roundScores && Array.isArray(raw.roundScores)) {
      roundScores = raw.roundScores;
    } else if (roundScores.length === 0 && raw.round_scores && Array.isArray(raw.round_scores)) {
      roundScores = raw.round_scores;
    } else if (roundScores.length === 0 && raw.maps && Array.isArray(raw.maps)) {
      roundScores = raw.maps.map(m => ({
        map: m.map || m.name || '',
        team1Score: m.team1Score || m.team1_score || m.score1 || 0,
        team2Score: m.team2Score || m.team2_score || m.score2 || 0
      }));
    }

    // === 新增：提取选手数据 ===
    let playerStats = null;
    if (raw.playerStats) {
      playerStats = raw.playerStats;
    } else if (raw.players) {
      playerStats = raw.players;
    } else if (raw.stats) {
      playerStats = raw.stats;
    }

    // 如果有 maps/roundScores 但没有 playerStats，至少返回 roundScores
    const result = {
      date: normalizeDate(date),
      time: normalizeTime(time),
      matchType: matchType.replace(/^bo/i, 'BO'),
      team1: String(team1).trim(),
      team2: String(team2).trim(),
      team1Logo: team1Logo || '',
      team2Logo: team2Logo || '',
      team1Score: team1Score != null ? Number(team1Score) : null,
      team2Score: team2Score != null ? Number(team2Score) : null,
      eventName: String(eventName).trim(),
      status: normalizeStatus(status, team1Score, team2Score),
      tab
    };

    if (eplayId) result.eplayId = eplayId;
    if (roundScores.length > 0) result.roundScores = roundScores;
    if (playerStats) result.playerStats = playerStats;

    return result;
  } catch (e) {
    console.error('[5eplay] 归一化失败:', e.message, JSON.stringify(raw).slice(0, 200));
    return null;
  }
}

/**
 * 爬取 5eplay 赛事详情页，获取局分和选手数据
 * 依次尝试多个 API 端点和页面抓取
 * @param {string} matchId - 5eplay 比赛 ID（如 csgo_mc_2395485）
 * @returns {Promise<{ roundScores: Array, playerStats: object } | null>}
 */
async function fetchMatchDetail(matchId) {
  if (!matchId) return null;

  // 备选 API 端点（按优先级尝试）
  const endpoints = [
    `https://ya-api-app.5eplay.com/v1/match/detail?id=${matchId}`,
    `https://ya-api-app.5eplay.com/v1/csgo/match/${matchId}`,
    `https://www.5eplay.com/api/restrict/matchscore?matchId=${matchId}`,
    `https://esports-data.5eplaycdn.com/v1/api/csgo/matches/${matchId}/data`,
    `https://event.5eplay.com/api/csgo/match/detail?id=${matchId}`,
  ];

  for (const url of endpoints) {
    try {
      console.log(`[5eplay] 详情 API: ${url}`);
      const resp = await axios.get(url, {
        headers: {
          'User-Agent': UA,
          'Referer': 'https://event.5eplay.com/',
          'Origin': 'https://event.5eplay.com',
          'Accept': 'application/json, text/plain, */*'
        },
        timeout: TIMEOUT,
        httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false })
      });

      const detailData = parseDetailApiResponse(resp.data);
      if (detailData && (detailData.roundScores.length > 0 || detailData.playerStats.length > 0)) {
        console.log(`[5eplay] 详情 API 成功: ${url}`);
        return detailData;
      }
    } catch (err) {
      console.log(`[5eplay] 详情 API ${matchId} 失败: ${err.message}`);
    }
  }

  // 最后尝试 HTML 详情页
  console.log(`[5eplay] 尝试 HTML 详情页: event.5eplay.com/csgo/matches/${matchId}`);
  try {
    const resp = await axios.get(`https://event.5eplay.com/csgo/matches/${matchId}`, {
      headers: { 'User-Agent': UA, 'Referer': 'https://event.5eplay.com/', 'Accept': 'text/html,application/xhtml+xml' },
      timeout: TIMEOUT
    });
    return parseDetailPage(resp.data);
  } catch (err) {
    console.log(`[5eplay] HTML 详情页失败: ${err.message}`);
  }

  return null;
}

/**
 * 解析详情 API 的 JSON 响应
 */
function parseDetailApiResponse(data) {
  if (!data) return null;
  let detail = data;
  if (data.data) detail = data.data;
  if (data.result) detail = data.result;

  const result = { roundScores: [], playerStats: [] };

  if (detail.maps && Array.isArray(detail.maps)) {
    for (const m of detail.maps) {
      result.roundScores.push({
        map: m.map || m.name || '',
        team1Score: m.team1Score ?? m.team1_score ?? m.score1 ?? 0,
        team2Score: m.team2Score ?? m.team2_score ?? m.score2 ?? 0
      });
    }
  }
  const scores = detail.roundScores || detail.round_scores || [];
  if (Array.isArray(scores)) {
    for (const s of scores) {
      result.roundScores.push({
        map: s.map || s.name || '',
        team1Score: s.team1Score ?? s.team1_score ?? s.score1 ?? 0,
        team2Score: s.team2Score ?? s.team2_score ?? s.score2 ?? 0
      });
    }
  }
  if (detail.players || detail.playerStats || detail.stats) {
    result.playerStats = detail.players || detail.playerStats || detail.stats || [];
  }

  return result;
}

/**
 * 解析 5eplay 赛事详情页 HTML，提取局分和选手数据
 */
function parseDetailPage(html) {
  if (!html) return null;

  const result = { roundScores: [], playerStats: [] };

  // 1. 尝试从 __NUXT__ / __INITIAL_STATE__ 中提取完整数据
  let pageData = null;

  const nuxtMatch = html.match(/window\.__NUXT__\s*=\s*(\{[\s\S]*?\});/);
  if (nuxtMatch) {
    try { pageData = JSON.parse(nuxtMatch[1]); } catch {}
  }

  if (!pageData) {
    const stateMatch = html.match(/window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\});/);
    if (stateMatch) {
      try { pageData = JSON.parse(stateMatch[1]); } catch {}
    }
  }

  if (pageData) {
    // 从页面数据中提取
    extractDetailData(pageData, result);
  }

  // 2. 尝试从嵌入式 JSON 中提取
  if (result.roundScores.length === 0) {
    const jsonBlocks = html.matchAll(
      /<script[^>]*type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/g
    );
    for (const block of jsonBlocks) {
      try {
        const jsonData = JSON.parse(block[1]);
        extractDetailData(jsonData, result);
        if (result.roundScores.length > 0) break;
      } catch {}
    }
  }

  // 3. 兜底：从 HTML 表格中提取局分
  if (result.roundScores.length === 0) {
    // 匹配局分行: <tr>...<td>13</td><td>16</td>...</tr>
    const mapRows = html.matchAll(
      /<tr[^>]*>[\s\S]*?<td[^>]*class="[^"]*team1[^"]*"[^>]*>(\d+)<\/td>[\s\S]*?<td[^>]*class="[^"]*team2[^"]*"[^>]*>(\d+)<\/td>[\s\S]*?<\/tr>/gi
    );
    for (const row of mapRows) {
      result.roundScores.push({
        map: '默认',
        team1Score: parseInt(row[1], 10),
        team2Score: parseInt(row[2], 10)
      });
    }
  }

  return result.roundScores.length > 0 ? result : null;
}

/**
 * 递归遍历对象，提取比赛详情数据
 */
function extractDetailData(obj, result) {
  if (!obj || typeof obj !== 'object') return;

  if (Array.isArray(obj)) {
    // 检查是否是地图/局分数数组
    if (obj.length > 0 && obj[0].team1Score !== undefined) {
      for (const item of obj) {
        result.roundScores.push({
          map: item.map || item.name || '',
          team1Score: item.team1Score ?? item.team1_score ?? item.score1 ?? 0,
          team2Score: item.team2Score ?? item.team2_score ?? item.score2 ?? 0
        });
      }
      return;
    }
    // 选手数据数组
    if (obj.length > 0 && obj[0].playerId !== undefined) {
      result.playerStats = obj;
      return;
    }
    for (const item of obj) {
      extractDetailData(item, result);
    }
    return;
  }

  // 检查是否有 maps/roundScores 字段
  if (obj.maps && Array.isArray(obj.maps)) {
    for (const m of obj.maps) {
      result.roundScores.push({
        map: m.map || m.name || '',
        team1Score: m.team1Score ?? m.team1_score ?? m.score1 ?? 0,
        team2Score: m.team2Score ?? m.team2_score ?? m.score2 ?? 0
      });
    }
    return;
  }

  if (obj.roundScores && Array.isArray(obj.roundScores)) {
    result.roundScores = [...result.roundScores, ...obj.roundScores];
  }
  if (obj.round_scores && Array.isArray(obj.round_scores)) {
    result.roundScores = [...result.roundScores, ...obj.round_scores];
  }

  // 递归遍历子字段
  for (const key of Object.keys(obj)) {
    if (['team1', 'team2', 'teams', 'players'].includes(key)) continue;
    extractDetailData(obj[key], result);
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
  // 有非零比分时推断为已结束（避免默认值 '0' 误判）
  if (score1 != null && score2 != null && (score1 > 0 || score2 > 0)) return 'Finished';
  return 'Upcoming';
}

module.exports = { fetchFrom5eplay, normalizeMatch, fetchMatchDetail, parseDetailPage };
