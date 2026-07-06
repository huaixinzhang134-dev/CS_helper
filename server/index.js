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

const { setupWebSocket } = require('./ws');

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

// 中间件
app.use(corsMiddleware);
app.use(express.json({ limit: '1mb' }));
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