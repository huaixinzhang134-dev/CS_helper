/**
 * PK 房间管理（好友对战）
 *
 * API:
 *   POST /api/pk/rooms        创建房间（选择难度后）
 *   POST /api/pk/rooms/:id/join  加入房间（通过分享链接）
 *   GET  /api/pk/rooms/:id    查询房间状态
 *   POST /api/pk/rooms/:id/result  报告游戏结果
 */
const express = require('express');
const router = express.Router();
const { query } = require('../db/pool');

// ======================== 内存房间存储 ========================
// 生产环境可用 Redis 或 MySQL 表，当前用 Map（单进程够用）
const rooms = new Map();

// 定期清理过期房间（30 分钟无活动）
setInterval(() => {
  const now = Date.now();
  for (const [id, room] of rooms) {
    if (now - room.updatedAt > 30 * 60 * 1000) {
      rooms.delete(id);
    }
  }
}, 5 * 60 * 1000);

// ======================== API ========================

/**
 * POST /api/pk/rooms
 * 创建 PK 房间
 * Body: { difficulty: 'easy'|'hard'|'hell', creatorNickname: string, creatorAvatar: string }
 */
router.post('/rooms', async (req, res, next) => {
  try {
    const { difficulty, creatorNickname, creatorAvatar } = req.body;
    if (!difficulty) {
      return res.status(400).json({ code: 400, message: '缺少 difficulty', data: null });
    }

    // 根据难度从选手池中随机选一个目标
    const target = await selectTargetPlayer(difficulty);
    if (!target) {
      return res.status(500).json({ code: 500, message: '无法选取目标选手', data: null });
    }

    const roomId = 'pk_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const room = {
      id: roomId,
      difficulty,
      creator: { nickname: creatorNickname || '玩家1', avatar: creatorAvatar || '' },
      joiner: null,
      targetPlayer: {
        id: target.id,
        playerId: target.game_id,
        name: target.name,
        team: target.current_team,
        age: target.age,
        country: target.country,
        countryCode: target.country_code,
        region: target.region,
        position: target.position,
        majorAppearances: target.major_appearances,
        formerTeams: target.former_teams,
        avatar: target.avatar,
      },
      creatorResult: null,  // { won, attempts }
      joinerResult: null,
      creatorAttempts: 0,   // 实时尝试次数（用于对方进度展示）
      joinerAttempts: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    rooms.set(roomId, room);
    console.log(`[pk] 创建房间 ${roomId} (${difficulty})`);

    res.json({
      code: 0,
      data: { roomId, targetPlayer: room.targetPlayer },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/pk/rooms/:id/join
 * 加入 PK 房间（分享链接的接收方）
 * Body: { joinerNickname: string, joinerAvatar: string }
 */
router.post('/rooms/:id/join', async (req, res, next) => {
  try {
    const room = rooms.get(req.params.id);
    if (!room) {
      return res.status(404).json({ code: 404, message: '房间不存在或已过期', data: null });
    }

    const { joinerNickname, joinerAvatar } = req.body;
    room.joiner = { nickname: joinerNickname || '玩家2', avatar: joinerAvatar || '' };
    room.updatedAt = Date.now();

    console.log(`[pk] ${joinerNickname || '玩家2'} 加入房间 ${req.params.id}`);

    res.json({
      code: 0,
      data: {
        roomId: room.id,
        difficulty: room.difficulty,
        targetPlayer: room.targetPlayer,
        creator: room.creator,
        creatorResult: room.creatorResult,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/pk/rooms/:id
 * 查询房间状态（用于轮询对手进度）
 */
router.get('/rooms/:id', async (req, res, next) => {
  try {
    const room = rooms.get(req.params.id);
    if (!room) {
      return res.status(404).json({ code: 404, message: '房间不存在', data: null });
    }
    res.json({
      code: 0,
      data: {
        roomId: room.id,
        difficulty: room.difficulty,
        creator: room.creator,
        joiner: room.joiner,
        targetPlayer: room.targetPlayer,
        creatorResult: room.creatorResult,
        joinerResult: room.joinerResult,
        creatorAttempts: room.creatorAttempts || 0,
        joinerAttempts: room.joinerAttempts || 0,
        createdAt: room.createdAt,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/pk/rooms/:id/attempt
 * 报告当前尝试次数（用于对方实时看到你的猜测进度）
 * Body: { role: 'creator'|'joiner', attempts: number }
 */
router.post('/rooms/:id/attempt', async (req, res, next) => {
  try {
    const room = rooms.get(req.params.id);
    if (!room) {
      return res.status(404).json({ code: 404, message: '房间不存在', data: null });
    }
    const { role, attempts } = req.body;
    if (role === 'creator') {
      room.creatorAttempts = attempts;
    } else if (role === 'joiner') {
      room.joinerAttempts = attempts;
    }
    room.updatedAt = Date.now();
    res.json({
      code: 0,
      data: { creatorAttempts: room.creatorAttempts, joinerAttempts: room.joinerAttempts },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/pk/rooms/:id/result
 * 报告游戏结果（玩家猜中或耗尽次数）
 * 当一方已报告胜利时，另一方直接判负（先胜先赢）
 * Body: { role: 'creator'|'joiner', won: boolean, attempts: number }
 */
router.post('/rooms/:id/result', async (req, res, next) => {
  try {
    const room = rooms.get(req.params.id);
    if (!room) {
      return res.status(404).json({ code: 404, message: '房间不存在', data: null });
    }

    const { role, won, attempts } = req.body;

    // 如果对方已报告胜利，则另一方直接判负，不能再赢
    const otherRole = role === 'creator' ? 'joiner' : 'creator';
    const otherResult = otherRole === 'creator' ? room.creatorResult : room.joinerResult;
    if (otherResult && otherResult.won) {
      // 对方已赢，当前玩家只能输
      if (role === 'creator') {
        room.creatorResult = { won: false, attempts };
      } else {
        room.joinerResult = { won: false, attempts };
      }
    } else {
      if (role === 'creator') {
        room.creatorResult = { won, attempts };
      } else if (role === 'joiner') {
        room.joinerResult = { won, attempts };
      }
    }
    room.updatedAt = Date.now();

    // 判断胜负
    let winner = null;
    if (room.creatorResult && room.joinerResult) {
      const c = room.creatorResult;
      const j = room.joinerResult;
      if (c.won && !j.won) winner = 'creator';
      else if (!c.won && j.won) winner = 'joiner';
      else if (c.won && j.won) {
        winner = c.attempts <= j.attempts ? 'creator' : 'joiner';
      } else {
        winner = 'draw';
      }
    } else if (room.creatorResult && room.creatorResult.won) {
      winner = 'creator'; // 等待对手结束
    } else if (room.joinerResult && room.joinerResult.won) {
      winner = 'joiner'; // 等待对手结束
    }

    res.json({
      code: 0,
      data: {
        creatorResult: room.creatorResult,
        joinerResult: room.joinerResult,
        winner,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ======================== 工具函数 ========================

/**
 * 根据难度从 player 表中随机选一个目标选手
 * trivial：选手现役队伍在世界排名前30的战队中
 * easy：选手现役队伍必须在 team_ranking 表中（世界排名前60）
 * hard：有现役队伍即可（含无排名战队）
 * hell：所有选手（含自由人/退役）
 */
async function selectTargetPlayer(difficulty) {
  let sql;
  if (difficulty === 'trivial') {
    sql = `SELECT p.* FROM player p
           WHERE p.current_team IN (
             SELECT team_name FROM (SELECT team_name FROM team_ranking ORDER BY \`rank\` ASC LIMIT 30) AS top30
           )
           ORDER BY RAND() LIMIT 1`;
  } else if (difficulty === 'easy') {
    sql = `SELECT p.* FROM player p
           INNER JOIN team_ranking r ON r.team_name = p.current_team
           ORDER BY RAND() LIMIT 1`;
  } else if (difficulty === 'hard') {
    sql = `SELECT * FROM player
           WHERE current_team IS NOT NULL AND current_team != ''
           ORDER BY RAND() LIMIT 1`;
  } else {
    sql = 'SELECT * FROM player ORDER BY RAND() LIMIT 1';
  }

  try {
    const [rows] = await query(sql);
    if (rows.length === 0) {
      // 兜底：去掉所有条件再试
      const [fallback] = await query('SELECT * FROM player ORDER BY RAND() LIMIT 1');
      return fallback[0] || null;
    }
    return rows[0];
  } catch (err) {
    console.error('[pk] 选择目标选手失败:', err.message);
    const [fallback] = await query('SELECT * FROM player ORDER BY RAND() LIMIT 1');
    return fallback[0] || null;
  }
}

module.exports = router;
