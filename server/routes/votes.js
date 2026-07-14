/**
 * 选手年度投票路由（问卷形式）
 * 每人最多提交 3 次，每次覆盖上次
 * 每次选择 top1 ~ top30 共 30 名选手
 *
 * POST   /api/votes/submit       提交/覆盖投票
 * GET    /api/votes/my-votes     查询我的当前投票
 * GET    /api/votes/statistics   查看统计结果
 */
const express = require('express');
const router = express.Router();
const { query } = require('../db/pool');
const { authMiddleware } = require('../middleware/auth');

const CURRENT_YEAR = 2026;
const MAX_SUBMISSIONS = 3;
const MAX_SLOTS = 30;

// ============================================================
// POST /api/votes/submit
// Body: { year: 2026, selections: [{ slot: 1, playerGameId: "123", playerName: "s1mple" }, ...] }
// slot: 1~30 对应 top1~top30
// ============================================================
router.post('/submit', authMiddleware, async (req, res, next) => {
  try {
    const { year = CURRENT_YEAR, selections } = req.body || {};

    if (!selections || !Array.isArray(selections) || selections.length === 0) {
      return res.status(400).json({ code: 400, message: '请选择至少一名选手', data: null });
    }
    if (selections.length > MAX_SLOTS) {
      return res.status(400).json({ code: 400, message: `最多选择 ${MAX_SLOTS} 名选手`, data: null });
    }

    // 校验 slot 不重复
    const slots = selections.map(s => s.slot);
    if (new Set(slots).size !== slots.length) {
      return res.status(400).json({ code: 400, message: '排名位置不能重复', data: null });
    }

    // 查询当前提交次数
    const [countRows] = await query(
      'SELECT COUNT(*) AS cnt FROM player_vote_records WHERE user_openid = ? AND year = ?',
      [req.userOpenid, year]
    );
    const currentCount = countRows[0].cnt;

    if (currentCount >= MAX_SUBMISSIONS) {
      return res.status(400).json({ code: 400, message: `每人最多提交 ${MAX_SUBMISSIONS} 次`, data: null });
    }

    const submissionNo = currentCount + 1;

    // 如果有上一次的提交，删除（覆盖）
    const conn = require('../db/pool').pool;
    const connection = await conn.getConnection();
    try {
      await connection.beginTransaction();

      // 删除该用户该年份的所有旧记录
      const [oldRecords] = await connection.query(
        'SELECT id FROM player_vote_records WHERE user_openid = ? AND year = ?',
        [req.userOpenid, year]
      );
      for (const old of oldRecords[0]) {
        await connection.query('DELETE FROM player_vote_items WHERE record_id = ?', [old.id]);
      }
      await connection.query(
        'DELETE FROM player_vote_records WHERE user_openid = ? AND year = ?',
        [req.userOpenid, year]
      );

      // 插入新记录
      const [insertResult] = await connection.query(
        'INSERT INTO player_vote_records (user_openid, year, submission_no) VALUES (?, ?, ?)',
        [req.userOpenid, year, submissionNo]
      );
      const recordId = insertResult.insertId;

      for (const s of selections) {
        await connection.query(
          'INSERT INTO player_vote_items (record_id, slot, player_game_id, player_name) VALUES (?, ?, ?, ?)',
          [recordId, s.slot, s.playerGameId || '', s.playerName || '']
        );
      }

      await connection.commit();

      res.json({
        code: 0, message: `第 ${submissionNo} 次投票成功`,
        data: { submissionNo, count: selections.length }
      });
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  } catch (err) { next(err); }
});

// ============================================================
// GET /api/votes/my-votes?year=2026
// 查询我的当前投票
// ============================================================
router.get('/my-votes', authMiddleware, async (req, res, next) => {
  try {
    const year = parseInt(req.query.year || String(CURRENT_YEAR), 10);

    const [records] = await query(
      'SELECT id, submission_no, created_at FROM player_vote_records WHERE user_openid = ? AND year = ? ORDER BY submission_no DESC LIMIT 1',
      [req.userOpenid, year]
    );

    if (!records[0]) {
      return res.json({
        code: 0, message: '',
        data: { hasVoted: false, submissionNo: 0, selections: [], year }
      });
    }

    const record = records[0];
    const [items] = await query(
      'SELECT slot, player_game_id, player_name FROM player_vote_items WHERE record_id = ? ORDER BY slot ASC',
      [record.id]
    );

    res.json({
      code: 0, message: '',
      data: {
        hasVoted: true,
        submissionNo: record.submission_no,
        submittedAt: record.created_at,
        selections: items[0].map(r => ({
          slot: r.slot,
          playerGameId: r.player_game_id,
          playerName: r.player_name,
        })),
        year,
      }
    });
  } catch (err) { next(err); }
});

// ============================================================
// GET /api/votes/statistics?year=2026
// 统计 top1~top30 各位置出现最多的选手
// ============================================================
router.get('/statistics', async (req, res, next) => {
  try {
    const year = parseInt(req.query.year || String(CURRENT_YEAR), 10);

    // 每位选手总出现次数（在所有top1~30位置中）
    const [totalRows] = await query(
      `SELECT pvi.player_game_id, pvi.player_name, COUNT(*) AS total_appearances
       FROM player_vote_items pvi
       JOIN player_vote_records pvr ON pvr.id = pvi.record_id
       WHERE pvr.year = ?
       GROUP BY pvi.player_game_id, pvi.player_name
       ORDER BY total_appearances DESC
       LIMIT 100`,
      [year]
    );

    // 每个 slot 的统计
    const [slotRows] = await query(
      `SELECT pvi.slot, pvi.player_game_id, pvi.player_name, COUNT(*) AS count
       FROM player_vote_items pvi
       JOIN player_vote_records pvr ON pvr.id = pvi.record_id
       WHERE pvr.year = ?
       GROUP BY pvi.slot, pvi.player_game_id, pvi.player_name
       ORDER BY pvi.slot ASC, count DESC`,
      [year]
    );

    // 整理 slot 数据
    const slotStats = {};
    for (const r of slotRows[0]) {
      if (!slotStats[r.slot]) slotStats[r.slot] = [];
      if (slotStats[r.slot].length < 5) {
        slotStats[r.slot].push({
          playerGameId: r.player_game_id,
          playerName: r.player_name,
          count: r.count,
        });
      }
    }

    res.json({
      code: 0, message: '',
      data: {
        year,
        totalSubmissions: 0, // 可由前端另行请求
        overall: totalRows[0].map((r, i) => ({
          rank: i + 1,
          playerGameId: r.player_game_id,
          playerName: r.player_name,
          totalAppearances: r.total_appearances,
        })),
        bySlot: slotStats,
      }
    });
  } catch (err) { next(err); }
});

// ============================================================
// 管理员接口：设定年度官方 Top30
// POST /api/votes/admin/winners
// Body: { year: 2026, winners: [{ rank: 1, playerGameId: "123", playerName: "s1mple" }, ...] }
// ============================================================
router.post('/admin/winners', async (req, res, next) => {
  try {
    const { year = CURRENT_YEAR, winners, adminOpenid } = req.body || {};
    if (!winners || !Array.isArray(winners) || winners.length === 0) {
      return res.status(400).json({ code: 400, message: '请提供获奖名单', data: null });
    }

    // 先清除该年份旧记录
    await query('DELETE FROM vote_winners WHERE year = ?', [year]);

    // 批量插入
    for (const w of winners) {
      await query(
        'INSERT INTO vote_winners (year, rank, player_game_id, player_name, set_by) VALUES (?, ?, ?, ?, ?)',
        [year, w.rank, w.playerGameId, w.playerName || '', adminOpenid || 'admin']
      );
    }

    res.json({ code: 0, message: `已设定 ${year} 年 Top${winners.length}`, data: { count: winners.length } });
  } catch (err) { next(err); }
});

// ============================================================
// 管理员接口：查看年度官方 Top30
// GET /api/votes/admin/winners?year=2026
// ============================================================
router.get('/admin/winners', async (req, res, next) => {
  try {
    const year = parseInt(req.query.year || String(CURRENT_YEAR), 10);
    const [rows] = await query(
      'SELECT rank, player_game_id, player_name FROM vote_winners WHERE year = ? ORDER BY rank ASC',
      [year]
    );
    res.json({
      code: 0, message: '',
      data: {
        year,
        hasSet: rows[0].length > 0,
        winners: rows[0].map(r => ({
          rank: r.rank,
          playerGameId: r.player_game_id,
          playerName: r.player_name,
        })),
      }
    });
  } catch (err) { next(err); }
});

// ============================================================
// 管理员接口：核对投票结果
// GET /api/votes/admin/check?year=2026&matchThreshold=20
// 返回猜对 N 人以上的用户列表
// ============================================================
router.get('/admin/check', async (req, res, next) => {
  try {
    const year = parseInt(req.query.year || String(CURRENT_YEAR), 10);
    const matchThreshold = parseInt(req.query.matchThreshold || '0', 10);
    const page = Math.max(parseInt(req.query.page || '0', 10), 0);
    const pageSize = Math.min(Math.max(parseInt(req.query.pageSize || '20', 10), 1), 100);
    const offset = page * pageSize;

    // 获取官方 winners
    const [winnerRows] = await query(
      'SELECT rank, player_game_id FROM vote_winners WHERE year = ? ORDER BY rank ASC',
      [year]
    );
    if (winnerRows[0].length === 0) {
      return res.status(400).json({ code: 400, message: '尚未设定该年份的官方 Top30', data: null });
    }

    const winnerMap = new Map();
    for (const w of winnerRows[0]) {
      winnerMap.set(w.rank, w.player_game_id);
    }

    // 获取所有用户的最后一轮投票
    const [records] = await query(
      `SELECT pvr.id, pvr.user_openid, pvr.submission_no, u.nickname
       FROM player_vote_records pvr
       LEFT JOIN users u ON u.openid = pvr.user_openid
       WHERE pvr.year = ?
         AND pvr.id IN (
           SELECT MAX(id) FROM player_vote_records WHERE year = ? GROUP BY user_openid
         )
       ORDER BY pvr.id DESC`,
      [year, year]
    );

    // 逐用户核对
    const allResults = [];
    for (const rec of records[0]) {
      const [items] = await query(
        'SELECT slot, player_game_id FROM player_vote_items WHERE record_id = ? ORDER BY slot ASC',
        [rec.id]
      );

      let matchedCount = 0;
      const matchDetails = [];
      for (const item of items[0]) {
        const officialPlayer = winnerMap.get(item.slot);
        const isMatch = officialPlayer === item.player_game_id;
        if (isMatch) matchedCount++;
        matchDetails.push({
          slot: item.slot,
          userPlayerGameId: item.player_game_id,
          officialPlayerGameId: officialPlayer || '',
          isMatch,
        });
      }

      allResults.push({
        openid: rec.user_openid,
        nickname: rec.nickname || '未知',
        submissionNo: rec.submission_no,
        matchedCount,
        totalSlots: winnerRows[0].length,
        matchDetails,
      });
    }

    // 筛选 + 分页
    const filtered = matchThreshold > 0
      ? allResults.filter(r => r.matchedCount >= matchThreshold)
      : allResults;
    const total = filtered.length;
    const paged = filtered.slice(offset, offset + pageSize);

    res.json({
      code: 0, message: '',
      data: {
        list: paged,
        total,
        totalSubmissions: records[0].length,
        page, pageSize,
        hasMore: offset + pageSize < total,
        year,
      }
    });
  } catch (err) { next(err); }
});

// ============================================================
// 管理员接口：发放代币奖励
// POST /api/votes/admin/award
// Body: { year: 2026, matchThreshold: 20, coinsPerMatch: 10, adminOpenid: "xxx" }
// 猜对 matchThreshold 人以上的用户，每猜对一个奖励 coinsPerMatch 代币
// ============================================================
router.post('/admin/award', async (req, res, next) => {
  try {
    const { year = CURRENT_YEAR, matchThreshold = 15, coinsPerMatch = 10, adminOpenid = 'admin' } = req.body || {};

    // 获取官方 winners
    const [winnerRows] = await query(
      'SELECT rank, player_game_id FROM vote_winners WHERE year = ? ORDER BY rank ASC',
      [year]
    );
    if (winnerRows[0].length === 0) {
      return res.status(400).json({ code: 400, message: '尚未设定该年份的官方 Top30', data: null });
    }

    const winnerMap = new Map();
    for (const w of winnerRows[0]) {
      winnerMap.set(w.rank, w.player_game_id);
    }

    // 获取所有用户的最后一轮投票
    const [records] = await query(
      `SELECT pvr.id, pvr.user_openid
       FROM player_vote_records pvr
       WHERE pvr.year = ?
         AND pvr.id IN (
           SELECT MAX(id) FROM player_vote_records WHERE year = ? GROUP BY user_openid
         )`,
      [year, year]
    );

    const conn = require('../db/pool').pool;
    const connection = await conn.getConnection();
    try {
      await connection.beginTransaction();

      let awardedCount = 0;
      let totalCoins = 0;

      for (const rec of records[0]) {
        const [items] = await connection.query(
          'SELECT slot, player_game_id FROM player_vote_items WHERE record_id = ? ORDER BY slot ASC',
          [rec.id]
        );

        let matchedCount = 0;
        for (const item of items[0]) {
          const officialPlayer = winnerMap.get(item.slot);
          if (officialPlayer === item.player_game_id) matchedCount++;
        }

        if (matchedCount >= matchThreshold) {
          const reward = matchedCount * coinsPerMatch;

          // 检查是否已经发过奖
          const [awardRows] = await connection.query(
            'SELECT id FROM vote_awards WHERE year = ? AND user_openid = ?',
            [year, rec.user_openid]
          );

          if (awardRows[0].length > 0) continue; // 已发过，跳过

          // 发代币
          await connection.query(
            'UPDATE users SET coins = coins + ?, total_coins_earned = total_coins_earned + ? WHERE openid = ?',
            [reward, reward, rec.user_openid]
          );

          // 记录交易
          await connection.query(
            'INSERT INTO coin_transactions (user_openid, amount, balance_after, type, description) VALUES (?, ?, (SELECT coins FROM users WHERE openid = ?), ?, ?)',
            [rec.user_openid, reward, rec.user_openid, 'reward', `年度投票奖励: 猜对${matchedCount}人`]
          );

          // 记录发奖
          await connection.query(
            'INSERT INTO vote_awards (year, user_openid, match_count, reward_coins, awarded_by) VALUES (?, ?, ?, ?, ?)',
            [year, rec.user_openid, matchedCount, reward, adminOpenid]
          );

          awardedCount++;
          totalCoins += reward;
        }
      }

      await connection.commit();

      res.json({
        code: 0, message: '发奖完成',
        data: {
          year,
          awardedUsers: awardedCount,
          totalCoinsAwarded: totalCoins,
          matchThreshold,
          coinsPerMatch,
        }
      });
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  } catch (err) { next(err); }
});

module.exports = router;
