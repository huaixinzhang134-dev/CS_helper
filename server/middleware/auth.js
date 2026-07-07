/**
 * 用户认证中间件
 *
 * 验证请求头 Authorization: Bearer <token>
 * token 格式为 base64(openid):timestamp:md5(openid+secret+timer)
 *
 * 在 routes/users.js 中签发 token
 */
const crypto = require('crypto');

// 从环境变量读取密钥，部署时务必设置
const AUTH_SECRET = process.env.AUTH_SECRET || 'cs-match-auth-dev-secret';

/**
 * 生成 token
 * @param {string} openid
 * @returns {string} token
 */
function generateToken(openid) {
  const timestamp = Date.now().toString(36);
  const raw = `${openid}:${AUTH_SECRET}:${timestamp}`;
  const sig = crypto.createHash('md5').update(raw).digest('hex').slice(0, 12);
  const payload = Buffer.from(`${openid}:${timestamp}`).toString('base64');
  return `${payload}.${sig}`;
}

/**
 * 验证 token → 返回 openid，失败返回 null
 */
function verifyToken(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const payload = Buffer.from(parts[0], 'base64').toString('utf-8');
    const [openid, timestamp] = payload.split(':');
    if (!openid || !timestamp) return null;
    const raw = `${openid}:${AUTH_SECRET}:${timestamp}`;
    const sig = crypto.createHash('md5').update(raw).digest('hex').slice(0, 12);
    if (sig !== parts[1]) return null;
    return openid;
  } catch {
    return null;
  }
}

/**
 * Express 中间件：从 Authorization 头提取并验证 token
 * 验证通过后将 openid 挂在 req.userOpenid 上
 */
function authMiddleware(req, res, next) {
  const auth = req.headers.authorization || '';
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return res.status(401).json({ code: 401, message: '请先登录', data: null });
  }
  const openid = verifyToken(match[1]);
  if (!openid) {
    return res.status(401).json({ code: 401, message: '登录已过期，请重新登录', data: null });
  }
  req.userOpenid = openid;
  next();
}

module.exports = { generateToken, verifyToken, authMiddleware };
