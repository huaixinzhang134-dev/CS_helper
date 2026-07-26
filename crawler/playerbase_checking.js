/**
 * 选手位置检测工具
 *
 * 爬取 HLTV 检测选手位置（步枪手/狙击手/指挥），
 * 将修正直接写入 playerbase.json（本地数据文件）。
 * 不涉及数据库操作。
 *
 * 用法：
 *   node playerbase_checking.js [--quick] [--start=N] [--limit=N]
 *
 *   --quick  仅检查当前为"步枪手"的选手（快速模式）
 *   --start=N 跳过前 N 个
 *   --limit=N 最多处理 N 个
 */

const fs = require('fs');
const cheerio = require('cheerio');
const path = require('path');

let puppeteer;
let stealthPlugin;

const BASE_URL = 'https://www.hltv.org';
const DATA_FILE = __dirname + '/playerbase.json';
const PROGRESS_FILE = __dirname + '/playerbase_checking_progress.json';
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

  const tmpUserDir = path.join(require('os').tmpdir(), 'puppeteer-profile-' + Date.now());
  browser = await puppeteer.launch({
    headless: 'new',
    executablePath: chromePath,
    protocolTimeout: 120000,
    args: [
      '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas', '--no-first-run', '--no-zygote',
      '--disable-gpu', '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process',
      '--disable-background-networking', '--disable-background-timer-throttling',
      `--user-data-dir=${tmpUserDir}`
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
    const isCanceled = err.message.includes('canceled') || err.message.includes('cancelled');
    if (isCanceled && retryCount < 3) {
      const waitTime = (retryCount + 1) * 8000;
      console.log(`  ⚠ 请求被取消，${(waitTime / 1000).toFixed(0)}s 后重试 (${retryCount + 1}/3)...`);

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

/**
 * 通过固定 CSS 选择器提取 Sniping 比率值辅助判断
 */
async function evaluateRatioAndCorrect(htmlPosition) {
  try {
    const ratioValue = await page.evaluate(() => {
      try {
        const bEl = document.querySelector(
          '#infoBox > div.g-grid.stats-matches > div:nth-child(1) ' +
          '> div.playerpage-container.playerpage-container-attributes ' +
          '> div:nth-child(7) > div.player-stat-top > span > p > b'
        );
        if (bEl) {
          const val = parseFloat(bEl.textContent.trim());
          return isNaN(val) ? null : val;
        }
      } catch (_) {}
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

// ======================== 数据（仅本地文件） ========================

/** 读取 playerbase.json 的所有原始行 */
let playerbaseRawLines = [];

function loadPlayers() {
  if (!fs.existsSync(DATA_FILE)) {
    console.error(`数据文件不存在: ${DATA_FILE}`);
    process.exit(1);
  }
  const raw = fs.readFileSync(DATA_FILE, 'utf8');
  playerbaseRawLines = raw.split('\n');
  return playerbaseRawLines.filter(l => l.trim()).map(l => JSON.parse(l));
}

/** 按 _id 匹配将更新写回 playerbase.json */
function flushPlayerbaseJson(updatedPlayers) {
  if (!updatedPlayers || updatedPlayers.length === 0) return;
  const idToPlayer = new Map(updatedPlayers.map(p => [String(p._id), p]));
  let modified = 0;
  for (let i = 0; i < playerbaseRawLines.length; i++) {
    const line = playerbaseRawLines[i].trim();
    if (!line) continue;
    try {
      const p = JSON.parse(line);
      const updated = idToPlayer.get(String(p._id));
      if (updated) {
        playerbaseRawLines[i] = JSON.stringify(updated, (key, val) => val === undefined ? undefined : val);
        modified++;
      }
    } catch (_) {}
  }
  if (modified > 0) {
    fs.writeFileSync(DATA_FILE, playerbaseRawLines.join('\n'), 'utf-8');
    console.log(`\n📝 已保存 ${modified} 条位置修改到 ${path.basename(DATA_FILE)}`);
  }
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

// ======================== 主流程 ========================

async function checkAllPositions() {
  console.log('========================================');
  console.log('选手位置检测工具 (playerbase_checking)');
  console.log('检测结果直接写入 playerbase.json');
  console.log('========================================\n');

  const args = process.argv.slice(2);
  const quickMode = args.includes('--quick');

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

  if (chunkStart > 0 || chunkLimit < Infinity) {
    const chunkEnd = Math.min(chunkStart + chunkLimit, players.length);
    players = players.slice(chunkStart, chunkEnd);
    console.log(`分片模式: 处理第 ${chunkStart + 1}～${chunkEnd} 个，共 ${players.length} 人\n`);
  }

  const progress = loadProgress();
  let startIndex = 0;
  if (progress && progress.startIndex > 0 && progress.startIndex < players.length) {
    startIndex = progress.startIndex;
    console.log(`检测到上次进度 (${progress.updatedAt})，从第 ${startIndex + 1}/${players.length} 个继续\n`);
  }

  /** 待写回 playerbase.json 的更新队列 */
  const pendingFileSync = [];

  let signalReceived = false;
  async function flushOnSignal(signal) {
    if (signalReceived) return;
    signalReceived = true;
    console.log(`\n⚠ 收到 ${signal} 信号，正在保存 ${pendingFileSync.length} 条待写入数据...`);
    flushPlayerbaseJson(pendingFileSync);
    saveProgress(startIndex, players.length);
    await closeBrowser();
    process.exit(0);
  }
  process.on('SIGINT', () => flushOnSignal('SIGINT'));
  process.on('SIGTERM', () => flushOnSignal('SIGTERM'));

  try {
    let correctedCount = 0;

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
        pendingFileSync.push(result);
      }

      await delay(DELAY_BETWEEN_REQUESTS);

      if ((i + 1) % BATCH_SIZE === 0 && i < players.length - 1) {
        flushPlayerbaseJson(pendingFileSync);
        saveProgress(i + 1, players.length);
        console.log(`\n--- 已检查 ${i + 1}/${players.length}，重启浏览器 ---\n`);
        await closeBrowser();
      }
    }

    flushPlayerbaseJson(pendingFileSync);
    clearProgress();

    console.log('\n========================================');
    console.log('检测完成！');
    console.log(`总计检查: ${players.length} 个选手`);
    console.log(`位置修正: ${correctedCount} 个`);
    console.log('========================================');
  } catch (error) {
    console.error('\n检测过程中出错:', error.message);
    flushPlayerbaseJson(pendingFileSync);
    saveProgress(startIndex > 0 ? startIndex : 0, players.length);
    console.log('进度已保存');
  } finally {
    await closeBrowser();
    process.exit(0);
  }
}

if (require.main === module) {
  checkAllPositions();
}

module.exports = { checkAllPositions, checkPlayerPosition };
