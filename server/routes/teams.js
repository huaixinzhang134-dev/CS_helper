// 战队相关路由
const express = require('express');
const router = express.Router();

const { query } = require('../db/pool');

/**
 * GET /api/teams/ranked
 * 返回 team_ranking 表中所有队伍的名称列表（前 60 名）
 * 用于猜选手游戏的"简单"模式筛选
 */
router.get('/ranked', async (req, res, next) => {
  try {
    const [rows] = await query(
      'SELECT team_name FROM team_ranking ORDER BY `rank` ASC'
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

module.exports = router;
