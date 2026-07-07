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
    // 🔁 总是覆盖队标：5eplay 的数据是最新的，不管之前有没有 logo
    if (logoUrl && logoUrl !== (rows[0].logo_url || '')) {
      await query('UPDATE team SET logo_url = ? WHERE id = ?', [logoUrl, rows[0].id]);
    }
    return rows[0].id;
  }

  const [result] = await query(
    'INSERT INTO team (name, region, member_count, logo_url) VALUES (?, ?, 0, ?)',
    [name, 'Other', logoUrl || '']
  );
  console.log(`[sync] 自动创建新战队: ${name} (id=${result.insertId})`);
  return result.insertId;
}

/**
 * 构建统一 Match DTO（与 matches.js toMatchDTO 对齐）
 */
function toMatchDTO(row) {
  return {
    _id: String(row.id),
    eplayId: row.eplay_id || '',
    event: row.event_name || '',
    status: row.status || 'Upcoming',
    teamA: {
      name: row.teamA_name || row.team_a_name || '',
      logo: row.teamA_logo || '',
      score: row.team1_score || 0
    },
    teamB: {
      name: row.teamB_name || row.team_b_name || '',
      logo: row.teamB_logo || '',
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

  // ----- 3. 无 eplay_id 或没找到，按 (date, team1, team2) + time 回退匹配 -----
  //     排除 legacy_ 和 NULL 的旧行，避免误匹配
  if (!existingId && fields.match_date && team1Id && team2Id) {
    const [rows] = await query(
      `SELECT id FROM matches
       WHERE match_date = ? AND team1_id = ? AND team2_id = ?
         AND (eplay_id IS NOT NULL AND eplay_id NOT LIKE 'legacy_%')
       ORDER BY match_time = ? DESC, id DESC
       LIMIT 1`,
      [fields.match_date, team1Id, team2Id, fields.match_time]
    );
    if (rows.length > 0) existingId = rows[0].id;
  }

  // ----- 4. 执行 UPSERT -----
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

    return { action: 'update', id: existingId, log: `更新 #${existingId}: ${m.team1} vs ${m.team2} [${fields.status}]` };
  }

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

  return { action: 'insert', id: insertResult.insertId, log: `新增 #${insertResult.insertId}: ${m.team1} vs ${m.team2}` };
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
