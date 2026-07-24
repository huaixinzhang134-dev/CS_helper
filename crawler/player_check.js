const fs = require('fs');
const cheerio = require('cheerio');
const path = require('path');
const mysql = require('mysql2/promise');

let puppeteer;
let stealthPlugin;

const BASE_URL = 'https://www.hltv.org';
const DATA_FILE = __dirname + '/playerbase.json';
const PROGRESS_FILE = __dirname + '/player_check_progress.json';
const DELAY_BETWEEN_REQUESTS = 2000;
const BATCH_SIZE = 100; // 每100个重启浏览器

let browser;
let page;

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function detectChromePath() {
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium'
  ];
  for (const p of candidates) {
    try { if (fs.existsSync(p)) return p; } catch (_) {}
  }
  return undefined;
}

async function initBrowser() {
  if (browser) return;

  puppeteer = require('puppeteer-extra');
  stealthPlugin = require('puppeteer-extra-plugin-stealth');
  puppeteer.use(stealthPlugin());

  const chromePath = detectChromePath();
  console.log(`浏览器路径: ${chromePath || '系统默认'}`);

  browser = await puppeteer.launch({
    headless: 'new',
    executablePath: chromePath,
    protocolTimeout: 120000,  // 协议超时从默认 30s 提升到 120s，避免 CI 环境慢导致崩溃
    args: [
      '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas', '--no-first-run', '--no-zygote',
      '--disable-gpu', '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process',
      '--disable-background-networking', '--disable-background-timer-throttling'
    ]
  });

  page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });
  console.log('浏览器启动成功\n');
}

async function closeBrowser() {
  if (browser) {
    await browser.close();
    browser = null;
    page = null;
    console.log('\n浏览器已关闭');
  }
}

function isCloudflareBlock(html) {
  return html.includes('cf-challenge') || html.includes('Just a moment') ||
    html.includes('cf-browser-verification') ||
    (html.includes('Attention Required') && html.includes('Cloudflare')) ||
    html.includes('Enable JavaScript and cookies');
}

async function fetchPageByUrl(url, retryCount = 0) {
  await initBrowser();

  try {
    console.log(`  访问: ${url}`);
    // 使用 'load' 而不是 'domcontentloaded'，更稳定但稍慢
    await page.goto(url, { waitUntil: 'load', timeout: 90000 });

    try {
      await page.waitForSelector('.playerRealname, .playerNickname', { timeout: 30000 });
    } catch (e) {}

    await delay(2000);
    const html = await page.content();

    if (isCloudflareBlock(html)) {
      if (retryCount < 3) {
        const waitTime = (retryCount + 1) * 10000;
        console.log(`  ⚠ Cloudflare 拦截，${(waitTime / 1000).toFixed(0)}s 后重试 (${retryCount + 1}/3)...`);
        await delay(waitTime);
        await page.reload({ waitUntil: 'load', timeout: 90000 });
        return fetchPageByUrl(url, retryCount + 1);
      } else {
        throw new Error(`Cloudflare 拦截，已重试 3 次: ${url}`);
      }
    }

    return html;
  } catch (err) {
    // "操作被取消" 通常也是 Cloudflare/网络问题，统一重试
    const isCanceled = err.message.includes('canceled') || err.message.includes('cancelled');
    if (isCanceled && retryCount < 3) {
      const waitTime = (retryCount + 1) * 8000;
      console.log(`  ⚠ 请求被取消 (可能是 Cloudflare 中断)，${(waitTime / 1000).toFixed(0)}s 后重试 (${retryCount + 1}/3)...`);

      // 先关闭当前页面重新打开一个新页面，避免页面状态损坏
      try { await page.close(); } catch (_) {}
      page = await browser.newPage();
      await page.setViewport({ width: 1920, height: 1080 });

      await delay(waitTime);
      return fetchPageByUrl(url, retryCount + 1);
    }

    console.error(`  ✗ 请求失败: ${err.message}`);
    throw err;
  }
}

// ======================== 位置解析 ========================

function parsePositionFromHtml(html) {
  const $ = cheerio.load(html);
  let position = '步枪手';
  const playerProfile = $('.player-profile-summary-container .text-ellipsis').text().toLowerCase();
  if (playerProfile.includes('awper') || playerProfile.includes('sniper')) {
    position = '狙击手';
  } else if (playerProfile.includes('igl') || playerProfile.includes('captain')) {
    position = '指挥';
  } else if (playerProfile.includes('coach')) {
    position = '教练';
  }
  return position;
}

async function evaluateRatioAndCorrect(htmlPosition) {
  try {
    const ratioValue = await page.evaluate(() => {
      const statsTop = document.querySelectorAll('.playerpage-container-attributes .player-stat-top');
      for (const st of statsTop) {
        const label = st.querySelector('span > p')?.textContent?.trim() || '';
        if (label.includes('Sniping') || label.includes('sniping')) {
          const valEl = st.querySelector('b');
          return valEl ? parseFloat(valEl.textContent.trim()) : null;
        }
      }
      return null;
    });
    if (ratioValue !== null && ratioValue > 65) return { position: '狙击手', ratioValue, corrected: true };
    return { position: htmlPosition, ratioValue, corrected: false };
  } catch (e) {
    return { position: htmlPosition, ratioValue: null, corrected: false };
  }
}

async function checkPlayerPosition(player) {
  const playerUrl = `${BASE_URL}/player/${player._id}/${player.name}`;
  try {
    const html = await fetchPageByUrl(playerUrl);
    const htmlPosition = parsePositionFromHtml(html);
    const result = await evaluateRatioAndCorrect(htmlPosition);
    const oldPosition = player.position;
    const newPosition = result.position;
    const positionChanged = oldPosition !== newPosition;

    if (positionChanged) {
      console.log(`  ✏ ${player.name}: "${oldPosition}" → "${newPosition}" (ratio: ${result.ratioValue})`);
    } else {
      console.log(`  ✓ ${player.name}: "${oldPosition}" 正确`);
    }

    return {
      ...player,
      position: newPosition,
      _positionChanged: positionChanged
    };
  } catch (err) {
    console.error(`  ✗ 检查 ${player.name} 失败: ${err.message}`);
    return { ...player, _positionChanged: false };
  }
}

// ======================== 数据 ========================

function loadPlayers() {
  if (!fs.existsSync(DATA_FILE)) {
    console.error(`数据文件不存在: ${DATA_FILE}`);
    process.exit(1);
  }
  const lines = fs.readFileSync(DATA_FILE, 'utf8').split('\n').filter(l => l.trim());
  return lines.map(l => JSON.parse(l));
}

/** 从 MySQL 加载选手数据（含正确的 status 字段，替代 JSON 文件） */
async function loadPlayersFromDb(conn) {
  const [rows] = await conn.execute(
    'SELECT game_id AS _id, name, position, status FROM player'
  );
  console.log(`数据库加载 ${rows.length} 个选手`);
  return rows;
}

// ======================== 进度管理 ========================

function saveProgress(index, total) {
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify({ startIndex: index, total, updatedAt: new Date().toISOString() }), 'utf-8');
}

function loadProgress() {
  try {
    if (fs.existsSync(PROGRESS_FILE)) return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf-8'));
  } catch (_) {}
  return null;
}

function clearProgress() {
  try { if (fs.existsSync(PROGRESS_FILE)) fs.unlinkSync(PROGRESS_FILE); } catch (_) {}
}

// ======================== MySQL ========================

let dbPool = null;
async function getDbConnection() {
  if (dbPool) return dbPool;
  const host = process.env.DB_HOST || process.env.MYSQLHOST || 'hayabusa.proxy.rlwy.net';
  const port = parseInt(process.env.DB_PORT || process.env.MYSQLPORT || '16612', 10);
  const user = process.env.DB_USER || process.env.MYSQLUSER || 'root';
  const password = process.env.DB_PASS || process.env.MYSQLPASSWORD || '';
  const database = process.env.DB_NAME || process.env.MYSQLDATABASE || 'railway';
  if (!password) { console.warn('\n⚠ 未设置数据库密码'); return null; }
  try {
    dbPool = await mysql.createConnection({
      host, port, user, password, database,
      ssl: { rejectUnauthorized: false }, connectTimeout: 10000
    });
    console.log(`  已连接数据库 ${host}:${port}/${database}\n`);
    return dbPool;
  } catch (err) {
    console.error(`  数据库连接失败: ${err.message}`);
    return null;
  }
}

async function syncPositionToDb(conn, playerId, name, position) {
  if (!conn) return;
  try {
    const [result] = await conn.execute(
      'UPDATE player SET position = ? WHERE game_id = ? OR name = ?',
      [position, playerId, name]
    );
    if (result.affectedRows > 0) console.log(`  DB ✓ ${name} → "${position}" (${result.affectedRows} 行)`);
  } catch (err) { console.error(`  DB ✗ ${name}: ${err.message}`); }
}

// ======================== 主流程 ========================

async function checkAllPositions() {
  console.log('========================================');
  console.log('选手位置检查工具');
  console.log('========================================\n');

  const args = process.argv.slice(2);
  const useDb = args.includes('--db');
  const quickMode = args.includes('--quick');

  // 分片参数：--start=N（跳过前N个，默认0）--limit=N（最多处理N个，默认全部）
  const startArg = args.find(a => a.startsWith('--start='));
  const limitArg = args.find(a => a.startsWith('--limit='));
  const chunkStart = startArg ? parseInt(startArg.split('=')[1], 10) || 0 : 0;
  const chunkLimit = limitArg ? parseInt(limitArg.split('=')[1], 10) || Infinity : Infinity;

  let players = loadPlayers();
  console.log(`共加载 ${players.length} 个选手数据`);

  if (quickMode) {
    const before = players.length;
    players = players.filter(p => p.position === '步枪手' || !p.position);
    console.log(`快速模式: 从 ${before} 人筛选出 ${players.length} 个"步枪手"待检查\n`);
  }

  if (players.length === 0) { console.log('没有需要检查的选手'); return; }

  // 应用分片
  if (chunkStart > 0 || chunkLimit < Infinity) {
    const chunkEnd = Math.min(chunkStart + chunkLimit, players.length);
    players = players.slice(chunkStart, chunkEnd);
    console.log(`分片模式: 处理第 ${chunkStart + 1}～${chunkEnd} 个，共 ${players.length} 人\n`);
  }

  // 断点续检
  const progress = loadProgress();
  let startIndex = 0;
  if (progress && progress.startIndex > 0 && progress.startIndex < players.length) {
    startIndex = progress.startIndex;
    console.log(`检测到上次进度 (${progress.updatedAt})，从第 ${startIndex + 1}/${players.length} 个继续\n`);
  }

  const pendingDbSync = [];
  let dbConn = null;

  // 统一冲刷待写入数据
  async function flushPendingDbSync() {
    if (pendingDbSync.length === 0 || !dbConn) return;
    console.log(`  ── 写入 MySQL ${pendingDbSync.length} 条变更...`);
    for (const item of pendingDbSync) {
      if (item.type === 'position') {
        try { await syncPositionToDb(dbConn, item.id, item.name, item.value); } catch (_) {}
      }
    }
    pendingDbSync.length = 0;
  }

  // === 信号处理：外力终止时把当前批次未写入的变动刷进 DB ===
  let signalReceived = false;
  async function flushOnSignal(signal) {
    if (signalReceived) return;
    signalReceived = true;
    console.log(`\n⚠ 收到 ${signal} 信号，正在刷新 ${pendingDbSync.length} 条待写入数据...`);
    await flushPendingDbSync();
    saveProgress(startIndex, players.length);
    await closeBrowser();
    if (dbPool) { try { await dbPool.end(); } catch {} }
    process.exit(0);
  }
  process.on('SIGINT', () => flushOnSignal('SIGINT'));
  process.on('SIGTERM', () => flushOnSignal('SIGTERM'));

  try {
    let correctedCount = 0;
    const enableDb = useDb || quickMode;
    if (enableDb) dbConn = await getDbConnection();

    for (let i = startIndex; i < players.length; i++) {
      const player = players[i];
      if (player.position === '教练') {
        console.log(`[${i + 1}/${players.length}] 跳过 ${player.name} (教练)`);
        continue;
      }
      console.log(`[${i + 1}/${players.length}] 检查 ${player.name} (${player._id})...`);

      const result = await checkPlayerPosition(player);

      if (result._positionChanged) {
        correctedCount++;
        pendingDbSync.push({ type: 'position', id: result._id, name: result.name, value: result.position });
      }

      await delay(DELAY_BETWEEN_REQUESTS);

      // 每 100 个：写入 MySQL + 重启浏览器
      if ((i + 1) % BATCH_SIZE === 0 && i < players.length - 1) {
        await flushPendingDbSync();
        saveProgress(i + 1, players.length);
        console.log(`\n--- 已检查 ${i + 1}/${players.length}，重启浏览器 ---\n`);
        await closeBrowser();
      }
    }

    // 最终写入
    await flushPendingDbSync();
    clearProgress();

    console.log('\n========================================');
    console.log('检查完成！');
    console.log(`总计检查: ${players.length} 个选手`);
    console.log(`位置修正: ${correctedCount} 个`);
    console.log('========================================');
  } catch (error) {
    console.error('\n检查过程中出错:', error.message);
    await flushPendingDbSync();
    saveProgress(startIndex > 0 ? startIndex : 0, players.length);
    console.log('进度已保存');
  } finally {
    await closeBrowser();
    if (dbPool) { try { await dbPool.end(); } catch {} }
    process.exit(0);
  }
}

if (require.main === module) {
  checkAllPositions();
}

module.exports = { checkAllPositions, checkPlayerPosition };
