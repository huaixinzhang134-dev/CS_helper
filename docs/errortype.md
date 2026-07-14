# CS Match Pro 错误类型与解决方案总结

> 从项目立项至今遇到的所有错误类型、根因分析及解决方案。

---

## 目录

1. [SQL 相关错误](#1-sql-相关错误)
2. [Node.js / 后端错误](#2-nodejs--后端错误)
3. [微信小程序 WXML 错误](#3-微信小程序-wxml-错误)
4. [部署与运维错误](#4-部署与运维错误)
5. [数据库迁移错误](#5-数据库迁移错误)
6. [网络与连接错误](#6-网络与连接错误)
7. [逻辑/设计错误](#7-逻辑设计错误)
8. [工具链与开发环境错误](#8-工具链与开发环境错误)

---

## 1. SQL 相关错误

### 1.1 三层嵌套子查询 LIMIT 不生效

**场景**：猜一猜 trivial 模式从排名前 30 战队中选择选手

**代码**：
```sql
SELECT * FROM player WHERE current_team IN (
  SELECT team_name FROM (
    SELECT team_name FROM team_ranking ORDER BY `rank` ASC LIMIT 30
  ) AS top30
)
```

**错误现象**：只返回 27 人/5 战队，LIMIT 30 未正确传递到最外层

**根因**：Railway MySQL（MySQL 8+）对三层嵌套 `IN (SELECT ... FROM (SELECT ... LIMIT N))` 存在兼容性问题，内层 LIMIT 被优化器忽略

**解决**：改用 `INNER JOIN` + `WHERE rank <= 30`
```sql
SELECT DISTINCT p.* FROM player p
INNER JOIN team_ranking r ON r.team_name = p.current_team
WHERE r.rank <= 30
```

---

### 1.2 team_ranking JOIN 产生重复行

**场景**：JOIN team_ranking 表后选手记录重复

**根因**：`team_ranking` 表同一战队有多次排名记录（每次爬虫抓取都会插入新行），JOIN 产生笛卡尔积

**解决**：加 `SELECT DISTINCT p.*`

---

### 1.3 MySQL 保留关键字冲突

**场景**：创建 `vote_winners` 表时使用 `rank` 作为列名

**代码**：
```sql
CREATE TABLE vote_winners (
  rank TINYINT UNSIGNED NOT NULL,
  ...
)
```

**错误**：
```
You have an error in your SQL syntax ... right syntax to use near 'rank'
```

**根因**：`rank` 是 MySQL 保留关键字，直接作为列名会导致语法错误

**解决**：加反引号转义：
```sql
`rank` TINYINT UNSIGNED NOT NULL
```

---

### 1.4 ONLY_FULL_GROUP_BY 兼容性

**场景**：队伍排行查询 GROUP BY 时报错

**根因**：MySQL 8 默认启用 `ONLY_FULL_GROUP_BY`，SELECT 中所有非聚合列必须出现在 GROUP BY 中

**解决**：调整 GROUP BY 列表，包含所有 SELECT 的非聚合列，或使用 `ANY_VALUE()` 包装

---

### 1.5 JSON_SEARCH 语法

**场景**：高级搜索中搜索历史战队（former_teams JSON 数组）

**根因**：`JSON_SEARCH` 函数的通配符写法与预期不符，需注意通配符转义和路径表达式

**解决**：使用 `JSON_SEARCH(former_teams, 'one', '%keyword%')` 配合 `LIKE` 语义搜索

---

## 2. Node.js / 后端错误

### 2.1 TypeScript 语法混入 JS 文件

**场景**：在 `server/routes/votes.js` 中使用了 TypeScript 类型注解

**代码**：
```javascript
const slotStats: Record<number, Array<{ playerGameId: string; playerName: string; count: number }>> = {};
```

**错误**：
```
SyntaxError: Missing initializer in const declaration
```

**根因**：Node.js 原生不支持 TypeScript 语法，`.js` 文件中不能出现类型注解

**解决**：移除所有类型注解，使用纯 JS 写法：
```javascript
const slotStats = {};
```

### 2.2 模块查找失败

**场景**：从项目根目录执行脚本，但依赖安装在 `server/node_modules`

**错误**：
```
Error: Cannot find module 'dotenv'
```

**根因**：Node.js 模块查找路径不包含 `server/node_modules`

**解决**：
- 从 server 目录执行：`cd server && node script.js`
- 或显式指定路径：`require('./server/node_modules/dotenv')`

### 2.3 自定义 Token 验证失败

**场景**：用户认证 Bearer Token 验证

**根因**：Token 格式为 `base64(openid:timestamp).md5(openid+secret+timer)`，任意部分被篡改或过期都会验证失败

**解决**：Token 无刷新机制，过期需重新登录。服务端 `AUTH_SECRET` 环境变量缺失也会导致全部 Token 失效

---

## 3. 微信小程序 WXML 错误

### 3.1 不支持箭头函数表达式

**场景**：在 `wx:if` 中使用 `.find()` 箭头函数

**代码**：
```xml
<text wx:if="{{voteWinners.find(w => w.rank === idx + 1)}}">
```

**错误**：
```
Bad attr `wx:if` with message: unexpected `>` at pos20.
```

**根因**：WXML 模板语法不支持 JS 箭头函数和复杂回调表达式，`=>` 被理解为比较运算符

**解决**：在 JS 层预处理数据，WXML 只做简单属性访问：
```javascript
// JS: 预先计算好
const voteSlots = Array.from({length: 30}, (_, i) => {
  const w = winners.find(w => w.rank === i + 1);
  return { slot: i + 1, winnerName: w ? w.playerName : '' };
});
```
```xml
<!-- WXML: 直接访问属性 -->
<text wx:if="{{item.winnerName}}">{{item.winnerName}}</text>
```

---

### 3.2 不支持可选链操作符

**场景**：在 WXML 中使用 `?.` 可选链

**代码**：
```xml
<text>{{item.teamA?.name || '?'}}</text>
```

**错误**：
```
Bad value with message: unexpected token `.`
```

**根因**：WXML 语法解析器不支持 `?.` 运算符

**解决**：确保数据完整性或使用三元表达式代替：
```xml
<!-- 改为 -->
<text>{{item.teamA.name}} vs {{item.teamB.name}}</text>
```

---

### 3.3 A 标签报错

**场景**：admin 页面编译错误

**错误**：
```
Bad attr `wx:if` with message: unexpected `>` at pos20.
```

**根因**：`wx:if` 表达式中的特殊字符或复杂语法导致解析失败

**解决**：简化 WXML 表达式，将逻辑移到 JS 层

---

### 3.4 `__route__ is not defined`

**场景**：添加新页面后首次编译

**错误**：
```
ReferenceError: __route__ is not defined
```

**根因**：微信开发者工具缓存了旧的页面路由映射，新增页面时缓存未刷新

**解决**：清除编译缓存（工具 → 清除缓存 → 全部清除），重新编译

---

## 4. 部署与运维错误

### 4.1 Railway 部署 413 Payload Too Large

**场景**：执行 `railway up` 部署

**错误**：
```
Failed to upload code. File too large (603757221 bytes)
413 Payload Too Large
```

**根因**：项目根目录包含 `.git` 目录（572MB），Railway CLI 打包时将其包含在 upload 中。`.railwayignore` 文件可能不支持或未被识别

**解决**：
- 使用 GitHub 集成自动部署（推送到 main 触发 Railway 构建，无需本地上传）
- Railway 构建时只从 GitHub 拉取代码，不包含 `.git` 目录

> ⚠️ **重要**：之后部署只需 `git push`，不需要执行 `railway up`

---

### 4.2 无法连接 mysql.railway.internal

**场景**：从本地连接 Railway MySQL

**错误**：
```
Error: Connection lost: The server closed the connection.
```
或
```
Error: connect ETIMEDOUT
```

**根因**：
- `mysql.railway.internal` 仅在 Railway 内部网络可解析
- 公网 host `mysql-production-0b76.up.railway.app` 需要 IP 白名单
- `railway connect mysql` 需要本机安装 MySQL CLI

**解决**：
| 方法 | 条件 | 命令 |
|------|------|------|
| SSH 隧道 | 本机有 MySQL CLI | `railway connect mysql --ssh -P 23306` |
| railway run | 执行临时脚本 | `railway run node script.js` |
| GitHub 部署 | 代码已推送 | 推送到 main 自动触发 |
| Railway 内执行 | 服务器本身 | 服务器代码可直接连接 |

---

### 4.3 Railway CLI 版本警告

**现象**：
```
A newer Railway CLI is available: v5.26.1 (current: v5.23.3)
```

**影响**：无功能影响，但建议升级以获得新特性和 bug 修复

---

## 5. 数据库迁移错误

### 5.1 SQL 分号分割导致语句丢失

**场景**：按 `;` 分割迁移 SQL 文件逐条执行

**根因**：SQL 文件中的注释行（`-- 注释`）与后续 SQL 语句被分到同一个分割块中，`filter(s => s.startsWith('--'))` 将整块过滤掉

示例：
```
-- 2. 代币交易记录表
DROP TABLE IF EXISTS coin_transactions;  ← 整块被过滤，因为以 -- 开头
```

**解决**：分两步处理
1. 先按行过滤注释行：`.split('\n').filter(line => !line.trim().startsWith('--')).join('\n')`
2. 再按 `;` 分割语句

或使用 `multipleStatements: true` 一次执行整个清理后的 SQL

---

### 5.2 ALTER TABLE 幂等性问题

**场景**：多次执行迁移 SQL

**错误**：
```
Duplicate column name 'coins'
```

**根因**：`ALTER TABLE ADD COLUMN` 在列已存在时报错

**解决**：捕获 `errno 1060`（重复列）等幂等错误，跳过继续执行

| errno | 含义 | 场景 |
|-------|------|------|
| 1050 | 表已存在 | CREATE TABLE |
| 1060 | 列已存在 | ALTER TABLE ADD COLUMN |
| 1061 | 索引已存在 | CREATE INDEX / UNIQUE KEY |
| 1091 | 列/索引不存在 | DROP COLUMN / DROP INDEX |

---

## 6. 网络与连接错误

### 6.1 GitHub Push 连接失败

**场景**：`git push` 到 GitHub

**错误 1**：
```
fatal: unable to access ... Recv failure: Connection was reset
```

**错误 2**：
```
fatal: unable to access ... Failed to connect to github.com port 443 after 21073 ms
```

**根因**：国内网络环境对 GitHub 访问不稳定，偶发连接中断或超时

**解决**：重试，通常 1-3 次后可成功

---

### 6.2 WebSocket 连接/重连

**场景**：赛事页面实时更新

**根因**：移动端网络切换、小程序切后台等导致 WebSocket 断开

**解决**：指数退避重连机制（3s → 6s → 12s → ... → max 60s），最多重试 10 次

---

## 7. 逻辑/设计错误

### 7.1 PK 模式"再来一局"关闭房间

**场景**：好友对战结束后点击"再来一局"，房间被完全重置，需重新分享邀请

**根因**：原逻辑将 PK 模式的"再来一局"等同于"回到模式选择"，丢失了房间状态和对手连接

**解决**：
- 双方独立标记准备状态（`creatorReadyForNext` / `joinerReadyForNext`）
- 双方都准备后调用 `/next-round` 选择新目标选手
- 房间持续存在，对手不需重新加入

---

### 7.2 排行榜 PK/Solo 列未迁移

**场景**：封神榜只有总胜率，没有按模式（PK/Solo）区分

**根因**：`users` 表最初只有整体 `win_count`/`total_games`，未按游戏模式拆分

**解决**：新增 6 列（`pk_win_count`/`pk_total_games`/`pk_win_rate`/`solo_*`）并通过迁移端点执行

---

### 7.3 环境变量优先级覆盖

**场景**：使用 `railway run` 执行迁移脚本，但连接到了本地 MySQL

**根因**：脚本中 `dotenv.config()` 加载了 `.env` 文件，其中 `DB_HOST=localhost` 覆盖了 Railway 提供的 `MYSQLHOST=mysql.railway.internal`

**解决**：检查是否在 Railway 环境中运行，优先使用 `MYSQLHOST`：
```javascript
const config = {
  host: process.env.MYSQLHOST || process.env.DB_HOST || 'localhost',
  ...
};
```

---

### 7.4 封神榜弹窗冒泡

**场景**：点击排行榜弹窗内容区域触发关闭

**根因**：事件冒泡导致 `bindtap` 穿透到蒙层关闭事件

**解决**：使用 `catchtap` 替代 `bindtap` 阻止冒泡，或在内容区域上使用 `catchtap=""`

---

### 7.5 搜索框中英文映射不完整

**场景**：按国家搜索选手时，数据库存中文名（如"中国"），用户输入英文（如"China"）搜不到

**根因**：`country` 字段存储混合格式（主要中文，少量英文如"Korea"）

**解决**：内置中英文双向映射表，输入中文时同时搜索对应英文，输入英文时同时搜索对应中文

---

## 8. 工具链与开发环境错误

### 8.1 Git add 全量误操作

**场景**：提交代码时使用 `git add .` 或 `git add -A`

**风险**：可能误将敏感信息（密码、Token、`.env`）提交到公开仓库

**规范**：
- 逐个 add 目标文件：`git add server/routes/xxx.js`
- 提交前检查硬编码的敏感字符串
- `CLAUDE.md` 和 `.env` 永不提交

---

### 8.2 评论审核策略选择

**场景**：用户评论是否需要审核

**方案对比**：
| 方案 | 优点 | 缺点 |
|------|------|------|
| 即时发布 | 体验好 | 有违规风险 |
| 全量审核 | 安全 | 审核延迟，用户等待 |
| **18小时自动发布** | 平衡体验和安全 | 需要管理员及时处理 |

**选型**：采用"18小时未审自动发布"策略，新评论默认 `status='pending'`，对外查询时筛选 `status='approved' OR (status='pending' AND created_at < NOW() - INTERVAL 18 HOUR)`

---

## 附录：快速排查对照表

| 错误特征 | 常见位置 | 排查方向 |
|---------|---------|---------|
| SQL subquery LIMIT 无效 | 嵌套 IN 查询 | 改用 JOIN + WHERE |
| WXML 编译报错 `>` 或 `.` | wx:if / 数据绑定 | 移除箭头函数、可选链 |
| Node 启动 SyntaxError | .js 文件 | 检查 TypeScript 注解 |
| railway up 413 | 部署 | 改用 git push 自动部署 |
| 连不上 MySQL | 本地脚本 | 用 railway run 或隧道 |
| 表不存在 | 新功能 | 执行数据库迁移 |
| 小程序白屏/报错 | 新增页面 | 清除编译缓存 |

---

> 最后更新：2026-07-14
> 维护人：项目开发团队
