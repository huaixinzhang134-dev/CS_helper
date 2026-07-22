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
    status: row.status || 'unknown',
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
 *   trivial：status IN ('active','coach') 且队伍在 top30
 *   easy：   major_appearances >= 5（不限职业状态）
 *   hard：   status IN ('active','coach','free_agent')（排除退役）
 *   hell：   所有选手（无 status 限制）
 */
router.get('/pool', async (req, res, next) => {
  try {
    const difficulty = req.query.difficulty || 'challenge';
    let sql;
    if (difficulty === 'trivial') {
      sql = `SELECT DISTINCT p.* FROM player p
             INNER JOIN team_ranking r ON r.team_name = p.current_team
             WHERE p.status = 'active'
               AND p.position != 'coach'
               AND r.ranking <= 10
             ORDER BY p.id ASC`;
    } else if (difficulty === 'easy') {
      sql = `SELECT * FROM player
             WHERE major_appearances > 5
               AND current_team != ''
               AND status = 'active'
               AND position != 'coach'
             ORDER BY id ASC`;
    } else if (difficulty === 'normal') {
      sql = `SELECT DISTINCT p.* FROM player p
             INNER JOIN team_ranking r ON r.team_name = p.current_team
             WHERE p.status = 'active'
               AND p.position != 'coach'
               AND r.ranking <= 30
             ORDER BY p.id ASC`;
    } else if (difficulty === 'hard') {
      sql = `SELECT * FROM player
             WHERE major_appearances > 5
             ORDER BY id ASC`;
    } else if (difficulty === 'hell') {
      sql = `SELECT * FROM player
             WHERE major_appearances > 0
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
 * GET /api/players/ranking?page=0&pageSize=20
 * 选手排行：按 rating 从高到低，排除 rating=0 的选手
 */
router.get('/ranking', async (req, res, next) => {
  try {
    const page = Math.max(parseInt(req.query.page || '0', 10), 0);
    const pageSize = Math.min(Math.max(parseInt(req.query.pageSize || '20', 10), 1), 100);
    const offset = page * pageSize;

    const [countRows] = await query('SELECT COUNT(*) AS total FROM player WHERE rating > 0');
    const total = countRows[0].total;

    const [rows] = await query(
      `SELECT * FROM player WHERE rating > 0 ORDER BY rating DESC LIMIT ${pageSize} OFFSET ${offset}`
    );

    res.json({
      code: 0,
      message: '',
      data: rows.map(toPlayerDTO),
      hasMore: offset + pageSize < total,
      total
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
 *   trivial：status IN ('active','coach') 且队伍在 top30
 *   easy：   major_appearances >= 5（不限职业状态）
 *   hard：   status IN ('active','coach','free_agent')（排除退役）
 *   hell：   所有选手（含退役）
 */
router.get('/random-by-difficulty', async (req, res, next) => {
  try {
    const difficulty = req.query.difficulty || 'challenge';
    let sql;
    if (difficulty === 'trivial') {
      sql = `SELECT DISTINCT p.* FROM player p
             INNER JOIN team_ranking r ON r.team_name = p.current_team
             WHERE p.status = 'active'
               AND p.position != 'coach'
               AND r.ranking <= 10
             ORDER BY RAND() LIMIT 1`;
    } else if (difficulty === 'easy') {
      sql = `SELECT * FROM player
             WHERE major_appearances > 5
               AND current_team != ''
               AND status = 'active'
               AND position != 'coach'
             ORDER BY RAND() LIMIT 1`;
    } else if (difficulty === 'normal') {
      sql = `SELECT DISTINCT p.* FROM player p
             INNER JOIN team_ranking r ON r.team_name = p.current_team
             WHERE p.status = 'active'
               AND p.position != 'coach'
               AND r.ranking <= 30
             ORDER BY RAND() LIMIT 1`;
    } else if (difficulty === 'hard') {
      sql = `SELECT * FROM player
             WHERE major_appearances > 5
             ORDER BY RAND() LIMIT 1`;
    } else if (difficulty === 'hell') {
      sql = `SELECT * FROM player
             WHERE major_appearances > 0
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
 * GET /api/players/search?q=&page=0&pageSize=20&difficulty=trivial
 * 前缀匹配 name / real_name / game_id
 *
 * 高级搜索参数（可选，与 q 可同时使用）：
 *   name       — 游戏 ID 精确匹配
 *   ageMin     — 最小年龄
 *   ageMax     — 最大年龄
 *   country    — 国家（模糊匹配）
 *   team       — 所属战队（模糊匹配）
 *   formerTeam — 历史战队（搜索 former_teams JSON 数组）
 *   difficulty — 可选，限定搜索范围到当前难度选手池
 *   当 q 和高级参数都未提供时返回空数组
 */
router.get('/search', async (req, res, next) => {
  try {
    const q = (req.query.q || '').trim();
    const name = (req.query.name || '').trim();
    const ageMin = req.query.ageMin;
    const ageMax = req.query.ageMax;
    const country = (req.query.country || '').trim();
    const team = (req.query.team || '').trim();
    const formerTeam = (req.query.formerTeam || '').trim();
    const difficulty = (req.query.difficulty || '').trim();

    const page = Math.max(parseInt(req.query.page || '0', 10), 0);
    const pageSize = Math.min(Math.max(parseInt(req.query.pageSize || '20', 10), 1), 100);

    const hasAnyFilter = q || name || ageMin !== undefined || ageMax !== undefined || country || team || formerTeam;
    if (!hasAnyFilter) {
      return res.json({ code: 0, message: '', data: [], hasMore: false });
    }

    // 动态构建 WHERE
    const conditions = [];
    const params = [];
    let fromClause = 'player';
    let joinClause = '';

    if (q) {
      const like = `${q}%`;
      conditions.push('(name LIKE ? OR real_name LIKE ? OR game_id LIKE ?)');
      params.push(like, like, like);
    }
    if (name) {
      // 模糊匹配游戏 ID（name 字段实际存的是游戏昵称）
      conditions.push('name LIKE ?');
      params.push(`%${name}%`);
    }
    if (ageMin !== undefined) {
      conditions.push('age >= ?');
      params.push(parseInt(ageMin, 10));
    }
    if (ageMax !== undefined) {
      conditions.push('age <= ?');
      params.push(parseInt(ageMax, 10));
    }
    if (country) {
      // 中英文国家名双向映射：数据库部分存中文（如"中国"）部分存英文（如"Korea"），
      // 确保用户无论输中文还是英文都能搜到对应记录
      const countryMap = {
        '中国': 'China', '乌克兰': 'Ukraine', '俄罗斯': 'Russia',
        '丹麦': 'Denmark', '法国': 'France', '瑞典': 'Sweden',
        '芬兰': 'Finland', '挪威': 'Norway', '波兰': 'Poland',
        '巴西': 'Brazil', '美国': 'United States', '加拿大': 'Canada',
        '澳大利亚': 'Australia', '德国': 'Germany', '英国': 'United Kingdom',
        '爱沙尼亚': 'Estonia', '拉脱维亚': 'Latvia', '立陶宛': 'Lithuania',
        '斯洛伐克': 'Slovakia', '匈牙利': 'Hungary', '以色列': 'Israel',
        '波黑': 'Bosnia', '罗马尼亚': 'Romania', '土耳其': 'Turkey',
        '保加利亚': 'Bulgaria', '塞尔维亚': 'Serbia', '南非': 'South Africa',
        '阿根廷': 'Argentina', '哈萨克斯坦': 'Kazakhstan', '新西兰': 'New Zealand',
        '韩国': 'Korea', '日本': 'Japan', '蒙古': 'Mongolia',
        '荷兰': 'Netherlands', '西班牙': 'Spain', '葡萄牙': 'Portugal',
        '比利时': 'Belgium', '瑞士': 'Switzerland', '爱尔兰': 'Ireland',
        '希腊': 'Greece', '奥地利': 'Austria', '捷克': 'Czechia',
        '克罗地亚': 'Croatia', '新加坡': 'Singapore', '马来西亚': 'Malaysia',
        '冰岛': 'Iceland', '墨西哥': 'Mexico', '哥伦比亚': 'Colombia'
      };
      const searchValues = [country];
      // 正向查找：中文→英文
      if (countryMap[country]) {
        searchValues.push(countryMap[country]);
      }
      // 反向查找：英文→中文
      for (const [cn, en] of Object.entries(countryMap)) {
        if (en.toLowerCase() === country.toLowerCase() && !searchValues.includes(cn)) {
          searchValues.push(cn);
        }
      }
      const countryClauses = searchValues.map(() => 'country LIKE ?');
      conditions.push(`(${countryClauses.join(' OR ')})`);
      searchValues.forEach(v => params.push(`%${v}%`));
    }
    if (team) {
      conditions.push('current_team LIKE ?');
      params.push(`%${team}%`);
    }
    if (formerTeam) {
      conditions.push('former_teams IS NOT NULL AND JSON_SEARCH(former_teams, \'one\', ?) IS NOT NULL');
      params.push(formerTeam);
    }

    // 可选：限定搜索到当前难度选手池
    if (difficulty === 'trivial') {
      fromClause = 'player p';
      joinClause = 'INNER JOIN team_ranking r ON r.team_name = p.current_team';
      conditions.push("p.status = 'active'", "p.position != 'coach'", 'r.ranking <= 10');
    } else if (difficulty === 'easy') {
      conditions.push("status = 'active'", "position != 'coach'", 'major_appearances > 5', "current_team != ''");
    } else if (difficulty === 'normal') {
      fromClause = 'player p';
      joinClause = 'INNER JOIN team_ranking r ON r.team_name = p.current_team';
      conditions.push("p.status = 'active'", "p.position != 'coach'", 'r.ranking <= 30');
    } else if (difficulty === 'hard') {
      conditions.push('major_appearances > 5');
    } else if (difficulty === 'hell') {
      conditions.push('major_appearances > 0');
    }
    // challenge 和未知难度不附加过滤

    const whereClause = conditions.join(' AND ');
    const fromWithJoin = joinClause ? `${fromClause} ${joinClause}` : fromClause;
    const offset = page * pageSize;

    // 先查总数
    const [countRows] = await query(
      `SELECT COUNT(*) AS total FROM ${fromWithJoin} WHERE ${whereClause}`,
      params
    );
    const total = countRows[0].total;

    // 再查分页
    const selectCols = fromClause === 'player p' ? 'p.*' : '*';
    const [rows] = await query(
      `SELECT ${selectCols} FROM ${fromWithJoin} WHERE ${whereClause} ORDER BY id ASC LIMIT ${pageSize} OFFSET ${offset}`,
      params
    );

    res.json({
      code: 0,
      message: '',
      data: rows.map(toPlayerDTO),
      hasMore: offset + pageSize < total,
      total    // 返回总数，前端可展示"共 N 个结果"
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
 *        former_teams, region, major_appearances, position, status, rating, avatar }
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
        former_teams, region, major_appearances, position, status, rating, avatar)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        p.status || 'unknown',
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
      status: p.status,
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