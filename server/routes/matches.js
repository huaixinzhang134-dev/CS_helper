// 比赛相关路由
const express = require('express');
const router = express.Router();

const { query } = require('../db/pool');

/**
 * 安全格式化日期：mysql2 timezone=+08:00 将 MySQL DATE 解析为
 * UTC+8 Date 对象，内部 UTC 时间戳回退 8h。服务器可能运行在
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
  return String(d).slice(0, 10);
}

function fmtTime(t) {
  if (t instanceof Date && !isNaN(t)) {
    const off = 8 * 60 * 60 * 1000;
    const d = new Date(t.getTime() + off);
    return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
  }
  const s = String(t).trim();
  if (/^\d{2}:\d{2}/.test(s)) return s.slice(0, 5);
  return s;
}

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
    roundName: row.tab || '',
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
      ? `${fmtDate(row.match_date)}T${fmtTime(row.match_time)}`
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

// 回合名关键词（用于 events 接口过滤，仅展示真正的赛事分类）
const ROUND_KEYWORDS = /(决赛|半决赛|季军赛|八强|四强|十六强|十二强|首轮|小组赛|淘汰赛|排位赛|瑞士轮|胜者组|败者组|入围赛|附加赛|升降级赛|复活赛|第[一二三四五六七八九十\d]+轮)/;

function isRoundName(name) {
  if (!name) return false;
  // "G5" / "G4" 等纯等级编号直接排除
  if (/^G\d+$/.test(name.trim())) return true;
  // 去除末尾 G+数字后缀（"八强 G4" → "八强"），再匹配关键词
  const cleaned = name.replace(/\s*G\d+$/, '').trim();
  // strip 后为空说明原名只有 G+数字（如 " G5"）→ 排除
  if (!cleaned) return true;
  return ROUND_KEYWORDS.test(cleaned);
}

/**
 * GET /api/matches/events
 * 返回所有赛事名称（去重），含比赛场次数和最近日期
 * 自动过滤「八强 G4」「首轮 G5」「决赛」等回合名，仅保留真正的赛事分类
 */
router.get('/events', async (req, res, next) => {
  try {
    const [rows] = await query(
      `SELECT event_name AS name, COUNT(*) AS matchCount, MAX(match_date) AS latestDate
       FROM matches GROUP BY event_name ORDER BY latestDate DESC`
    );
    const filtered = rows.filter(r => !isRoundName(r.name))
      .map(r => ({ ...r, latestDate: fmtDate(r.latestDate) }));
    res.json({ code: 0, message: '', data: filtered });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/matches
 * 联表 team 拿战队名/logo（按战队 ID）
 * 可选 query: ?event=XXX 筛选特定赛事
 */
router.get('/', async (req, res, next) => {
  try {
    const eventFilter = req.query.event || '';
    let sql = `SELECT m.*,
                      ta.name AS teamA_name, ta.logo_url AS teamA_logo,
                      tb.name AS teamB_name, tb.logo_url AS teamB_logo
               FROM matches m
               LEFT JOIN team ta ON ta.id = m.team1_id
               LEFT JOIN team tb ON tb.id = m.team2_id`;
    const params = [];
    if (eventFilter) {
      sql += ' WHERE m.event_name = ?';
      params.push(eventFilter);
    }
    sql += ' ORDER BY m.match_date ASC, m.match_time ASC';

    const [rows] = await query(sql, params);

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