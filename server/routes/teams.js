// 战队相关路由
const express = require('express');
const router = express.Router();

const { query } = require('../db/pool');

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
              (SELECT COUNT(*) FROM team_member WHERE team_id = t.id AND is_current = 1) AS current_members
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
              (SELECT COUNT(*) FROM team_member WHERE team_id = t.id AND is_current = 1) AS current_members
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

module.exports = router;
