// 战队相关路由
const express = require('express');
const router = express.Router();

const { query } = require('../db/pool');

/** 将队标 URL 包装为 /api/logo 代理（小程序不支持 SVG，转换为 PNG） */
function logoToPng(url, baseUrl) {
  if (!url) return '';
  return `${baseUrl}/api/logo?url=${encodeURIComponent(url)}`;
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
              MAX(t.logo_url) AS team_logo_url
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
      data: rows.map(r => ({
        teamName: r.team_name,
        ranking: r.ranking,
        points: r.points,
        logoUrl: logoToPng(r.team_logo_url || r.logo_url || '', baseUrl),
        region: r.region || 'Other'
      })),
      hasMore: offset + pageSize < total,
      total
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
