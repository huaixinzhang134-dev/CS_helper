const fs = require('fs');
const cheerio = require('cheerio');
const path = require('path');
const mysql = require('mysql2/promise');

let puppeteer;
let stealthPlugin;

const BASE_URL = 'https://www.hltv.org';
const DATA_FILE = __dirname + '/playerbase.json';
const DELAY_BETWEEN_REQUESTS = 2000;

// ======================== 轮换池配置 ========================

/** 浏览器重启间隔（每个实例处理 N 次请求后重启，失败也计入） */
const POOL_RESTART_INTERVAL = 50;
/** 页面池大小（每个浏览器实例内建 N 个页面，轮转使用） */
const POOL_PAGE_COUNT = 4;
/** 超时重试最大次数 */
const POOL_MAX_RETRIES = 3;
/** 超时重试基础等待（ms），每次翻倍 */
const POOL_RETRY_BASE_DELAY = 30000;
/** 导航超时（ms） */
const POOL_NAV_TIMEOUT = 120000;

// ======================== 轮换池（Page Pool + 定时重启 + 代理轮换） ========================

class CrawlerPool {
  constructor() {
    this.browser = null;
    this.pages = [];          // 当前 browser 的页面池
    this.currentPageIdx = 0;  // 轮转索引
    this.useCount = 0;        // 当前 browser 已处理的请求数（成功+失败）
    this.consecutiveFails = 0; // 连续失败次数
    this.proxies = [];        // 代理列表
    this.currentProxyIdx = 0;
    this._loadProxies();
  }

  /** 从环境变量 / 命令行加载代理列表 */
  _loadProxies() {
    // 支持 PROXY_LIST 环境变量：'http://user:pass@host:port,http://user2:pass2@host2:port2'
    const envProxies = process.env.PROXY_LIST || '';
    if (envProxies) {
      this.proxies = envProxies.split(',').map(s => s.trim()).filter(Boolean);
      console.log(`  代理池: 已加载 ${this.proxies.length} 个代理`);
    } else {
      // 从命令行参数读取 --proxies=url1,url2,url3
      const proxyArg = process.argv.find(a => a.startsWith('--proxies='));
      if (proxyArg) {
        this.proxies = proxyArg.replace('--proxies=', '').split(',').map(s => s.trim()).filter(Boolean);
        console.log(`  代理池: 从 --proxies 加载 ${this.proxies.length} 个代理`);
      }
    }
  }

  /** 获取下一个代理（轮转），没有则返回 undefined */
  _nextProxy() {
    if (this.proxies.length === 0) return undefined;
    const proxy = this.proxies[this.currentProxyIdx % this.proxies.length];
    this.currentProxyIdx++;
    return proxy;
  }

  /** 获取浏览器 launch args（含代理） */
  _buildLaunchArgs(proxyUrl) {
    const args = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu',
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process'
    ];
    if (proxyUrl) {
      args.push(`--proxy-server=${proxyUrl}`);
      console.log(`  使用代理: ${proxyUrl.replace(/\/\/.*@/, '//***:***@')}`);  // 脱敏打印
    }
    return args;
  }

  /** 启动一个新的浏览器实例 + N 个页面 */
  async launch() {
    if (this.browser) {
      await this._closeBrowser();
    }

    puppeteer = require('puppeteer-extra');
    const sp = require('puppeteer-extra-plugin-stealth');
    puppeteer.use(sp());

    const chromePath = detectChromePath();

    // 轮换代理
    const proxyUrl = this._nextProxy();
    const launchArgs = this._buildLaunchArgs(proxyUrl);

    console.log(`浏览器路径: ${chromePath || '系统默认'}`);
    console.log(`启动浏览器实例 #${Math.floor(this.useCount / POOL_RESTART_INTERVAL) + 1}`);

    this.browser = await puppeteer.launch({
      headless: 'new',
      executablePath: chromePath,
      args: launchArgs,
    });

    // 创建页面池
    this.pages = [];
    for (let i = 0; i < POOL_PAGE_COUNT; i++) {
      const p = await this.browser.newPage();
      await p.setViewport({ width: 1920, height: 1080 });
      // 随机 User-Agent
      const ua = getRandomUA();
      await p.setUserAgent(ua);
      this.pages.push(p);
    }
    this.currentPageIdx = 0;
    this.useCount = 0;
    console.log(`  页面池: ${POOL_PAGE_COUNT} 个页面已就绪`);
  }

  /** 获取下一个页面（round-robin） */
  _nextPage() {
    const page = this.pages[this.currentPageIdx % this.pages.length];
    this.currentPageIdx++;
    return page;
  }

  /** 检查是否需要重启浏览器 */
  async _checkRestart() {
    if (this.useCount >= POOL_RESTART_INTERVAL) {
      console.log(`\n--- 达到 ${POOL_RESTART_INTERVAL} 次请求限制，重启浏览器 ---\n`);
      await this.launch();
    }
  }

  /** 关闭浏览器 */
  async _closeBrowser() {
    if (!this.browser) return;
    try {
      for (const p of this.pages) {
        try { await p.close(); } catch (_) {}
      }
      await this.browser.close();
    } catch (_) {}
    this.browser = null;
    this.pages = [];
  }

  /**
   * 发送请求（自动轮换页面 + 重启 + 重试）
   * @param {string} url
   * @param {object} options
   * @param {number} options.timeout - 导航超时（ms），默认 POOL_NAV_TIMEOUT
   * @param {number} options.waitFor - 等待选择器出现
   * @param {number} options.waitMs - 等待后固定延迟（ms）
   */
  async fetch(url, options = {}) {
    const timeout = options.timeout || POOL_NAV_TIMEOUT;
    const waitFor = options.waitFor;
    const waitMs = options.waitMs || 2000;

    let lastError;

    for (let retry = 0; retry <= POOL_MAX_RETRIES; retry++) {
      // 每次重试（除第一次外）重启浏览器换 IP
      if (retry > 0) {
        const backoff = POOL_RETRY_BASE_DELAY * Math.pow(2, retry - 1);
        console.log(`  ⏳ 第 ${retry}/${POOL_MAX_RETRIES} 次重试，等待 ${(backoff / 1000).toFixed(0)}s 后重启浏览器...`);
        await delay(backoff);
        await this.launch();
        this.consecutiveFails = 0;
      }

      // 检查是否需要定时重启
      if (retry === 0) {
        await this._checkRestart();
      }

      // 连续失败过多时强制重启（触发在 _checkRestart 之后，记入下个周期）
      if (this.consecutiveFails >= 5) {
        console.log(`  ⚠ 连续 ${this.consecutiveFails} 次失败，强制重启浏览器`);
        await this.launch();
        this.consecutiveFails = 0;
      }

      // 确保浏览器已启动
      if (!this.browser || this.pages.length === 0) {
        await this.launch();
      }

      const page = this._nextPage();
      console.log(`  访问: ${url} (页面 ${this.currentPageIdx % this.pages.length + 1}/${this.pages.length})`);

      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
        this.useCount++;
        this.consecutiveFails = 0;
      } catch (navErr) {
        lastError = navErr;
        this.useCount++;  // 失败也计入，确保最终触发重启
        this.consecutiveFails++;
        const msg = navErr.message || '';
        console.error(`  ✗ 导航失败 (重试 ${retry}/${POOL_MAX_RETRIES}): ${msg.slice(0, 120)}`);
        continue;
      }

      // 等待目标内容
      if (waitFor) {
        try {
          await page.waitForSelector(waitFor, { timeout: 30000 });
        } catch (_) {}
      }

      // 固定等待
      await delay(waitMs);

      // 获取 HTML 并检查 Cloudflare
      try {
        const html = await page.content();

        if (isCloudflareBlock(html)) {
          console.log(`  ⚠ Cloudflare 拦截 (重试 ${retry}/${POOL_MAX_RETRIES})`);
          lastError = new Error('Cloudflare 拦截');
          this.useCount++;
          this.consecutiveFails++;
          continue;
        }

        return html;  // ✓ 成功
      } catch (contentErr) {
        lastError = contentErr;
        console.error(`  ✗ 获取页面内容失败 (重试 ${retry}/${POOL_MAX_RETRIES}): ${contentErr.message.slice(0, 120)}`);
        continue;
      }
    }

    throw lastError || new Error(`所有重试耗尽 (${POOL_MAX_RETRIES} 次)`);
  }

  /** 关闭所有资源 */
  async close() {
    await this._closeBrowser();
  }
}

// 创建全局轮换池实例
const pool = new CrawlerPool();

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** 轮换 User-Agent 列表 */
const UA_LIST = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
];

function getRandomUA() {
  return UA_LIST[Math.floor(Math.random() * UA_LIST.length)];
}

function detectChromePath() {
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium'
  ];
  for (const p of candidates) {
    try { if (fs.existsSync(p)) return p; } catch (_) {}
  }
  return undefined;
}

function isCloudflareBlock(html) {
  return html.includes('cf-challenge') ||
         html.includes('Just a moment') ||
         html.includes('cf-browser-verification') ||
         (html.includes('Attention Required') && html.includes('Cloudflare')) ||
         html.includes('Enable JavaScript and cookies');
}

/**
 * 通过轮换池请求页面（向后兼容的封装）
 */
async function fetchPageByUrl(url, retryCount = 0) {
  return pool.fetch(url, {
    waitFor: '.playerRealname, .playerNickname',
    waitMs: 2000,
  });
}

/**
 * 解析页面文字判断位置（与爬虫逻辑一致）
 */
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

/**
 * 从页面属性中获取 ratio 值并辅助修正位置
 * 注意：需要在调用 fetchPageByUrl 之后立即调用，由 checkPlayerPosition 控制时序
 */
async function evaluateRatioAndCorrect(htmlPosition) {
  let correctedPosition = htmlPosition;

  try {
    // 从 pool 中获取上一次使用的 page（刚访问完该选手页面的 page）
    // 如果 pool 没有可用 page 则跳过
    const livePage = pool.pages && pool.pages.length > 0
      ? pool.pages[(pool.currentPageIdx - 1) % pool.pages.length]
      : null;

    if (!livePage || livePage.isClosed()) {
      return { position: correctedPosition, ratioValue: null, corrected: false };
    }

    const ratioValue = await livePage.evaluate(() => {
      const attrBase = '#infoBox > div.g-grid.stats-matches > div:nth-child(1) > div.playerpage-container.playerpage-container-attributes > div:nth-child';
      const ratioEl = document.querySelector(attrBase + '(7) > div.player-stat-top > span > p > b');
      return ratioEl ? parseFloat(ratioEl.textContent.trim()) : null;
    });

    if (ratioValue !== null && ratioValue > 65) {
      correctedPosition = '狙击手';
      return { position: correctedPosition, ratioValue, corrected: true };
    }

    return { position: correctedPosition, ratioValue, corrected: false };
  } catch (e) {
    return { position: correctedPosition, ratioValue: null, corrected: false };
  }
}

/**
 * 检查单个选手的位置
 */
async function checkPlayerPosition(player) {
  const playerUrl = `${BASE_URL}/player/${player._id}/${player.name}`;

  try {
    const html = await fetchPageByUrl(playerUrl);
    const htmlPosition = parsePositionFromHtml(html);
    const result = await evaluateRatioAndCorrect(htmlPosition);

    const oldPosition = player.position;
    const newPosition = result.position;
    const changed = oldPosition !== newPosition;

    if (changed) {
      console.log(`  ✏ ${player.name}: "${oldPosition}" → "${newPosition}" (ratio: ${result.ratioValue})`);
    } else {
      console.log(`  ✓ ${player.name}: "${oldPosition}" 正确`);
    }

    return { ...player, position: newPosition, _positionChanged: changed };
  } catch (err) {
    console.error(`  ✗ 检查 ${player.name} 失败: ${err.message}`);
    return { ...player, _positionChanged: false };
  }
}

/**
 * 加载 playerbase.json
 */
function loadPlayers() {
  if (!fs.existsSync(DATA_FILE)) {
    console.error(`数据文件不存在: ${DATA_FILE}`);
    process.exit(1);
  }

  const lines = fs.readFileSync(DATA_FILE, 'utf8').split('\n').filter(l => l.trim());
  return lines.map(l => JSON.parse(l));
}

/**
 * 保存回 playerbase.json
 */
function savePlayers(players) {
  const jsonLinesData = players.map(p => {
    const { _positionChanged, ...rest } = p;
    return JSON.stringify(rest);
  }).join('\n');
  fs.writeFileSync(DATA_FILE, jsonLinesData, 'utf8');
}

async function closeBrowser() {
  await pool.close();
  console.log('\n轮换池已关闭');
}

/**
 * 连接到 MySQL 数据库
 * 使用与 import_ranking.js 一致的凭据
 */
let dbPool = null;
async function getDbConnection() {
  if (dbPool) return dbPool;
  const host = process.env.DB_HOST || process.env.MYSQLHOST || 'hayabusa.proxy.rlwy.net';
  const port = parseInt(process.env.DB_PORT || process.env.MYSQLPORT || '16612', 10);
  const user = process.env.DB_USER || process.env.MYSQLUSER || 'root';
  const password = process.env.DB_PASS || process.env.MYSQLPASSWORD || 'ojfZTZhWxfsJgcnKswraKulftkRjbOLG';
  const database = process.env.DB_NAME || process.env.MYSQLDATABASE || 'railway';

  if (!password) {
    console.warn('\n⚠ 请在运行前设置数据库密码环境变量:');
    console.warn('   export DB_PASS=你的Railway MySQL密码');
    return null;
  }

  try {
    const conn = await mysql.createConnection({ host, port, user, password, database,
      ssl: { rejectUnauthorized: false }, connectTimeout: 10000 });
    console.log(`  已连接数据库 ${host}:${port}/${database}\n`);
    dbPool = conn;
    return conn;
  } catch (err) {
    console.error(`  数据库连接失败: ${err.message}`);
    return null;
  }
}

/**
 * 将位置更新写入 MySQL
 */
async function syncPositionToDb(conn, playerId, name, position) {
  if (!conn) return;
  try {
    const [result] = await conn.execute(
      'UPDATE player SET position = ? WHERE game_id = ? OR name = ?',
      [position, playerId, name]
    );
    if (result.affectedRows > 0) {
      console.log(`  DB ✓ ${name} → "${position}" (${result.affectedRows} 行)`);
    }
  } catch (err) {
    console.error(`  DB ✗ ${name}: ${err.message}`);
  }
}

/**
 * 主检查流程
 */
async function checkAllPositions() {
  console.log('========================================');
  console.log('选手位置检查工具');
  console.log('========================================\n');

  const args = process.argv.slice(2);
  const useDb = args.includes('--db');
  const quickMode = args.includes('--quick');
  const filterIds = args.filter(a => /^\d+$/.test(a));
  const filterNames = args.filter(a => !a.startsWith('-') && !/^\d+$/.test(a));

  let players = loadPlayers();
  console.log(`共加载 ${players.length} 个选手数据`);

  if (useDb) console.log('模式: 检查 + 同步到数据库');
  else console.log('模式: 仅检查（加 --db 同步到数据库）');
  if (quickMode) console.log('快速模式: 仅检查当前为"步枪手"的选手\n');
  else console.log('');

  if (filterIds.length > 0 || filterNames.length > 0) {
    players = players.filter(p =>
      filterIds.includes(p._id) || filterNames.includes(p.name)
    );
    console.log(`筛选后待检查: ${players.length} 个选手\n`);
  }
  if (quickMode) {
    const before = players.length;
    players = players.filter(p => p.position === '步枪手' || !p.position);
    console.log(`快速模式: 从 ${before} 人筛选出 ${players.length} 个"步枪手"待检查\n`);
  }

  if (players.length === 0) {
    console.log('没有需要检查的选手');
    return;
  }

  try {
    let correctedCount = 0;
    let failedCount = 0;

    // 如果启用 DB 同步，先连接数据库
    let dbConn = null;
    const enableDb = useDb || quickMode;
    if (enableDb) {
      dbConn = await getDbConnection();
      if (!dbConn) {
        console.log('⚠ 数据库连接失败，仅保存本地文件\n');
      }
    }

    // 待同步到 DB 的变更队列
    const pendingDbSync = [];

    for (let i = 0; i < players.length; i++) {
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

      // 每 300 个选手或最后一批，批量同步到数据库
      if (pendingDbSync.length > 0 && dbConn && ((i + 1) % 300 === 0 || i === players.length - 1)) {
        console.log(`  ── 批量同步 ${pendingDbSync.length} 条位置变更到数据库...`);
        for (const item of pendingDbSync) {
          await syncPositionToDb(dbConn, item.id, item.name, item.position);
        }
        pendingDbSync.length = 0;
      }

      // 每 20 个保存一次本地文件
      if ((i + 1) % 20 === 0) {
        savePlayers(players);
        console.log(`--- 已保存进度: ${i + 1}/${players.length} ---\n`);
      }
    }

    // 最后一批同步
    if (pendingDbSync.length > 0 && dbConn) {
      console.log(`  ── 最后同步 ${pendingDbSync.length} 条位置变更到数据库...`);
      for (const item of pendingDbSync) {
        await syncPositionToDb(dbConn, item.id, item.name, item.position);
      }
      pendingDbSync.length = 0;
    }

    savePlayers(players);

    console.log('\n========================================');
    console.log('检查完成！');
    console.log(`总计检查: ${players.length} 个选手`);
    console.log(`位置修正: ${correctedCount} 个`);
    console.log(`失败: ${failedCount} 个`);
    console.log('========================================');
  } catch (error) {
    console.error('\n检查过程中出错:', error.message);
    savePlayers(players);
    console.log('已保存当前进度');
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
