// 评论路由
const express = require('express');
const router = express.Router();

const { query } = require('../db/pool');

const CONTENT_MAX_LEN = 500;

/**
 * 数据库行 → 前端 Comment DTO
 */
function toCommentDTO(row) {
  return {
    _id: String(row.id),  // 兼容旧前端
    id: String(row.id),
    matchId: String(row.match_id),
    playerId: row.player_id,
    content: row.content,
    userOpenid: row.user_openid,
    createdAt: row.created_at,  // 前端会用 formatTime 格式化
    status: row.status
  };
}

/**
 * GET /api/comments?matchId=&playerId=&page=0&pageSize=20
 */
router.get('/', async (req, res, next) => {
  try {
    const matchId = req.query.matchId;
    const playerId = req.query.playerId;
    const page = Math.max(parseInt(req.query.page || '0', 10), 0);
    const pageSize = Math.min(Math.max(parseInt(req.query.pageSize || '20', 10), 1), 100);

    if (!matchId) {
      return res.status(400).json({ code: 400, message: 'matchId 必填', data: null });
    }

    const where = ['match_id = ?', 'status = 1'];
    const params = [matchId];
    if (playerId) {
      where.push('player_id = ?');
      params.push(playerId);
    }
    const whereSQL = where.join(' AND ');

    const offset = page * pageSize;

    const [listRows, countRows] = await Promise.all([
      query(
        `SELECT * FROM match_comments WHERE ${whereSQL}
         ORDER BY created_at DESC, id DESC
         LIMIT ${pageSize} OFFSET ${offset}`,
        params
      ),
      query(
        `SELECT COUNT(*) AS total FROM match_comments WHERE ${whereSQL}`,
        params
      )
    ]);

    res.json({
      code: 0,
      message: '',
      data: {
        list: listRows[0].map(toCommentDTO),
        total: countRows[0][0].total,
        page,
        pageSize,
        hasMore: (page + 1) * pageSize < countRows[0][0].total
      }
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/comments
 * Body: { matchId, playerId, content, userOpenid }
 */
router.post('/', async (req, res, next) => {
  try {
    const { matchId, playerId, content, userOpenid } = req.body || {};

    if (!userOpenid) {
      return res.status(401).json({ code: 401, message: '请先登录', data: null });
    }
    if (!matchId || !playerId) {
      return res.status(400).json({ code: 400, message: 'matchId / playerId 必填', data: null });
    }
    const trimmed = (content || '').trim();
    if (!trimmed) {
      return res.status(400).json({ code: 400, message: '评论内容不能为空', data: null });
    }
    if (trimmed.length > CONTENT_MAX_LEN) {
      return res.status(400).json({ code: 400, message: `评论最多 ${CONTENT_MAX_LEN} 字`, data: null });
    }

    // 校验比赛存在
    const [matchRows] = await query('SELECT id FROM matches WHERE id = ? LIMIT 1', [matchId]);
    if (matchRows.length === 0) {
      return res.status(404).json({ code: 404, message: '比赛不存在', data: null });
    }
    // 校验选手存在
    const [playerRows] = await query('SELECT id FROM player WHERE game_id = ? LIMIT 1', [playerId]);
    if (playerRows.length === 0) {
      return res.status(404).json({ code: 404, message: '选手不存在', data: null });
    }

    const [result] = await query(
      `INSERT INTO match_comments (match_id, player_id, content, user_openid, status)
       VALUES (?, ?, ?, ?, 1)`,
      [matchId, playerId, trimmed, userOpenid]
    );

    // 返回完整记录
    const [rows] = await query('SELECT * FROM match_comments WHERE id = ?', [result.insertId]);
    res.json({ code: 0, message: '发送成功', data: toCommentDTO(rows[0]) });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/comments/:id?userOpenid=
 * 仅本人可删（软删除）
 */
router.delete('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const userOpenid = req.query.userOpenid || '';

    if (!userOpenid) {
      return res.status(401).json({ code: 401, message: '请先登录', data: null });
    }

    const [rows] = await query('SELECT * FROM match_comments WHERE id = ? LIMIT 1', [id]);
    if (rows.length === 0) {
      return res.status(404).json({ code: 404, message: '评论不存在', data: null });
    }
    const comment = rows[0];
    if (comment.user_openid !== userOpenid) {
      return res.status(403).json({ code: 403, message: '只能删除自己的评论', data: null });
    }

    await query('UPDATE match_comments SET status = 0 WHERE id = ?', [id]);
    res.json({ code: 0, message: '删除成功', data: { id: String(id) } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;