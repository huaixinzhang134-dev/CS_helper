// 选手相关路由
const express = require('express');
const router = express.Router();

const { query } = require('../db/pool');

/**
 * 数据库行 → 前端 Player DTO
 */
function toPlayerDTO(row) {
  return {
    _id: String(row.id),                  // 兼容旧前端
    playerId: row.game_id,               // 业务 ID（HLTV 数字）
    name: row.name,
    realName: row.real_name,
    country: row.country,
    countryCode: row.country_code,
    age: row.age,
    team: row.current_team || '',
    formerTeams: row.former_teams ? safeParseArray(row.former_teams) : [],
    region: row.region,
    majorAppearances: row.major_appearances || 0,
    position: row.position,
    rating: Number(row.rating) || 0,
    avatar: row.avatar || ''
  };
}

function safeParseArray(json) {
  // mysql2 在部分版本中会自动解析 JSON 列为数组，此时无需再 parse
  if (Array.isArray(json)) return json;
  if (typeof json === 'string') {
    try {
      const arr = JSON.parse(json);
      return Array.isArray(arr) ? arr : [];
    } catch (e) {
      return [];
    }
  }
  return [];
}

/**
 * GET /api/players?skip=0&limit=20
 */
router.get('/', async (req, res, next) => {
  try {
    const skip = Math.max(parseInt(req.query.skip || '0', 10), 0);
    const limit = Math.min(Math.max(parseInt(req.query.limit || '20', 10), 1), 100);
    // mysql2 的 prepare/execute 对 LIMIT/OFFSET 的占位符类型挑剔，
    // 直接将已校验的整数内联进 SQL（安全：已 parseInt + clamp 过）
    const [rows] = await query(
      `SELECT * FROM player ORDER BY id ASC LIMIT ${limit} OFFSET ${skip}`
    );
    res.json({
      code: 0,
      message: '',
      data: rows.map(toPlayerDTO)
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/players/pool?difficulty=trivial|easy|hard|hell
 * 根据难度返回选手池（用于猜一猜游戏，避免前端全量加载）
 *   trivial：选手现役队伍在世界排名前30的战队中
 *   easy：current_team 在 team_ranking 表中的选手（世界排名前60）
 *   hard：有现役队伍的选手（含无排名战队）
 *   hell：所有选手（含自由人、退役选手等）
 */
router.get('/pool', async (req, res, next) => {
  try {
    const difficulty = req.query.difficulty || 'hell';
    let sql;
    if (difficulty === 'trivial') {
      sql = `SELECT p.* FROM player p
             WHERE p.current_team IN (
               SELECT team_name FROM (SELECT team_name FROM team_ranking ORDER BY \`rank\` ASC LIMIT 30) AS top30
             )
             ORDER BY p.id ASC`;
    } else if (difficulty === 'easy') {
      sql = `SELECT p.* FROM player p
             INNER JOIN team_ranking r ON r.team_name = p.current_team
             ORDER BY p.id ASC`;
    } else if (difficulty === 'hard') {
      sql = `SELECT * FROM player
             WHERE current_team IS NOT NULL AND current_team != ''
             ORDER BY id ASC`;
    } else {
      sql = 'SELECT * FROM player ORDER BY id ASC';
    }
    const [rows] = await query(sql);
    res.json({
      code: 0,
      message: '',
      data: rows.map(toPlayerDTO)
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/players/count
 */
router.get('/count', async (req, res, next) => {
  try {
    const [rows] = await query('SELECT COUNT(*) AS total FROM player');
    res.json({
      code: 0,
      message: '',
      data: { total: rows[0].total }
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/players/random
 */
router.get('/random', async (req, res, next) => {
  try {
    const [rows] = await query(
      'SELECT * FROM player ORDER BY RAND() LIMIT 1'
    );
    if (rows.length === 0) {
      return res.json({ code: 0, message: '', data: null });
    }
    res.json({ code: 0, message: '', data: toPlayerDTO(rows[0]) });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/players/random-by-difficulty?difficulty=trivial|easy|hard|hell
 * 根据难度随机选一个目标选手（单人模式和PK模式共用同一套难度逻辑）
 *   trivial：选手现役队伍在世界排名前30的战队中
 *   easy：选手现役队伍在 team_ranking 表中（世界排名前60）
 *   hard：有现役队伍即可（含无排名战队）
 *   hell：所有选手（含自由人/退役）
 */
router.get('/random-by-difficulty', async (req, res, next) => {
  try {
    const difficulty = req.query.difficulty || 'hell';
    let sql;
    if (difficulty === 'trivial') {
      sql = `SELECT p.* FROM player p
             WHERE p.current_team IN (
               SELECT team_name FROM (SELECT team_name FROM team_ranking ORDER BY \`rank\` ASC LIMIT 30) AS top30
             )
             ORDER BY RAND() LIMIT 1`;
    } else if (difficulty === 'easy') {
      sql = `SELECT p.* FROM player p
             INNER JOIN team_ranking r ON r.team_name = p.current_team
             ORDER BY RAND() LIMIT 1`;
    } else if (difficulty === 'hard') {
      sql = `SELECT * FROM player
             WHERE current_team IS NOT NULL AND current_team != ''
             ORDER BY RAND() LIMIT 1`;
    } else {
      sql = 'SELECT * FROM player ORDER BY RAND() LIMIT 1';
    }
    const [rows] = await query(sql);
    if (rows.length === 0) {
      return res.json({ code: 0, message: '', data: null });
    }
    res.json({ code: 0, message: '', data: toPlayerDTO(rows[0]) });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/players/search?q=&page=0&pageSize=20
 * 前缀匹配 name / real_name / game_id（与原 NoSQL 行为一致）
 */
router.get('/search', async (req, res, next) => {
  try {
    const q = (req.query.q || '').trim();
    const page = Math.max(parseInt(req.query.page || '0', 10), 0);
    const pageSize = Math.min(Math.max(parseInt(req.query.pageSize || '20', 10), 1), 100);

    if (!q) {
      return res.json({ code: 0, message: '', data: [], hasMore: false });
    }

    const like = `${q}%`;
    const offset = page * pageSize;
    const [rows] = await query(
      `SELECT * FROM player
       WHERE name LIKE ? OR real_name LIKE ? OR game_id LIKE ?
       ORDER BY id ASC LIMIT ${pageSize} OFFSET ${offset}`,
      [like, like, like]
    );

    res.json({
      code: 0,
      message: '',
      data: rows.map(toPlayerDTO),
      hasMore: rows.length === pageSize
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/players/:playerId
 * 按业务 ID（game_id）查选手
 */
router.get('/:playerId', async (req, res, next) => {
  try {
    const { playerId } = req.params;
    const [rows] = await query(
      'SELECT * FROM player WHERE game_id = ? LIMIT 1',
      [playerId]
    );
    if (rows.length === 0) {
      return res.status(404).json({ code: 404, message: '选手不存在', data: null });
    }
    res.json({ code: 0, message: '', data: toPlayerDTO(rows[0]) });
  } catch (err) {
    next(err);
  }
});

// ============ Admin CRUD ============

/**
 * POST /api/players
 * Body: { game_id, name, real_name, country, country_code, age, current_team,
 *        former_teams, region, major_appearances, position, rating, avatar }
 */
router.post('/', async (req, res, next) => {
  try {
    const p = req.body || {};
    if (!p.game_id || !p.real_name) {
      return res.status(400).json({ code: 400, message: 'game_id / real_name 必填', data: null });
    }
    const [result] = await query(
      `INSERT INTO player
       (game_id, name, real_name, age, country, country_code, current_team,
        former_teams, region, major_appearances, position, rating, avatar)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        p.game_id,
        p.name || '',
        p.real_name,
        parseInt(p.age || 0, 10),
        p.country || '',
        p.country_code || '',
        p.current_team || '',
        JSON.stringify(p.formerTeams || p.former_teams || []),
        p.region || 'Other',
        parseInt(p.majorAppearances || p.major_appearances || 0, 10),
        p.position || '',
        parseFloat(p.rating || 0),
        p.avatar || ''
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
 * PUT /api/players/:playerId
 */
router.put('/:playerId', async (req, res, next) => {
  try {
    const { playerId } = req.params;
    const p = req.body || {};

    const fields = [];
    const values = [];
    const map = {
      name: p.name,
      real_name: p.real_name,
      age: p.age !== undefined ? parseInt(p.age, 10) : undefined,
      country: p.country,
      country_code: p.country_code,
      current_team: p.current_team,
      former_teams: p.formerTeams || p.former_teams
        ? JSON.stringify(p.formerTeams || p.former_teams)
        : undefined,
      region: p.region,
      major_appearances:
        p.majorAppearances !== undefined
          ? parseInt(p.majorAppearances, 10)
          : p.major_appearances !== undefined
          ? parseInt(p.major_appearances, 10)
          : undefined,
      position: p.position,
      rating: p.rating !== undefined ? parseFloat(p.rating) : undefined,
      avatar: p.avatar
    };
    for (const [col, val] of Object.entries(map)) {
      if (val !== undefined) {
        fields.push(`${col} = ?`);
        values.push(val);
      }
    }
    if (fields.length === 0) {
      return res.json({ code: 0, message: '无变更', data: null });
    }
    values.push(playerId);
    const [result] = await query(
      `UPDATE player SET ${fields.join(', ')} WHERE game_id = ?`,
      values
    );
    res.json({ code: 0, message: '更新成功', data: { affected: result.affectedRows } });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/players/:playerId
 */
router.delete('/:playerId', async (req, res, next) => {
  try {
    const { playerId } = req.params;
    const [result] = await query('DELETE FROM player WHERE game_id = ?', [playerId]);
    res.json({ code: 0, message: '删除成功', data: { affected: result.affectedRows } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;