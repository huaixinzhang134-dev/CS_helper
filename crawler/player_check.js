const fs = require('fs');
const cheerio = require('cheerio');

let puppeteer;
let stealthPlugin;

const BASE_URL = 'https://www.hltv.org';
const DATA_FILE = __dirname + '/playerbase.json';
const DELAY_BETWEEN_REQUESTS = 3000;

let browser;
let page;

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function initBrowser() {
  if (browser) return;

  puppeteer = require('puppeteer-extra');
  stealthPlugin = require('puppeteer-extra-plugin-stealth');
  puppeteer.use(stealthPlugin());

  console.log('正在启动浏览器...');
  browser = await puppeteer.launch({
    headless: 'new',
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
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
 * 主检查流程
 */
async function checkAllPositions() {
  console.log('========================================');
  console.log('选手位置检查工具');
  console.log('========================================\n');

  // 支持参数：指定检查某几个选手（按 _id 或 name）
  const args = process.argv.slice(2);
  const filterIds = args.filter(a => /^\d+$/.test(a));
  const filterNames = args.filter(a => !a.startsWith('-') && !/^\d+$/.test(a));

  let players = loadPlayers();
  console.log(`共加载 ${players.length} 个选手数据\n`);

  // 按参数筛选
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

    for (let i = 0; i < players.length; i++) {
      const player = players[i];
      console.log(`[${i + 1}/${players.length}] 检查 ${player.name} (${player._id})...`);

      const result = await checkPlayerPosition(player);

      if (result._positionChanged) {
        correctedCount++;
        // 更新原数据
        const idx = players.findIndex(p => p._id === result._id);
        if (idx !== -1) {
          players[idx] = result;
        }
      }

      await delay(DELAY_BETWEEN_REQUESTS);

      // 每20个保存一次
      if ((i + 1) % 20 === 0) {
        savePlayers(players);
        console.log(`--- 已保存进度: ${i + 1}/${players.length} ---\n`);
      }
    }

    // 最终保存
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
    console.log(`已保存当前进度`);
  } finally {
    await closeBrowser();
  }
}

if (require.main === module) {
  checkAllPositions();
}

module.exports = { checkAllPositions, checkPlayerPosition };
