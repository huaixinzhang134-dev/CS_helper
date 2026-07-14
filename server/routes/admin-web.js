/**
 * 管理后台网页路由
 * 提供 /admin/* 路径的静态网页服务
 */
const express = require('express');
const router = express.Router();
const path = require('path');

// 直接托管 admin 静态目录
router.use(express.static(path.join(__dirname, '..', 'public', 'admin')));

// 所有 /admin/* 路径都返回 index.html（SPA）
router.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'admin', 'index.html'));
});

module.exports = router;
