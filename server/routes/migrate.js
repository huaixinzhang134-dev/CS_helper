/**
 * 临时迁移端点（部署后调用一次，之后可删除此文件及 server/index.js 中的引用）
 * POST /api/migrate
 */
const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { query } = require('../db/pool');

router.post('/', async (req, res) => {
  try {
    const sqlPath = path.join(__dirname, '..', 'migrations', '004_coins_voting.sql');
    if (!fs.existsSync(sqlPath)) {
      return res.status(404).json({ code: 404, message: '迁移文件不存在', data: null });
    }

    const sql = fs.readFileSync(sqlPath, 'utf-8');
    const statements = sql
      .split('\n')
      .filter(line => !line.trim().startsWith('--'))
      .join('\n')
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0);

    let success = 0, fail = 0;
    for (const stmt of statements) {
      try {
        await query(stmt);
        success++;
      } catch (err) {
        if ([1050, 1060, 1061, 1091].includes(err.errno)) {
          success++; // 幂等跳过算成功
        } else {
          fail++;
          console.error('[migrate error]', err.message.substring(0, 120));
        }
      }
    }

    res.json({ code: 0, message: `迁移完成: 成功=${success} 失败=${fail}`, data: { success, fail } });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message, data: null });
  }
});

module.exports = router;
