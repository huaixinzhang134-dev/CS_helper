/**
 * 选手年度投票路由（每位 top 独立提交，覆盖式，每 slot 最多 3 次）
 *
 * POST   /api/votes/submit-slot    提交某 top 的选择（覆盖上次）
 * GET    /api/votes/my-votes       查询我的全部投票
 * GET    /api/votes/statistics     查看统计
 * GET    /api/votes/slot-config    查看各 top 提交开关
 * POST   /api/votes/admin/slot-config  管理员设置提交开关
 * POST   /api/votes/admin/winners       设定官方 Top30
 * GET    /api/votes/admin/winners       查看官方 Top30
 * GET    /api/votes/admin/check         核对投票
 * POST   /api/votes/admin/award         发奖
 */
const express = require('express');
const router = express.Router();
const { query } = require('../db/pool');
const { authMiddleware } = require('../middleware/auth');

const CURRENT_YEAR = 2026;
const MAX_SUBMISSIONS_PER_SLOT = 3;

// ============================================================
// POST /api/votes/submit-slot
// Body: { year: 2026, slot: 1, playerGameId: "123", playerName: "s1mple" }
// ============================================================
router.post('/submit-slot', authMiddleware, async (req, res, next) => {
  try {
    const { year = CURRENT_YEAR, slot, playerGameId, playerName } = req.body || {};

    if (!slot || slot < 1 || slot > 30) {
      return res.status(400).json({ code: 400, message: 'slot 必须为 1-30', data: null });
    }
    if (!playerGameId) {
      return res.status(400).json({ code: 400, message: '请选择选手', data: null });
    }

    // 检查该 slot 是否可提交
    const [cfgRows] = await query(
      'SELECT can_submit FROM vote_slot_config WHERE year = ? AND slot = ?',
      [year, slot]
    );
    if (cfgRows[0] && cfgRows[0].can_submit === 0) {
      return res.status(400).json({ code: 400, message: '提交时间已过，不可提交', data: null });
    }

    // 查询当前该 slot 的提交次数
    const [existing] = await query(
      'SELECT id, submission_no FROM player_vote_slots WHERE user_openid = ? AND year = ? AND slot = ?',
      [req.userOpenid, year, slot]
    );

    if (existing[0] && existing[0].submission_no >= MAX_SUBMISSIONS_PER_SLOT) {
      return res.status(400).json({
        code: 400,
        message: `该位置已达最大提交次数（${MAX_SUBMISSIONS_PER_SLOT}次）`,
        data: null,
      });
    }

    const newSubmissionNo = existing[0] ? existing[0].submission_no + 1 : 1;

    // 覆盖写入（ON DUPLICATE KEY UPDATE）
    await query(
      `INSERT INTO player_vote_slots (user_openid, year, slot, submission_no, player_game_id, player_name)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE submission_no = VALUES(submission_no),
                               player_game_id = VALUES(player_game_id),
                               player_name = VALUES(player_name)`,
      [req.userOpenid, year, slot, newSubmissionNo, playerGameId, playerName || '']
    );

    res.json({
      code: 0,
      message: `Top${slot} 第 ${newSubmissionNo}/${MAX_SUBMISSIONS_PER_SLOT} 次提交成功`,
      data: { slot, submissionNo: newSubmissionNo, maxSubmissions: MAX_SUBMISSIONS_PER_SLOT },
    });
  } catch (err) { next(err); }
});

// ============================================================
// GET /api/votes/my-votes?year=2026
// 查询我的全部投票（每个 slot 的最新提交）
// ============================================================
router.get('/my-votes', authMiddleware, async (req, res, next) => {
  try {
    const year = parseInt(req.query.year || String(CURRENT_YEAR), 10);
    const [rows] = await query(
      'SELECT slot, submission_no, player_game_id, player_name FROM player_vote_slots WHERE user_openid = ? AND year = ? ORDER BY slot ASC',
      [req.userOpenid, year]
    );

    const selections = rows[0].map(r => ({
      slot: r.slot,
      playerGameId: r.player_game_id,
      playerName: r.player_name,
      submissionNo: r.submission_no,
      maxSubmissions: MAX_SUBMISSIONS_PER_SLOT,
    }));

    res.json({
      code: 0, message: '',
      data: {
        hasVoted: selections.length > 0,
        selections,
        year,
      }
    });
  } catch (err) { next(err); }
});

// ============================================================
// GET /api/votes/statistics?year=2026
// ============================================================
router.get('/statistics', async (req, res, next) => {
  try {
    const year = parseInt(req.query.year || String(CURRENT_YEAR), 10);

    // 每位选手总出现次数
    const [totalRows] = await query(
      `SELECT player_game_id, player_name, COUNT(*) AS total_appearances
       FROM player_vote_slots WHERE year = ?
       GROUP BY player_game_id, player_name
       ORDER BY total_appearances DESC LIMIT 100`,
      [year]
    );

    // 每个 slot 的统计
    const [slotRows] = await query(
      `SELECT slot, player_game_id, player_name, COUNT(*) AS count
       FROM player_vote_slots WHERE year = ?
       GROUP BY slot, player_game_id, player_name
       ORDER BY slot ASC, count DESC`,
      [year]
    );

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
// GET /api/votes/slot-config?year=2026
// ============================================================
router.get('/slot-config', async (req, res, next) => {
  try {
    const year = parseInt(req.query.year || String(CURRENT_YEAR), 10);
    const [rows] = await query(
      'SELECT slot, can_submit FROM vote_slot_config WHERE year = ? ORDER BY slot ASC',
      [year]
    );

    const config = {};
    for (const r of rows[0]) {
      config[r.slot] = !!r.can_submit;
    }

    res.json({ code: 0, message: '', data: { year, config } });
  } catch (err) { next(err); }
});

// ============================================================
// 管理员：设置提交开关
// POST /api/votes/admin/slot-config
// Body: { year: 2026, config: { "1": true, "2": false, ... } }
// ============================================================
router.post('/admin/slot-config', async (req, res, next) => {
  try {
    const { year = CURRENT_YEAR, config } = req.body || {};
    if (!config) return res.status(400).json({ code: 400, message: '缺少 config', data: null });

    for (const [slot, canSubmit] of Object.entries(config)) {
      await query(
        'INSERT INTO vote_slot_config (year, slot, can_submit) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE can_submit = ?',
        [year, parseInt(slot), canSubmit ? 1 : 0, canSubmit ? 1 : 0]
      );
    }

    res.json({ code: 0, message: '配置已更新', data: null });
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
    await query('DELETE FROM vote_winners WHERE year = ?', [year]);
    for (const w of winners) {
      await query(
        'INSERT INTO vote_winners (year, `rank`, player_game_id, player_name, set_by) VALUES (?, ?, ?, ?, ?)',
        [year, w.rank, w.playerGameId, w.playerName || '', adminOpenid || 'admin']
      );
    }
    res.json({ code: 0, message: `已设定 ${year} 年 Top${winners.length}`, data: { count: winners.length } });
  } catch (err) { next(err); }
});

// ============================================================
// 管理员接口：查看年度官方 Top30
// ============================================================
router.get('/admin/winners', async (req, res, next) => {
  try {
    const year = parseInt(req.query.year || String(CURRENT_YEAR), 10);
    const [rows] = await query(
      'SELECT `rank`, player_game_id, player_name FROM vote_winners WHERE year = ? ORDER BY `rank` ASC',
      [year]
    );
    res.json({
      code: 0, message: '',
      data: { year, hasSet: rows[0].length > 0, winners: rows[0].map(r => ({ rank: r.rank, playerGameId: r.player_game_id, playerName: r.player_name })) }
    });
  } catch (err) { next(err); }
});

// ============================================================
// 管理员接口：核对投票结果
// GET /api/votes/admin/check?year=2026&matchThreshold=20
// ============================================================
router.get('/admin/check', async (req, res, next) => {
  try {
    const year = parseInt(req.query.year || String(CURRENT_YEAR), 10);
    const matchThreshold = parseInt(req.query.matchThreshold || '0', 10);
    const page = Math.max(parseInt(req.query.page || '0', 10), 0);
    const pageSize = Math.min(Math.max(parseInt(req.query.pageSize || '20', 10), 1), 100);
    const offset = page * pageSize;

    const [winnerRows] = await query(
      'SELECT `rank`, player_game_id FROM vote_winners WHERE year = ? ORDER BY `rank` ASC',
      [year]
    );
    if (winnerRows[0].length === 0) {
      return res.status(400).json({ code: 400, message: '尚未设定该年份的官方 Top30', data: null });
    }

    const winnerMap = new Map();
    for (const w of winnerRows[0]) winnerMap.set(w.rank, w.player_game_id);

    // 获取所有用户对各 slot 的投票
    const [users] = await query(
      `SELECT DISTINCT pvs.user_openid, u.nickname
       FROM player_vote_slots pvs
       LEFT JOIN users u ON u.openid = pvs.user_openid
       WHERE pvs.year = ?
       ORDER BY pvs.user_openid`,
      [year]
    );

    const allResults = [];
    const userRows = users[0] || [];
    for (const user of userRows) {
      const [items] = await query(
        'SELECT slot, player_game_id FROM player_vote_slots WHERE user_openid = ? AND year = ? ORDER BY slot ASC',
        [user.user_openid, year]
      );

      let matchedCount = 0;
      const matchDetails = [];
      for (const item of items[0]) {
        const official = winnerMap.get(item.slot);
        const isMatch = official === item.player_game_id;
        if (isMatch) matchedCount++;
        matchDetails.push({ slot: item.slot, userPlayerGameId: item.player_game_id, officialPlayerGameId: official || '', isMatch });
      }

      allResults.push({ openid: user.user_openid, nickname: user.nickname || '未知', matchedCount, totalSlots: winnerRows[0].length, matchDetails });
    }

    const filtered = matchThreshold > 0 ? allResults.filter(r => r.matchedCount >= matchThreshold) : allResults;
    const paged = filtered.slice(offset, offset + pageSize);

    res.json({ code: 0, message: '', data: { list: paged, total: filtered.length, totalSubmissions: userRows.length, page, pageSize, hasMore: offset + pageSize < filtered.length, year } });
  } catch (err) { next(err); }
});

// ============================================================
// 管理员接口：发放代币奖励
// POST /api/votes/admin/award
// ============================================================
router.post('/admin/award', async (req, res, next) => {
  try {
    const { year = CURRENT_YEAR, matchThreshold = 15, coinsPerMatch = 10, adminOpenid = 'admin' } = req.body || {};

    const [winnerRows] = await query(
      'SELECT `rank`, player_game_id FROM vote_winners WHERE year = ? ORDER BY `rank` ASC',
      [year]
    );
    if (winnerRows[0].length === 0) {
      return res.status(400).json({ code: 400, message: '尚未设定该年份的官方 Top30', data: null });
    }

    const winnerMap = new Map();
    for (const w of winnerRows[0]) winnerMap.set(w.rank, w.player_game_id);

    const [users] = await query(
      'SELECT DISTINCT user_openid FROM player_vote_slots WHERE year = ?', [year]
    );

    const conn = require('../db/pool').pool;
    const c = await conn.getConnection();
    try {
      await c.beginTransaction();
      let awardedCount = 0, totalCoins = 0;

      for (const user of users[0]) {
        const [items] = await c.query(
          'SELECT slot, player_game_id FROM player_vote_slots WHERE user_openid = ? AND year = ? ORDER BY slot ASC',
          [user.user_openid, year]
        );

        let matchedCount = 0;
        for (const item of items[0]) {
          if (winnerMap.get(item.slot) === item.player_game_id) matchedCount++;
        }

        if (matchedCount >= matchThreshold) {
          const reward = matchedCount * coinsPerMatch;
          const [awardRows] = await c.query('SELECT id FROM vote_awards WHERE year = ? AND user_openid = ?', [year, user.user_openid]);
          if (awardRows[0].length > 0) continue;

          await c.query('UPDATE users SET coins = coins + ?, total_coins_earned = total_coins_earned + ? WHERE openid = ?', [reward, reward, user.user_openid]);
          await c.query('INSERT INTO coin_transactions (user_openid, amount, balance_after, type, description) VALUES (?, ?, (SELECT coins FROM users WHERE openid = ?), ?, ?)', [user.user_openid, reward, user.user_openid, 'reward', `年度投票奖励: 猜对${matchedCount}人`]);
          await c.query('INSERT INTO vote_awards (year, user_openid, match_count, reward_coins, awarded_by) VALUES (?, ?, ?, ?, ?)', [year, user.user_openid, matchedCount, reward, adminOpenid]);
          awardedCount++;
          totalCoins += reward;
        }
      }

      await c.commit();
      res.json({ code: 0, message: '发奖完成', data: { year, awardedUsers: awardedCount, totalCoinsAwarded: totalCoins, matchThreshold, coinsPerMatch } });
    } catch (err) {
      await c.rollback();
      throw err;
    } finally {
      c.release();
    }
  } catch (err) { next(err); }
});

module.exports = router;
