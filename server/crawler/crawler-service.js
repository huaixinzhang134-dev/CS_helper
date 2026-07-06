#!/usr/bin/env node
/**
 * 5eplay 赛事爬虫服务（独立 PM2 进程）
 *
 * 功能：
 *   每 30 秒从 5eplay 获取最新赛事数据
 *   推送到 Express API 的 POST /api/matches/sync
 *   由 API 服务完成数据对比、入库和 WS 广播
 *
 * 启动方式：
 *   node crawler/crawler-service.js
 *   或通过 PM2: pm2 start ecosystem.config.js
 *
 * 环境变量：
 *   API_BASE      - API 服务地址（默认 http://127.0.0.1:3000）
 *   SYNC_TOKEN    - 同步鉴权 token（与 server/.env 保持一致）
 *   CRAWLER_INTERVAL - 轮询间隔，毫秒（默认 30000）
 *   CRAWLER_DRY_RUN  - dry-run 模式，只打印不推送（默认 false）
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const axios = require('axios');

const { fetchFrom5eplay } = require('./5eplay-api');

// ======================== 配置 ========================

const API_BASE = process.env.API_BASE || 'http://127.0.0.1:3000';
const SYNC_TOKEN = process.env.SYNC_TOKEN || 'cs-match-sync-token';
const INTERVAL = parseInt(process.env.CRAWLER_INTERVAL || '30000', 10);
const DRY_RUN = process.env.CRAWLER_DRY_RUN === 'true';

// ======================== 同步逻辑 ========================

/**
 * 一次完整的抓取 + 推送周期
 */
async function syncCycle() {
  const startTime = Date.now();

  try {
    // 1. 从 5eplay 获取数据
    const { source, matches } = await fetchFrom5eplay();

    if (!matches || matches.length === 0) {
      console.log(`[crawler] 无比赛数据 (${source})`);
      return;
    }

    // 2. 按 date + time 分组，只保留"今天及未来"的比赛 + 今天已结束的比赛
    //    避免把历史比赛反复同步
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString().slice(0, 10);

    const filtered = matches.filter(m => {
      // 保留所有 upcoming/live 的比赛
      if (m.status !== 'Finished') return true;
      // 已结束的比赛只保留今天的（比分可能还在更新）
      return m.date >= todayStr;
    });

    if (filtered.length === 0) {
      console.log(`[crawler] 过滤后无有效比赛 (${source})`);
      return;
    }

    // 3. 推送到 API 服务
    if (DRY_RUN) {
      console.log(`[crawler] DRY RUN | 源=${source} | 原始=${matches.length} 有效=${filtered.length}`);
      console.log(`[crawler] 示例:`, JSON.stringify(filtered.slice(0, 2), null, 2));
      return;
    }

    const pushResp = await axios.post(
      `${API_BASE}/api/matches/sync`,
      { matches: filtered },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SYNC_TOKEN}`
        },
        timeout: 10000
      }
    );

    const elapsed = Date.now() - startTime;
    const result = pushResp.data?.data || {};
    console.log(
      `[crawler] ✅ ${elapsed}ms | ` +
      `源=${source} | ` +
      `推送=${filtered.length} | ` +
      `检查=${result.checked || 0} | ` +
      `更新=${result.updated || 0}`
    );
  } catch (err) {
    if (err.code === 'ECONNREFUSED') {
      console.log(`[crawler] ⚠ API 服务未就绪 (${API_BASE})，下次重试`);
    } else if (err.response) {
      console.log(`[crawler] ❌ API 返回 ${err.response.status}: ${err.response.data?.message || err.message}`);
    } else {
      console.log(`[crawler] ❌ ${err.message}`);
    }
  }
}

// ======================== 启动 ========================

async function main() {
  console.log('========================================');
  console.log('CS Match Pro - 赛事爬虫服务');
  console.log(`  API:       ${API_BASE}`);
  console.log(`  间隔:      ${INTERVAL}ms`);
  console.log(`  Dry Run:   ${DRY_RUN}`);
  console.log('========================================\n');

  // 立即执行一次
  console.log('[crawler] 首次抓取...');
  await syncCycle();

  // 定时轮询
  setInterval(syncCycle, INTERVAL);
  console.log(`\n[crawler] 已启动定时轮询，间隔 ${INTERVAL / 1000}s`);
}

// ======================== 启动入口 ========================

if (require.main === module) {
  // 支持 --once 参数：执行一次后退出（用于 GitHub Actions）
  const isOnceRun = process.argv.includes('--once');

  if (isOnceRun) {
    console.log('[crawler] 单次执行模式 (--once)\n');
    syncCycle().then(() => {
      console.log('\n[crawler] 单次执行完成');
      process.exit(0);
    }).catch(err => {
      console.error('[crawler] 执行失败:', err);
      process.exit(1);
    });
  } else {
    main().catch(err => {
      console.error('[crawler] 启动失败:', err);
      process.exit(1);
    });
  }
}

module.exports = { syncCycle, main };
