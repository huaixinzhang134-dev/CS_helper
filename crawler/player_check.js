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

// ======================== 轮换池配置 ========================

/** 每 N 个选手重启一次浏览器（清缓存防 Cloudflare 堆积），失败也计入 */
const BATCH_SIZE = 100;
/** 页面池大小（每个浏览器实例内建 N 个页面，轮转使用） */
const POOL_PAGE_COUNT = 4;
/** 超时重试最大次数 */
const POOL_MAX_RETRIES = 3;
/** 超时重试基础等待（ms），每次翻倍 */
const POOL_RETRY_BASE_DELAY = 30000;
/** 导航超时（ms） */
const POOL_NAV_TIMEOUT = 120000;

// ======================== 轮换池（Page Pool + 定时重启） ========================

class CrawlerPool {
  constructor() {
    this.browser = null;
    this.pages = [];
    this.currentPageIdx = 0;
    this.useCount = 0;
    this.consecutiveFails = 0;
    this._loadProxies();
  }

  /** 从环境变量加载代理（可选，不配置则直连） */
  _loadProxies() {
    const envProxies = process.env.PROXY_LIST || '';
    if (envProxies) {
      this.proxies = envProxies.split(',').map(s => s.trim()).filter(Boolean);
      if (this.proxies.length > 0) console.log(`  代理池: ${this.proxies.length} 个代理`);
    }
  }

  _nextProxy() {
    if (!this.proxies || this.proxies.length === 0) return undefined;
    if (!this.currentProxyIdx) this.currentProxyIdx = 0;
    return this.proxies[this.currentProxyIdx++ % this.proxies.length];
  }

  _buildLaunchArgs(proxyUrl) {
    const args = [
      '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas', '--no-first-run', '--no-zygote',
      '--disable-gpu', '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process'
    ];
    if (proxyUrl) args.push(`--proxy-server=${proxyUrl}`);
    return args;
  }

  async launch() {
    if (this.browser) await this._closeBrowser();

    puppeteer = require('puppeteer-extra');
    const sp = require('puppeteer-extra-plugin-stealth');
    puppeteer.use(sp());

    const chromePath = detectChromePath();
    const proxyUrl = this._nextProxy();
    console.log(`浏览器路径: ${chromePath || '系统默认'}`);

    this.browser = await puppeteer.launch({
      headless: 'new',
      executablePath: chromePath,
      args: this._buildLaunchArgs(proxyUrl),
    });

    this.pages = [];
    for (let i = 0; i < POOL_PAGE_COUNT; i++) {
      const p = await this.browser.newPage();
      await p.setViewport({ width: 1920, height: 1080 });
      await p.setUserAgent(UA_LIST[Math.floor(Math.random() * UA_LIST.length)]);
      this.pages.push(p);
    }
    this.currentPageIdx = 0;
    this.useCount = 0;
    this.consecutiveFails = 0;
    console.log(`  页面池: ${POOL_PAGE_COUNT} 个页面已就绪`);
  }

  _nextPage() {
    return this.pages[this.currentPageIdx++ % this.pages.length];
  }

  async _closeBrowser() {
    if (!this.browser) return;
    try { for (const p of this.pages) try { await p.close(); } catch (_) {} } catch (_) {}
    try { await this.browser.close(); } catch (_) {}
    this.browser = null;
    this.pages = [];
  }

  async fetch(url, options = {}) {
    const timeout = options.timeout || POOL_NAV_TIMEOUT;
    const waitFor = options.waitFor;
    const waitMs = options.waitMs || 2000;
    let lastError;

    for (let retry = 0; retry <= POOL_MAX_RETRIES; retry++) {
      if (retry > 0) {
        const backoff = POOL_RETRY_BASE_DELAY * Math.pow(2, retry - 1);
        console.log(`  ⏳ 重试 ${retry}/${POOL_MAX_RETRIES}，等待 ${(backoff / 1000).toFixed(0)}s 后重启浏览器...`);
        await delay(backoff);
        await this.launch();
        this.consecutiveFails = 0;
      }

      if (this.consecutiveFails >= 5) {
        console.log(`  ⚠ 连续 ${this.consecutiveFails} 次失败，强制重启浏览器`);
        await this.launch();
        this.consecutiveFails = 0;
      }

      if (!this.browser || this.pages.length === 0) await this.launch();

      const page = this._nextPage();
      console.log(`  访问: ${url}`);

      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
        this.useCount++;
        this.consecutiveFails = 0;
      } catch (navErr) {
        lastError = navErr;
        this.useCount++;
        this.consecutiveFails++;
        console.error(`  ✗ 导航失败 (重试 ${retry}/${POOL_MAX_RETRIES}): ${(navErr.message || '').slice(0, 120)}`);
        continue;
      }

      if (waitFor) {
        try { await page.waitForSelector(waitFor, { timeout: 30000 }); } catch (_) {}
      }
      await delay(waitMs);

      try {
        const html = await page.content();
        if (isCloudflareBlock(html)) {
          console.log(`  ⚠ Cloudflare 拦截 (重试 ${retry}/${POOL_MAX_RETRIES})`);
          lastError = new Error('Cloudflare 拦截');
          this.useCount++;
          this.consecutiveFails++;
          continue;
        }
        return html;
      } catch (contentErr) {
        lastError = contentErr;
        continue;
      }
    }
    throw lastError || new Error(`所有重试耗尽 (${POOL_MAX_RETRIES} 次)`);
  }

  async close() {
    await this._closeBrowser();
  }
}

const pool = new CrawlerPool();

// ======================== 进度管理 ========================

function saveProgress(index, total) {
  const data = { startIndex: index, total, updatedAt: new Date().toISOString() };
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

function loadProgress() {
  try {
    if (fs.existsSync(PROGRESS_FILE)) {
      return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf-8'));
    }
  } catch (_) {}
  return null;
}

function clearProgress() {
  try { if (fs.existsSync(PROGRESS_FILE)) fs.unlinkSync(PROGRESS_FILE); } catch (_) {}
}

// ======================== 工具函数 ========================

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const UA_LIST = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
];

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

function isCloudflareBlock(html) {
  return html.includes('cf-challenge') || html.includes('Just a moment') ||
    html.includes('cf-browser-verification') ||
    (html.includes('Attention Required') && html.includes('Cloudflare')) ||
    html.includes('Enable JavaScript and cookies');
}

async function fetchPageByUrl(url, retryCount = 0) {
  return pool.fetch(url, { waitFor: '.playerRealname, .playerNickname', waitMs: 2000 });
}

// ======================== 选手位置解析 ========================

function parsePositionFromHtml(html) {
  const $ = cheerio.load(html);
  let position = '步枪手';
  const playerProfile = $('.player-profile-summary-container .text-ellipsis').text().toLowerCase();
  if (playerProfile.includes('awper') || playerProfile.includes('sniper')) position = '狙击手';
  else if (playerProfile.includes('igl') || playerProfile.includes('captain')) position = '指挥';
  else if (playerProfile.includes('coach')) position = '教练';
  return position;
}

async function evaluateRatioAndCorrect(htmlPosition) {
  try {
    const livePage = pool.pages && pool.pages.length > 0
      ? pool.pages[(pool.currentPageIdx - 1) % pool.pages.length]
      : null;
    if (!livePage || livePage.isClosed()) return { position: htmlPosition, ratioValue: null, corrected: false };

    const ratioValue = await livePage.evaluate(() => {
      const el = document.querySelector('#infoBox > div.g-grid.stats-matches > div:nth-child(1) > div.playerpage-container.playerpage-container-attributes > div:nth-child(7) > div.player-stat-top > span > p > b');
      return el ? parseFloat(el.textContent.trim()) : null;
    });
    if (ratioValue !== null && ratioValue > 65) return { position: '狙击手', ratioValue, corrected: true };
    return { position: htmlPosition, ratioValue, corrected: false };
  } catch (_) {
    return { position: htmlPosition, ratioValue: null, corrected: false };
  }
}

async function checkPlayerPosition(player) {
  const playerUrl = `${BASE_URL}/player/${player._id}/${player.name}`;
  try {
    const html = await fetchPageByUrl(playerUrl);
    const htmlPosition = parsePositionFromHtml(html);
    const result = await evaluateRatioAndCorrect(htmlPosition);
    const changed = player.position !== result.position;
    if (changed) {
      console.log(`  ✏ ${player.name}: "${player.position}" → "${result.position}" (ratio: ${result.ratioValue})`);
    } else {
      console.log(`  ✓ ${player.name}: "${player.position}" 正确`);
    }
    return { ...player, position: result.position, _positionChanged: changed };
  } catch (err) {
    console.error(`  ✗ 检查 ${player.name} 失败: ${err.message}`);
    return { ...player, _positionChanged: false };
  }
}

function loadPlayers() {
  if (!fs.existsSync(DATA_FILE)) {
    console.error(`数据文件不存在: ${DATA_FILE}`);
    process.exit(1);
  }
  return fs.readFileSync(DATA_FILE, 'utf8').split('\n').filter(l => l.trim()).map(l => JSON.parse(l));
}

async function closeBrowser() {
  await pool.close();
  console.log('\n轮换池已关闭');
}

// ======================== MySQL ========================

let dbPool = null;

async function getDbConnection() {
  if (dbPool) return dbPool;
  const host = process.env.DB_HOST || process.env.MYSQLHOST || 'hayabusa.proxy.rlwy.net';
  const port = parseInt(process.env.DB_PORT || process.env.MYSQLPORT || '16612', 10);
  const user = process.env.DB_USER || process.env.MYSQLUSER || 'root';
  const password = process.env.DB_PASS || process.env.MYSQLPASSWORD || 'ojfZTZhWxfsJgcnKswraKulftkRjbOLG';
  const database = process.env.DB_NAME || process.env.MYSQLDATABASE || 'railway';
  if (!password) { console.warn('\n⚠ 未设置数据库密码'); return null; }
  try {
    dbPool = await mysql.createConnection({ host, port, user, password, database, ssl: { rejectUnauthorized: false }, connectTimeout: 10000 });
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
    const [result] = await conn.execute('UPDATE player SET position = ? WHERE game_id = ? OR name = ?', [position, playerId, name]);
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

  const allPlayers = loadPlayers();
  console.log(`共加载 ${allPlayers.length} 个选手数据`);

  // 筛选
  let players = allPlayers;
  if (quickMode) {
    players = allPlayers.filter(p => p.position === '步枪手' || !p.position);
    console.log(`快速模式: 筛选出 ${players.length} 个"步枪手"待检查\n`);
  }

  if (players.length === 0) { console.log('没有需要检查的选手'); return; }

  // 断点续检
  const progress = loadProgress();
  let startIndex = 0;
  if (progress && progress.startIndex > 0 && progress.startIndex < players.length) {
    startIndex = progress.startIndex;
    console.log(`检测到上次进度 (${progress.updatedAt})，从第 ${startIndex + 1}/${players.length} 个继续\n`);
  }

  try {
    let correctedCount = 0;
    let dbConn = null;
    if (useDb || quickMode) dbConn = await getDbConnection();
    const pendingDbSync = [];

    /** 将待同步队列写入 MySQL */
    const flushDb = async () => {
      if (pendingDbSync.length > 0 && dbConn) {
        console.log(`  ── 写入 MySQL ${pendingDbSync.length} 条位置变更...`);
        for (const item of pendingDbSync) {
          await syncPositionToDb(dbConn, item.id, item.name, item.position);
        }
        pendingDbSync.length = 0;
      }
    };

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
        const idx = players.findIndex(p => p._id === result._id);
        if (idx !== -1) players[idx] = result;
        pendingDbSync.push({ id: result._id, name: result.name, position: result.position });
      }

      await delay(DELAY_BETWEEN_REQUESTS);

      // 每 BATCH_SIZE 个选手：写入 MySQL + 重启浏览器
      if ((i + 1) % BATCH_SIZE === 0 && i < players.length - 1) {
        await flushDb();
        saveProgress(i + 1, players.length);
        console.log(`\n--- 已检查 ${i + 1}/${players.length}，重启浏览器 ---\n`);
        await pool.close();
        // pool 在下次 fetch 时自动调用 launch()
      }
    }

    // 最终写入 MySQL + 清理进度文件
    await flushDb();
    clearProgress();

    console.log('\n========================================');
    console.log('检查完成！');
    console.log(`总计检查: ${players.length} 个选手`);
    console.log(`位置修正: ${correctedCount} 个`);
    console.log('========================================');
  } catch (error) {
    console.error('\n检查过程中出错:', error.message);
    // 把已检查的变更写入 MySQL 再退出
    if (dbConn && pendingDbSync.length > 0) {
      console.log('  ── 尝试写入已检查的位置变更...');
      for (const item of pendingDbSync) {
        try { await syncPositionToDb(dbConn, item.id, item.name, item.position); } catch (_) {}
      }
    }
    saveProgress(startIndex > 0 ? startIndex : 0, players.length);
    console.log('进度已保存，下次运行会自动续检');
  } finally {
    await pool.close();
    if (dbPool) { try { await dbPool.end(); } catch {} }
    process.exit(0);
  }
}

if (require.main === module) {
  checkAllPositions();
}

module.exports = { checkAllPositions, checkPlayerPosition };
