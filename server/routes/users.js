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
const crypto = require('crypto');
const { query } = require('../db/pool');
const { generateToken, authMiddleware } = require('../middleware/auth');

// -------- 微信 code2session 配置（从环境变量读取）--------
const WX_APPID = process.env.WX_APPID || '';
const WX_SECRET = process.env.WX_SECRET || '';
const WX_LOGIN_URL = 'https://api.weixin.qq.com/sns/jscode2session';

function buildWxUrl(code) {
  const p = new URLSearchParams({
    appid: WX_APPID,
    secret: WX_SECRET,
    js_code: code,
    grant_type: 'authorization_code'
  });
  return `${WX_LOGIN_URL}?${p.toString()}`;
}

// ---------- 工具函数 ----------

function userToDTO(row) {
  const dto = {
    id: String(row.id),
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
  // 如果已迁移（有 pk_win_count 等列），补充 PK/Solo 数据
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
// 迁移：为 users 表新增 PK/Solo 分离统计列
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
// ============================================================
router.post('/login', async (req, res, next) => {
  try {
    const { code } = req.body || {};
    if (!code) {
      return res.status(400).json({ code: 400, message: 'code 必填', data: null });
    }

    let openid;

    if (WX_APPID && WX_SECRET) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      let wxData;
      try {
        const resp = await fetch(buildWxUrl(code), { signal: controller.signal });
        wxData = await resp.json();
      } finally {
        clearTimeout(timeout);
      }
      if (wxData.errcode) {
        console.error('[wx login error]', wxData);
        return res.status(400).json({ code: 400, message: wxData.errmsg || '微信登录失败', data: null });
      }
      openid = wxData.openid;
    } else {
      console.warn('[wx login] WX_APPID/WX_SECRET 未配置，使用模拟 openid');
      openid = 'dev_' + crypto.createHash('md5').update(code).digest('hex').slice(0, 12);
    }

    const [existing] = await query('SELECT * FROM users WHERE openid = ? LIMIT 1', [openid]);
    let user;
    if (existing[0]) {
      user = existing[0];
    } else {
      const [result] = await query(
        'INSERT INTO users (openid, nickname, guess_records) VALUES (?, ?, ?)',
        [openid, '微信用户', JSON.stringify([])]
      );
      const [rows] = await query('SELECT * FROM users WHERE id = ?', [result.insertId]);
      user = rows[0];
    }

    const token = generateToken(openid);
    res.json({ code: 0, message: '登录成功', data: { token, user: userToDTO(user) } });
  } catch (err) { next(err); }
});

// ============================================================
// POST /api/users/web-login
// Web 端手机号登录（替代微信登录）
// Body: { phone }
// ============================================================
router.post('/web-login', async (req, res, next) => {
  try {
    let { phone } = req.body || {};
    if (!phone || !phone.trim()) {
      return res.status(400).json({ code: 400, message: '请输入手机号', data: null });
    }
    phone = String(phone).trim().replace(/\s+/g, '');
    // 简单校验手机号格式
    if (!/^1\d{10}$/.test(phone)) {
      return res.status(400).json({ code: 400, message: '手机号格式不正确', data: null });
    }

    // 以 phone_<号码> 作为 openid，确保同一手机号登录后数据一致
    const openid = 'phone_' + phone;

    const [existing] = await query('SELECT * FROM users WHERE openid = ? LIMIT 1', [openid]);
    let user;
    if (existing[0]) {
      user = existing[0];
      // 如果用户没有昵称，自动生成一个
      if (!user.nickname || user.nickname === '微信用户') {
        const maskedPhone = phone.slice(0, 3) + '****' + phone.slice(7);
        await query('UPDATE users SET nickname = ? WHERE openid = ?', ['用户' + maskedPhone, openid]);
        user.nickname = '用户' + maskedPhone;
      }
    } else {
      // 新用户，生成默认昵称
      const maskedPhone = phone.slice(0, 3) + '****' + phone.slice(7);
      const nickname = '用户' + maskedPhone;
      const [result] = await query(
        'INSERT INTO users (openid, nickname, avatar_url, guess_records) VALUES (?, ?, ?, ?)',
        [openid, nickname, '', JSON.stringify([])]
      );
      const [rows] = await query('SELECT * FROM users WHERE id = ?', [result.insertId]);
      user = rows[0];
    }

    const token = generateToken(openid);
    res.json({ code: 0, message: '登录成功', data: { token, user: userToDTO(user) } });
  } catch (err) { next(err); }
});

// ============================================================
// GET /api/users/profile
// ============================================================
router.get('/profile', authMiddleware, async (req, res, next) => {
  try {
    const [rows] = await query('SELECT * FROM users WHERE openid = ? LIMIT 1', [req.userOpenid]);
    if (!rows[0]) return res.status(404).json({ code: 404, message: '用户不存在', data: null });
    res.json({ code: 0, message: '', data: userToDTO(rows[0]) });
  } catch (err) { next(err); }
});

// ============================================================
// PUT /api/users/profile
// ============================================================
router.put('/profile', authMiddleware, async (req, res, next) => {
  try {
    const { nickname, avatarUrl } = req.body || {};
    const updates = [];
    const params = [];

    if (nickname !== undefined) {
      const trimmed = String(nickname).trim().slice(0, 64);
      if (trimmed) { updates.push('nickname = ?'); params.push(trimmed); }
    }
    if (avatarUrl !== undefined) {
      updates.push('avatar_url = ?');
      params.push(String(avatarUrl).slice(0, 512));
    }

    if (updates.length === 0) {
      return res.status(400).json({ code: 400, message: '没有需要更新的字段', data: null });
    }

    params.push(req.userOpenid);
    await query(`UPDATE users SET ${updates.join(', ')} WHERE openid = ?`, params);

    const [rows] = await query('SELECT * FROM users WHERE openid = ? LIMIT 1', [req.userOpenid]);
    res.json({ code: 0, message: '更新成功', data: userToDTO(rows[0]) });
  } catch (err) { next(err); }
});

// ============================================================
// POST /api/users/guess/record
// Body: { won, attempts, difficulty, targetPlayerId, targetPlayerName, gameMode }
//   gameMode: 'personal' | 'friend'（可选，默认 'personal'）
// ============================================================
router.post('/guess/record', authMiddleware, async (req, res, next) => {
  try {
    const { won, attempts, difficulty, targetPlayerId, targetPlayerName, gameMode } = req.body || {};
    if (won === undefined) {
      return res.status(400).json({ code: 400, message: 'won 必填', data: null });
    }

    const mode = (gameMode === 'friend') ? 'friend' : 'personal';

    const [rows] = await query('SELECT * FROM users WHERE openid = ? LIMIT 1', [req.userOpenid]);
    if (!rows[0]) return res.status(404).json({ code: 404, message: '用户不存在', data: null });

    const user = rows[0];

    // 更新整体胜场 / 总局数
    const newTotal = (user.total_games || 0) + 1;
    const newWins = (user.win_count || 0) + (won ? 1 : 0);
    const newRate = newTotal > 0 ? ((newWins / newTotal) * 100).toFixed(2) : '0.00';

    // 追加竞猜记录（存最近的 100 条）
    const oldRecords = user.guess_records
      ? (typeof user.guess_records === 'string' ? JSON.parse(user.guess_records) : user.guess_records)
      : [];

    const newRecord = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      won,
      attempts: attempts || 0,
      difficulty: difficulty || '',
      targetPlayerId: targetPlayerId || '',
      targetPlayerName: targetPlayerName || '',
      gameMode: mode,
      playedAt: new Date().toISOString()
    };

    const newRecords = [newRecord, ...oldRecords].slice(0, 100);

    // 判断是否已迁移（有 pk_win_count 列则更新 PK/Solo 分离数据）
    let updateSQL = `UPDATE users SET win_count = ?, total_games = ?, win_rate = ?, guess_records = ? WHERE openid = ?`;
    let updateParams = [newWins, newTotal, newRate, JSON.stringify(newRecords), req.userOpenid];

    if (user.pk_win_count !== undefined) {
      const pkTotal = (user.pk_total_games || 0) + (mode === 'friend' ? 1 : 0);
      const pkWins = (user.pk_win_count || 0) + (mode === 'friend' && won ? 1 : 0);
      const pkRate = pkTotal > 0 ? ((pkWins / pkTotal) * 100).toFixed(2) : '0.00';

      const soloTotal = (user.solo_total_games || 0) + (mode === 'personal' ? 1 : 0);
      const soloWins = (user.solo_win_count || 0) + (mode === 'personal' && won ? 1 : 0);
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

    // 更新难度解锁进度
    if (difficulty) {
      await query(
        `INSERT INTO difficulty_progress (user_openid, difficulty, correct_count, total_games)
         VALUES (?, ?, ?, 1)
         ON DUPLICATE KEY UPDATE
           correct_count = correct_count + ?,
           total_games = total_games + 1`,
        [req.userOpenid, difficulty, won ? 1 : 0, won ? 1 : 0]
      );
    }

    const [updated] = await query('SELECT * FROM users WHERE openid = ? LIMIT 1', [req.userOpenid]);
    res.json({ code: 0, message: won ? '胜利记录已保存' : '记录已保存', data: userToDTO(updated[0]) });
  } catch (err) { next(err); }
});

// ============================================================
// GET /api/users/guess/difficulty-progress
// 返回用户所有难度的猜对次数（用于解锁判断）
// 解锁顺序：trivial → easy → normal → hard → hell → challenge
// 每档需前一个难度猜对 10 次才解锁
// ============================================================
router.get('/guess/difficulty-progress', authMiddleware, async (req, res, next) => {
  try {
    const DIFF_ORDER = ['trivial', 'easy', 'normal', 'hard', 'hell', 'challenge'];
    const [rows] = await query(
      'SELECT difficulty, correct_count FROM difficulty_progress WHERE user_openid = ?',
      [req.userOpenid]
    );
    const progressMap = {};
    for (const r of rows) progressMap[r.difficulty] = r.correct_count;

    const result = DIFF_ORDER.map((diff, i) => {
      const correct = progressMap[diff] || 0;
      // 第一档（trivial）默认解锁；后续需要前一个猜对 >= 10
      const unlocked = i === 0 ? true : (progressMap[DIFF_ORDER[i - 1]] || 0) >= 10;
      return {
        difficulty: diff,
        correctCount: correct,
        unlocked,
        needPrevCorrect: 10
      };
    });

    res.json({ code: 0, message: '', data: result });
  } catch (err) { next(err); }
});

// ============================================================
// GET /api/users/guess/records
// ============================================================
router.get('/guess/records', authMiddleware, async (req, res, next) => {
  try {
    const [rows] = await query('SELECT * FROM users WHERE openid = ? LIMIT 1', [req.userOpenid]);
    if (!rows[0]) return res.status(404).json({ code: 404, message: '用户不存在', data: null });

    const records = rows[0].guess_records
      ? (typeof rows[0].guess_records === 'string' ? JSON.parse(rows[0].guess_records) : rows[0].guess_records)
      : [];

    const page = Math.max(parseInt(req.query.page || '0', 10), 0);
    const pageSize = Math.min(Math.max(parseInt(req.query.pageSize || '20', 10), 1), 50);
    const total = records.length;
    const start = page * pageSize;
    const paged = records.slice(start, start + pageSize);

    res.json({
      code: 0, message: '',
      data: { list: paged, total, page, pageSize, hasMore: start + pageSize < total }
    });
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
      code: 0, message: '',
      data: {
        list: rows[0].map(r => ({
          id: r.id,
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
        total: countRows[0][0].total,
        page, pageSize,
        hasMore: (page + 1) * pageSize < countRows[0][0].total,
      }
    });
  } catch (err) { next(err); }
});

// ============================================================
// 管理员：编辑用户
// PUT /api/users/admin/:openid
// Body: { nickname, coins }
// ============================================================
router.put('/admin/:openid', async (req, res, next) => {
  try {
    const { openid } = req.params;
    const { nickname, coins } = req.body || {};

    const updates = [];
    const params = [];
    if (nickname !== undefined) { updates.push('nickname = ?'); params.push(String(nickname).trim().slice(0, 64)); }
    if (coins !== undefined) { updates.push('coins = ?'); params.push(Math.max(0, parseInt(coins, 10) || 0)); }

    if (updates.length === 0) {
      return res.status(400).json({ code: 400, message: '没有需要更新的字段', data: null });
    }

    params.push(openid);
    await query(`UPDATE users SET ${updates.join(', ')} WHERE openid = ?`, params);
    res.json({ code: 0, message: '更新成功', data: null });
  } catch (err) { next(err); }
});

// ============================================================
// 管理员：删除用户
// DELETE /api/users/admin/:openid
// ============================================================
router.delete('/admin/:openid', async (req, res, next) => {
  try {
    const { openid } = req.params;
    await query('DELETE FROM users WHERE openid = ?', [openid]);
    res.json({ code: 0, message: '删除成功', data: null });
  } catch (err) { next(err); }
});

module.exports = router;
