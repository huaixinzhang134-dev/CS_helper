# CS Match Pro 后端

自建 Node.js + Express + MySQL 后端，替代原 CloudBase 云函数。

## 技术栈

- Node.js 18+
- Express 4 (REST API)
- WebSocket (ws) — 实时赛事数据推送
- mysql2 / promise（连接池）
- axios + cheerio — 5eplay 赛事爬虫（轻量，无 Puppeteer）
- PM2 — 进程管理（双进程架构）
- cors / dotenv / morgan / nodemon（dev）

## 架构

```
┌─────────────────────────────────────────────────────┐
│  PM2 进程 1: cs-match-api                            │
│  ├── Express (端口 3000)                              │
│  ├── WebSocket (/ws)                                  │
│  └── REST API (/api/*)                                │
├─────────────────────────────────────────────────────┤
│  PM2 进程 2: cs-match-crawler                         │
│  ├── axios → 5eplay 赛事页 (每 30s)                   │
│  └── POST /api/matches/sync → API 进程                 │
└─────────────────────────────────────────────────────┘
```

## 目录结构

```
server/
├── index.js               # 入口 + WS 附着
├── ecosystem.config.js    # PM2 双进程配置
├── db/pool.js             # MySQL 连接池
├── middleware/             # cors / 错误处理
├── routes/                # players / matches / comments / sync
├── ws/index.js            # WebSocket 服务 + 广播
├── crawler/
│   ├── crawler-service.js # 定时爬虫入口（PM2 进程2）
│   └── 5eplay-api.js      # 5eplay 数据抓取封装
├── .env                   # 实际凭据（git 忽略）
├── .env.example           # 模板
└── package.json
```

## 本地启动

### 1. 准备 MySQL

```bash
# 创建数据库
mysql -u root -p < crawler/schema.sql
mysql -u root -p cs_match_pro < crawler/schema_v2.sql

# 导入数据
cd crawler
python import_to_sql.py
```

### 2. 配置环境变量

复制 `.env.example` 为 `.env`，确认以下值：

```
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASS=201005
DB_NAME=cs_match_pro
PORT=3000
```

### 3. 安装依赖 + 启动

```bash
cd server
npm install
npm run dev   # nodemon 热重载
# 或
npm start
```

看到 `[server] listening on http://localhost:3000` 即启动成功。

## 接口列表

### 健康检查
- `GET /health`

### 选手（/api/players）
- `GET    /api/players?skip=&limit=`            列表
- `GET    /api/players/count`                   总数
- `GET    /api/players/random`                  随机
- `GET    /api/players/search?q=&page=&pageSize=` 模糊搜索
- `GET    /api/players/:playerId`               详情
- `POST   /api/players`                         创建（admin）
- `PUT    /api/players/:playerId`               更新（admin）
- `DELETE /api/players/:playerId`               删除（admin）

### 比赛（/api/matches）
- `GET    /api/matches`                         列表
- `GET    /api/matches/:id`                     详情
- `GET    /api/matches/:id/players`             两队选手
- `POST   /api/matches`                         创建（admin）
- `PUT    /api/matches/:id`                     更新（admin）
- `DELETE /api/matches/:id`                     删除（admin）

### 评论（/api/comments）
- `GET    /api/comments?matchId=&playerId=&page=` 列表
- `POST   /api/comments`                        发评论（body: matchId/playerId/content/userOpenid）
- `DELETE /api/comments/:id?userOpenid=`        删自己评论（软删除）

## 公网部署

### 1. 购买云服务器

推荐配置：1 核 2G（轻量级）、Ubuntu 20.04/22.04。

### 2. 安装 Node.js + MySQL

```bash
# Node.js 18 LTS
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs

# MySQL 8.0
sudo apt install -y mysql-server
sudo mysql_secure_installation
```

### 3. 上传项目 + 配 .env

把 `server/` 目录上传到服务器 `/opt/cs-match-pro/server/`，编辑 `.env` 改成生产 MySQL 凭据。

### 4. 用 PM2 守护进程

```bash
sudo npm install -g pm2
cd /opt/cs-match-pro/server
npm install --production

# 启动双进程（API + 爬虫）
pm2 start ecosystem.config.js

# 查看状态
pm2 status
pm2 logs

# 保存进程列表，开机自启
pm2 startup
pm2 save
```

也可以单独控制每个进程：
```bash
pm2 start ecosystem.config.js --only api      # 只启动 API
pm2 restart cs-match-crawler                   # 只重启爬虫
pm2 logs cs-match-crawler                      # 只看爬虫日志
```

### 5. Nginx 反向代理 + HTTPS（支持 WebSocket）

```nginx
# /etc/nginx/sites-available/cs-match-pro
server {
    listen 80;
    server_name your.domain.com;

    # REST API + 静态资源
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;

        # 大请求体（评论内容等）
        client_max_body_size 2m;
    }

    # WebSocket 需要额外的升级头
    location /ws {
        proxy_pass http://127.0.0.1:3000/ws;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;

        # WS 长连接超时（必须大于心跳间隔 30s）
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }
}
```

用 certbot 申请 HTTPS：
```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your.domain.com
```

### 6. 小程序后台配置

微信公众平台 → 开发管理 → 服务器域名 → request 合法域名：
```
https://your.domain.com
```

然后把 [miniprogram/config.ts](../miniprogram/config.ts) 中的 `API_BASE` 改为：
```ts
export const API_BASE = 'https://your.domain.com/api';
```

## 用户登录升级（可选）

当前 mock 阶段 `userOpenid` 用 `wx.getStorageSync('userInfo').uid || 'guest'`，仅供 dev 联调。

公网部署建议补真实登录：
1. 前端 `wx.login()` 拿 `code`
2. 后端加 `POST /api/auth/login`，body: `{ code }`
3. 后端调微信 `code2Session` 接口换 `openid` / `session_key`（需要 AppID + AppSecret，存 `.env`）
4. 后端返 JWT / session_token，前端存 storage，后续请求 header 带 `Authorization: Bearer <token>`
5. 后端加 `auth` 中间件校验 token，注入 `req.openid`

## 安全要点

- **MySQL 注入**：所有 SQL 用 `?` 占位符，禁止字符串拼接
- **CORS**：开发期全开放，生产白名单 `https://servicewechat.com`
- **限流**（建议补充）：用 `express-rate-limit` 防刷评论
- **HTTPS**：公网必须，否则 `wx.request` 报错
- **日志**：生产环境用 `winston` / `pino`，不要 `console.log`
