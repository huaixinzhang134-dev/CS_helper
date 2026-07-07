const fs = require('fs');
const cheerio = require('cheerio');
const path = require('path');
const mysql = require('mysql2/promise');

let puppeteer;
let stealthPlugin;

const BASE_URL = 'https://www.hltv.org';
const DATA_FILE = __dirname + '/playerbase.json';
const DELAY_BETWEEN_REQUESTS = 2000;

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
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium'
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
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu',
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process'
    ]
  });

  page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });
  console.log('浏览器启动成功\n');
}

function isCloudflareBlock(html) {
  return html.includes('cf-challenge') ||
         html.includes('Just a moment') ||
         html.includes('cf-browser-verification') ||
         (html.includes('Attention Required') && html.includes('Cloudflare')) ||
         html.includes('Enable JavaScript and cookies');
}

async function fetchPageByUrl(url, retryCount = 0) {
  await initBrowser();

  try {
    console.log(`  访问: ${url}`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

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
        await page.reload({ waitUntil: 'domcontentloaded' });
        return fetchPageByUrl(url, retryCount + 1);
      } else {
        throw new Error(`Cloudflare 拦截，已重试 3 次: ${url}`);
      }
    }

    return html;
  } catch (err) {
    console.error(`  ✗ 请求失败: ${err.message}`);
    throw err;
  }
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
 */
async function evaluateRatioAndCorrect(htmlPosition) {
  let correctedPosition = htmlPosition;

  try {
    const ratioValue = await page.evaluate(() => {
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
  if (browser) {
    await browser.close();
    browser = null;
    page = null;
    console.log('\n浏览器已关闭');
  }
}

/**
 * 连接到 MySQL 数据库
 * 使用与 import_ranking.js 一致的凭据
 */
let dbPool = null;
async function getDbConnection() {
  if (dbPool) return dbPool;
  const host = process.env.DB_HOST || process.env.MYSQLHOST || 'mysql-production-0b76.up.railway.app';
  const port = parseInt(process.env.DB_PORT || process.env.MYSQLPORT || '3306', 10);
  const user = process.env.DB_USER || process.env.MYSQLUSER || 'root';
  const password = process.env.DB_PASS || process.env.MYSQLPASSWORD || '';
  const database = process.env.DB_NAME || process.env.MYSQLDATABASE || 'railway';

  if (!password) {
    console.warn('\n⚠ 未设置数据库密码，请在运行前设置环境变量:');
    console.warn('   export DB_HOST=mysql-production-0b76.up.railway.app');
    console.warn('   export DB_PORT=3306');
    console.warn('   export DB_USER=root');
    console.warn('   export DB_PASS=你的密码');
    console.warn('   export DB_NAME=railway\n');
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
  const filterIds = args.filter(a => /^\d+$/.test(a));
  const filterNames = args.filter(a => !a.startsWith('-') && !/^\d+$/.test(a));

  let players = loadPlayers();
  console.log(`共加载 ${players.length} 个选手数据`);

  if (useDb) console.log('模式: 检查 + 同步到数据库\n');
  else console.log('模式: 仅检查（加 --db 同步到数据库）\n');

  if (filterIds.length > 0 || filterNames.length > 0) {
    players = players.filter(p =>
      filterIds.includes(p._id) || filterNames.includes(p.name)
    );
    console.log(`筛选后待检查: ${players.length} 个选手\n`);
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
    if (useDb) {
      dbConn = await getDbConnection();
      if (!dbConn) {
        console.log('⚠ 数据库连接失败，仅保存本地文件\n');
      }
    }

    for (let i = 0; i < players.length; i++) {
      const player = players[i];
      console.log(`[${i + 1}/${players.length}] 检查 ${player.name} (${player._id})...`);

      const result = await checkPlayerPosition(player);

      if (result._positionChanged) {
        correctedCount++;
        const idx = players.findIndex(p => p._id === result._id);
        if (idx !== -1) players[idx] = result;

        if (dbConn) {
          await syncPositionToDb(dbConn, result._id, result.name, result.position);
        }
      }

      await delay(DELAY_BETWEEN_REQUESTS);

      if ((i + 1) % 20 === 0) {
        savePlayers(players);
        console.log(`--- 已保存进度: ${i + 1}/${players.length} ---\n`);
      }
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
