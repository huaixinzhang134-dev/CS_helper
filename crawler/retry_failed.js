/**
 * 仅重爬失败的选手
 *
 * 原理：对比 playerbase.json（已成功数据）和 HLTV 列表页的完整选手名单，
 *       找出缺失/失败的选手，仅爬取这些。
 *
 * 用法：
 *   node retry_failed.js                    # 自动对比，补爬缺失选手
 *   node retry_failed.js --ids-only         # 只输出缺失 ID 列表，不爬
 *   node retry_failed.js 11893 4608         # 按 ID 指定要重爬的选手
 *   node retry_failed.js s1mple NiKo        # 按名字指定要重爬的选手
 *   node retry_failed.js --image-only       # 仅补爬缺失的头像图片
 *
 * 依赖：
 *   npm install puppeteer-extra puppeteer-extra-plugin-stealth cheerio
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

let puppeteer;

// ======================== 配置 ========================

const BASE_URL = 'https://www.hltv.org';
const DATA_FILE = path.join(__dirname, 'playerbase.json');
const IMAGE_DIR = path.join(__dirname, 'image');
const FAILED_LOG = path.join(__dirname, 'retry_failed_log.json');
const DELAY_MS = 3000;
const CATEGORIES = [
  'numbers', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I',
  'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T',
  'U', 'V', 'W', 'X', 'Y', 'Z'
];
const MAX_PAGES = 10;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
           '(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

let browser;
let page;

// ======================== 工具 ========================

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function randomDelay() {
  return sleep(1000 + Math.random() * 2000);
}

function sanitizeFileName(name) {
  return name.replace(/[<>:"/\\|?*]/g, '_').trim();
}

// ======================== 浏览器 ========================

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
    '/usr/bin/chromium',
  ];
  for (const p of candidates) {
    try { if (fs.existsSync(p)) return p; } catch (_) {}
  }
  return undefined;
}

async function initBrowser() {
  if (browser) return;
  puppeteer = require('puppeteer-extra');
  const stealth = require('puppeteer-extra-plugin-stealth');
  puppeteer.use(stealth());
  const chromePath = detectChromePath();
  browser = await puppeteer.launch({
    headless: 'new',
    executablePath: chromePath,
    args: [
      '--no-sandbox', '--disable-setuid-sandbox',
      '--disable-dev-shm-usage', '--disable-gpu',
    ],
  });
  page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });
}

async function closeBrowser() {
  if (browser) { await browser.close(); browser = null; page = null; }
}

function isCfBlock(html) {
  return html.includes('cf-challenge') || html.includes('Just a moment') ||
         html.includes('cf-browser-verification') ||
         (html.includes('Attention Required') && html.includes('Cloudflare'));
}

async function fetchPageByUrl(url, retryCount = 0) {
  await initBrowser();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    try {
      await page.waitForFunction(
        () => document.querySelector('a[href*="/player/"]') ||
               document.querySelector('.players-archive-grid') ||
               document.body.innerText.length > 500,
        { timeout: 30000 }
      );
    } catch (_) {}
    await sleep(2000);
    const html = await page.content();

    if (isCfBlock(html)) {
      if (retryCount < 3) {
        const wait = (retryCount + 1) * 10000;
        console.log(`  ⚠ Cloudflare，${wait / 1000}s 后重试 (${retryCount + 1}/3)...`);
        await sleep(wait);
        return fetchPageByUrl(url, retryCount + 1);
      }
      throw new Error(`Cloudflare 拦截: ${url}`);
    }
    return html;
  } catch (err) {
    throw err;
  }
}

// ======================== 获取全量选手列表 ========================

const cheerio = require('cheerio');

async function fetchListPage(category, pageNum, type = 'active') {
  const pageParam = pageNum > 0 ? `&page=${pageNum}` : '';
  const url = `${BASE_URL}/players/archive/${type}?filter=${category}${pageParam}`;
  console.log(`  列表: ${url}`);
  return fetchPageByUrl(url);
}

function parsePlayers(html) {
  const $ = cheerio.load(html);
  const players = [];
  const seen = new Set();
  const listArea =
    $('.players-archive-grid').length > 0 ? $('.players-archive-grid') :
    $('.archive-grid').length > 0 ? $('.archive-grid') :
    $();

  const links = listArea.length > 0
    ? listArea.find('a[href*="/player/"]')
    : $('a[href*="/player/"]');

  links.each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    const match = href.match(/\/player\/(\d+)(?:\/([^/?]+))?/);
    if (!match) return;
    const id = match[1];
    if (seen.has(id)) return;
    seen.add(id);
    players.push({
      id,
      name: (match[2] || id).split('?')[0],
      displayName: $(el).text().trim() || match[2],
      url: href.startsWith('http') ? href : `${BASE_URL}${href}`,
    });
  });
  return players;
}

/**
 * 扫描所有列表页，返回完整选手名单
 */
async function getAllPlayerLinks() {
  const all = [];
  const seenIds = new Set();

  for (const type of ['active', 'retired']) {
    console.log(`\n>>> 档案: ${type} <<<`);
    for (const cat of CATEGORIES) {
      process.stdout.write(`  ${cat}: `);
      for (let p = 0; p < MAX_PAGES; p++) {
        try {
          const html = await fetchListPage(cat, p, type);
          const players = parsePlayers(html);
          let added = 0;
          for (const pl of players) {
            if (!seenIds.has(pl.id)) {
              seenIds.add(pl.id);
              all.push(pl);
              added++;
            }
          }
          process.stdout.write(`${added} `);
          await sleep(DELAY_MS);
          if (players.length === 0) break;
        } catch (err) {
          process.stdout.write(`ERR `);
        }
      }
      console.log();
      await sleep(DELAY_MS);
    }
  }
  return all;
}

// ======================== 获取选手详情 ========================

async function fetchPlayerDetails(playerUrl, playerId, fallbackName) {
  try {
    const html = await fetchPageByUrl(playerUrl);
    const $ = cheerio.load(html);

    // 昵称
    const nickname =
      $('h1.playerNickname[itemprop="alternateName"]').text().trim() ||
      fallbackName || 'unknown';

    // 真实姓名
    const realName = (() => {
      const clone = $('.playerRealname').clone();
      clone.children().remove();
      const t = clone.text().replace(/\s*\([^)]*\)\s*/g, '').trim();
      return t || 'unknown';
    })();

    // 国籍
    let country = 'unknown', countryCode = 'unknown';
    const flag = $('img.flag[itemprop="nationality"]').first();
    if (flag.length > 0) {
      country = flag.attr('title') || flag.attr('alt') || country;
      const src = flag.attr('src') || '';
      const m = src.match(/flags\/\d+x\d+\/([A-Za-z]{2})/);
      if (m) countryCode = m[1].toUpperCase();
    }

    // 年龄
    let age = 0;
    const ageText = $('.playerAge span[itemprop="text"]').text().trim();
    const ageM = ageText.match(/(\d+)\s*years?/);
    if (ageM) age = parseInt(ageM[1]);

    // 战队
    let team = '', teamId = '';
    const teamSel = $('.playerTeam a[itemprop="text"]').first();
    if (teamSel.length > 0) {
      team = teamSel.text().trim();
      const href = teamSel.attr('href') || '';
      const tm = href.match(/\/team\/(\d+)\//);
      if (tm) teamId = tm[1];
    }

    // Major
    let majorAppearances = 0;
    const achievementStats = $('#achievementBox .highlighted-stat .stat');
    if (achievementStats.length >= 2) {
      majorAppearances = parseInt(achievementStats.eq(1).text().trim()) || 0;
    }

    // 历史战队
    const formerTeams = [];
    $('tr.past-team .team-name.gtSmartphone-only').each(function () {
      const t = $(this).text().trim();
      if (t && !formerTeams.includes(t)) formerTeams.push(t);
    });

    // 位置
    let position = '步枪手';
    const bio = (
      $('.player-summary, .player-profile-summary, .player-bio, .summary-content').text() +
      ' ' + $('[class*="role"]').text()
    ).toLowerCase();
    if (bio.includes('awper') || bio.includes('sniper')) position = '狙击手';
    else if (bio.includes('igl') || bio.includes('captain') || bio.includes('in-game leader')) position = '指挥';
    else if (bio.includes('coach')) position = '教练';

    // 头像 URL
    let avatar = '';
    const imgSel = [
      'img.bodyshot-img[itemprop="image"]',
      'img.playerImage',
      '.bodyshot-img',
      'img[itemprop="image"]',
    ];
    for (const sel of imgSel) {
      const img = $(sel).first();
      if (img.length === 0) continue;
      const src = img.attr('src') || img.attr('data-src') || '';
      if (src && !src.includes('silhouette') && !src.includes('blankplayer')) {
        avatar = src.startsWith('http') ? src : `https:${src}`;
        break;
      }
    }

    // 通过 browser evaluate 取 rating
    let rating = null;
    try {
      rating = await page.evaluate(() => {
        const stats = document.querySelectorAll('.playerpage-container-attributes .player-stat');
        for (const s of stats) {
          const label = s.querySelector('b')?.textContent?.trim() || '';
          if (label.includes('Rating')) {
            const val = s.querySelector('.statsVal p');
            return val ? parseFloat(val.textContent.trim()) : null;
          }
        }
        return null;
      });
    } catch (_) {}

    return {
      _id: playerId,
      name: nickname,
      realName,
      country,
      countryCode,
      age,
      team,
      teamId,
      formerTeams,
      majorAppearances,
      position,
      rating: rating ?? 'unknown',
      avatar,
    };
  } catch (err) {
    console.error(`  ✗ 获取详情失败: ${err.message}`);
    return null;
  }
}

// ======================== 图片下载 ========================

function downloadImage(imageUrl, outputPath) {
  return new Promise((resolve, reject) => {
    if (!imageUrl) { resolve(null); return; }
    const protocol = imageUrl.startsWith('https') ? https : http;
    protocol.get(imageUrl, {
      headers: { 'User-Agent': UA, 'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8' },
      timeout: 30000,
    }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        downloadImage(res.headers.location, outputPath).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        fs.writeFile(outputPath, Buffer.concat(chunks), (err) => {
          if (err) reject(err);
          else resolve(outputPath);
        });
      });
    }).on('error', reject);
  });
}

function getExtension(url) {
  const clean = url.split('?')[0];
  const m = clean.match(/\.(\w+)$/);
  return m ? m[1] : 'png';
}

// ======================== 核心逻辑 ========================

/**
 * 从 playerbase.json 加载已成功的数据
 */
function loadExisting() {
  if (!fs.existsSync(DATA_FILE)) return { players: [], map: new Map() };
  const lines = fs.readFileSync(DATA_FILE, 'utf8').split('\n').filter(Boolean);
  const players = lines.map(l => JSON.parse(l));
  const map = new Map(players.map(p => [p._id, p]));
  return { players, map };
}

/**
 * 保存到 playerbase.json
 */
function savePlayers(players) {
  const data = players.map(p => JSON.stringify(p)).join('\n');
  fs.writeFileSync(DATA_FILE, data, 'utf8');
  console.log(`\n已保存 ${players.length} 个选手到 ${DATA_FILE}`);
}

/**
 * 列出所有缺失的选手
 */
async function findMissing() {
  console.log('\n=== 第1步：扫描列表页获取全量选手名单 ===\n');
  const allLinks = await getAllPlayerLinks();
  console.log(`\n全量选手总数: ${allLinks.length}`);

  const { map: existingMap } = loadExisting();
  console.log(`已有数据: ${existingMap.size} 个`);

  const missing = allLinks.filter(p => !existingMap.has(p.id));
  console.log(`缺失/失败: ${missing.length} 个\n`);

  if (missing.length > 0) {
    console.log('缺失选手列表:');
    missing.forEach(p => console.log(`  ID=${p.id}, name=${p.displayName || p.name}`));
  }

  return missing;
}

/**
 * 主函数：仅重爬失败选手
 */
async function retryFailed() {
  console.log('========================================');
  console.log('   HLTV 爬虫 - 仅补爬失败选手');
  console.log('========================================');

  const args = process.argv.slice(2);

  // ====== --ids-only: 仅输出缺失 ID 列表 ======
  if (args.includes('--ids-only')) {
    const missing = await findMissing();
    console.log(`\n缺失 ID 列表 (${missing.length} 个):`);
    missing.forEach(p => console.log(p.id));
    const idList = missing.map(p => p.id).join(',');
    console.log(`\n一行复制: ${idList}`);
    await closeBrowser();
    return;
  }

  // ====== --image-only: 仅补爬图片 ======
  if (args.includes('--image-only')) {
    await retryImages();
    return;
  }

  // ====== 确定要重爬的选手 ======
  let targetLinks = [];

  // 如果传了具体 ID 或名称，用这些
  const customTargets = args.filter(a => !a.startsWith('-'));
  if (customTargets.length > 0) {
    console.log(`\n指定重爬 ${customTargets.length} 个选手`);
    const { players, map } = loadExisting();
    // 先尝试按 ID 匹配，再按名字匹配
    for (const t of customTargets) {
      if (/^\d+$/.test(t)) {
        targetLinks.push({ id: t, name: '', displayName: t });
      } else {
        // 需要从列表页找到对应 ID
        console.log(`  按名称 "${t}" 查找中...`);
        const allLinks = await getAllPlayerLinks();
        const found = allLinks.find(p =>
          p.displayName?.toLowerCase() === t.toLowerCase() ||
          p.name?.toLowerCase() === t.toLowerCase()
        );
        if (found) {
          targetLinks.push(found);
        } else {
          console.log(`  ⚠ 未找到名为 "${t}" 的选手`);
        }
      }
    }
  } else {
    // 自动对比找缺失
    targetLinks = await findMissing();
  }

  if (targetLinks.length === 0) {
    console.log('\n没有需要重爬的选手 ✅');
    await closeBrowser();
    return;
  }

  console.log(`\n=== 第2步：逐个爬取 ${targetLinks.length} 个缺失选手 ===\n`);

  let { players, map } = loadExisting();
  let successCount = 0, failCount = 0;
  const failedList = [];

  for (let i = 0; i < targetLinks.length; i++) {
    const pl = targetLinks[i];
    console.log(`[${i + 1}/${targetLinks.length}] ${pl.displayName || pl.name} (ID: ${pl.id})`);

    try {
      const details = await fetchPlayerDetails(pl.url, pl.id, pl.name);
      if (details) {
        // 更新/新增
        const idx = players.findIndex(p => p._id === details._id);
        if (idx >= 0) players[idx] = details;
        else players.push(details);
        successCount++;
        console.log(`  ✓ ${details.name} | ${details.team || '无战队'} | ${details.country}`);
      } else {
        failCount++;
        failedList.push({ id: pl.id, name: pl.displayName || pl.name, reason: '获取详情返回空' });
      }
    } catch (err) {
      console.error(`  ✗ ${err.message}`);
      failCount++;
      failedList.push({ id: pl.id, name: pl.displayName || pl.name, reason: err.message });
    }

    await randomDelay();

    // 每 10 个保存一次进度
    if ((i + 1) % 10 === 0 || i === targetLinks.length - 1) {
      savePlayers(players);
      // 同时保存失败日志
      if (failedList.length > 0) {
        fs.writeFileSync(FAILED_LOG, JSON.stringify(failedList, null, 2), 'utf8');
        console.log(`失败日志 → ${FAILED_LOG}`);
      }
      console.log(`  进度: ${i + 1}/${targetLinks.length} | 成功: ${successCount} | 失败: ${failCount}`);
    }
  }

  // ====== 第3步：下载缺失的头像图片（可选） ======
  console.log(`\n=== 第3步：下载新增选手的头像 ===`);
  fs.mkdirSync(IMAGE_DIR, { recursive: true });
  let imgSuccess = 0, imgFail = 0;

  for (let i = 0; i < players.length; i++) {
    const p = players[i];
    if (!p.avatar) continue;

    const ext = getExtension(p.avatar);
    const outPath = path.join(IMAGE_DIR, `${sanitizeFileName(p.name)}.${ext}`);
    if (fs.existsSync(outPath)) {
      imgSuccess++;
      continue;
    }

    try {
      await downloadImage(p.avatar, outPath);
      imgSuccess++;
    } catch (_) {
      imgFail++;
    }

    if ((i + 1) % 100 === 0) {
      console.log(`  图片: ${i + 1}/${players.length} (成功:${imgSuccess} 失败:${imgFail})`);
    }
  }

  console.log(`\n图片下载: 成功 ${imgSuccess} | 失败 ${imgFail}`);

  // ====== 汇总 ======
  console.log('\n========================================');
  console.log('补爬完成！');
  console.log(`新增/更新: ${successCount} 个选手`);
  console.log(`总数据: ${players.length} 个选手`);
  console.log(`失败: ${failCount} 个 (见 ${FAILED_LOG})`);
  console.log('========================================');

  await closeBrowser();
}

/**
 * 仅补爬缺失的头像图片
 */
async function retryImages() {
  console.log('\n=== 仅补爬缺失头像 ===\n');
  const { players } = loadExisting();
  if (!players.length) {
    console.log('无数据，请先运行主爬虫');
    return;
  }

  fs.mkdirSync(IMAGE_DIR, { recursive: true });
  console.log(`共 ${players.length} 个选手`);

  let success = 0, fail = 0;

  for (let i = 0; i < players.length; i++) {
    const p = players[i];
    const outPath = path.join(IMAGE_DIR, `${sanitizeFileName(p.name)}.png`);
    if (fs.existsSync(outPath)) { success++; continue; }

    if (!p.avatar) {
      fail++;
      continue;
    }

    try {
      const ext = getExtension(p.avatar);
      const out = path.join(IMAGE_DIR, `${sanitizeFileName(p.name)}.${ext}`);
      await downloadImage(p.avatar, out);
      success++;
    } catch (_) {
      fail++;
    }

    if ((i + 1) % 50 === 0) {
      console.log(`  [${i + 1}/${players.length}] 成功:${success} 失败:${fail}`);
    }
  }

  console.log(`\n完成: 成功 ${success} | 失败 ${fail}`);
  await closeBrowser();
}

// ======================== 入口 ========================

if (require.main === module) {
  retryFailed().catch(err => {
    console.error('\n🚨 脚本异常:', err.message);
    process.exit(1);
  });
}

module.exports = { retryFailed, findMissing };
