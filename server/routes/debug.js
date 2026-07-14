/**
 * 临时调试端点 —— 查询数据库表结构（用完即删）
 * GET /api/debug/tables
 */
const express = require('express');
const router = express.Router();
const { query } = require('../db/pool');

router.get('/tables', async (req, res) => {
  try {
    const [tables] = await query("SELECT TABLE_NAME, TABLE_COMMENT, TABLE_ROWS FROM information_schema.TABLES WHERE TABLE_SCHEMA = (SELECT DATABASE()) ORDER BY TABLE_NAME");
    const result = [];
    for (const t of tables) {
      const [cols] = await query(`SHOW COLUMNS FROM \`${t.TABLE_NAME}\``);
      result.push({
        name: t.TABLE_NAME,
        comment: t.TABLE_COMMENT || '',
        rows: t.TABLE_ROWS,
        columns: cols.map(c => ({ field: c.Field, type: c.Type, key: c.Key, extra: c.Extra })),
      });
    }
    res.json({ code: 0, data: result });
  } catch (err) {
    res.json({ code: 500, message: err.message });
  }
});

// 清理未使用的旧表建议
router.get('/suggest-cleanup', async (req, res) => {
  try {
    const [tables] = await query("SELECT TABLE_NAME, TABLE_COMMENT FROM information_schema.TABLES WHERE TABLE_SCHEMA = (SELECT DATABASE()) ORDER BY TABLE_NAME");
    const allTables = tables.map(t => t.TABLE_NAME);

    // 定义当前功能正在使用的表
    const activeTables = new Set([
      'player', 'team', 'team_member', 'matches', 'player_comments',
      'team_ranking', 'users', 'match_players',
      'coin_transactions', 'shop_items', 'user_items',
      'player_vote_slots', 'vote_slot_config', 'vote_winners', 'vote_awards',
      'admin_users',
    ]);

    const unused = allTables.filter(t => !activeTables.has(t));
    res.json({
      code: 0,
      data: {
        activeTables: [...activeTables].filter(t => allTables.includes(t)),
        possibleUnused: unused,
        note: 'guess_records 表已废弃（改用 users.guess_records JSON 列）；player_vote_records/player_vote_items 已由 player_vote_slots 替代',
      }
    });
  } catch (err) {
    res.json({ code: 500, message: err.message });
  }
});

module.exports = router;
