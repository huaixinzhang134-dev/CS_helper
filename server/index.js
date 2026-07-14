// CS Match Pro 后端入口
require('dotenv').config();

const path = require('path');
const http = require('http');
const express = require('express');
const morgan = require('morgan');

const corsMiddleware = require('./middleware/cors');
const errorHandler = require('./middleware/error');

const playersRouter = require('./routes/players');
const matchesRouter = require('./routes/matches');
const commentsRouter = require('./routes/comments');
const teamsRouter = require('./routes/teams');
const syncRouter = require('./routes/sync');
const logoRouter = require('./routes/logo');
const usersRouter = require('./routes/users');
const coinsRouter = require('./routes/coins');
const votesRouter = require('./routes/votes');
const adminAuthRouter = require('./routes/admin-auth').router;

const { setupWebSocket } = require('./ws');

const app = express();
app.enable('trust proxy');  // 信任 Railway 反向代理
const PORT = parseInt(process.env.PORT || '3000', 10);

// 中间件
app.use(corsMiddleware);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));

// 静态资源服务：/static/players/<name>.png → server/public/players/<name>.png
// 跨域 cache-control + 长期缓存（图片更新频率低）
app.use(
  '/static',
  express.static(path.join(__dirname, 'public'), {
    maxAge: '7d',
    setHeaders(res) {
      res.setHeader('Access-Control-Allow-Origin', '*');
    }
  })
);

// 健康检查
app.get('/health', (req, res) => {
  res.json({ code: 0, message: 'ok', data: { time: Date.now() } });
});

// 业务路由
app.use('/api/players', playersRouter);
app.use('/api/matches', matchesRouter);
app.use('/api/comments', commentsRouter);

// 队伍路由（排名等）
app.use('/api/teams', teamsRouter);

// 爬虫同步路由（仅内网调用）
app.use('/api/matches/sync', syncRouter);

// 队标代理（SVG → PNG 转换）
app.use('/api/logo', logoRouter);

// 用户（微信登录、竞猜记录）
app.use('/api/users', usersRouter);

// PK 好友对战
app.use('/api/pk', require('./routes/pk'));

// 代币系统
app.use('/api/coins', coinsRouter);

// 年度投票
app.use('/api/votes', votesRouter);

// 管理员登录
app.use('/api/admin', adminAuthRouter);

// 管理后台网页
app.use('/admin', require('./routes/admin-web'));

// 404
app.use((req, res) => {
  res.status(404).json({ code: 404, message: '接口不存在', data: null });
});

// 错误处理
app.use(errorHandler);

// ==================== HTTP Server + WebSocket ====================
const server = http.createServer(app);

// 挂载 WebSocket（路径 /ws）
const { broadcastMatchUpdate, broadcastGlobal } = setupWebSocket(server);

// 将广播函数注入 app，供 sync 路由使用
app.set('broadcastMatchUpdate', broadcastMatchUpdate);
app.set('broadcastGlobal', broadcastGlobal);

// ==================== 启动 ====================
server.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`);
  console.log(`[server] WebSocket 路径: ws://localhost:${PORT}/ws`);
  if (process.env.NODE_ENV !== 'production') {
    console.log(`[server] 爬虫同步: POST http://localhost:${PORT}/api/matches/sync`);
  }
});