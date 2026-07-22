# CS Match Pro 项目指南

## 推送规则（双备份强制）
每次修改完代码必须执行完整三步，保持本地 + GitHub 两边代码一致、可互相备份：

```bash
git add <文件>
git commit -m "<描述>"
git push
```

**绝对禁止**只改本地不推送。如遇网络问题导致 push 失败，重试直到成功。

## 项目结构
- `miniprogram/` — 微信小程序前端
- `server/` — Express 后端（Node.js + MySQL）
- `server/public/web/` — **Web 前端 SPA**（手机号登录，替代小程序）
- `crawler/` — HLTV / 5eplay 爬虫脚本
- `scripts/` — 数据导入脚本
- `.github/workflows/` — GitHub Actions 自动化工作流

## 部署信息
| 项目 | 地址 |
|------|------|
| 线上 API | https://cshelper.yxcshelper.top/api |
| Web 前端（主站） | https://cshelper.yxcshelper.top/ |
| 管理后台（网页版） | https://cshelper.yxcshelper.top/admin |
| 管理员账号 | admin / 7355608（数据库 admin_users 表 MD5 存储） |
| MySQL 连接 | 阿里云轻量服务器 localhost:3306，用户 root，密码见 .env |

## 数据库表（共 16 表 + 2 视图）

### 核心业务
| 表 | 用途 |
|----|------|
| `player` | 选手信息（6199 行，含 status 职业状态） |
| `team` | 战队信息（441 行） |
| `team_member` | 战队-选手关联（4808 行） |
| `matches` | 比赛信息（308 行） |
| `match_players` | 比赛选手数据（1487 行） |
| `team_ranking` | Valve 世界排名（360 行，每次爬取追加） |
| `player_comments` | 选手评论（含 status 审核：pending/approved/rejected） |

### 用户与代币
| 表 | 用途 |
|----|------|
| `users` | 微信用户（含 coins/total_coins_earned 代币列） |
| `coin_transactions` | 代币交易流水 |
| `shop_items` | 商城商品（提示券 40 代币、额外机会 90 代币） |
| `user_items` | 用户道具库存 |

### 猜测系统（2026 年度 Top30）
| 表 | 用途 |
|----|------|
| `user_picks` | 用户猜测（每位 top 独立提交，覆盖式，最多 3 次） |
| `pick_config` | 各 top 提交开关（管理员控制） |
| `official_top30` | 管理员设定的官方 Top30 |
| `top30_awards` | 发奖记录（防止重复发放） |

### 管理后台
| 表 | 用途 |
|----|------|
| `admin_users` | 管理员账户（username + MD5(password)） |

### 视图（只读）
| 视图 | 用途 |
|------|------|
| `v_player_current_team` | 选手+当前战队 JOIN |
| `v_team_member_count` | 战队当前成员数统计 |

## 猜一猜游戏难度分级

| 难度 | SQL 过滤条件 | 选手池 |
|------|-------------|--------|
| trivial | `status IN ('active','coach')` + `team_ranking ranking <= 30` | ~173 |
| easy | `status IN ('active','coach')` + `INNER JOIN team_ranking` | ~2000 |
| hard | `status IN ('active','coach','free_agent')` | ~3000 |
| hell | 全部选手（含退役） | ~6000 |

## PK 好友对战多局机制（2026-07-14）

- 双方结束后点「再来一局」不关闭房间
- 各自标记 `creatorReadyForNext` / `joinerReadyForNext`
- 双方都准备后服务端选新目标选手，重置猜测状态
- 轮询检测对方准备状态（/api/pk/rooms/:id/ready + /next-round）

## 年度 Top30 猜测（2026-07-14）

- 每位 top（1-30）独立提交，每 slot 最多 3 次覆盖式
- 搜索选手 → 暂存 → 点击「提交」按钮确认
- 管理员可在网页后台控制每个 top 的提交开关
- 管理员设定官方 Top30 后核对发奖

## 代币系统（2026-07-14）

- `users` 表 `coins` / `total_coins_earned` 列
- 获取途径：充值（管理员）、活动奖励、猜测奖励
- 消费途径：商城购买道具（提示券、额外机会）
- 交易记录在 `coin_transactions` 表

## 管理后台（网页版 2026-07-14）

- 独立网页：https://cshelper.yxcshelper.top/admin
- 后端鉴权：`/api/admin/login` 验证 admin_users 表
- 功能：用户管理、评论审核、猜测管理（开关/Top30设定/核对发奖）
- 小程序内 admin 页面已改为迁移提示

## 版本更新公告（2026-07-14）

- 首页加载时检测 `wx.getStorageSync('home_version_shown')`
- 版本号 `v1.4.0`，点击「我收到」后写入缓存，下次更新版本时重新弹出

## GitHub Actions 工作流

| 工作流 | 频率 | 说明 |
|--------|------|------|
| 赛事爬虫 | 每 30 分钟 | 爬取 5eplay 赛事数据 |
| 排名爬虫 | 每 7 天 | 爬取 Valve 世界排名 |
| 选手信息爬虫 | 每月 1 日 | 全量爬取 HLTV 选手数据并覆盖导入 |
| ~~选手位置检测~~ | ~~每 3 天~~ | **已暂停**，由选手信息爬虫自动设定 |

## 持久记忆

项目相关的技术记录存储在 `C:\Users\50584\.claude\projects\C--Users-50584-Desktop-cs\memory\`，新对话自动加载 `MEMORY.md` 索引。
