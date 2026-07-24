/**
 * 用户路由 —— 微信登录、个人信息、竞猜记录、排行榜
 *
 * POST   /api/users/login              微信登录 (code → openid)
 * GET    /api/users/profile             获取个人信息（需 Bearer token）
 * PUT    /api/users/profile             更新昵称/头像（需 Bearer token）
 * POST   /api/users/guess/record        记录猜一猜结果（需 Bearer token）
 * GET    /api/users/guess/records       获取竞猜记录列表（需 Bearer token）
 * GET    /api/users/ranking?mode=pk     获取排行榜（需 Bearer token）
 * GET    /api/users/migrate             迁移：添加 PK/Solo 分离列（管理员）
 */
const express = require('express');
const router = express.Router();
const { query, getPool } = require('../db');

// 用户 DTO 映射
function toUserDTO(row) {
  const dto = {
    openid: row.openid,
    nickname: row.nickname,
    avatarUrl: row.avatar_url,
    winCount: row.win_count,
    totalGames: row.total_games,
    winRate: parseFloat(row.win_rate),
    guessRecords: row.guess_records ? (typeof row.guess_records === 'string' ? JSON.parse(row.guess_records) : row.guess_records) : [],
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
  // 兼容迁移后的分模式统计列
  if (row.pk_win_count !== undefined) {
    dto.pkWinCount = row.pk_win_count;
    dto.pkTotalGames = row.pk_total_games;
    dto.pkWinRate = parseFloat(row.pk_win_rate || '0');
    dto.soloWinCount = row.solo_win_count;
    dto.soloTotalGames = row.solo_total_games;
    dto.soloWinRate = parseFloat(row.solo_win_rate || '0');
  }
  // 代币数据
  if (row.coins !== undefined) {
    dto.coins = row.coins;
    dto.totalCoinsEarned = row.total_coins_earned;
  }
  return dto;
}

// ============================================================
// GET /api/users/migrate
// 迁移：添加 PK/Solo 分离的统计列（管理员操作）
// ============================================================
router.get('/migrate', async (req, res, next) => {
  try {
    const [cols] = await query("SHOW COLUMNS FROM users LIKE 'pk_win_count'");
    if (cols.length === 0) {
      await query(`ALTER TABLE users
        ADD COLUMN pk_win_count     INT UNSIGNED NOT NULL DEFAULT 0 AFTER win_rate,
        ADD COLUMN pk_total_games   INT UNSIGNED NOT NULL DEFAULT 0 AFTER pk_win_count,
        ADD COLUMN pk_win_rate      DECIMAL(5,2) NOT NULL DEFAULT 0.00 AFTER pk_total_games,
        ADD COLUMN solo_win_count   INT UNSIGNED NOT NULL DEFAULT 0 AFTER pk_win_rate,
        ADD COLUMN solo_total_games INT UNSIGNED NOT NULL DEFAULT 0 AFTER solo_win_count,
        ADD COLUMN solo_win_rate    DECIMAL(5,2) NOT NULL DEFAULT 0.00 AFTER solo_total_games`);
    }
    res.json({ code: 0, message: '迁移完成' });
  } catch (err) { next(err); }
});

// ============================================================
// POST /api/users/login
// 微信登录 — code → openid 登录/注册
// ============================================================
router.post('/login', async (req, res, next) => {
  try {
    const { code, nickname, avatarUrl } = req.body;
    if (!code) return res.status(400).json({ code: 1, message: '缺少 code' });

    // 通过 wxapp 模块获取 openid
    const { getWxOpenid } = require('../wxapp');
    const openid = await getWxOpenid(code);
    if (!openid) return res.status(400).json({ code: 1, message: '登录失败' });

    // 查找或创建用户
    let [users] = await query('SELECT * FROM users WHERE openid = ?', [openid]);
    if (users.length === 0) {
      await query('INSERT INTO users (openid, nickname, avatar_url) VALUES (?, ?, ?)',
        [openid, nickname || '微信用户', avatarUrl || '']);
      [users] = await query('SELECT * FROM users WHERE openid = ?', [openid]);
    } else {
      // 更新昵称/头像（仅在提供时）
      let updates = [], params = [];
      if (nickname) { updates.push('nickname = ?'); params.push(nickname); }
      if (avatarUrl) { updates.push('avatar_url = ?'); params.push(avatarUrl); }
      if (updates.length > 0) {
        params.push(openid);
        await query(`UPDATE users SET ${updates.join(', ')} WHERE openid = ?`, params);
      }
    }

    // 签发 token（简化：openid 直接作为 token）
    const token = openid;

    res.json({
      code: 0, message: '登录成功',
      data: { token, user: toUserDTO(users[0]) }
    });
  } catch (err) { next(err); }
});

// ============================================================
// GET /api/users/profile
// 获取个人信息（需 Bearer token）
// ============================================================
router.get('/profile', async (req, res, next) => {
  try {
    const [rows] = await query('SELECT * FROM users WHERE openid = ?', [req.userOpenid]);
    if (rows.length === 0) return res.status(404).json({ code: 1, message: '用户不存在' });
    res.json({ code: 0, data: toUserDTO(rows[0]) });
  } catch (err) { next(err); }
});

// ============================================================
// PUT /api/users/profile
// 更新个人信息（昵称/头像）
// ============================================================
router.put('/profile', async (req, res, next) => {
  try {
    const { nickname, avatarUrl } = req.body;
    if (!nickname && !avatarUrl) return res.status(400).json({ code: 1, message: '没有要更新的内容' });

    let updates = [], params = [];
    if (nickname) { updates.push('nickname = ?'); params.push(nickname); }
    if (avatarUrl) { updates.push('avatar_url = ?'); params.push(avatarUrl); }
    params.push(req.userOpenid);
    await query(`UPDATE users SET ${updates.join(', ')} WHERE openid = ?`, params);
    res.json({ code: 0, message: '更新成功' });
  } catch (err) { next(err); }
});

// ============================================================
// POST /api/users/guess/record
// 记录猜一猜结果
// 并更新 difficulty_progress 表
// ============================================================
router.post('/guess/record', async (req, res, next) => {
  try {
    const { won, attempts, difficulty, targetPlayerId, targetPlayerName, gameMode } = req.body;
    if (!difficulty || !targetPlayerId) {
      return res.status(400).json({ code: 1, message: '缺少难度或目标选手' });
    }

    const openid = req.userOpenid;
    // 查询用户当前记录
    const [users] = await query('SELECT * FROM users WHERE openid = ?', [openid]);
    if (users.length === 0) return res.status(404).json({ code: 1, message: '用户不存在' });
    const user = users[0];

    // 更新总胜率
    let newWins = user.win_count + (won ? 1 : 0);
    let newTotal = user.total_games + 1;
    let newRate = ((newWins / newTotal) * 100).toFixed(2);

    // 读取旧记录（最多保留 100 条）
    let oldRecords = user.guess_records ? (typeof user.guess_records === 'string' ? JSON.parse(user.guess_records) : user.guess_records) : [];
    const newRecord = { won, attempts, difficulty, targetPlayerId, targetPlayerName, gameMode: gameMode || 'personal', time: new Date().toISOString() };
    const newRecords = [newRecord, ...oldRecords].slice(0, 100);

    // 判断是否已迁移（有 pk_win_count 列则更新 PK/Solo 分离数据）
    let updateSQL = `UPDATE users SET win_count = ?, total_games = ?, win_rate = ?, guess_records = ? WHERE openid = ?`;
    let updateParams = [newWins, newTotal, newRate, JSON.stringify(newRecords), req.userOpenid];

    if (user.pk_win_count !== undefined) {
      const mode = gameMode === 'friend' ? 'pk' : 'solo';
      const winCol = mode === 'pk' ? 'pk_win_count' : 'solo_win_count';
      const totalCol = mode === 'pk' ? 'pk_total_games' : 'solo_total_games';
      const rateCol = mode === 'pk' ? 'pk_win_rate' : 'solo_win_rate';

      const modeWins = (user[winCol] || 0) + (won ? 1 : 0);
      const modeTotal = (user[totalCol] || 0) + 1;
      const modeRate = modeTotal > 0 ? ((modeWins / modeTotal) * 100).toFixed(2) : '0.00';

      const pkWins = mode === 'pk' ? modeWins : user.pk_win_count;
      const pkTotal = mode === 'pk' ? modeTotal : user.pk_total_games;
      const pkRate = pkTotal > 0 ? ((pkWins / pkTotal) * 100).toFixed(2) : '0.00';
      const soloWins = mode === 'solo' ? modeWins : user.solo_win_count;
      const soloTotal = mode === 'solo' ? modeTotal : user.solo_total_games;
      const soloRate = soloTotal > 0 ? ((soloWins / soloTotal) * 100).toFixed(2) : '0.00';

      updateSQL = `UPDATE users SET
        win_count = ?, total_games = ?, win_rate = ?,
        pk_win_count = ?, pk_total_games = ?, pk_win_rate = ?,
        solo_win_count = ?, solo_total_games = ?, solo_win_rate = ?,
        guess_records = ? WHERE openid = ?`;
      updateParams = [newWins, newTotal, newRate, pkWins, pkTotal, pkRate,
                      soloWins, soloTotal, soloRate, JSON.stringify(newRecords), req.userOpenid];
    }

    await query(updateSQL, updateParams);

    // 更新 difficulty_progress
    await query(
      `INSERT INTO difficulty_progress (user_openid, difficulty, correct_count, total_games)
       VALUES (?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE
         correct_count = correct_count + ?,
         total_games = total_games + 1`,
      [openid, difficulty, won ? 1 : 0, won ? 1 : 0]
    );

    res.json({ code: 0, message: '记录成功' });
  } catch (err) { next(err); }
});

// ============================================================
// GET /api/users/guess/records
// 获取竞猜记录列表（需 Bearer token）
// ============================================================
router.get('/guess/records', async (req, res, next) => {
  try {
    const page = Math.max(parseInt(req.query.page || '0', 10), 0);
    const pageSize = Math.min(Math.max(parseInt(req.query.pageSize || '20', 10), 1), 100);
    const offset = page * pageSize;

    const [rows] = await query(
      'SELECT openid, guess_records FROM users WHERE openid = ?', [req.userOpenid]
    );
    if (rows.length === 0) return res.json({ code: 0, data: { records: [], total: 0 } });

    let records = rows[0].guess_records ? (typeof rows[0].guess_records === 'string' ? JSON.parse(rows[0].guess_records) : rows[0].guess_records) : [];
    const total = records.length;
    records = records.slice(offset, offset + pageSize);
    res.json({ code: 0, data: { records, total } });
  } catch (err) { next(err); }
});

// ============================================================
// GET /api/users/guess/difficulty-progress
// 获取各难度的猜对次数
// ============================================================
router.get('/guess/difficulty-progress', async (req, res, next) => {
  try {
    const [rows] = await query(
      'SELECT difficulty, correct_count, total_games FROM difficulty_progress WHERE user_openid = ?',
      [req.userOpenid]
    );
    res.json({ code: 0, data: rows });
  } catch (err) { next(err); }
});

// ============================================================
// GET /api/users/ranking?mode=pk|solo
// 返回所有用户的胜率排行榜
// 优先使用迁移后的分模式统计列，无数据时回退到总胜率
// ============================================================
router.get('/ranking', async (req, res, next) => {
  try {
    const mode = req.query.mode === 'solo' ? 'solo' : 'pk';
    const winCol = mode === 'pk' ? 'pk_win_count' : 'solo_win_count';
    const totalCol = mode === 'pk' ? 'pk_total_games' : 'solo_total_games';
    const rateCol = mode === 'pk' ? 'pk_win_rate' : 'solo_win_rate';

    // 检测列是否存在
    const [cols] = await query("SHOW COLUMNS FROM users LIKE '" + winCol + "'");
    const hasMigrated = cols.length > 0;

    let sql;
    if (hasMigrated) {
      // 优先使用分模式统计列；无数据时回退到总胜率
      // 注意：ORDER BY 使用完整 CASE 表达式而非别名，避免 MySQL 解析到原列名
      sql = `SELECT openid, nickname, avatar_url,
               CASE WHEN ${totalCol} > 0 THEN ${winCol} ELSE win_count END AS win_count,
               CASE WHEN ${totalCol} > 0 THEN ${totalCol} ELSE total_games END AS total_games,
               CASE WHEN ${totalCol} > 0 THEN ${rateCol} ELSE win_rate END AS win_rate
             FROM users
             WHERE ${totalCol} > 0 OR total_games > 0
             ORDER BY
               CASE WHEN ${totalCol} > 0 THEN ${rateCol} ELSE win_rate END DESC,
               CASE WHEN ${totalCol} > 0 THEN ${totalCol} ELSE total_games END DESC
             LIMIT 100`;
    } else {
      sql = `SELECT openid, nickname, avatar_url, win_count, total_games, win_rate
             FROM users WHERE total_games > 0
             ORDER BY win_rate DESC, total_games DESC LIMIT 100`;
    }

    const [rows] = await query(sql);

    res.json({
      code: 0, message: '',
      data: rows.map(r => ({
        openid: r.openid,
        nickname: r.nickname,
        avatarUrl: r.avatar_url,
        winCount: r.win_count,
        totalGames: r.total_games,
        winRate: parseFloat(r.win_rate || '0')
      }))
    });
  } catch (err) { next(err); }
});

// ============================================================
// 管理员：用户列表
// GET /api/users/admin/list?page=0&pageSize=20
// ============================================================
router.get('/admin/list', async (req, res, next) => {
  try {
    const page = Math.max(parseInt(req.query.page || '0', 10), 0);
    const pageSize = Math.min(Math.max(parseInt(req.query.pageSize || '20', 10), 1), 100);
    const offset = page * pageSize;

    const [rows, countRows] = await Promise.all([
      query(
        'SELECT id, openid, nickname, avatar_url, win_count, total_games, win_rate, coins, created_at, updated_at FROM users ORDER BY id DESC LIMIT ? OFFSET ?',
        [String(pageSize), String(offset)]
      ),
      query('SELECT COUNT(*) AS total FROM users'),
    ]);

    res.json({
      code: 0,
      data: {
        users: rows.map(r => ({
          openid: r.openid,
          nickname: r.nickname,
          avatarUrl: r.avatar_url,
          winCount: r.win_count,
          totalGames: r.total_games,
          winRate: parseFloat(r.win_rate || '0'),
          coins: r.coins || 0,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
        })),
        total: countRows[0].total,
      }
    });
  } catch (err) { next(err); }
});

// ============================================================
// 管理员：用户金币操作
// PUT /api/users/admin/coins
// ============================================================
router.put('/admin/coins', async (req, res, next) => {
  try {
    const { openid, amount, reason } = req.body;
    if (!openid || amount === undefined) {
      return res.status(400).json({ code: 1, message: '缺少参数' });
    }
    const [users] = await query('SELECT * FROM users WHERE openid = ?', [openid]);
    if (users.length === 0) return res.status(404).json({ code: 1, message: '用户不存在' });

    const user = users[0];
    const newCoins = Math.max(0, (user.coins || 0) + amount);
    const newTotalEarned = amount > 0 ? (user.total_coins_earned || 0) + amount : (user.total_coins_earned || 0);
    await query('UPDATE users SET coins = ?, total_coins_earned = ? WHERE openid = ?', [newCoins, newTotalEarned, openid]);

    // 记录流水
    const { v4: uuidv4 } = require('uuid');
    await query(
      'INSERT INTO coin_transactions (id, user_openid, amount, type, reason, created_at) VALUES (?, ?, ?, ?, ?, NOW())',
      [uuidv4(), openid, amount, amount > 0 ? 'admin_add' : 'admin_deduct', reason || '管理员操作']
    );

    res.json({ code: 0, message: '操作成功' });
  } catch (err) { next(err); }
});

// ============================================================
// 管理员：获取单个用户详情
// GET /api/users/admin/detail?openid=xxx
// ============================================================
router.get('/admin/detail', async (req, res, next) => {
  try {
    const { openid } = req.query;
    if (!openid) return res.status(400).json({ code: 1, message: '缺少 openid' });
    const [rows] = await query('SELECT * FROM users WHERE openid = ?', [openid]);
    if (rows.length === 0) return res.status(404).json({ code: 1, message: '用户不存在' });
    res.json({ code: 0, data: toUserDTO(rows[0]) });
  } catch (err) { next(err); }
});

// ============================================================
// 管理员：获取用户金币交易流水
// GET /api/users/admin/transactions?openid=xxx&page=0&pageSize=20
// ============================================================
router.get('/admin/transactions', async (req, res, next) => {
  try {
    const { openid } = req.query;
    if (!openid) return res.status(400).json({ code: 1, message: '缺少 openid' });
    const page = Math.max(parseInt(req.query.page || '0', 10), 0);
    const pageSize = Math.min(Math.max(parseInt(req.query.pageSize || '20', 10), 1), 100);
    const offset = page * pageSize;

    const [rows, countRows] = await Promise.all([
      query('SELECT * FROM coin_transactions WHERE user_openid = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
        [openid, String(pageSize), String(offset)]),
      query('SELECT COUNT(*) AS total FROM coin_transactions WHERE user_openid = ?', [openid]),
    ]);

    res.json({ code: 0, data: { transactions: rows, total: countRows[0].total } });
  } catch (err) { next(err); }
});

module.exports = router;
