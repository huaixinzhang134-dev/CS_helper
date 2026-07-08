/**
 * 选手评论路由（新版 player_comments 表）
 *
 * GET    /api/comments?playerGameId=&userId=&page=0&pageSize=20
 * POST   /api/comments  { userId, playerGameId, content }
 * DELETE /api/comments/:id?userId=
 */

const express = require('express');
const router = express.Router();
const { query } = require('../db/pool');

const CONTENT_MAX_LEN = 500;

function toDTO(row) {
  return {
    _id: String(row.id),
    userId: row.user_id,
    userName: row.user_name || row.user_id || '匿名用户',
    playerGameId: row.player_game_id,
    content: row.content,
    createdAt: row.created_at
  };
}

/**
 * GET /api/comments
 * 查询评论，可按选手 game_id 或用户 id 筛选
 */
router.get('/', async (req, res, next) => {
  try {
    const { playerGameId, userId } = req.query;
    const page = Math.max(parseInt(req.query.page || '0', 10), 0);
    const pageSize = Math.min(Math.max(parseInt(req.query.pageSize || '20', 10), 1), 100);

    const where = [];
    const params = [];
    if (playerGameId) { where.push('player_game_id = ?'); params.push(playerGameId); }
    if (userId) { where.push('user_id = ?'); params.push(userId); }

    const whereSQL = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const offset = page * pageSize;

    const [rows, countRows] = await Promise.all([
      query(
        `SELECT pc.*, u.nickname AS user_name
         FROM player_comments pc
         LEFT JOIN users u ON u.openid = pc.user_id
         ${whereSQL}
         ORDER BY pc.created_at DESC, pc.id DESC
         LIMIT ${pageSize} OFFSET ${offset}`,
        params
      ),
      query(
        `SELECT COUNT(*) AS total FROM player_comments ${whereSQL}`,
        params
      )
    ]);

    res.json({
      code: 0,
      message: '',
      data: {
        list: rows[0].map(toDTO),
        total: countRows[0][0].total,
        page, pageSize,
        hasMore: (page + 1) * pageSize < countRows[0][0].total
      }
    });
  } catch (err) { next(err); }
});

/**
 * POST /api/comments
 * Body: { userId, playerGameId, content }
 */
router.post('/', async (req, res, next) => {
  try {
    const { userId, playerGameId, content } = req.body || {};

    if (!userId) {
      return res.status(401).json({ code: 401, message: '请先登录', data: null });
    }
    if (!playerGameId) {
      return res.status(400).json({ code: 400, message: 'playerGameId 必填', data: null });
    }

    const trimmed = (content || '').trim();
    if (!trimmed) {
      return res.status(400).json({ code: 400, message: '评论内容不能为空', data: null });
    }
    if (trimmed.length > CONTENT_MAX_LEN) {
      return res.status(400).json({ code: 400, message: `评论最多 ${CONTENT_MAX_LEN} 字`, data: null });
    }

    const [result] = await query(
      `INSERT INTO player_comments (user_id, player_game_id, content) VALUES (?, ?, ?)`,
      [userId, playerGameId, trimmed]
    );

    const [rows] = await query(
      `SELECT pc.*, u.nickname AS user_name
       FROM player_comments pc
       LEFT JOIN users u ON u.openid = pc.user_id
       WHERE pc.id = ?`, [result.insertId]);
    res.json({ code: 0, message: '发送成功', data: toDTO(rows[0]) });
  } catch (err) { next(err); }
});

/**
 * DELETE /api/comments/:id?userId=
 */
router.delete('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.query.userId || '';

    if (!userId) {
      return res.status(401).json({ code: 401, message: '请先登录', data: null });
    }

    const [rows] = await query('SELECT * FROM player_comments WHERE id = ? LIMIT 1', [id]);
    if (rows.length === 0) {
      return res.status(404).json({ code: 404, message: '评论不存在', data: null });
    }
    if (rows[0].user_id !== userId) {
      return res.status(403).json({ code: 403, message: '只能删除自己的评论', data: null });
    }

    await query('DELETE FROM player_comments WHERE id = ?', [id]);
    res.json({ code: 0, message: '删除成功', data: { id: String(id) } });
  } catch (err) { next(err); }
});

module.exports = router;
