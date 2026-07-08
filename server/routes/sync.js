/**
 * POST /api/matches/sync
 *
 * 爬虫推送接口：接收 5eplay 赛事数据，UPSERT 覆盖更新到 MySQL 并广播 WS。
 *
 * 处理流程（覆盖更新模式）：
 *   1. 通过 eplay_id 查找已有比赛；找不到则按 (date, team1_id, team2_id) 再查
 *   2. 存在 → 全字段 UPDATE 覆盖（不对比差异）
 *   3. 不存在 → INSERT
 *
 * 关键变更（2026-07）：放弃 diff-check 增量更新，改为全字段覆盖。
 * 这样多次运行爬虫后不会残留旧数据，时间保持与 5eplay 源站一致。
 */
const express = require('express');
const router = express.Router();

const { query } = require('../db/pool');

// ======================== 工具函数 ========================

/**
 * 将队伍名解析为 team ID，不存在则自动创建
 */
async function resolveTeamId(teamName, logoUrl) {
  if (!teamName || !teamName.trim()) return null;

  const name = teamName.trim();

  const [rows] = await query('SELECT id, logo_url FROM team WHERE name = ? LIMIT 1', [name]);
  if (rows.length > 0) {
    // 不覆盖已有队标：5eplay 的 logo 是 5e 域名，HLTV CDN URL 才是正确的
    // 队标由 ranking.yml 爬虫（crawl_ranking.js）从 HLTV 获取
    return rows[0].id;
  }

  const [result] = await query(
    'INSERT INTO team (name, region, member_count, logo_url) VALUES (?, ?, 0, ?)',
    [name, 'Other', '']  // 新队伍也不写 5eplay 的 logo，等 HLTV 爬虫来补充
  );
  console.log(`[sync] 自动创建新战队: ${name} (id=${result.insertId})`);
  return result.insertId;
}

/**
 * 构建统一 Match DTO（与 matches.js toMatchDTO 对齐）
 */
function proxyLogo(url) {
  if (!url) return '';
  return url;
}

function toMatchDTO(row) {
  return {
    _id: String(row.id),
    eplayId: row.eplay_id || '',
    event: row.event_name || '',
    status: row.status || 'Upcoming',
    teamA: {
      name: row.teamA_name || row.team_a_name || '',
      logo: proxyLogo(row.teamA_logo),
      score: row.team1_score || 0
    },
    teamB: {
      name: row.teamB_name || row.team_b_name || '',
      logo: proxyLogo(row.teamB_logo),
      score: row.team2_score || 0
    },
    time: row.match_date && row.match_time
      ? `${String(row.match_date).slice(0, 10)}T${row.match_time}`
      : '',
    roundScores: row.round_scores
      ? (typeof row.round_scores === 'string' ? JSON.parse(row.round_scores) : row.round_scores)
      : []
  };
}

/**
 * 将爬虫状态映射到 DB 格式
 */
function mapStatus(status) {
  if (!status) return 'Upcoming';
  const s = status.toLowerCase();
  if (s === 'live' || s === 'playing' || s === 'ongoing') return 'Live';
  if (s === 'finished' || s === 'completed' || s === 'ended' || s === 'results') return 'Finished';
  if (s === 'upcoming' || s === 'scheduled') return 'Upcoming';
  return 'Upcoming';
}

// ======================== PlayerStats 归一化 ========================

/**
 * 归一化单条 5eplay 选手数据，处理多种可能的字段命名
 */
function normalizePlayerStat(raw) {
  const getStr = (...keys) => {
    for (const k of keys) {
      if (raw[k] && typeof raw[k] === 'string' && raw[k].trim()) return raw[k].trim();
    }
    return '';
  };
  const getNum = (...keys) => {
    for (const k of keys) {
      const v = raw[k];
      if (v !== undefined && v !== null && !isNaN(Number(v))) return Number(v);
    }
    return 0;
  };

  return {
    player_name: getStr('name', 'nickName', 'playerName', 'nickname'),
    team_name: getStr('teamName', 'team', 'clan', 'team_name'),
    kills: Math.round(getNum('kills', 'kill', 'k', 'Kill', 'frags')),
    deaths: Math.round(getNum('deaths', 'death', 'd', 'Death')),
    assists: Math.round(getNum('assists', 'assist', 'a', 'Assist')),
    rating: getNum('rating', 'rating2', 'Rating', 'rtg', 'playerRating'),
    adr: getNum('adr', 'ADR', 'damage_per_round', 'dpr'),
    plus_minus: Math.round(getNum('plusMinus', 'plus_minus', 'kdDiff', 'kd_diff', 'kd')),
  };
}

/**
 * 尝试将选手名 + 战队名解析到 player 表的 game_id
 */
async function resolvePlayerGameId(playerName, teamName) {
  if (!playerName) return '';
  try {
    // 精确匹配：选手名 + 当前战队
    const [rows] = await query(
      'SELECT game_id FROM player WHERE name = ? AND current_team = ? LIMIT 1',
      [playerName, teamName]
    );
    if (rows.length > 0) return rows[0].game_id;
    // 模糊匹配：选手名 + 战队名包含
    const [rows2] = await query(
      'SELECT game_id FROM player WHERE name = ? AND current_team LIKE ? LIMIT 1',
      [playerName, `%${teamName}%`]
    );
    if (rows2.length > 0) return rows2[0].game_id;
    // 兜底：仅按选手名匹配
    const [rows3] = await query(
      'SELECT game_id FROM player WHERE name = ? LIMIT 1',
      [playerName]
    );
    if (rows3.length > 0) return rows3[0].game_id;
  } catch (err) {
    console.error(`[sync] resolvePlayerGameId 出错: ${err.message}`);
  }
  return '';
}

/**
 * 保存选手数据到 match_players 表（先清后插，支持重跑）
 */
async function saveMatchPlayers(matchId, playerStats) {
  if (!Array.isArray(playerStats) || playerStats.length === 0) return;

  // 先清除旧数据（支持爬虫重跑）
  await query('DELETE FROM match_players WHERE match_id = ?', [matchId]);

  let count = 0;
  for (const raw of playerStats) {
    const stat = normalizePlayerStat(raw);
    if (!stat.player_name) continue;

    // 选手 ID：先用名称匹配 player 表（兼容），CDN API 数字 ID 兜底
    let gameId = await resolvePlayerGameId(stat.player_name, stat.team_name);
    if (!gameId) {
      // 名称匹配失败时，用 CDN API 的 id（如 csgo_pl_22613 → 22613）
      const idMatch = raw.id && raw.id.match(/(\d+)$/);
      if (idMatch) gameId = idMatch[1];
    }

    try {
      await query(
        `INSERT INTO match_players
         (match_id, player_game_id, player_name, team_name,
          kills, deaths, assists, rating, adr, plus_minus, raw_data)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
          kills = VALUES(kills), deaths = VALUES(deaths),
          assists = VALUES(assists), rating = VALUES(rating),
          adr = VALUES(adr), plus_minus = VALUES(plus_minus),
          raw_data = VALUES(raw_data)`,
        [
          matchId, gameId, stat.player_name, stat.team_name,
          stat.kills, stat.deaths, stat.assists, stat.rating, stat.adr,
          stat.plus_minus, JSON.stringify(raw)
        ]
      );
      count++;
    } catch (err) {
      console.error(`[sync] 保存选手数据失败: ${err.message} (${stat.player_name})`);
    }
  }

  if (count > 0) {
    console.log(`[sync] 保存 ${count} 条选手数据 → match #${matchId}`);
  }
}


// ======================== UPSERT 核心 ========================

/**
 * 准备 INSERT / UPDATE 需要的所有字段值
 */
function prepareMatchFields(m, team1Id, team2Id) {
  const score1 = m.team1Score != null ? parseInt(m.team1Score, 10) : 0;
  const score2 = m.team2Score != null ? parseInt(m.team2Score, 10) : 0;
  const roundScoresJson = m.roundScores && Array.isArray(m.roundScores)
    ? JSON.stringify(m.roundScores)
    : '[]';

  const eplayIdRaw = String(m.eplayId || '').trim();
  return {
    eplay_id: eplayIdRaw || null,  // null 避免 UNIQUE KEY 冲突
    match_date: m.date || '',
    match_time: m.time || '',
    match_type: m.matchType || 'BO1',
    team1_id: team1Id,
    team2_id: team2Id,
    team1_score: score1,
    team2_score: score2,
    round_scores: roundScoresJson,
    event_name: (m.eventName || '').slice(0, 256),
    status: mapStatus(m.status),
    tab: m.tab || 'schedule'
  };
}

/**
 * 将一场比赛 UPSERT 到数据库
 * @returns {Promise<{action: 'insert'|'update'|'skip', id: number, log: string}|null>}
 */
async function upsertMatch(m, req) {
  // ----- 1. 解析队伍 ID -----
  const team1Id = await resolveTeamId(m.team1, m.team1Logo);
  const team2Id = await resolveTeamId(m.team2, m.team2Logo);
  if (!team1Id || !team2Id) return null;

  const fields = prepareMatchFields(m, team1Id, team2Id);

  // ----- 2. 按 eplay_id 查找已有比赛 -----
  let existingId = null;

  if (fields.eplay_id) {
    const [rows] = await query('SELECT id FROM matches WHERE eplay_id = ? LIMIT 1', [fields.eplay_id]);
    if (rows.length > 0) existingId = rows[0].id;
  }

  // ----- 3. 无 eplay_id 或没找到，按 (date, team1, team2) 回退匹配 -----
  //     不排除 legacy 行，防止爬虫时间修改后重复插入
  if (!existingId && fields.match_date && team1Id && team2Id) {
    const [rows] = await query(
      `SELECT id FROM matches
       WHERE match_date = ? AND team1_id = ? AND team2_id = ?
       ORDER BY match_time = ? DESC, id DESC
       LIMIT 1`,
      [fields.match_date, team1Id, team2Id, fields.match_time]
    );
    if (rows.length > 0) existingId = rows[0].id;
  }

  // ----- 4. 执行 UPSERT -----
  let matchId = existingId;
  let action = 'update';

  if (existingId) {
    // ---- UPDATE：全字段覆盖 ----
    await query(
      `UPDATE matches SET
        eplay_id = ?, match_date = ?, match_time = ?, match_type = ?,
        team1_id = ?, team2_id = ?, team1_score = ?, team2_score = ?,
        round_scores = ?, event_name = ?, status = ?, tab = ?
       WHERE id = ?`,
      [
        fields.eplay_id, fields.match_date, fields.match_time, fields.match_type,
        fields.team1_id, fields.team2_id, fields.team1_score, fields.team2_score,
        fields.round_scores, fields.event_name, fields.status, fields.tab,
        existingId
      ]
    );

    console.log(`[sync] 更新 #${existingId}: ${m.team1} vs ${m.team2} [${fields.status}]`);
  } else {
    // ---- INSERT ----
    const [insertResult] = await query(
      `INSERT INTO matches
       (eplay_id, match_date, match_time, match_type, team1_id, team2_id,
        team1_score, team2_score, round_scores, event_name, status, tab)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        fields.eplay_id, fields.match_date, fields.match_time, fields.match_type,
        fields.team1_id, fields.team2_id, fields.team1_score, fields.team2_score,
        fields.round_scores, fields.event_name, fields.status, fields.tab
      ]
    );
    matchId = insertResult.insertId;
    action = 'insert';

    console.log(`[sync] 新增 #${matchId}: ${m.team1} vs ${m.team2}`);
  }

  // ----- 5. 保存选手数据（如果爬虫提供了） -----
  if (matchId && m.playerStats) {
    await saveMatchPlayers(matchId, m.playerStats);
  }

  return { action, id: matchId, log: '' };
}

// ======================== 主路由 ========================

router.post('/', async (req, res, next) => {
  try {
    // 简单鉴权
    const auth = req.headers.authorization;
    const expectedToken = process.env.SYNC_TOKEN || 'cs-match-sync-token';
    if (!auth || auth !== `Bearer ${expectedToken}`) {
      return res.status(401).json({ code: 401, message: 'unauthorized', data: null });
    }

    const { matches = [] } = req.body;
    if (!Array.isArray(matches) || matches.length === 0) {
      return res.json({ code: 0, message: 'no data', data: { checked: 0, inserted: 0, updated: 0 } });
    }

    console.log(`[sync] 收到 ${matches.length} 场比赛，开始全字段覆盖同步...`);

    let inserted = 0;
    let updated = 0;

    for (const m of matches) {
      const result = await upsertMatch(m, req);
      if (!result) continue;

      if (result.action === 'insert') inserted++;
      else updated++;
      console.log(`[sync] ${result.log}`);
    }

    // ----- WS 广播：推全量 -----
    try {
      const [allRows] = await query(
        `SELECT m.*, ta.name AS teamA_name, tb.name AS teamB_name,
                ta.logo_url AS teamA_logo, tb.logo_url AS teamB_logo
         FROM matches m
         LEFT JOIN team ta ON ta.id = m.team1_id
         LEFT JOIN team tb ON tb.id = m.team2_id
         ORDER BY m.match_date ASC, m.match_time ASC`
      );
      const statusOrder = { Live: 0, Upcoming: 1, Finished: 2 };
      allRows.sort((a, b) => {
        const sa = statusOrder[a.status] ?? 9;
        const sb = statusOrder[b.status] ?? 9;
        return sa - sb;
      });

      const broadcastGlobal = req.app.get('broadcastGlobal');
      if (broadcastGlobal) {
        broadcastGlobal(allRows.map(toMatchDTO));
      }

      // 逐场广播新增/更新的比赛
      const broadcastMatchUpdate = req.app.get('broadcastMatchUpdate');
      if (broadcastMatchUpdate) {
        for (const row of allRows) {
          // 只广播最近变化的比赛（本批次处理过的）
          // 简化处理：全量列表广播已包含所有数据
        }
      }
    } catch (err) {
      console.error('[sync] WS 广播失败:', err.message);
    }

    // ----- 清理重复比赛：同一场比赛只保留最新更新的那条 -----
    //     旧数据使用 UTC 时间，新数据使用 UTC+8，需要清理旧行
    try {
      // 1. 同一 eplay_id 多行 → 保留 updated_at 最新那条
      const [r1] = await query(
        `DELETE m1 FROM matches m1
         INNER JOIN matches m2
         ON m1.eplay_id IS NOT NULL AND m1.eplay_id = m2.eplay_id
          AND m1.updated_at < m2.updated_at`
      );
      if (r1.affectedRows > 0) console.log(`[sync] 清理 ${r1.affectedRows} 条 eplay_id 重复`);

      // 2. 同一天+同对手+同赛事，时间相差 8h → 保留较晚（UTC+8）的
      const [r2] = await query(
        `DELETE m1 FROM matches m1
         INNER JOIN matches m2
         ON m1.match_date = m2.match_date
          AND m1.team1_id = m2.team1_id
          AND m1.team2_id = m2.team2_id
          AND m1.event_name = m2.event_name
          AND m1.tab = m2.tab
          AND m1.id < m2.id
         WHERE ADDTIME(m1.match_time, '08:00') = m2.match_time`
      );
      if (r2.affectedRows > 0) console.log(`[sync] 清理 ${r2.affectedRows} 条 UTC/UTC+8 时间重复`);
    } catch (err) {
      console.error('[sync] 清理重复比赛失败:', err.message);
    }

    console.log(`[sync] ✅ 完成: 新增=${inserted}, 更新=${updated}`);
    res.json({
      code: 0,
      message: 'sync ok',
      data: { checked: matches.length, inserted, updated }
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
