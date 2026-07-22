#!/bin/bash
# CS Match Pro — 阿里云一键部署脚本
# 用法: bash deploy.sh
# 前提: 服务器已安装 Node.js 18+、git

set -e

PROJECT_DIR="/root/cs-helper"
REPO_URL="https://github.com/huaixinzhang134-dev/CS_helper.git"

echo "===== 1. 拉取最新代码 ====="
if [ -d "$PROJECT_DIR" ]; then
  cd "$PROJECT_DIR" && git pull
else
  git clone "$REPO_URL" "$PROJECT_DIR"
  cd "$PROJECT_DIR"
fi

echo "===== 2. 安装依赖 ====="
npm install

echo "===== 3. 创建 .env（如不存在）====="
if [ ! -f ".env" ]; then
  cat > .env << 'EOF'
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=你的数据库密码
DB_NAME=cs_match
JWT_SECRET=你的JWT密钥
PORT=3000
EOF
  echo "⚠️ 请手动编辑 .env 填写数据库密码和 JWT 密钥"
fi

echo "===== 4. 用 PM2 启动/重启服务 ====="
if command -v pm2 &> /dev/null; then
  pm2 delete cs-helper 2>/dev/null || true
  pm2 start server/index.js --name cs-helper
  pm2 save
else
  npm install -g pm2
  pm2 start server/index.js --name cs-helper
  pm2 save
fi

echo ""
echo "===== ✅ 部署完成 ====="
echo "服务已启动，监听端口: \$(grep ^PORT= .env | cut -d= -f2)"
echo ""
echo "下一步（可选）—— 配置 Nginx 反向代理："
echo '  1. apt install nginx'
echo "  2. 在 /etc/nginx/sites-enabled/default 中添加："
echo '     server {'
echo '       listen 80;'
echo '       server_name cshelper.yxcshelper.top;'
echo '       location / {'
echo '         proxy_pass http://127.0.0.1:3000;'
echo '         proxy_set_header Host $host;'
echo '         proxy_set_header X-Real-IP $remote_addr;'
echo '       }'
echo '     }'
echo "  3. nginx -t && systemctl restart nginx"
