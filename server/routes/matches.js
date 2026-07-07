// 比赛相关路由
const express = require('express');
const router = express.Router();

const { query } = require('../db/pool');

/**
 * 将队标 URL 转为本地代理地址
 * 微信小程序 <image> 无法直接加载 HLTV CDN（403），且不支持 SVG
 * 通过后端 /api/logo 代理：自动添加 User-Agent + SVG→PNG 转换 + 24h 缓存
 */
function logoToPng(url, baseUrl) {
  if (!url) return '';
  // 已经是代理地址或非 HLTV 源，直接返回
  if (url.startsWith('/api/logo') || url.includes('/api/logo?')) return url;
  if (!url.includes('hltv.org')) return url;
  // HLTV 的 CDN 屏蔽外部请求，通过后端代理转发
  return baseUrl + '/api/logo?url=' + encodeURIComponent(url);
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
    time: row.match_time
      ? `${row.match_date.toISOString ? row.match_date.toISOString().slice(0, 10) : row.match_date}T${row.match_time}`
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
 * 取比赛两队当前 5 名选手（按战队名匹配 player.current_team）
 */
router.get('/:id/players', async (req, res, next) => {
  try {
    const { id } = req.params;

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

    // 兼容旧前端：直接按战队名查选手（player.current_team = 战队名）
    // LEFT JOIN match_players 获取本场 K/D/A/Rating
    const [players] = await query(
      `SELECT p.*, mp.kills, mp.deaths, mp.assists, mp.rating AS match_rating
       FROM player p
       LEFT JOIN match_players mp ON mp.match_id = ?
         AND (mp.player_game_id = p.game_id OR mp.player_name = p.name)
       WHERE p.current_team IN (?, ?)
       ORDER BY p.current_team, p.name`,
      [id, team1Name, team2Name]
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
        // Per-match stats (null when no match_players row)
        kills: p.kills != null ? p.kills : null,
        deaths: p.deaths != null ? p.deaths : null,
        assists: p.assists != null ? p.assists : null,
        rating: p.match_rating != null ? parseFloat(p.match_rating) : null
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