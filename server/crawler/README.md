# 5eplay 赛事爬虫服务

每 30 秒轮询 5eplay，获取最新赛事数据并推送到 Express API。

## 使用方式

单独启动（调试用）：
```bash
cd server
node crawler/crawler-service.js
```

PM2 启动（生产）：
```bash
cd server
pm2 start ecosystem.config.js
# 或仅爬虫：pm2 start ecosystem.config.js --only crawler
```

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `API_BASE` | `http://127.0.0.1:3000` | Express API 地址 |
| `SYNC_TOKEN` | `cs-match-sync-token` | 与 `.env` 中保持一致 |
| `CRAWLER_INTERVAL` | `30000` | 轮询间隔（毫秒） |
| `CRAWLER_DRY_RUN` | `false` | dry-run 模式，只打印不推送 |

## 关于 5eplay API

5eplay 是一个 Vue SPA 站点，页面数据通过内部 API 加载。本爬虫会：

1. **优先尝试内部 JSON API**（如 `event.5eplay.com/api/...`）
2. **回退到 SSR/HTML 提取**（从 `<script>` 标签中提取初始状态）
3. **如果以上都失败**，参考 `crawler/match_data.js` 的 Puppeteer 方案

### 如何找到真实 API

1. 打开 Chrome → F12 → Network
2. 访问 `https://event.5eplay.com/csgo/matches?grade=1,7,2,3,8,9`
3. 在 Network 面板筛选 `XHR` / `Fetch`
4. 点击"赛程"或"赛果" tab
5. 找到返回 JSON 的请求，把 URL 和参数复制到 `5eplay-api.js` 的 `API_ENDPOINTS`

### 验证 API 可用性

```bash
# 确保 API 服务在运行
curl http://127.0.0.1:3000/health

# 手动触发一次爬虫推送（dry-run 模式）
CRAWLER_DRY_RUN=true node crawler/crawler-service.js
```
