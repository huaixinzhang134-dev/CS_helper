/**
 * 绰号路由 —— 用户提交绰号建议 + 管理员审核
 *
 * 挂载方式（见 index.js）：
 *   app.use('/api/nicknames', nicknamesRouter);   → 用户端
 *   app.use('/api/admin', nicknamesRouter);        → 管理员端（路径前缀会自动拼合）
 *
 * POST   /suggest                 用户提交绰号建议（需登录）
 * GET    /nicknames               管理员：获取待审核/所有建议
 * POST   /nicknames/:id/approve   管理员：通过建议
 * POST   /nicknames/:id/reject    管理员：拒绝建议
 */

const express = require('express');
const router = express.Router();
const { query } = require('../db/pool');
const { authMiddleware } = require('../middleware/auth');
const { verifyAdminToken } = require('./admin-auth');

/** 管理员认证中间件 */
function adminAuth(req, res, next) {
  const auth = req.headers.authorization || '';
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match) return res.status(401).json({ code: 401, message: '未登录', data: null });
  const username = verifyAdminToken(match[1]);
  if (!username) return res.status(401).json({ code: 401, message: '登录已过期', data: null });
  req.adminUsername = username;
  next();
}

// ============================================================
// POST /api/nicknames/suggest
// Body: { targetType: 'player'|'team', targetId: string, alias: string }
// ============================================================
router.post('/suggest', authMiddleware, async (req, res, next) => {
  try {
    const { targetType, targetId, alias } = req.body;
    if (!targetType || !targetId || !alias) {
      return res.status(400).json({ code: 400, message: 'targetType, targetId, alias 必填' });
    }
    if (!['player', 'team'].includes(targetType)) {
      return res.status(400).json({ code: 400, message: 'targetType 必须为 player 或 team' });
    }
    if (alias.length > 100) {
      return res.status(400).json({ code: 400, message: '绰号不能超过100字' });
    }

    // 检查目标是否存在
    const table = targetType === 'player' ? 'player' : 'team';
    // 两端表都用 id 做主键（player._id 是后端响应的 JS 别名，不是数据库列名）
    const idField = 'id';
    const [rows] = await query(
      `SELECT id FROM ${table} WHERE ${idField} = ? LIMIT 1`,
      [targetId]
    );
    if (!rows.length) {
      return res.status(404).json({ code: 404, message: `${targetType === 'player' ? '选手' : '战队'}不存在` });
    }

    await query(
      `INSERT INTO nickname_suggestions (target_type, target_id, alias, submitter_openid, status)
       VALUES (?, ?, ?, ?, 'pending')`,
      [targetType, targetId, alias.trim(), req.userOpenid]
    );

    res.json({ code: 0, message: '绰号建议已提交，等待管理员审核' });
  } catch (err) { next(err); }
});

// ============================================================
// GET /api/admin/nicknames?status=pending&page=0&pageSize=20
// ============================================================
router.get('/nicknames', adminAuth, async (req, res, next) => {
  try {
    const status = req.query.status || 'pending';
    const page = Math.max(parseInt(req.query.page || '0', 10), 0);
    const pageSize = Math.min(Math.max(parseInt(req.query.pageSize || '20', 10), 1), 100);
    const offset = page * pageSize;

    const whereSql = status !== 'all' ? 'WHERE s.status = ?' : '';
    const params = status !== 'all' ? [status] : [];

    const [countRows] = await query(
      `SELECT COUNT(*) AS total FROM nickname_suggestions s ${whereSql}`,
      params
    );
    const total = countRows[0].total;

    const [rows] = await query(
      `SELECT s.*, u.nickname AS submitter_name
       FROM nickname_suggestions s
       LEFT JOIN users u ON u.openid = s.submitter_openid
       ${whereSql}
       ORDER BY s.created_at DESC
       LIMIT ${pageSize} OFFSET ${offset}`,
      params
    );

    const list = rows.map(r => ({
      id: r.id,
      targetType: r.target_type,
      targetId: r.target_id,
      alias: r.alias,
      submitterOpenid: r.submitter_openid,
      submitterName: r.submitter_name || '未知用户',
      status: r.status,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
    res.json({
      code: 0, message: '',
      data: { data: list, total, hasMore: offset + pageSize < total },
    });
  } catch (err) { next(err); }
});

// ============================================================
// POST /api/admin/nicknames/:id/approve
// 通过建议：将绰号追加到目标表的 alias JSON 字段
// ============================================================
router.post('/nicknames/:id/approve', adminAuth, async (req, res, next) => {
  try {
    const [rows] = await query(
      "SELECT * FROM nickname_suggestions WHERE id = ? AND status = 'pending'",
      [req.params.id]
    );
    if (!rows.length) {
      return res.status(404).json({ code: 404, message: '建议不存在或已处理' });
    }
    const suggestion = rows[0];

    // 获取当前 alias，追加新绰号
    const table = suggestion.target_type === 'player' ? 'player' : 'team';
    // 两端表都用 id 做主键（player._id 是后端响应的 JS 别名，不是数据库列名）
    const idField = 'id';
    const [targetRows] = await query(
      `SELECT alias FROM ${table} WHERE ${idField} = ? LIMIT 1`,
      [suggestion.target_id]
    );
    if (!targetRows.length) {
      return res.status(404).json({ code: 404, message: '目标不存在' });
    }

    let currentAliases = [];
    try {
      if (targetRows[0].alias) {
        currentAliases = typeof targetRows[0].alias === 'string'
          ? JSON.parse(targetRows[0].alias)
          : targetRows[0].alias;
      }
    } catch (_) { currentAliases = []; }

    // 去重
    if (!currentAliases.includes(suggestion.alias)) {
      currentAliases.push(suggestion.alias);
    }

    await query(
      `UPDATE ${table} SET alias = ? WHERE ${idField} = ?`,
      [JSON.stringify(currentAliases), suggestion.target_id]
    );

    // 更新建议状态
    await query(
      "UPDATE nickname_suggestions SET status = 'approved' WHERE id = ?",
      [req.params.id]
    );

    res.json({ code: 0, message: '已通过并添加绰号' });
  } catch (err) { next(err); }
});

// ============================================================
// POST /api/admin/nicknames/:id/reject
// ============================================================
router.post('/nicknames/:id/reject', adminAuth, async (req, res, next) => {
  try {
    const [result] = await query(
      "UPDATE nickname_suggestions SET status = 'rejected' WHERE id = ? AND status = 'pending'",
      [req.params.id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ code: 404, message: '建议不存在或已处理' });
    }
    res.json({ code: 0, message: '已拒绝' });
  } catch (err) { next(err); }
});

module.exports = router;
