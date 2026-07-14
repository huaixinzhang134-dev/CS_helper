/**
 * 管理员登录路由
 *
 * POST /api/admin/login   { username, password } → { token }
 * GET  /api/admin/verify  验证 token 是否有效（需 Authorization header）
 */
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { query } = require('../db/pool');

// 管理员 token 密钥（与用户 token 不同）
const ADMIN_SECRET = process.env.ADMIN_SECRET || process.env.AUTH_SECRET || 'admin_secret_key';

function generateAdminToken(username) {
  const timestamp = Date.now().toString(36);
  const raw = `${username}:${ADMIN_SECRET}:${timestamp}`;
  const sig = crypto.createHash('md5').update(raw).digest('hex').slice(0, 12);
  const payload = Buffer.from(`${username}:${timestamp}`).toString('base64');
  return `admin_${payload}.${sig}`;
}

function verifyAdminToken(token) {
  try {
    if (!token.startsWith('admin_')) return null;
    const parts = token.replace('admin_', '').split('.');
    if (parts.length !== 2) return null;
    const payload = Buffer.from(parts[0], 'base64').toString('utf-8');
    const [username, timestamp] = payload.split(':');
    if (!username || !timestamp) return null;
    const raw = `${username}:${ADMIN_SECRET}:${timestamp}`;
    const sig = crypto.createHash('md5').update(raw).digest('hex').slice(0, 12);
    if (sig !== parts[1]) return null;
    return username;
  } catch {
    return null;
  }
}

/**
 * POST /api/admin/login
 */
router.post('/login', async (req, res, next) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ code: 400, message: '请输入用户名和密码', data: null });
    }

    const [rows] = await query(
      'SELECT id FROM admin_users WHERE username = ? AND password_hash = MD5(?)',
      [username, password]
    );

    if (!rows[0]) {
      return res.status(401).json({ code: 401, message: '用户名或密码错误', data: null });
    }

    const token = generateAdminToken(username);
    res.json({ code: 0, message: '登录成功', data: { token, username } });
  } catch (err) { next(err); }
});

/**
 * GET /api/admin/verify
 * 验证 token 是否有效（前端用于检查登录状态）
 */
router.get('/verify', async (req, res) => {
  const auth = req.headers.authorization || '';
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return res.json({ code: 401, message: '未登录', data: null });
  }
  const username = verifyAdminToken(match[1]);
  if (!username) {
    return res.json({ code: 401, message: '登录已过期', data: null });
  }
  res.json({ code: 0, message: '', data: { username } });
});

module.exports = { router, verifyAdminToken };
