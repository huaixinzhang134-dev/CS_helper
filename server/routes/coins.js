/**
 * 代币系统路由
 *
 * GET    /api/coins/balance      获取代币余额
 * GET    /api/coins/transactions 获取交易记录
 * POST   /api/coins/recharge     充值（管理员/支付回调）
 * POST   /api/coins/spend        消费代币
 * POST   /api/coins/activity     活动奖励
 * GET    /api/coins/shop         获取商品列表
 * POST   /api/coins/shop/buy     购买商品
 * GET    /api/coins/items        获取用户道具库存
 */
const express = require('express');
const router = express.Router();
const { query } = require('../db/pool');
const { authMiddleware } = require('../middleware/auth');

// ============================================================
// 工具函数 - 代币变动 + 记录交易
// ============================================================
async function changeCoins(openid, amount, type, description) {
  const [rows] = await query('SELECT coins, total_coins_earned FROM users WHERE openid = ? LIMIT 1', [openid]);
  if (!rows[0]) throw new Error('用户不存在');

  const currentCoins = rows[0].coins || 0;
  if (amount < 0 && currentCoins < Math.abs(amount)) {
    throw new Error('代币不足');
  }

  const newBalance = currentCoins + amount;
  const newTotalEarned = (rows[0].total_coins_earned || 0) + (amount > 0 ? amount : 0);

  await query(
    'UPDATE users SET coins = ?, total_coins_earned = ? WHERE openid = ?',
    [newBalance, newTotalEarned, openid]
  );

  await query(
    'INSERT INTO coin_transactions (user_openid, amount, balance_after, type, description) VALUES (?, ?, ?, ?, ?)',
    [openid, amount, newBalance, type, description]
  );

  return newBalance;
}

// ============================================================
// GET /api/coins/balance
// ============================================================
router.get('/balance', authMiddleware, async (req, res, next) => {
  try {
    const [rows] = await query('SELECT coins, total_coins_earned FROM users WHERE openid = ? LIMIT 1', [req.userOpenid]);
    if (!rows[0]) return res.status(404).json({ code: 404, message: '用户不存在', data: null });
    res.json({
      code: 0, message: '',
      data: {
        coins: rows[0].coins || 0,
        totalCoinsEarned: rows[0].total_coins_earned || 0,
      }
    });
  } catch (err) { next(err); }
});

// ============================================================
// GET /api/coins/transactions?page=0&pageSize=20
// ============================================================
router.get('/transactions', authMiddleware, async (req, res, next) => {
  try {
    const page = Math.max(parseInt(req.query.page || '0', 10), 0);
    const pageSize = Math.min(Math.max(parseInt(req.query.pageSize || '20', 10), 1), 50);
    const offset = page * pageSize;

    const [rows, countRows] = await Promise.all([
      query(
        'SELECT * FROM coin_transactions WHERE user_openid = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
        [req.userOpenid, String(pageSize), String(offset)]
      ),
      query('SELECT COUNT(*) AS total FROM coin_transactions WHERE user_openid = ?', [req.userOpenid]),
    ]);

    res.json({
      code: 0, message: '',
      data: {
        list: rows[0].map(r => ({
          id: r.id,
          amount: r.amount,
          balanceAfter: r.balance_after,
          type: r.type,
          description: r.description,
          createdAt: r.created_at,
        })),
        total: countRows[0][0].total,
        page, pageSize,
        hasMore: (page + 1) * pageSize < countRows[0][0].total,
      }
    });
  } catch (err) { next(err); }
});

// ============================================================
// POST /api/coins/recharge
// 管理员充值 or 支付回调
// Body: { openid, amount, description }
// ============================================================
router.post('/recharge', async (req, res, next) => {
  try {
    const { openid, amount, description } = req.body || {};
    if (!openid || !amount || amount <= 0) {
      return res.status(400).json({ code: 400, message: '参数错误', data: null });
    }

    const newBalance = await changeCoins(openid, amount, 'recharge', description || '充值');
    res.json({ code: 0, message: '充值成功', data: { coins: newBalance } });
  } catch (err) { next(err); }
});

// ============================================================
// POST /api/coins/spend
// 消费代币（通用扣减）
// Body: { amount, description }
// ============================================================
router.post('/spend', authMiddleware, async (req, res, next) => {
  try {
    const { amount, description } = req.body || {};
    if (!amount || amount <= 0) {
      return res.status(400).json({ code: 400, message: '参数错误', data: null });
    }

    const newBalance = await changeCoins(req.userOpenid, -amount, 'spend', description || '消费');
    res.json({ code: 0, message: '消费成功', data: { coins: newBalance } });
  } catch (err) {
    if (err.message === '代币不足') {
      return res.status(400).json({ code: 400, message: '代币不足', data: null });
    }
    next(err);
  }
});

// ============================================================
// POST /api/coins/activity
// 活动奖励
// Body: { openid, amount, description }
// ============================================================
router.post('/activity', async (req, res, next) => {
  try {
    const { openid, amount, description } = req.body || {};
    if (!openid || !amount || amount <= 0) {
      return res.status(400).json({ code: 400, message: '参数错误', data: null });
    }

    const newBalance = await changeCoins(openid, amount, 'activity', description || '活动奖励');
    res.json({ code: 0, message: '奖励发放成功', data: { coins: newBalance } });
  } catch (err) { next(err); }
});

// ============================================================
// GET /api/coins/shop - 商品列表
// ============================================================
router.get('/shop', async (req, res, next) => {
  try {
    const [rows] = await query('SELECT * FROM shop_items WHERE enabled = 1 ORDER BY price ASC');
    res.json({
      code: 0, message: '',
      data: rows[0].map(item => ({
        id: item.id,
        name: item.name,
        description: item.description,
        price: item.price,
        icon: item.icon,
        itemType: item.item_type,
        maxPerUser: item.max_per_user,
      }))
    });
  } catch (err) { next(err); }
});

// ============================================================
// POST /api/coins/shop/buy - 购买道具
// Body: { itemId, quantity }
// ============================================================
router.post('/shop/buy', authMiddleware, async (req, res, next) => {
  try {
    const { itemId, quantity = 1 } = req.body || {};
    if (!itemId) return res.status(400).json({ code: 400, message: 'itemId 必填', data: null });

    const [shopRows] = await query('SELECT * FROM shop_items WHERE id = ? AND enabled = 1', [itemId]);
    if (!shopRows[0]) return res.status(404).json({ code: 404, message: '商品不存在', data: null });

    const item = shopRows[0];
    const totalPrice = item.price * quantity;

    // 检查限购
    if (item.max_per_user > 0) {
      const [userItemRows] = await query(
        'SELECT quantity FROM user_items WHERE user_openid = ? AND item_type = ?',
        [req.userOpenid, item.item_type]
      );
      const owned = userItemRows[0]?.quantity || 0;
      if (owned + quantity > item.max_per_user) {
        return res.status(400).json({ code: 400, message: `该道具限购 ${item.max_per_user} 个`, data: null });
      }
    }

    // 扣代币 + 给道具（原子操作）
    const conn = require('../db/pool').pool;
    const connection = await conn.getConnection();
    try {
      await connection.beginTransaction();

      // 检查余额
      const [userRows] = await connection.query('SELECT coins FROM users WHERE openid = ? FOR UPDATE', [req.userOpenid]);
      if (!userRows[0] || userRows[0].coins < totalPrice) {
        await connection.rollback();
        return res.status(400).json({ code: 400, message: '代币不足', data: null });
      }

      // 扣代币
      await connection.query('UPDATE users SET coins = coins - ? WHERE openid = ?', [totalPrice, req.userOpenid]);

      // 记录交易
      await connection.query(
        'INSERT INTO coin_transactions (user_openid, amount, balance_after, type, description) VALUES (?, ?, (SELECT coins FROM users WHERE openid = ?), ?, ?)',
        [req.userOpenid, -totalPrice, req.userOpenid, 'spend', `购买 ${item.name} x${quantity}`]
      );

      // 给道具 ON DUPLICATE KEY UPDATE
      await connection.query(
        'INSERT INTO user_items (user_openid, item_type, quantity) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE quantity = quantity + ?',
        [req.userOpenid, item.item_type, quantity, quantity]
      );

      await connection.commit();

      const [balanceRows] = await query('SELECT coins FROM users WHERE openid = ?', [req.userOpenid]);

      res.json({
        code: 0, message: '购买成功',
        data: { coins: balanceRows[0]?.coins || 0, itemType: item.item_type }
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
// GET /api/coins/items - 用户道具库存
// ============================================================
router.get('/items', authMiddleware, async (req, res, next) => {
  try {
    const [rows] = await query('SELECT * FROM user_items WHERE user_openid = ?', [req.userOpenid]);
    res.json({
      code: 0, message: '',
      data: rows[0].map(r => ({
        itemType: r.item_type,
        quantity: r.quantity,
      }))
    });
  } catch (err) { next(err); }
});

module.exports = router;
