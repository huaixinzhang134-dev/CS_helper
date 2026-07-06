const cors = require('cors');

// 开发环境开放所有 origin，生产请改为白名单
module.exports = cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
});