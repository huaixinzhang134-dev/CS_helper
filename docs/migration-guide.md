# Railway → 阿里云迁移指南

## 整体架构

```
迁移前                          迁移后
┌──────────────────┐          ┌──────────────────┐
│ GitHub Actions    │          │ GitHub Actions    │ ✓ 不变
│ (爬虫)            │          │ (爬虫)            │
└─────┬────────────┘          └─────┬────────────┘
      │ 爬取 HLTV.org               │ 爬取 HLTV.org
      │ (GitHub Runner IP)          │ (GitHub Runner IP)
      │                             │
      ├── MySQL ── Railway ──┐      ├── MySQL ──┐
      └── API ─── Railway ──┤      └── API ────┤
                             │                  │
┌──────────────────┐        │     ┌─────────────┴──────────┐
│ 小程序            │        │     │ 阿里云轻量服务器 ¥36/月  │
│ API_BASE →       ├────────┘     │ ├─ MySQL                │
│ Railway          │              │ ├─ Express 后端         │
└──────────────────┘              │ └─ Nginx + SSL         │
                                  │                         │
                           ┌─────┴──────────────┐
                           │ 小程序              │
                           │ API_BASE →          │
                           │ api.你的域名.com    │
                           └────────────────────┘
```

---

## 第一步：购买阿里云轻量服务器

1. 打开 [阿里云轻量应用服务器](https://swas.console.aliyun.com/)
2. 配置：
   - **地域**：上海 或 广州（离你近，延迟低）
   - **镜像**：Ubuntu 24.04
   - **规格**：2核2G / 60GB SSD（¥36/月 ≈ ¥432/年）
3. 购买后记下**公网 IP**
4. 进入控制台 → **重置密码**（设置 root 登录密码）

> 💡 新人首单一般有折扣，有时 ¥24/月

---

## 第二步：购买域名 + 备案

### 2.1 买域名
- [阿里云万网域名注册](https://wanwang.aliyun.com/)
- 推荐后缀：`.club` / `.xyz` / `.top`（首年 ¥6-¥10）
- 也可以在 **阿里云 → 域名注册** 直接搜
- 购买后完成**实名认证**（通常 1 天内通过）

### 2.2 域名备案
> 小程序已备案不等于域名备案，域名备案是单独的。

[阿里云备案入口](https://beian.aliyun.com/)

```
流程：
1. 填写主体信息（个人身份证）
2. 填写域名信息
3. 上传身份证照片 + 人脸识别（阿里云 APP）
4. 提交管局审核
5. 等待 7-14 天 → 短信/邮件通知通过
```

**重要时间线：**
- 第 1 天：买域名 → 实名认证
- 第 2-14 天：域名备案审核中
- **备案通过前**：域名不能解析到国内服务器 IP（会被退回）
- **备案通过后**：才能配置 DNS + Nginx + 小程序正式上线

> **可以先买服务器，备案期间先做第三步（不配域名也能用 IP 连接）**

---

## 第三步：服务器初始化

### 3.1 登录服务器
```bash
ssh root@你的服务器IP
```
（如果提示密码错误，去阿里云控制台重置密码后重启）

### 3.2 安装 MySQL
```bash
apt update
apt install mysql-server -y

# 创建数据库
mysql -e "CREATE DATABASE cs_match_pro CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"

# 创建远程用户（给 GitHub Actions 爬虫用）
mysql -e "CREATE USER 'cs_user'@'%' IDENTIFIED BY '你的密码'"
mysql -e "GRANT ALL PRIVILEGES ON cs_match_pro.* TO 'cs_user'@'%'"
mysql -e "FLUSH PRIVILEGES"

# 允许远程连接（GitHub Actions 需要）
sed -i 's/bind-address.*/bind-address = 0.0.0.0/' /etc/mysql/mysql.conf.d/mysqld.cnf
systemctl restart mysql
```

### 3.3 开放防火墙端口

**服务器内开放端口：**
```bash
ufw allow 3306/tcp   # MySQL（给 GitHub Actions 连接）
ufw allow 3000/tcp   # 后端 API
ufw allow 22/tcp     # SSH
ufw allow 80/tcp     # HTTP
ufw allow 443/tcp    # HTTPS
ufw enable
```

**阿里云控制台也要开放安全组端口：**
1. 登录阿里云 → **轻量应用服务器控制台**
2. 点击你的服务器 → **防火墙**
3. 添加规则（批量添加）：

| 端口 | 协议 | 备注 |
|------|------|------|
| 3306 | TCP | MySQL（可限 GitHub Actions IP） |
| 3000 | TCP | 后端 API（测试用） |
| 80 | TCP | HTTP |
| 443 | TCP | HTTPS |
| 22 | TCP | SSH |

> 安全：3306 端口可以设置**仅允许 GitHub Actions IP** 访问。IP 列表：https://api.github.com/meta

### 3.4 安装 Node.js
```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install nodejs -y
node -v   # 确认 v22
```

---

## 第四步：导出 Railway 数据库 → 导入阿里云

### 4.1 本地导出（你的电脑上跑）
先确认 Railway 的 MySQL 连接信息（从 GitHub Secrets 或 Railway 控制台获取）：
```bash
mysqldump -h [Railway的DB_HOST] \
  -P [Railway的DB_PORT] \
  -u [Railway的DB_USER] \
  -p[Railway的DB_PASS] \
  [Railway的DB_NAME] > cs_match_pro_dump.sql
```

### 4.2 上传到阿里云服务器
```bash
scp cs_match_pro_dump.sql root@你的服务器IP:/root/
```

### 4.3 服务器上导入
```bash
mysql cs_match_pro < /root/cs_match_pro_dump.sql
```

---

## 第五步：部署后端

```bash
# 拉代码
cd /opt
git clone https://github.com/huaixinzhang134-dev/CS_helper.git
cd CS_helper/server
npm install

# 创建环境变量
cat > .env << 'EOF'
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASS=你的MySQL密码
DB_NAME=cs_match_pro
PORT=3000
SYNC_TOKEN=随便设一个复杂字符串（和 GitHub Secrets 一致）
NODE_ENV=production
EOF

# pm2 启动（保持后台运行）
npm install -g pm2
pm2 start index.js --name cs-match-pro
pm2 save
pm2 startup   # 按提示执行开机自启命令
```

验证：
```bash
curl http://localhost:3000/health
# 应返回 {"code":0,"message":"ok",...}
```

---

## 第六步：配 Nginx + SSL（备案完成后做）

### 6.1 安装 Nginx + 证书工具
```bash
apt install nginx certbot python3-certbot-nginx -y
```

### 6.2 配置 Nginx

先登录阿里云 **DNS 控制台（云解析 DNS）** → 添加 A 记录：
- 记录类型：`A`
- 主机记录：`api`
- 解析线路：默认
- 记录值：你的服务器公网 IP

```bash
cat > /etc/nginx/sites-enabled/cs-match-pro << 'EOF'
server {
    listen 80;
    server_name api.你的域名.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
EOF

nginx -t && systemctl reload nginx
```

### 6.3 申请免费 SSL 证书
```bash
certbot --nginx -d api.你的域名.com
```

自动续期验证：
```bash
certbot renew --dry-run
```

### 6.4 验证 HTTPS
浏览器访问 `https://api.你的域名.com/api/players/count`，确认返回 JSON。

---

## 第七步：更新小程序配置

```typescript
// miniprogram/config.ts
export const API_BASE = 'https://api.你的域名.com/api';
export const STATIC_BASE = 'https://api.你的域名.com';
```

微信小程序后台 → **开发管理 → 服务器域名**：
| 域名类型 | 值 |
|---------|-----|
| `request` 合法域名 | `https://api.你的域名.com` |
| `downloadFile` 合法域名 | `https://api.你的域名.com` |

> 记得把旧的 `https://cshelper-production.up.railway.app` 删掉

---

## 第八步：更新 GitHub Secrets

GitHub 仓库 → Settings → Secrets and variables → Actions：

| Secret | 旧值（Railway） | 新值（阿里云） |
|--------|---------------|--------------|
| `DB_HOST` | railway.host | 你的服务器公网 IP |
| `DB_PORT` | 16612 | 3306 |
| `DB_USER` | railway_user | cs_user |
| `DB_PASS` | railway密码 | 你设的密码 |
| `DB_NAME` | railway | cs_match_pro |
| `SYNC_TOKEN` | 旧 token | 保持不变（或改） |

---

## 第九步：验证

### 服务器验证
```bash
# 检查后端运行
pm2 list
curl http://localhost:3000/health

# 检查 MySQL 连接
mysql -u root -p cs_match_pro -e "SELECT COUNT(*) FROM player"
# 应返回 6199（选手数量）
```

### GitHub Actions 验证
手动触发一次 `players.yml` 工作流，确认：
1. ✅ 爬虫成功爬取 HLTV
2. ✅ 能连上阿里云 MySQL
3. ✅ 数据正确导入

### 小程序验证
1. ✅ 打开小程序，能加载数据
2. ✅ 猜一猜正常
3. ✅ 好友 PK 正常
4. ✅ 赛事页面正常

### 爬虫验证
等待 `crawler.yml` 定时触发（每 30 分钟），确认数据同步正常。

---

## 费用汇总

| 项目 | 月费 | 年费 |
|------|------|------|
| 阿里云轻量服务器 2核2G | ¥36 | ¥432 |
| 域名 .xyz/.club | - | ¥6-¥10 |
| SSL 证书 | 免费 | 免费 |
| **合计** | **¥36** | **¥438-¥442** |

对比 Railway 付费版 $5-20/月（¥36-¥144/月），国内方案延迟低、访问稳定。

---

## 常见问题

### Q: 备案期间后端能用吗？
A: 备案期间不能配域名 + HTTPS。但可以：
- **GitHub Actions** 通过服务器 **IP 地址**直接连 MySQL 3306（不改 Secrets 也能用）
- **小程序**暂时保持指向旧的 Railway，备案完成后再切过来
- 你也可以先用 `http://IP:3000` 做临时测试

### Q: HLTV 会屏蔽阿里云 IP 吗？
A: **不影响爬虫。** 爬虫跑在 GitHub Runner 上（美国 IP），HLTV 看不到你的服务器 IP。服务器只存数据 + 提供 API。

### Q: 数据怎么定期备份？
A: 服务器上设 cron 每天自动备份：
```bash
crontab -e
# 凌晨 3 点备份
0 3 * * * mysqldump cs_match_pro > /backup/cs_$(date +\%Y\%m\%d).sql

# 保留最近 30 天，删除旧的
0 4 * * * find /backup -name "cs_*.sql" -mtime +30 -delete
```

### Q: 阿里云轻量服务器和 ECS 有什么区别？
| | 轻量应用服务器 | ECS 云服务器 |
|---|---|---|
| 价格 | ¥36/月起 | ¥50/月起（突发性能型） |
| 管理 | 简单，集成防火墙/监控 | 灵活，VPC/子网可配 |
| 适用 | 个人项目/小程序后端 | 企业级/高并发场景 |
| **推荐** | **✅ 你的项目够用** | ❌ 没必要多花钱 |

### Q: 迁移过程中用户会受影响吗？
A: 迁移期间小程序仍然指向旧的 Railway，用户无感知。等阿里云部署 + 测试全部完成后，**一步切换 API_BASE**，小程序下次启动就自动用新服务器了。
