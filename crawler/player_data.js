/**
 * HLTV 选手数据爬虫 (Puppeteer + Cheerio)
 *
 * 数据源：https://www.hltv.org/players/archive/active?filter=<字母>&page=<页码>
 * 输出：playerbase.json（JSON Lines 格式）
 *
 * 使用：
 *   node player_data.js               全量爬取
 *   node player_data.js --images-only 仅补缺失头像
 *
 * --- 2026-07 更新 ---
 * HLTV 将选手列表页 URL 改为：
 *   旧: /players/{letter}?offset={n}
 *   新: /players/archive/active?filter={letter}&page={n}
 * 同时选手详情页 DOM 结构也有调整，本版本已适配。
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

let puppeteer;

// ======================== 配置 ========================

const BASE_URL = 'https://www.hltv.org';
const MAX_PAGES = 7;           // 每字母最多翻页数
const OUTPUT_FILE = 'hltv-players.txt';
const OUTPUT_JSON_FILE = 'playerbase.json';
const IMAGE_DIR = 'image';
const DELAY_BETWEEN_REQUESTS = 3000;
const DELAY_MIN = 1000;
const DELAY_MAX = 2000;

// 字母分类 —— HLTV URL 中使用大写
// 实际 URL 示例: /players/archive/active?filter=N&page=2
const ALL_CATEGORIES = ['numbers', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z'];

// 分片映射：9 个并发 job，每个爬取 3 个首字母（job8 负责 Y/Z/数字符号）
const CHUNK_MAP = [
  ['A', 'B', 'C'],
  ['D', 'E', 'F'],
  ['G', 'H', 'I'],
  ['J', 'K', 'L'],
  ['M', 'N', 'O'],
  ['P', 'Q', 'R'],
  ['S', 'T', 'U'],
  ['V', 'W', 'X'],
  ['Y', 'Z', 'numbers'],
];

let CATEGORIES = ALL_CATEGORIES;  // 默认全量，--chunk 参数会覆盖

let allPlayers = [];
let browser;
let page;

// ======================== 工具函数 ========================

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function randomDelay() {
  return delay(DELAY_MIN + Math.random() * (DELAY_MAX - DELAY_MIN));
}

function ensureOutputDir() {
  if (!fs.existsSync(IMAGE_DIR)) {
    fs.mkdirSync(IMAGE_DIR, { recursive: true });
    console.log(`创建输出目录: ${IMAGE_DIR}`);
  }
}

/** 清理文件名中的非法字符 */
function sanitizeFileName(name) {
  return name.replace(/[<>:"/\\|?*]/g, '_').trim();
}

// ======================== 浏览器管理 ========================

function detectChromePath() {
  const candidates = [
    // Windows
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    // macOS
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    // Linux
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
  const stealthPlugin = require('puppeteer-extra-plugin-stealth');
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

async function closeBrowser() {
  if (browser) {
    await browser.close();
    browser = null;
    page = null;
    console.log('\n浏览器已关闭');
  }
}

// ======================== 页面抓取 ========================

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
           '(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

/**
 * 用 Puppeteer 抓取渲染后的页面 HTML
 */
async function fetchPageByUrl(url, retryCount = 0) {
  await initBrowser();

  try {
    console.log(`  正在访问: ${url}`);

    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });

    // 等待页面出现选手卡片或任何内容
    try {
      await page.waitForFunction(
        () => {
          return document.querySelector('a[href*="/player/"]')
              || document.querySelector('.players-archive-grid')
              || document.querySelector('.archive-grid')
              || document.querySelector('.player-card')
              || document.body.innerText.length > 500;
        },
        { timeout: 30000 }
      );
    } catch (e) {
      console.log('  警告: 等待页面内容超时，继续');
    }

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

function isCloudflareBlock(html) {
  return html.includes('cf-challenge') ||
         html.includes('Just a moment') ||
         html.includes('cf-browser-verification') ||
         (html.includes('Attention Required') && html.includes('Cloudflare')) ||
         html.includes('Enable JavaScript and cookies');
}

// ======================== 列表页 ========================

/**
 * 获取新格式的列表页 HTML
 * 旧: /players/{category}?offset={offset}
 * 新: /players/archive/{type}?filter={category}&page={pageNum}
 *
 * @param {string} category 字母（大写）或 'numbers'
 * @param {number} pageNum  页码（0=第一页）
 * @param {string} type     'active' | 'retired'
 */
async function fetchPage(category, pageNum, type = 'active') {
  const pageParam = pageNum > 0 ? `&page=${pageNum}` : '';
  const url = `${BASE_URL}/players/archive/${type}?filter=${category}${pageParam}`;
  console.log(`正在爬取: ${url}`);
  return fetchPageByUrl(url);
}

/**
 * 解析列表页 HTML，提取所有选手链接
 * 兼容新旧两种页面结构
 */
function parsePlayers(html, archiveType) {
  const $ = cheerio.load(html);
  const players = [];

  // 尝试多种可能的容器选择器（适配 HLTV 页面改版）
  const selectors = [
    '.players-archive-grid',       // 旧格式
    '.archive-grid',               // 新格式（推测）
    '.player-grid',                // 另一个可能的新格式
    '.col-category-page',          // 通用内容容器
    '#players',                    // 通用 ID
  ];

  let listArea = $();
  for (const sel of selectors) {
    listArea = $(sel);
    if (listArea.length > 0) break;
  }

  // 如果找不到容器，回退到全局搜索 a[href*="/player/"]
  const links = listArea.length > 0
    ? listArea.find('a[href*="/player/"]')
    : $('a[href*="/player/"]');

  if (links.length === 0) {
    console.log('  未找到任何选手链接，页面可能已改版');
    return [];
  }

  // 用于跟踪已添加的 (id, name) 组合，防止同一选手被多次添加
  const seen = new Set();

  links.each((_, element) => {
    const href = $(element).attr('href');
    if (!href) return;

    // 解析 /player/{id}/{name} 或 /player/{id}
    const match = href.match(/\/player\/(\d+)(?:\/([^/?]+))?/);
    if (!match) return;

    const playerId = match[1];
    const playerName = (match[2] || playerId).split('?')[0];
    const displayName = $(element).text().trim() || playerName;

    // 用 id 去重：不同选手的 id 一定不同
    // 额外用 id+displayName 兜底（防止 HLTV 页面中同一 id 出现两次）
    const key = playerId;
    if (seen.has(key)) return;
    seen.add(key);

    players.push({
      id: playerId,
      name: playerName,
      displayName: displayName,
      url: href.startsWith('http') ? href : `${BASE_URL}${href}`,
      archiveType: archiveType,  // 'active' | 'retired'
      // 顺便尝试找到选手头像小图
      thumbnail: $(element).find('img').first().attr('src') || ''
    });
  });

  console.log(`  解析到 ${players.length} 个选手`);
  return players;
}

// ======================== 选手详情页 ========================

/**
 * 抓取并解析单个选手详情页
 *
 * 注意：因为 HLTV 选手页结构复杂，本函数分两步：
 *   1. fetchPageByUrl 获取完整 HTML（供 cheerio 解析）
 *   2. page.evaluate 从浏览器获取额外字段（rating / firepower）
 *   第二步失败不影响基本信息
 */
async function fetchPlayerDetails(playerUrl, playerId, playerName, archiveType) {
  try {
    const profileHtml = await fetchPageByUrl(playerUrl);
    const profileData = parsePlayerProfile(profileHtml, playerId, playerName, archiveType);

    // ---- 尝试获取 rating / firepower / sniping（通过浏览器 evaluate）----
    // 实际 HTML: .playerpage-container-attributes .player-stat 中包含 Rating 3.0 / Firepower
    //            .playerpage-container-attributes .player-stat-top 中包含 Sniping%
    try {
      const extras = await page.evaluate(() => {
        const result = { rating: null, firepower: null, sniping: null };

        // 遍历所有 .player-stat，找到 Rating 和 Firepower
        const stats = document.querySelectorAll('.playerpage-container-attributes .player-stat');
        for (const stat of stats) {
          const label = stat.querySelector('b')?.textContent?.trim() || '';
          const valueEl = stat.querySelector('.statsVal p');
          const value = valueEl ? parseFloat(valueEl.textContent.trim()) : NaN;

          if (label.includes('Rating') && !isNaN(value)) {
            result.rating = value;
          }
          if (label.includes('Firepower') && !isNaN(value)) {
            result.firepower = value;
          }
        }

        // 查找 Sniping 数据（在 .player-stat-top 中，显示为百分比）
        // HTML 结构: div.player-stat-top > span > p > b (百分比数字)
        const statTopEl = document.querySelector('.playerpage-container-attributes .player-stat-top');
        if (statTopEl) {
          const snipingText = statTopEl.textContent?.trim() || '';
          const snipingMatch = snipingText.match(/(\d+[\.\d]*)%/);
          if (snipingMatch) {
            result.sniping = parseFloat(snipingMatch[1]);
          }
        }

        return result;
      });

      if (extras.rating != null && !isNaN(extras.rating)) {
        profileData.rating = extras.rating;
      }
      if (extras.firepower != null && !isNaN(extras.firepower)) {
        profileData.firepower = extras.firepower;
      }
      if (extras.sniping != null && !isNaN(extras.sniping)) {
        profileData.sniping = extras.sniping;
        // 用 sniping 数值辅助判断位置：高于 40% 判定为狙击手
        if (extras.sniping >= 60 && profileData.position !== '指挥' && profileData.position !== '教练') {
          profileData.position = '狙击手';
        }
      }
    } catch (e) {
      // evaluate 失败不影响基本信息
    }

    return profileData;
  } catch (err) {
    console.error(`  获取选手 ${playerId} 详情失败: ${err.message}`);
    return null;
  }
}

/**
 * 用 Cheerio 解析选手详情页 HTML，提取基本信息
 *
 * 基于 HLTV 2026年7月实际页面结构：
 *   .playerContainer > .playerBodyshot / .playerInfoWrapper
 *   .playerRealname 上直接带 itemprop="name"，内部不含 span
 *   .playerTeam a[itemprop="text"] 指向当前战队
 *   #teamsBox .team-breakdown 为历史战队表格
 *   #infoBox 内 .player-stat 为统计信息
 */
function parsePlayerProfile(html, playerId, fallbackName, archiveType) {
  const $ = cheerio.load(html);

  // ===== 1. 游戏昵称 =====
  // 实际 HTML: <h1 class="playerNickname" itemprop="alternateName">Niko</h1>
  const nickname =
    $('h1.playerNickname[itemprop="alternateName"]').text().trim()
    || $('.playerRealname').prev('h1').text().trim()
    || $('.player-nickname').text().trim()
    || fallbackName || 'unknown';

  // ===== 2. 真实姓名 =====
  // 实际 HTML: <div class="playerRealname" itemprop="name"><img class="flag"> Zuobin Yu</div>
  // NOTE: itemprop="name" 在 div 上，内部没有 span！不能用 span[itemprop="name"]
  const realName = extractRealName($);

  // ===== 3. 国籍 =====
  // 实际 HTML: <img class="flag" itemprop="nationality" title="China" src="/img/static/flags/30x20/CN.gif">
  const { country, countryCode } = extractCountry($);

  // ===== 4. 年龄 =====
  // 实际 HTML: .playerAge span[itemprop="text"] 内容为 "23 years"
  let age = 0;
  const ageText = $('.playerAge span[itemprop="text"]').text().trim()
               || $('span[itemprop="text"]').filter(function() {
                    return $(this).text().includes('years');
                  }).text().trim();
  const ageMatch = ageText.match(/(\d+)\s*years?/);
  if (ageMatch) {
    age = parseInt(ageMatch[1]);
  } else {
    const m2 = ($('.player-age').text().trim() || '').match(/(\d+)/);
    if (m2) age = parseInt(m2[1]);
  }

  // ===== 5. 所属战队 =====
  // 实际 HTML: .playerTeam a[itemprop="text"] 指向 /team/11275/nsn
  let team = '', teamId = '';
  const teamSel = $('.playerTeam a[itemprop="text"]').first();
  if (teamSel.length > 0) {
    team = teamSel.text().trim();
    const href = teamSel.attr('href') || '';
    const tidMatch = href.match(/\/team\/(\d+)\//);
    if (tidMatch) teamId = tidMatch[1];
  } else {
    // 回退
    const altTeam = $('.player-team a').first();
    if (altTeam.length > 0) {
      team = altTeam.text().trim();
    } else {
      team = $('.player-team-name').text().trim() || '';
    }
  }

  // ===== 6. Major 出场次数 =====
  // 实际 HTML: #achievementBox 可能在隐藏 tab 中，
  // .highlighted-stat .stat 在 #teamsBox 中也有（但那是队伍数据不是 major）
  // 精确查找: #achievementBox .highlighted-stat:nth-child(2) .stat
  let majorAppearances = 0;
  const achievementStats = $('#achievementBox .highlighted-stat .stat');
  if (achievementStats.length >= 2) {
    majorAppearances = parseInt(achievementStats.eq(1).text().trim()) || 0;
  }

  // ===== 7. 历史战队 =====
  // 实际 HTML: #teamsBox .team-breakdown tr.past-team .team-name.gtSmartphone-only
  const formerTeams = [];
  // 优先从历史战队表格解析
  $('tr.past-team .team-name.gtSmartphone-only').each(function() {
    const t = $(this).text().trim();
    if (t && !formerTeams.includes(t)) {
      formerTeams.push(t);
    }
  });
  // 回退：从页面全局查找
  if (formerTeams.length === 0) {
    $('.team-name.gtSmartphone-only').each(function() {
      const t = $(this).text().trim();
      // 排除当前战队名、排除已在列表中的
      if (t && t !== team && !formerTeams.includes(t)) {
        formerTeams.push(t);
      }
    });
  }

  // ===== 8. 位置判断 & 职业状态 =====
  let position = '步枪手';
  let status = (archiveType === 'retired') ? 'retired' : 'active';  // archiveType → status 默认值
  const bioText = (
    $('.player-summary, .player-profile-summary, .player-bio, .summary-content').text()
    + ' ' + $('[class*="role"]').text()
  ).toLowerCase();
  if (bioText.includes('awper') || bioText.includes('sniper') || bioText.includes('狙')) {
    position = '狙击手';
  } else if (bioText.includes('igl') || bioText.includes('captain') || bioText.includes('in-game leader') || bioText.includes('指挥')) {
    position = '指挥';
  } else if (bioText.includes('coach') || bioText.includes('教练')) {
    position = '教练';
    status = 'coach';  // 教练覆盖 archiveType
  }
  // 比值推断：来自 page.evaluate 的结果（由调用方负责）

  // ===== 9. 头像 URL =====
  // 实际 HTML: <img src="/img/static/player/player_silhouette.png" class="bodyshot-img" itemprop="image">
  // silhouette 图片跳过，只保留真实定妆照
  const avatar = extractAvatar($);

  return {
    _id: playerId,
    name: nickname,
    realName: realName,
    country: country,
    countryCode: countryCode,
    age: age,
    team: team,
    teamId: teamId,
    formerTeams: formerTeams.length > 0 ? formerTeams : [],
    majorAppearances: majorAppearances,
    position: position,
    status: status,
    sniping: 'unknown',
    firepower: 'unknown',
    rating: 'unknown',
    avatar: avatar
  };
}

// ==================== 子提取函数 ====================

function extractRealName($) {
  // 实际 HTML: <div class="playerRealname" itemprop="name"><img ...> Zuobin Yu</div>
  // 注意: itemprop="name" 在 div 上，子元素没有 span，因此不能 .playerRealname span[itemprop="name"]

  // 方式1: 直接取 .playerRealname 的文本（排除子元素图片等）
  const cloneMethod = $('.playerRealname').clone();
  cloneMethod.children().remove();
  const text1 = cloneMethod.text().replace(/\s*\([^)]*\)\s*/g, '').trim();
  if (text1) return text1;

  // 方式2: 取所有 itemprop="name" 的非 h1 文本
  const text2 = $('[itemprop="name"]').not('h1').text().trim();
  if (text2) return text2;

  // 方式3: 从页面标题推断
  const title = $('title').text().trim();
  const titleMatch = title.match(/^[^']+'([^']+)'/);
  if (titleMatch) return titleMatch[1];

  return 'unknown';
}

function extractCountry($) {
  let country = 'unknown', countryCode = 'unknown';

  // 实际 HTML: <img class="flag" itemprop="nationality" title="China" src="/img/static/flags/30x20/CN.gif">
  const flag = $('img.flag[itemprop="nationality"]').first()
            || $('.flag').first();
  if (flag.length > 0) {
    country = flag.attr('title') || flag.attr('alt') || country;
    const src = flag.attr('src') || '';
    // /img/static/flags/30x20/CN.gif → CN
    const codeMatch = src.match(/flags\/\d+x\d+\/([A-Za-z]{2})/);
    if (codeMatch) countryCode = codeMatch[1].toUpperCase();
  }

  // 回退：从 country 文本查映射表
  if (countryCode === 'unknown' && country !== 'unknown') {
    const countryMap = {
      'Ukraine': 'UA', '乌克兰': 'UA',
      'Russia': 'RU', '俄罗斯': 'RU',
      'Denmark': 'DK', '丹麦': 'DK',
      'France': 'FR', '法国': 'FR',
      'Sweden': 'SE', '瑞典': 'SE',
      'Finland': 'FI', '芬兰': 'FI',
      'Norway': 'NO', '挪威': 'NO',
      'Poland': 'PL', '波兰': 'PL',
      'Brazil': 'BR', '巴西': 'BR',
      'United States': 'US', '美国': 'US',
      'Canada': 'CA', '加拿大': 'CA',
      'Australia': 'AU', '澳大利亚': 'AU',
      'Germany': 'DE', '德国': 'DE',
      'United Kingdom': 'GB', '英国': 'GB',
      'Estonia': 'EE', '爱沙尼亚': 'EE',
      'Latvia': 'LV', '拉脱维亚': 'LV',
      'Lithuania': 'LT', '立陶宛': 'LT',
      'Slovakia': 'SK', '斯洛伐克': 'SK',
      'Hungary': 'HU', '匈牙利': 'HU',
      'Israel': 'IL', '以色列': 'IL',
      'Bosnia': 'BA', '波黑': 'BA',
      'Romania': 'RO', '罗马尼亚': 'RO',
      'Turkey': 'TR', '土耳其': 'TR',
      'China': 'CN', '中国': 'CN',
      'Kazakhstan': 'KZ', '哈萨克斯坦': 'KZ',
      'Serbia': 'RS', '塞尔维亚': 'RS',
      'Bulgaria': 'BG', '保加利亚': 'BG',
    };
    for (const [key, code] of Object.entries(countryMap)) {
      if (country.includes(key)) {
        countryCode = code;
        break;
      }
    }
  }

  return { country, countryCode };
}

function extractAvatar($) {
  const selectors = [
    'img.bodyshot-img[itemprop="image"]',
    'img.playerImage',
    '.bodyshot-img',
    '.player-bodyshot img[itemprop="image"]',
    'img[itemprop="image"]'
  ];
  for (const sel of selectors) {
    const img = $(sel).first();
    if (img.length === 0) continue;
    const src = img.attr('src') || img.attr('data-src') || '';
    // silhouette = HLTV 默认剪影（无定妆照）
    if (src && !src.includes('silhouette') && !src.includes('blankplayer')) {
      return src.startsWith('http') ? src : `https:${src}`;
    }
  }
  return '';
}

// ======================== 图片下载 ========================

function parsePlayerImage(html) {
  const $ = cheerio.load(html);
  const selectors = [
    'img.bodyshot-img[itemprop="image"]',
    'img.playerImage',
    '.player-bodyshot img',
    'img[itemprop="image"]'
  ];
  for (const sel of selectors) {
    const img = $(sel).first();
    if (img.length > 0) {
      const src = img.attr('src') || img.attr('data-src') || null;
      if (src) return src;
    }
  }
  return null;
}

function downloadImage(imageUrl, outputPath) {
  return new Promise((resolve, reject) => {
    if (!imageUrl) { resolve(null); return; }

    const protocol = imageUrl.startsWith('https') ? https : http;

    protocol.get(imageUrl, {
      headers: {
        'User-Agent': UA,
        'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8'
      }
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
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        fs.writeFile(outputPath, Buffer.concat(chunks), (err) => {
          if (err) reject(err);
          else resolve(outputPath);
        });
      });
    }).on('error', reject);
  });
}

function getExtensionFromUrl(url) {
  const cleanUrl = url.split('?')[0];
  const match = cleanUrl.match(/\.(\w+)$/);
  return match ? match[1] : 'png';
}

function imageExists(playerName) {
  const name = sanitizeFileName(playerName);
  for (const ext of ['png', 'jpg', 'jpeg', 'webp', 'gif']) {
    const fp = path.join(IMAGE_DIR, `${name}.${ext}`);
    if (fs.existsSync(fp)) return fp;
  }
  return null;
}

// ======================== 数据持久化 ========================

let CHUNK_SUFFIX = '';  // 分片模式下追加后缀，如 _chunk0

function getOutputFile(base) {
  return CHUNK_SUFFIX ? base.replace(/\.(\w+)$/, `_chunk${CHUNK_SUFFIX}.$1`) : base;
}

function saveData() {
  const outFile = getOutputFile(OUTPUT_FILE);
  const outJson = getOutputFile(OUTPUT_JSON_FILE);
  const textData = allPlayers.map(p => p.name).join('\n');
  fs.writeFileSync(outFile, textData, 'utf8');
  console.log(`\n已保存 ${allPlayers.length} 个玩家名称到 ${outFile}`);

  const jsonLinesData = allPlayers.map(p => JSON.stringify(p)).join('\n');
  fs.writeFileSync(outJson, jsonLinesData, 'utf8');
  console.log(`已保存详细数据到 ${outJson} (JSON Lines格式)`);
}

function loadProgress() {
  const outJson = getOutputFile(OUTPUT_JSON_FILE);
  if (fs.existsSync(outJson)) {
    try {
      const lines = fs.readFileSync(outJson, 'utf8').split('\n').filter(l => l.trim());
      return lines.map(l => JSON.parse(l));
    } catch (e) { return []; }
  }
  return [];
}

// ======================== 主流程 ========================

/**
 * 全量爬取：第1步扫描列表页，第2步逐个抓详情
 */
async function crawlAllPages() {
  console.log('========================================');
  console.log('HLTV 选手数据爬虫 (Puppeteer + Cheerio)');
  console.log('========================================\n');
  console.log(`URL: ${BASE_URL}/players/archive/{active|retired}?filter=<字母>&page=<页码>`);
  console.log(`分类: ${CATEGORIES.join(', ')}`);
  console.log(`每分类最多 ${MAX_PAGES} 页`);
  console.log(`模式: 全量获取（Active + Retired），覆盖已有数据\n`);

  ensureOutputDir();

  try {
    // ======== 第1步：获取列表页所有选手链接 ========
    console.log('=== 第1步：获取选手列表 ===\n');

    const playerLinks = [];  // { id, name, url, displayName, thumbnail }
    const archiveTypes = ['active', 'retired'];

    for (const archiveType of archiveTypes) {
      console.log(`\n>>> 档案类型: ${archiveType} <<<\n`);

      for (const category of CATEGORIES) {
        console.log(`--- 分类: ${category} (${archiveType}) ---`);

        for (let pageNum = 0; pageNum < MAX_PAGES; pageNum++) {
          const html = await fetchPage(category, pageNum, archiveType);
          const players = parsePlayers(html, archiveType);

          // 去重（按 id）
          let addedCount = 0;
          for (const p of players) {
            if (!playerLinks.find(existing => existing.id === p.id)) {
              playerLinks.push(p);
              addedCount++;
            }
          }

          console.log(`  第 ${pageNum + 1} 页完成，新增 ${addedCount} 个，总计 ${playerLinks.length} 个\n`);

          await delay(DELAY_BETWEEN_REQUESTS);

          if (players.length === 0) {
            console.log(`  分类 ${category} 没有更多数据\n`);
            break;
          }
        }

        // 翻页间隔
        await delay(DELAY_BETWEEN_REQUESTS);
      }

      // 分类间间隔
      await delay(DELAY_BETWEEN_REQUESTS);
    }

    // 第1步完成，准备进入第2步

    // ======== 第2步：逐个抓详情 + 下载图片 ========
    console.log(`\n=== 第2步：获取选手详情 + 图片 ===`);
    console.log(`总计 ${playerLinks.length} 个选手\n`);

    allPlayers = [];
    let successCount = 0, failCount = 0;
    let imgSuccess = 0, imgFail = 0;

    for (let i = 0; i < playerLinks.length; i++) {
      const pl = playerLinks[i];
      // 显示比例 + ID 防止同名混淆
      console.log(`[${i + 1}/${playerLinks.length}] ${pl.displayName || pl.name} (ID: ${pl.id})`);

      try {
        const details = await fetchPlayerDetails(pl.url, pl.id, pl.name, pl.archiveType);

        if (details) {
          // 下载头像
          try {
            const detailHtml = await fetchPageByUrl(pl.url);
            const imgUrl = parsePlayerImage(detailHtml);
            if (imgUrl && !imgUrl.includes('silhouette')) {
              const ext = getExtensionFromUrl(imgUrl);
              const outPath = path.join(IMAGE_DIR, `${sanitizeFileName(details.name)}.${ext}`);
              await downloadImage(imgUrl, outPath);
              imgSuccess++;
            } else {
              imgFail++;
            }
          } catch (imgErr) {
            imgFail++;
          }

          allPlayers.push(details);
          console.log(`  ✓ ${details.name} | ${details.team} | ${details.country}`);
          successCount++;
        } else {
          failCount++;
        }
      } catch (err) {
        console.error(`  ✗ 出错: ${err.message}`);
        failCount++;
      }

      await delay(DELAY_BETWEEN_REQUESTS);

      // 每 10 个自动保存
      if ((i + 1) % 10 === 0) {
        console.log(`\n--- 进度: ${i + 1}/${playerLinks.length} (成功:${successCount} 失败:${failCount}) ---`);
        saveData();
      }
    }

    // 最终保存
    saveData();

    console.log('\n========================================');
    console.log('爬取完成！');
    console.log(`数据: 成功 ${successCount} 个, 失败 ${failCount} 个`);
    console.log(`图片: 成功 ${imgSuccess} 个, 失败 ${imgFail} 个`);
    console.log(`总计 ${allPlayers.length} 个选手数据`);
    console.log('========================================');

    if (allPlayers.length > 0) {
      console.log('\n=== 示例 (前 3 条) ===');
      allPlayers.slice(0, 3).forEach((p, i) => {
        console.log(`\n[${i + 1}] ${p.name} (${p.realName})`);
        console.log(`    国籍: ${p.country} | 战队: ${p.team} | 年龄: ${p.age}`);
        console.log(`    位置: ${p.position} | Major: ${p.majorAppearances}`);
      });
    }
  } catch (error) {
    console.error('\n爬取异常:', error.message);
    if (allPlayers.length > 0) {
      saveData();
      console.log(`已保存 ${allPlayers.length} 个已获取数据`);
    }
  } finally {
    await closeBrowser();
  }
}

/**
 * 仅补下载缺失的图片
 */
async function downloadMissingImages() {
  console.log('========================================');
  console.log('HLTV 选手图片 - 仅补缺失');
  console.log('========================================\n');

  ensureOutputDir();

  const players = loadProgress();
  if (!players || players.length === 0) {
    console.error('无选手数据，先运行爬虫');
    return;
  }

  console.log(`已加载 ${players.length} 个选手\n`);

  let imgSuccess = 0, imgFail = 0;
  const failed = [];

  for (let i = 0; i < players.length; i++) {
    const p = players[i];
    console.log(`[${i + 1}/${players.length}] ${p.name}`);

    try {
      const html = await fetchPageByUrl(`${BASE_URL}/player/${p._id}/${p.name}`);
      const imgUrl = parsePlayerImage(html);

      if (!imgUrl || imgUrl.includes('silhouette')) {
        console.log(`  无有效图片`);
        imgFail++;
        failed.push({ name: p.name, id: p._id, reason: 'no image / silhouette' });
        continue;
      }

      const ext = getExtensionFromUrl(imgUrl);
      const outPath = path.join(IMAGE_DIR, `${sanitizeFileName(p.name)}.${ext}`);
      await downloadImage(imgUrl, outPath);
      console.log(`  ✓ ${outPath}`);
      imgSuccess++;
    } catch (err) {
      console.error(`  ✗ ${err.message}`);
      imgFail++;
      failed.push({ name: p.name, id: p._id, reason: err.message });
    }

    await randomDelay();

    if ((i + 1) % 50 === 0) {
      console.log(`\n--- 进度: ${i + 1}/${players.length} (成功:${imgSuccess} 失败:${imgFail}) ---\n`);
    }
  }

  console.log(`\n完成！成功: ${imgSuccess} | 失败: ${imgFail}`);

  if (failed.length > 0) {
    fs.writeFileSync(
      path.join(IMAGE_DIR, 'failed_players.json'),
      JSON.stringify(failed, null, 2)
    );
    console.log(`失败列表 → ${IMAGE_DIR}/failed_players.json`);
  }
}

function analyzeData() {
  if (fs.existsSync(OUTPUT_JSON_FILE)) {
    const lines = fs.readFileSync(OUTPUT_JSON_FILE, 'utf8').split('\n').filter(l => l.trim());
    const data = lines.map(l => JSON.parse(l));

    console.log('\n=== 数据分析 ===');
    console.log(`总选手数: ${data.length}`);

    // 检查同名选手
    const nameCount = {};
    data.forEach(p => {
      nameCount[p.name] = (nameCount[p.name] || 0) + 1;
    });
    const duplicates = Object.entries(nameCount).filter(([, c]) => c > 1);
    if (duplicates.length > 0) {
      console.log(`同名选手: ${duplicates.length} 组`);
      duplicates.slice(0, 10).forEach(([name, count]) => {
        const players = data.filter(p => p.name === name);
        console.log(`  ${name} (${count}人): ${players.map(p => `ID=${p._id}`).join(', ')}`);
      });
    }

    console.log('\n前 10 个选手:');
    data.slice(0, 10).forEach((p, i) => {
      console.log(`  ${i + 1}. ${p.name} - ${p.realName} - ${p.team || '无战队'}`);
    });
  }
}

// ======================== 启动入口 ========================

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.includes('--images-only')) {
    downloadMissingImages().then(() => console.log('\n图片下载完成'));
  } else {
    // 解析 --chunk 参数：指定爬取哪个分片（0-6）
    const chunkIdx = args.indexOf('--chunk');
    if (chunkIdx >= 0 && chunkIdx + 1 < args.length) {
      const chunk = parseInt(args[chunkIdx + 1], 10);
      if (!isNaN(chunk) && chunk >= 0 && chunk < CHUNK_MAP.length) {
        CATEGORIES = CHUNK_MAP[chunk];
        CHUNK_SUFFIX = String(chunk);
        console.log(`[chunk ${chunk}] 爬取分类: ${CATEGORIES.join(', ')}`);
      }
    }
    crawlAllPages().then(() => analyzeData());
  }
}

module.exports = {
  fetchPage, parsePlayers, fetchPlayerDetails, parsePlayerProfile,
  crawlAllPages, downloadMissingImages, analyzeData
};
