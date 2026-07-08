// 比赛相关路由
const express = require('express');
const router = express.Router();

const { query } = require('../db/pool');

/**
 * 安全格式化日期：mysql2 timezone=+08:00 将 MySQL DATE 解析为
 * UTC+8 Date 对象，内部 UTC 时间戳回退 8h。Railway Node.js 运行在
 * UTC 时区，getDate() 取到的是错误的 UTC 日期。这里手动 +8h 恢复
 * 北京时间，再用 getUTC* 取日期，消除服务器时区影响。
 */
function fmtDate(d) {
  if (d instanceof Date && !isNaN(d)) {
    const off = 8 * 60 * 60 * 1000;       // UTC → 北京时间偏移
    const t = new Date(d.getTime() + off);
    const y = t.getUTCFullYear();
    const m = String(t.getUTCMonth() + 1).padStart(2, '0');
    const day = String(t.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  // 兜底：string 或数字直接取前 10 位
  return String(d).slice(0, 10);
}

/**
 * 队标 URL 处理（数据库已存储正确 CDN URL，直接使用）
 */
function logoToPng(url, baseUrl) {
  if (!url) return '';
  return url;
}

/**
 * 比赛行 → 前端 Match DTO
 */
function toMatchDTO(row, baseUrl) {
  const teamAName = row.teamA_name || row.team_a_name || '';
  const teamBName = row.teamB_name || row.team_b_name || '';
  const dto = {
    _id: String(row.id),
    event: row.event_name || '',
    status: row.status || 'Upcoming',
    teamA: {
      name: teamAName,
      logo: logoToPng(row.teamA_logo, baseUrl),
      score: row.team1_score || 0
    },
    teamB: {
      name: teamBName,
      logo: logoToPng(row.teamB_logo, baseUrl),
      score: row.team2_score || 0
    },
    time: row.match_date && row.match_time
      ? `${fmtDate(row.match_date)}T${row.match_time}`
      : ''
  };
  // 附加局分数据（用于详情页展示小分）
  if (row.round_scores) {
    try {
      dto.roundScores = typeof row.round_scores === 'string'
        ? JSON.parse(row.round_scores)
        : row.round_scores;
    } catch { dto.roundScores = []; }
  }
  return dto;
}

/**
 * GET /api/matches
 * 联表 team 拿战队名/logo（按战队 ID）
 */
router.get('/', async (req, res, next) => {
  try {
    const [rows] = await query(
      `SELECT m.*,
              ta.name AS teamA_name, ta.logo_url AS teamA_logo,
              tb.name AS teamB_name, tb.logo_url AS teamB_logo
       FROM matches m
       LEFT JOIN team ta ON ta.id = m.team1_id
       LEFT JOIN team tb ON tb.id = m.team2_id
       ORDER BY m.match_date ASC, m.match_time ASC`
    );

    // 简单的排序：Live > Upcoming > Finished（与原前端一致）
    const statusOrder = { Live: 0, Upcoming: 1, Finished: 2 };
    const sorted = rows.sort((a, b) => {
      const sa = statusOrder[a.status] ?? 9;
      const sb = statusOrder[b.status] ?? 9;
      return sa - sb;
    });

    const baseUrl = req.protocol + '://' + req.get('host');
    res.json({
      code: 0,
      message: '',
      data: sorted.map(r => toMatchDTO(r, baseUrl))
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/matches/:id
 */
router.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const [rows] = await query(
      `SELECT m.*,
              ta.name AS teamA_name, ta.logo_url AS teamA_logo,
              tb.name AS teamB_name, tb.logo_url AS teamB_logo
       FROM matches m
       LEFT JOIN team ta ON ta.id = m.team1_id
       LEFT JOIN team tb ON tb.id = m.team2_id
       WHERE m.id = ? LIMIT 1`,
      [id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ code: 404, message: '比赛不存在', data: null });
    }
    const baseUrl = req.protocol + '://' + req.get('host');
    res.json({ code: 0, message: '', data: toMatchDTO(rows[0], baseUrl) });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/matches/:id/players
 * 取比赛两队实际出场选手（优先从 match_players 精确获取，兜底按战队名查）
 */
router.get('/:id/players', async (req, res, next) => {
  try {
    const { id } = req.params;

    // 1. 先尝试从 match_players 获取本场实际出场选手（爬虫已推送的精确阵容）
    const [mpRows] = await query(
      `SELECT mp.*, p.id AS player_db_id, p.game_id, p.name, p.current_team,
              p.country, p.country_code, p.age, p.avatar, p.position,
              p.real_name, p.former_teams, p.region, p.major_appearances, p.rating AS player_rating
       FROM match_players mp
       LEFT JOIN player p ON (mp.player_game_id != '' AND p.game_id = mp.player_game_id)
                          OR (p.name = mp.player_name AND p.current_team = mp.team_name)
       WHERE mp.match_id = ?
       ORDER BY mp.team_name, mp.id`,
      [id]
    );

    if (mpRows.length > 0) {
      // 精确阵容：仅显示本场实际出场的选手
      const team1Map = new Map(); // team_name -> players[]
      const team2Map = new Map();
      const teamNames = []; // 保持出场顺序

      for (const row of mpRows) {
        const teamName = row.team_name || '';
        const dto = {
          _id: row.player_db_id ? String(row.player_db_id) : '',
          playerId: row.game_id || row.player_game_id || '',
          name: row.name || row.player_name || '',
          team: teamName,
          avatar: row.avatar || '',
          country: row.country || '',
          countryCode: row.country_code || '',
          position: row.position || '',
          kills: row.kills != null ? row.kills : null,
          deaths: row.deaths != null ? row.deaths : null,
          assists: row.assists != null ? row.assists : null,
          rating: row.rating != null ? parseFloat(row.rating) : null
        };

        if (teamNames.length === 0) {
          teamNames.push(teamName);
          team1Map.set(teamName, [dto]);
        } else if (teamName === teamNames[0]) {
          team1Map.get(teamName).push(dto);
        } else if (teamNames.length === 1) {
          teamNames.push(teamName);
          team2Map.set(teamName, [dto]);
        } else {
          team2Map.get(teamName).push(dto);
        }
      }

      const team1Name = teamNames[0] || '';
      const team2Name = teamNames[1] || '';
      const team1 = team1Map.get(team1Name) || [];
      const team2 = team2Map.get(team2Name) || [];

      return res.json({
        code: 0,
        message: '',
        data: {
          team1: { name: team1Name, players: team1 },
          team2: { name: team2Name, players: team2 },
          total: mpRows.length
        }
      });
    }

    // 2. 兜底：无 match_players 数据时（如未开赛），按战队名查全队选手
    const [matchRows] = await query(
      `SELECT m.team1_id, m.team2_id,
              ta.name AS teamA_name, tb.name AS teamB_name
       FROM matches m
       LEFT JOIN team ta ON ta.id = m.team1_id
       LEFT JOIN team tb ON tb.id = m.team2_id
       WHERE m.id = ? LIMIT 1`,
      [id]
    );
    if (matchRows.length === 0) {
      return res.status(404).json({ code: 404, message: '比赛不存在', data: null });
    }
    const m = matchRows[0];
    const team1Name = m.teamA_name || '';
    const team2Name = m.teamB_name || '';

    const [players] = await query(
      `SELECT p.*
       FROM player p
       WHERE p.current_team IN (?, ?)
       ORDER BY p.current_team, p.name`,
      [team1Name, team2Name]
    );

    const team1 = [];
    const team2 = [];
    for (const p of players) {
      const dto = {
        _id: String(p.id),
        playerId: p.game_id,
        name: p.name,
        team: p.current_team,
        avatar: p.avatar || '',
        country: p.country || '',
        countryCode: p.country_code || '',
        position: p.position || '',
        kills: null,
        deaths: null,
        assists: null,
        rating: null
      };
      if (p.current_team === team1Name) team1.push(dto);
      else if (p.current_team === team2Name) team2.push(dto);
    }

    res.json({
      code: 0,
      message: '',
      data: {
        team1: { name: team1Name, players: team1 },
        team2: { name: team2Name, players: team2 },
        total: players.length
      }
    });
  } catch (err) {
    next(err);
  }
});

// ============ Admin CRUD ============

/**
 * POST /api/matches
 * Body: { event_name, status, team1_id, team2_id, team1_score, team2_score,
 *        match_date, match_time, match_type, event_id(round_scores), tab }
 */
router.post('/', async (req, res, next) => {
  try {
    const m = req.body || {};
    if (!m.event_name || !m.match_date || !m.match_time) {
      return res.status(400).json({ code: 400, message: 'event_name / match_date / match_time 必填', data: null });
    }
    const [result] = await query(
      `INSERT INTO matches
       (match_date, match_time, match_type, team1_id, team2_id,
        team1_score, team2_score, round_scores, event_name, status, tab)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        m.match_date,
        m.match_time,
        m.match_type || '',
        m.team1_id || null,
        m.team2_id || null,
        m.team1_score || 0,
        m.team2_score || 0,
        JSON.stringify(m.round_scores || []),
        m.event_name,
        m.status || 'Upcoming',
        m.tab || ''
      ]
    );
    res.json({
      code: 0,
      message: '创建成功',
      data: { id: result.insertId, _id: String(result.insertId) }
    });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/matches/:id
 */
router.put('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const m = req.body || {};

    const map = {
      match_date: m.match_date,
      match_time: m.match_time,
      match_type: m.match_type,
      team1_id: m.team1_id,
      team2_id: m.team2_id,
      team1_score: m.team1_score !== undefined ? parseInt(m.team1_score, 10) : undefined,
      team2_score: m.team2_score !== undefined ? parseInt(m.team2_score, 10) : undefined,
      round_scores: m.round_scores ? JSON.stringify(m.round_scores) : undefined,
      event_name: m.event_name,
      status: m.status,
      tab: m.tab
    };
    const fields = [];
    const values = [];
    for (const [col, val] of Object.entries(map)) {
      if (val !== undefined) {
        fields.push(`${col} = ?`);
        values.push(val);
      }
    }
    if (fields.length === 0) {
      return res.json({ code: 0, message: '无变更', data: null });
    }
    values.push(id);
    const [result] = await query(
      `UPDATE matches SET ${fields.join(', ')} WHERE id = ?`,
      values
    );
    res.json({ code: 0, message: '更新成功', data: { affected: result.affectedRows } });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/matches/:id
 */
router.delete('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const [result] = await query('DELETE FROM matches WHERE id = ?', [id]);
    res.json({ code: 0, message: '删除成功', data: { affected: result.affectedRows } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;