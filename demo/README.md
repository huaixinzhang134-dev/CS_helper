# CS Match Pro — 自建服务器版

本版本连接本地 Express + MySQL 后端，数据实时从数据库读取，支持完整的 CRUD 和 WebSocket 实时推送。

## 前置条件

1. **MySQL 8.0+** 已安装并运行（本机端口 3306）
2. **Node.js 18+**
3. **微信开发者工具**

## 启动步骤

### 1. 启动后端服务器

```bash
# 进入服务器目录
cd ../server

# 安装依赖（首次）
npm install

# 启动服务器（默认 http://localhost:3000）
npm start
```

服务器输出示例：
```
[server] listening on http://localhost:3000
[server] WebSocket 路径: ws://localhost:3000/ws
```

### 2. 打开微信开发者工具

1. **导入项目**
   - 项目目录：选择本文件夹 `demo/`
   - AppID：`wxb08417e28e434e25`（已在 project.config.json 中配置）
   - 后端服务：选择"不使用云服务"

2. **开启不校验合法域名**
   - 「详情」→ 「本地设置」→ 勾选 **"不校验合法域名、web-view（业务域名）、TLS 版本以及 HTTPS 证书"**

3. **设置项目目录**（如果提示 "app.json 未找到"）
   - 「设置」→ 「项目设置」→ 「项目目录」指向 `demo/miniprogram/`

### 3. 编译运行

点击开发者工具的「编译」按钮即可。

## 技术栈

| 层 | 技术 |
|------|--------|
| 前端 | 微信小程序（TypeScript + WXML + WXSS） |
| 后端 | Express.js（Node.js） |
| 数据库 | MySQL 8.0 |
| 实时推送 | WebSocket（ws 库） |
| API 风格 | RESTful JSON |

## 功能

- 赛事列表（Live / Upcoming / Finished 分类展示）
- 赛事详情（含双方选手阵容）
- 评论区（登录后可发表/删除评论）
- 选手资料库（6000+ 职业选手，支持分页浏览、模糊搜索）
- 猜选手游戏（随机抽选，搜索匹配）
- 管理后台（选手/赛事 CRUD）
