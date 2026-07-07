/**
 * 用户路由 —— 微信登录、个人信息、竞猜记录
 *
 * POST   /api/users/login         微信登录 (code → openid)
 * GET    /api/users/profile       获取个人信息（需 Bearer token）
 * PUT    /api/users/profile       更新昵称/头像（需 Bearer token）
 * POST   /api/users/guess/record  记录猜一猜结果（需 Bearer token）
 * GET    /api/users/guess/records 获取竞猜记录列表（需 Bearer token）
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

// 简单的 URL 拼接（避免额外依赖）
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
  return {
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
}

// ============================================================
// POST /api/users/login
// Body: { code: string }
// 流程：wx.login() → code → 后端 → code2session → openid
// ============================================================
router.post('/login', async (req, res, next) => {
  try {
    const { code } = req.body || {};
    if (!code) {
      return res.status(400).json({ code: 400, message: 'code 必填', data: null });
    }

    let openid;

    if (WX_APPID && WX_SECRET) {
      // 生产环境：调用微信 API 换取 openid
      const resp = await fetch(buildWxUrl(code));
      const wxData = await resp.json();

      if (wxData.errcode) {
        console.error('[wx login error]', wxData);
        return res.status(400).json({ code: 400, message: wxData.errmsg || '微信登录失败', data: null });
      }

      openid = wxData.openid;
    } else {
      // 开发/测试环境：用 code 模拟 openid
      console.warn('[wx login] WX_APPID/WX_SECRET 未配置，使用模拟 openid');
      openid = 'dev_' + crypto.createHash('md5').update(code).digest('hex').slice(0, 12);
    }

    // 查找或创建用户
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

    // 生成 token
    const token = generateToken(openid);

    res.json({
      code: 0,
      message: '登录成功',
      data: {
        token,
        user: userToDTO(user)
      }
    });
  } catch (err) { next(err); }
});

// ============================================================
// GET /api/users/profile
// 需 Bearer token
// ============================================================
router.get('/profile', authMiddleware, async (req, res, next) => {
  try {
    const [rows] = await query('SELECT * FROM users WHERE openid = ? LIMIT 1', [req.userOpenid]);
    if (!rows[0]) {
      return res.status(404).json({ code: 404, message: '用户不存在', data: null });
    }
    res.json({ code: 0, message: '', data: userToDTO(rows[0]) });
  } catch (err) { next(err); }
});

// ============================================================
// PUT /api/users/profile
// Body: { nickname?: string, avatarUrl?: string }
// 需 Bearer token
// ============================================================
router.put('/profile', authMiddleware, async (req, res, next) => {
  try {
    const { nickname, avatarUrl } = req.body || {};
    const updates = [];
    const params = [];

    if (nickname !== undefined) {
      const trimmed = String(nickname).trim().slice(0, 64);
      if (trimmed) {
        updates.push('nickname = ?');
        params.push(trimmed);
      }
    }
    if (avatarUrl !== undefined) {
      updates.push('avatar_url = ?');
      params.push(String(avatarUrl).slice(0, 512));
    }

    if (updates.length === 0) {
      return res.status(400).json({ code: 400, message: '没有需要更新的字段', data: null });
    }

    params.push(req.userOpenid);
    await query(
      `UPDATE users SET ${updates.join(', ')} WHERE openid = ?`,
      params
    );

    const [rows] = await query('SELECT * FROM users WHERE openid = ? LIMIT 1', [req.userOpenid]);
    res.json({ code: 0, message: '更新成功', data: userToDTO(rows[0]) });
  } catch (err) { next(err); }
});

// ============================================================
// POST /api/users/guess/record
// Body: { won: boolean, attempts: number, difficulty: string, targetPlayerId: string, targetPlayerName: string }
// 需 Bearer token
// ============================================================
router.post('/guess/record', authMiddleware, async (req, res, next) => {
  try {
    const { won, attempts, difficulty, targetPlayerId, targetPlayerName } = req.body || {};

    if (won === undefined) {
      return res.status(400).json({ code: 400, message: 'won 必填', data: null });
    }

    const [rows] = await query('SELECT * FROM users WHERE openid = ? LIMIT 1', [req.userOpenid]);
    if (!rows[0]) {
      return res.status(404).json({ code: 404, message: '用户不存在', data: null });
    }

    const user = rows[0];

    // 更新胜场 / 总局数
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
      playedAt: new Date().toISOString()
    };

    const newRecords = [newRecord, ...oldRecords].slice(0, 100);

    await query(
      `UPDATE users SET win_count = ?, total_games = ?, win_rate = ?, guess_records = ? WHERE openid = ?`,
      [newWins, newTotal, newRate, JSON.stringify(newRecords), req.userOpenid]
    );

    // 重新读取
    const [updated] = await query('SELECT * FROM users WHERE openid = ? LIMIT 1', [req.userOpenid]);
    res.json({ code: 0, message: won ? '胜利记录已保存' : '记录已保存', data: userToDTO(updated[0]) });
  } catch (err) { next(err); }
});

// ============================================================
// GET /api/users/guess/records
// Query: ?page=0&pageSize=20
// 需 Bearer token
// 返回用户竞猜记录（分页）
// ============================================================
router.get('/guess/records', authMiddleware, async (req, res, next) => {
  try {
    const [rows] = await query('SELECT * FROM users WHERE openid = ? LIMIT 1', [req.userOpenid]);
    if (!rows[0]) {
      return res.status(404).json({ code: 404, message: '用户不存在', data: null });
    }

    const records = rows[0].guess_records
      ? (typeof rows[0].guess_records === 'string' ? JSON.parse(rows[0].guess_records) : rows[0].guess_records)
      : [];

    const page = Math.max(parseInt(req.query.page || '0', 10), 0);
    const pageSize = Math.min(Math.max(parseInt(req.query.pageSize || '20', 10), 1), 50);
    const total = records.length;
    const start = page * pageSize;
    const paged = records.slice(start, start + pageSize);

    res.json({
      code: 0,
      message: '',
      data: {
        list: paged,
        total,
        page,
        pageSize,
        hasMore: start + pageSize < total
      }
    });
  } catch (err) { next(err); }
});

module.exports = router;
