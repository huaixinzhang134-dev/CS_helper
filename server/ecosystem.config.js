/**
 * PM2 Ecosystem 配置 —— 双进程架构
 *
 * 进程1: cs-match-api      Express + WebSocket 服务（面向用户）
 * 进程2: cs-match-crawler  5eplay 定时爬虫（独立进程，不影响 API）
 *
 * 使用方式：
 *   pm2 start ecosystem.config.js              # 启动所有进程
 *   pm2 start ecosystem.config.js --only api    # 只启动 API
 *   pm2 logs cs-match-crawler                   # 查看爬虫日志
 *   pm2 restart cs-match-api                    # 重启 API（不影响爬虫）
 *
 * 迁移服务器时：
 *   1. 新服务器先启动 cs-match-crawler 预热
 *   2. 确认爬虫正常推送后，再启动 cs-match-api
 *   3. 改小程序 config.ts 域名 → 切流量
 */
module.exports = {
  apps: [
    // ========== 进程1: API + WebSocket ==========
    {
      name: 'cs-match-api',
      script: 'index.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: '3000'
      },
      // 内存超过 200MB 自动重启
      max_memory_restart: '200M',
      // 日志配置
      error_file: './logs/api-error.log',
      out_file: './logs/api-out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      // 自动重启
      watch: false,
      // 优雅关闭：给 5s 处理完正在响应的请求
      kill_timeout: 5000,
      // 监听端口
      listen_timeout: 3000
    },

    // ========== 进程2: 5eplay 赛事爬虫 ==========
    {
      name: 'cs-match-crawler',
      script: 'crawler/crawler-service.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        API_BASE: 'http://127.0.0.1:3000',
        CRAWLER_INTERVAL: '30000'
      },
      max_memory_restart: '150M',
      error_file: './logs/crawler-error.log',
      out_file: './logs/crawler-out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      // 爬虫挂了，5s 后自动重启
      watch: false,
      restart_delay: 5000,
      // 最大重启次数（防止无限循环崩溃）
      max_restarts: 30,
      // 指数退避：重启间隔逐渐增大（最多 30s）
      exp_backoff_restart_delay: 100
    }
  ]
};
