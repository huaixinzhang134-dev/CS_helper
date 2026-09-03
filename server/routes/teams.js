// 战队相关路由
const express = require('express');
const router = express.Router();

const { query, pool } = require('../db/pool');

/** 多表同步事务包裹：fn(conn) 内用 conn.execute(sql, params)，全部成功才提交 */
async function withTransaction(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/** former_teams 追加队名（去重），兼容字符串/数组两种形态；比较忽略大小写（对齐 MySQL CI collation） */
function appendFormerTeam(currentValue, teamName) {
  let arr = [];
  if (typeof currentValue === 'string') {
    try { arr = JSON.parse(currentValue) || []; } catch (_) { arr = []; }
  } else if (Array.isArray(currentValue)) {
    arr = currentValue;
  }
  if (arr.some(t => String(t).toLowerCase() === String(teamName).toLowerCase())) return arr;
  return [...arr, teamName];
}

/** 将队标 URL 包装为 /api/logo 代理（小程序不支持 SVG，转换为 PNG） */
function logoToPng(url, baseUrl) {
  if (!url) return '';
  return `${baseUrl}/api/logo?url=${encodeURIComponent(url)}`;
}

/** 后台列表/单条查询共用的战队 DTO */
function toTeamAdminDTO(r) {
  return {
    id: r.id,
    name: r.name,
    logoUrl: r.logo_url || '',
    logo5eplayUrl: r.logo_5eplay || '',
    region: r.region || 'Other',
    regionPlayerCount: r.region_player_count || 0,
    memberCount: r.current_members || 0,
  };
}

/**
 * GET /api/teams/ranked
 * 返回 team_ranking 表中所有队伍的名称列表
 */
router.get('/ranked', async (req, res, next) => {
  try {
    const [rows] = await query(
      'SELECT team_name FROM team_ranking ORDER BY ranking ASC'
    );
    const teamNames = rows.map(r => r.team_name).filter(Boolean);
    res.json({
      code: 0,
      message: '',
      data: teamNames
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/teams/ranking?region=all&page=0&pageSize=20
 * 队伍排行：从 team_ranking JOIN team 获取 region
 * region 可选：all / Europe / Asia / Americas
 */
router.get('/ranking', async (req, res, next) => {
  try {
    const baseUrl = req.protocol + '://' + req.get('host');
    const region = (req.query.region || 'all').trim();
    const page = Math.max(parseInt(req.query.page || '0', 10), 0);
    const pageSize = Math.min(Math.max(parseInt(req.query.pageSize || '20', 10), 1), 100);
    const offset = page * pageSize;

    let whereSql = '';
    const params = [];
    if (region && region !== 'all') {
      whereSql = 'WHERE t.region = ?';
      params.push(region);
    }

    const [countRows] = await query(
      `SELECT COUNT(DISTINCT r.team_name) AS total
       FROM team_ranking r
       LEFT JOIN team t ON t.name = r.team_name
       ${whereSql}`,
      params
    );
    const total = countRows[0].total;

    const [rows] = await query(
      `SELECT r.team_name,
              MAX(r.points) AS points,
              MAX(r.logo_url) AS logo_url,
              MIN(r.ranking) AS ranking,
              MAX(t.region) AS region,
              MAX(t.logo_url) AS team_logo_url,
              MAX(t.logo_5eplay) AS team_logo_5eplay
       FROM team_ranking r
       LEFT JOIN team t ON t.name = r.team_name
       ${whereSql}
       GROUP BY r.team_name
       ORDER BY ranking ASC
       LIMIT ${pageSize} OFFSET ${offset}`,
      params
    );

    res.json({
      code: 0,
      message: '',
      data: rows.map(r => {
        // 优先级：team 表 HLTV 队标 > team 表 5eplay 队标 > team_ranking 表自带 logo
        const hltv = r.team_logo_url;
        const eplay = r.team_logo_5eplay || r.logo_url;
        return {
          teamName: r.team_name,
          ranking: r.ranking,
          points: r.points,
          logoUrl: logoToPng(hltv || eplay || '', baseUrl),
          logoFallback: hltv ? logoToPng(eplay || '', baseUrl) : '',
          region: r.region || 'Other'
        };
      }),
      hasMore: offset + pageSize < total,
      total
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// Admin: 战队管理
// ============================================================

/**
 * GET /api/teams/admin/list?page=0&pageSize=20&q=
 */
router.get('/admin/list', async (req, res, next) => {
  try {
    const page = Math.max(parseInt(req.query.page || '0', 10), 0);
    const pageSize = Math.min(Math.max(parseInt(req.query.pageSize || '20', 10), 1), 100);
    const offset = page * pageSize;
    const q = (req.query.q || '').trim();

    let whereSql = '';
    const params = [];
    if (q) {
      // 列表搜索仅按队名模糊匹配；按 id 定位队伍请用 GET /admin/:teamId
      whereSql = 'WHERE name LIKE ?';
      params.push(`%${q}%`);
    }

    const [countRows] = await query(
      `SELECT COUNT(*) AS total FROM team ${whereSql}`, params
    );
    const total = countRows[0].total;

    const [rows] = await query(
      `SELECT t.*,
              (SELECT COUNT(*) FROM player WHERE current_team = t.name) AS current_members
       FROM team t ${whereSql}
       ORDER BY t.id ASC LIMIT ${pageSize} OFFSET ${offset}`,
      params
    );

    res.json({
      code: 0, message: '',
      data: {
        list: rows.map(toTeamAdminDTO),
        total,
        page,
        pageSize,
        hasMore: offset + pageSize < total,
      }
    });
  } catch (err) { next(err); }
});

/**
 * GET /api/teams/admin/:teamId
 * 按 id 取单条战队（编辑弹窗定位用）。
 * 注意：必须注册在 GET /admin/list 之后，避免吞掉 /admin/list；
 * 且不能通过 /admin/list?q= 搜索定位——数字队名会命中 name LIKE 把目标挤掉。
 */
router.get('/admin/:teamId', async (req, res, next) => {
  try {
    const [rows] = await query(
      `SELECT t.*,
              (SELECT COUNT(*) FROM player WHERE current_team = t.name) AS current_members
       FROM team t WHERE t.id = ? LIMIT 1`,
      [req.params.teamId]
    );
    if (rows.length === 0) {
      return res.status(404).json({ code: 404, message: '战队不存在', data: null });
    }
    res.json({ code: 0, message: '', data: toTeamAdminDTO(rows[0]) });
  } catch (err) { next(err); }
});

/**
 * PUT /api/teams/admin/:teamId
 * Body: { name?, region?, logoUrl?, logo5eplayUrl? }
 */
router.put('/admin/:teamId', async (req, res, next) => {
  try {
    const teamId = req.params.teamId;
    const allowedFields = ['name', 'region', 'logoUrl', 'logo5eplayUrl'];
    const colMap = { logoUrl: 'logo_url', logo5eplayUrl: 'logo_5eplay' };
    const updates = [];
    const params = [];

    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        const col = colMap[field] || field;
        updates.push(`${col} = ?`);
        params.push(req.body[field]);
      }
    }

    if (updates.length === 0) {
      return res.status(400).json({ code: 400, message: '没有需要更新的字段' });
    }

    params.push(teamId);
    const [result] = await query(
      `UPDATE team SET ${updates.join(', ')} WHERE id = ?`,
      params
    );

    if (result.affectedRows === 0) {
      // affectedRows=0 可能是"值没变化"而非"队伍不存在"，查一下区分
      const [exists] = await query('SELECT id FROM team WHERE id = ?', [teamId]);
      if (exists.length === 0) {
        return res.status(404).json({ code: 404, message: '战队不存在' });
      }
    }

    res.json({ code: 0, message: '更新成功' });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// 战队成员管理
// ⚠️ 事实源 = player.current_team（选手表），team_member 只是派生缓存：
//    team_member 由 scripts/sync_team_member.py TRUNCATE 全量重建，
//    队伍/选手数据变动后未重跑即过期（曾出现 team_member 只有 1 条而
//    player.current_team='Falcons' 有 6 条），故展示/计数一律查 player。
// 规则：
//   - 添加：current_team 切到本队；从其他队转来则原队进 former_teams；
//     非 coach 的 free_agent/unknown 选手恢复 active；同步 upsert
//     team_member 缓存行(is_current=1)并把别队缓存行置 0
//   - 移除：仅当选手 current_team == 本队名（不在本队列表则 404）；
//     清空 current_team、本队进 former_teams、active(非 coach) 改
//     free_agent；缓存行置 is_current=0
//   - game_id 是选手业务主键；:teamId 是 team 表自增 id
// ============================================================

/** 查某队当前成员（player.current_team = 队名），返回 DTO 数组（复用 conn 或全局池） */
const MEMBERS_SQL = `
  SELECT p.id AS player_id, p.name AS player_name, p.game_id, p.real_name, p.position, p.status, p.rating
  FROM player p
  WHERE p.current_team = ?
  ORDER BY p.id ASC`;

function membersToDTO(rows) {
  return rows.map(r => ({
    playerId: r.game_id,           // game_id，前端操作主键
    playerName: r.player_name,
    realName: r.real_name,
    position: r.position || '',
    status: r.status || 'unknown',
    rating: Number(r.rating) || 0,
  }));
}

/**
 * GET /api/teams/admin/:teamId/members
 * 当前成员列表（player.current_team = 队名）
 */
router.get('/admin/:teamId/members', async (req, res, next) => {
  try {
    const [teams] = await query('SELECT id, name FROM team WHERE id = ? LIMIT 1', [req.params.teamId]);
    if (teams.length === 0) {
      return res.status(404).json({ code: 404, message: '战队不存在', data: null });
    }
    const [rows] = await query(MEMBERS_SQL, [teams[0].name]);
    res.json({ code: 0, message: '', data: membersToDTO(rows) });
  } catch (err) { next(err); }
});

/**
 * POST /api/teams/admin/:teamId/members
 * Body: { playerId: game_id }  — 添加选手为当前成员
 * 事务内双同步（见文件头注释）
 */
router.post('/admin/:teamId/members', async (req, res, next) => {
  try {
    const teamId = parseInt(req.params.teamId, 10);
    const gameId = (req.body.playerId || '').toString().trim();
    if (!teamId || !gameId) {
      return res.status(400).json({ code: 400, message: '参数错误' });
    }

    const { list, message } = await withTransaction(async conn => {
      // 1. 校验队伍
      const [teams] = await conn.execute('SELECT id, name FROM team WHERE id = ? LIMIT 1', [teamId]);
      if (teams.length === 0) throw Object.assign(new Error('战队不存在'), { status: 404 });
      const teamName = teams[0].name;

      // 2. 校验选手（按 game_id）
      const [players] = await conn.execute(
        'SELECT id, name, current_team, former_teams, status, position FROM player WHERE game_id = ? LIMIT 1',
        [gameId]
      );
      if (players.length === 0) throw Object.assign(new Error('选手不存在'), { status: 404 });
      const pl = players[0];

      // 3. 该选手在别队的现役关联全部置 0（一人一队）
      await conn.execute(
        'UPDATE team_member SET is_current = 0 WHERE player_id = ? AND is_current = 1 AND team_id != ?',
        [pl.id, teamId]
      );

      // 4. 本队关联 UPSERT 为现役
      await conn.execute(
        `INSERT INTO team_member (team_id, team_name, player_id, player_name, is_current)
         VALUES (?, ?, ?, ?, 1)
         ON DUPLICATE KEY UPDATE team_name = ?, player_name = ?, is_current = 1`,
        [teamId, teamName, pl.id, pl.name, teamName, pl.name]
      );

      // 5. 联动 player：current_team 切到本队；只有"从其他队转来"才把原队写进
      //    former_teams（自由身加入时本队不属于历史队伍，不写入）
      let formerArr = [];
      if (typeof pl.former_teams === 'string') {
        try { formerArr = JSON.parse(pl.former_teams) || []; } catch (_) { formerArr = []; }
      } else if (Array.isArray(pl.former_teams)) {
        formerArr = pl.former_teams;
      }
      let msg = '已加入';
      if (pl.current_team && pl.current_team.toLowerCase() !== teamName.toLowerCase()) {
        formerArr = appendFormerTeam(formerArr, pl.current_team);
        msg = `已从 ${pl.current_team} 转入`;
      }
      // 6. 非 coach 的 free_agent/unknown 选手恢复 active
      const newStatus = (pl.position !== 'coach' && (pl.status === 'free_agent' || pl.status === 'unknown'))
        ? 'active'
        : pl.status;
      await conn.execute(
        'UPDATE player SET current_team = ?, former_teams = ?, status = ? WHERE id = ?',
        [teamName, JSON.stringify(formerArr), newStatus, pl.id]
      );

      // 7. 返回更新后的成员列表（事实源 = current_team，无需 team_member）
      const [rows] = await conn.execute(MEMBERS_SQL, [teamName]);
      return { list: membersToDTO(rows), message: msg };
    });

    // data 内也带 message（前端 API helper 只回传 data）
    res.json({ code: 0, message, data: { list, message } });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ code: err.status, message: err.message, data: null });
    next(err);
  }
});

/**
 * DELETE /api/teams/admin/:teamId/members/:playerId  (playerId = game_id)
 * 移除当前成员（见文件头注释的联动规则）
 */
router.delete('/admin/:teamId/members/:playerId', async (req, res, next) => {
  try {
    const teamId = parseInt(req.params.teamId, 10);
    const gameId = req.params.playerId;
    if (!teamId || !gameId) {
      return res.status(400).json({ code: 400, message: '参数错误' });
    }

    const { list, message } = await withTransaction(async conn => {
      const [teams] = await conn.execute('SELECT id, name FROM team WHERE id = ? LIMIT 1', [teamId]);
      if (teams.length === 0) throw Object.assign(new Error('战队不存在'), { status: 404 });
      const teamName = teams[0].name;

      const [players] = await conn.execute(
        'SELECT id, name, current_team, former_teams, status, position FROM player WHERE game_id = ? LIMIT 1',
        [gameId]
      );
      if (players.length === 0) throw Object.assign(new Error('选手不存在'), { status: 404 });
      const pl = players[0];

      // 事实源校验：只有 current_team == 本队名（忽略大小写）的选手才在本队成员列表
      if (!pl.current_team || pl.current_team.toLowerCase() !== teamName.toLowerCase()) {
        throw Object.assign(new Error(`选手当前不属于本队（所属：${pl.current_team || '无'}）`), { status: 404 });
      }

      // 1. 缓存关联置 0（历史 team_member 可能没有该行，空操作无害）
      await conn.execute(
        'UPDATE team_member SET is_current = 0 WHERE team_id = ? AND player_id = ? AND is_current = 1',
        [teamId, pl.id]
      );

      // 2. 正统离队：清空所属、本队进历史、active(非 coach) 改 free_agent
      const formerArr = appendFormerTeam(pl.former_teams, teamName);
      const newStatus = (pl.position !== 'coach' && pl.status === 'active') ? 'free_agent' : pl.status;
      await conn.execute(
        'UPDATE player SET current_team = ?, former_teams = ?, status = ? WHERE id = ?',
        ['', JSON.stringify(formerArr), newStatus, pl.id]
      );

      const [rows] = await conn.execute(MEMBERS_SQL, [teamName]);
      return { list: membersToDTO(rows), message: '已移除' };
    });

    // data 内也带 message（前端 API helper 只回传 data）
    res.json({ code: 0, message, data: { list, message } });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ code: err.status, message: err.message, data: null });
    next(err);
  }
});

module.exports = router;
