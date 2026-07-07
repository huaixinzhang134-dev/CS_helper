#!/usr/bin/env node
/**
 * HLTV Valve 世界排名爬虫 (Puppeteer + Cheerio)
 *
 * 数据源：https://www.hltv.org/valve-ranking/teams
 * 输出：valve_ranking.json（JSON Lines 格式）
 *
 * 使用：
 *   node crawl_ranking.js              全量爬取前 60 名
 *   node crawl_ranking.js --top=30     爬取前 30 名
 *   node crawl_ranking.js --output=my_ranking.json  自定义输出文件
 */

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

let puppeteer;

// ======================== 配置 ========================

const BASE_URL = 'https://www.hltv.org';
const RANKING_URL = `${BASE_URL}/valve-ranking/teams`;
const OUTPUT_FILE = 'valve_ranking.json';
const PLAYER_JSON_PATH = path.join(__dirname, 'playerbase_clean.json');
const LOGO_OUTPUT_FILE = 'team_logos.json';
const DELAY_MIN = 1000;
const DELAY_MAX = 2000;
const DEFAULT_TOP = 60;
const LOGO_DELAY_MS = 2000;

// ======================== 轮换池配置 ========================

const POOL_RESTART_INTERVAL = 50;    // 每 50 次请求重启浏览器
const POOL_PAGE_COUNT = 3;            // 页面池大小
const POOL_MAX_RETRIES = 3;           // 超时重试次数
const POOL_RETRY_BASE_DELAY = 30000;  // 重试基础等待（ms）
const POOL_NAV_TIMEOUT = 120000;      // 导航超时（ms）

// ======================== 轮换池 ========================

class CrawlerPool {
  constructor() {
    this.browser = null;
    this.pages = [];
    this.currentPageIdx = 0;
    this.useCount = 0;
    this.consecutiveFails = 0;
    this._loadProxies();
  }

  _loadProxies() {
    const envProxies = process.env.PROXY_LIST || '';
    if (envProxies) {
      this.proxies = envProxies.split(',').map(s => s.trim()).filter(Boolean);
      if (this.proxies.length > 0) console.log(`  代理池: ${this.proxies.length} 个`);
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
    this.browser = await puppeteer.launch({
      headless: 'new',
      executablePath: chromePath,
      args: this._buildLaunchArgs(this._nextProxy()),
    });
    this.pages = [];
    for (let i = 0; i < POOL_PAGE_COUNT; i++) {
      const p = await this.browser.newPage();
      await p.setViewport({ width: 1920, height: 1080 });
      this.pages.push(p);
    }
    this.currentPageIdx = 0;
    this.useCount = 0;
    this.consecutiveFails = 0;
    console.log(`  浏览器实例已启动，页面池: ${POOL_PAGE_COUNT} 个`);
  }

  _nextPage() {
    return this.pages[this.currentPageIdx++ % this.pages.length];
  }

  async _closeBrowser() {
    if (!this.browser) return;
    try { for (const p of this.pages) try { await p.close(); } catch (_) {} } catch (_) {}
    try { await this.browser.close(); } catch (_) {}
    this.browser = null; this.pages = [];
  }

  async fetch(url, options = {}) {
    const timeout = options.timeout || POOL_NAV_TIMEOUT;
    const waitFor = options.waitFor;
    const waitMs = options.waitMs || 2000;
    let lastError;

    for (let retry = 0; retry <= POOL_MAX_RETRIES; retry++) {
      if (retry > 0) {
        const backoff = POOL_RETRY_BASE_DELAY * Math.pow(2, retry - 1);
        console.log(`  ⏳ 重试 ${retry}/${POOL_MAX_RETRIES}，等待 ${(backoff / 1000).toFixed(0)}s...`);
        await delay(backoff); await this.launch();
        this.consecutiveFails = 0;
      }
      if (this.consecutiveFails >= 5) {
        console.log(`  ⚠ 连续 ${this.consecutiveFails} 次失败，强制重启`);
        await this.launch();
        this.consecutiveFails = 0;
      }
      if (!this.browser || this.pages.length === 0) await this.launch();

      const page = this._nextPage();
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
        this.useCount++; this.consecutiveFails = 0;
      } catch (e) {
        lastError = e; this.useCount++; this.consecutiveFails++;
        console.error(`  ✗ 导航失败 (重试 ${retry}/${POOL_MAX_RETRIES}): ${(e.message || '').slice(0, 100)}`);
        continue;
      }

      if (waitFor) { try { await page.waitForFunction(waitFor, { timeout: 30000 }); } catch (_) {} }
      await delay(waitMs);
      try {
        const html = await page.content();
        if (isCloudflareBlock(html)) {
          console.log(`  ⚠ Cloudflare 拦截 (重试 ${retry}/${POOL_MAX_RETRIES})`);
          lastError = new Error('Cloudflare 拦截');
          this.useCount++; this.consecutiveFails++;
          continue;
        }
        return html;
      } catch (e) { lastError = e; continue; }
    }
    throw lastError || new Error(`重试耗尽 (${POOL_MAX_RETRIES} 次)`);
  }

  async close() { await this._closeBrowser(); }
}

const pool = new CrawlerPool();

let browser;

// ======================== 工具函数 ========================

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function randomDelay() {
  return delay(DELAY_MIN + Math.random() * (DELAY_MAX - DELAY_MIN));
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
  if (browser) return;  // 已初始化

  puppeteer = require('puppeteer-extra');
  const stealthPlugin = require('puppeteer-extra-plugin-stealth');
  puppeteer.use(stealthPlugin());

  const chromePath = detectChromePath();
  console.log(`浏览器路径: ${chromePath || '系统默认'}`);

  // 启动轮换池（页面轮转 + 定时重启 + 代理轮换）
  await pool.launch();
  browser = pool.browser;
  console.log('浏览器启动成功\n');
}

async function closeBrowser() {
  await pool.close();
  browser = null;
  console.log('\n轮换池已关闭');
}

// ======================== 页面抓取 ========================

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
           '(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

/**
 * 用 Puppeteer 抓取渲染后的页面 HTML（使用轮换池）
 */
async function fetchPage(url, retryCount = 0) {
  await initBrowser();

  // 等待排行榜内容出现的检测函数
  const rankingDetected = `() => {
    return document.querySelector('.ranking-list')
        || document.querySelector('.ranked-teams')
        || document.querySelector('[class*="ranking"]')
        || document.querySelector('[class*="rank"]')
        || document.body.innerText.length > 500;
  }`;

  try {
    const html = await pool.fetch(url, {
      timeout: 60000,
      waitFor: rankingDetected,
      waitMs: 2000,
    });
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

// ======================== 队标爬取 ========================

/**
 * 归一化 HLTV 队标 URL（保留原始 URL 不变）
 * 带 CDN 签名的 URL（?ixlib=...&w=50&s=...）才能正常加载
 */
function normalizeLogoUrl(url) {
  if (!url || !url.includes('hltv.org')) return url;
  return url;  // 保留原始 URL，签名由 HLTV CDN 处理
}

/**
 * 从 HLTV 队伍页面 HTML 中提取队标 URL
 */
function extractLogoUrl(html) {
  const $ = cheerio.load(html);
  const selectors = [
    'img.team-logo[src*="teamlogo"]',
    '.team-logo img[src*="teamlogo"]',
    'img[src*="teamlogo"]',
    '.profile-team-logo img',
    '.team-header-logo img',
  ];
  for (const sel of selectors) {
    const img = $(sel).first();
    if (img.length > 0) {
      let src = img.attr('src') || '';
      if (src && !src.startsWith('http')) src = `https:${src}`;
      if (src && src.includes('teamlogo') && !src.includes('silhouette')) return normalizeLogoUrl(src);
    }
  }
  const allImgs = $('img[src*="teamlogo"]');
  for (const img of allImgs) {
    let src = $(img).attr('src') || '';
    if (src && !src.startsWith('http')) src = `https:${src}`;
    if (src && !src.includes('silhouette')) return normalizeLogoUrl(src);
  }
  return '';
}

/**
 * 从 playerbase_clean.json 建立 teamName → teamId 映射
 * 每个队伍名取出现次数最多的 teamId
 */
function buildTeamIdMap() {
  if (!fs.existsSync(PLAYER_JSON_PATH)) {
    console.error(`[ERROR] 选手数据文件不存在: ${PLAYER_JSON_PATH}`);
    console.error('请先运行 node player_data.js 或确认路径');
    return {};
  }
  const raw = fs.readFileSync(PLAYER_JSON_PATH, 'utf-8');
  const counts = {};
  for (const line of raw.split('\n').filter(l => l.trim())) {
    try {
      const p = JSON.parse(line);
      const team = p.team;
      const tid = p.teamId;
      if (team && tid) {
        const key = `${team}||${tid}`;
        counts[key] = (counts[key] || 0) + 1;
      }
    } catch (_) {}
  }
  const best = {};
  for (const [key, cnt] of Object.entries(counts)) {
    const [team, tid] = key.split('||');
    if (!best[team] || cnt > best[team][1]) best[team] = [tid, cnt];
  }
  return Object.fromEntries(Object.entries(best).map(([k, v]) => [k, v[0]]));
}

/**
 * 爬取所有队伍的队标（仅爬尚未获得 logo_url 的队伍）
 * 输出 team_logos.json：{ teamName: logoUrl, ... }
 *
 * @param {number} limit - 限制爬取数量（调试用）
 */
async function crawlTeamLogos(limit = Infinity) {
  console.log('========================================');
  console.log('HLTV 队伍队标爬取');
  console.log('========================================\n');

  // 1. 读取已有 logo 记录（支持断点续爬）
  let existingLogos = {};
  if (fs.existsSync(LOGO_OUTPUT_FILE)) {
    try {
      existingLogos = JSON.parse(fs.readFileSync(LOGO_OUTPUT_FILE, 'utf-8'));
      console.log(`已加载已有记录: ${Object.keys(existingLogos).length} 个 logo\n`);
    } catch (_) {}
  }

  // 2. 加载队伍 ID 映射
  console.log('==> 加载队伍 ID 映射...');
  const teamIdMap = buildTeamIdMap();
  const allTeams = Object.keys(teamIdMap);
  console.log(`    共 ${allTeams.length} 支队伍有 teamId`);

  // 3. 过滤出还没有 logo 的队伍
  const needCrawl = allTeams.filter(t => !existingLogos[t]);
  console.log(`    已爬 ${Object.keys(existingLogos).length} 支，剩余 ${needCrawl.length} 支\n`);

  if (needCrawl.length === 0) {
    console.log('所有队伍已有 logo，无需爬取');
    return existingLogos;
  }

  const crawlList = limit < Infinity ? needCrawl.slice(0, limit) : needCrawl;
  console.log(`本次爬取: ${crawlList.length} 支\n`);

  let success = 0, fail = 0;
  const results = { ...existingLogos };

  for (let i = 0; i < crawlList.length; i++) {
    const teamName = crawlList[i];
    const teamId = teamIdMap[teamName];
    const slug = encodeURIComponent(teamName.replace(/ /g, '-').replace(/[^a-zA-Z0-9-]/g, ''));
    const url = `${BASE_URL}/team/${teamId}/${slug}`;

    console.log(`[${i + 1}/${crawlList.length}] ${teamName} (ID: ${teamId})`);

    try {
      const html = await fetchPage(url);
      const logoUrl = extractLogoUrl(html);

      if (logoUrl) {
        results[teamName] = logoUrl;
        console.log(`  ✓ ${logoUrl.slice(0, 60)}...`);
        success++;
      } else {
        console.log(`  ✗ 页面未找到 logo`);
        fail++;
      }
    } catch (err) {
      console.error(`  ✗ ${err.message}`);
      fail++;
    }

    // 定期保存进度
    if ((i + 1) % 20 === 0 || i === crawlList.length - 1) {
      fs.writeFileSync(LOGO_OUTPUT_FILE, JSON.stringify(results, null, 2), 'utf-8');
      console.log(`\n--- 进度: ${i + 1}/${crawlList.length} (成功:${success} 失败:${fail}) 已保存到 ${LOGO_OUTPUT_FILE} ---\n`);
    }

    await delay(LOGO_DELAY_MS);
  }

  console.log(`\n=== 队标爬取完成 ===`);
  console.log(`成功: ${success} | 失败: ${fail} | 总计: ${Object.keys(results).length}`);
  return results;
}

// ======================== 队标导入数据库 ========================

/**
 * 从 team_logos.json 读取爬取结果，更新 team 表的 logo_url
 */
async function importLogosToDb() {
  if (!fs.existsSync(LOGO_OUTPUT_FILE)) {
    console.error(`[ERROR] ${LOGO_OUTPUT_FILE} 不存在，请先运行 --logos`);
    return;
  }

  let mysql2;
  try {
    mysql2 = require('mysql2/promise');
  } catch (e) {
    console.error('[ERROR] 需要 mysql2 模块：npm install mysql2');
    return;
  }

  const logos = JSON.parse(fs.readFileSync(LOGO_OUTPUT_FILE, 'utf-8'));
  const entries = Object.entries(logos).filter(([, v]) => v);
  console.log(`\n==> 准备导入 ${entries.length} 个 logo 到 team 表`);

  const conn = await mysql2.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT || '3306'),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASS || '201005',
    database: process.env.DB_NAME || 'cs_match_pro',
  });

  let updated = 0, notFound = 0;
  for (const [teamName, logoUrl] of entries) {
    const [result] = await conn.execute(
      "UPDATE team SET logo_url = ? WHERE name = ? AND (logo_url IS NULL OR logo_url = '')",
      [logoUrl, teamName]
    );
    if (result.affectedRows > 0) updated++;
    else notFound++;
  }

  await conn.end();
  console.log(`更新: ${updated} 条 | 未匹配: ${notFound} 条`);
}

// ======================== 排名解析 ========================

/**
 * 解析 Valve 排名页面 HTML，提取队伍排名列表
 *
 * HLTV Valve 排名页面实际结构（2026年）：
 *   div.ranking > div:nth-child(1) > div:nth-child(N) > div > div.ranking-header
 *   .ranking-header 内包含：
 *     - span.name（在 .teamLine.teamLineExpanded 中） ← 队伍名称
 *     - div.rank-num 或 .position 或序号 ← 排名数字
 *     - a[href*="/team/"] ← 可提取 teamId
 *
 * @param {string} html - 页面 HTML
 * @param {number} topN - 仅返回前 N 名
 */
function parseRanking(html, topN = DEFAULT_TOP) {
  const $ = cheerio.load(html);
  const teams = [];

  // 优先策略：基于用户提供的 JS path / XPath 结构
  // Team name:   .ranking .ranking-header .teamLine.teamLineExpanded span.name
  // Points:      ranking 条目内 div/div[1]/div/div[1]/span[2]
  // Logo:        ranking 条目内 div/div[1]/span[2]/img
  const rankingHeaders = $('.ranking .ranking-header');

  if (rankingHeaders.length > 0) {
    console.log(`  使用 .ranking .ranking-header，找到 ${rankingHeaders.length} 个条目`);
    let rank = 0;
    rankingHeaders.each((_, header) => {
      if (rank >= topN) return false;
      rank++;

      const $header = $(header);

      // 队伍名称：.teamLine.teamLineExpanded span.name
      let name = '';
      const nameEl = $header.find('.teamLine.teamLineExpanded span.name, .teamLine span.name, span.name').first();
      if (nameEl.length > 0) {
        name = nameEl.text().trim();
      }

      // 队伍 ID（从 a[href*="/team/"] 链接中提取）
      // 先取整个 ranking 条目容器（header 的父级容器）
      const $entry = $header.parent().parent();

      let teamId = '';
      // 在条目范围内搜索队伍链接（可能在 header 外部）
      const linkSelectors = [
        'a[href*="/team/"]',
        '.teamLine a[href*="/team/"]',
        'span.name a[href*="/team/"]',
        'a[href*="/team/"] span.name',
      ];
      for (const sel of linkSelectors) {
        const link = $entry.find(sel).first();
        if (link.length > 0) {
          const href = link.attr('href') || link.parent().attr('href') || '';
          const idMatch = href.match(/\/team\/(\d+)\//);
          if (idMatch) { teamId = idMatch[1]; break; }
        }
      }

      // 队标 logo
      // 队标 logo
      // 页面结构: .ranking-header > span.team-logo > img
      // JS 路径: .ranking-header > span.team-logo > img
      let logo = '';
      const logoSelectors = [
        'span.team-logo > img',                          // 优先：用户提供的准确选择器
        '.team-logo img',
        'img[src*="teamlogo"]',
        'img[class*="logo"]',
        'img[alt*="logo"]',
        'div > div:nth-child(1) > span:nth-child(2) > img',
        'div > span:nth-child(2) > img',
        'span:nth-child(2) > img',
      ];
      for (const sel of logoSelectors) {
        const img = $entry.find(sel).first();
        if (img.length > 0 && img.attr('src')) {
          logo = img.attr('src') || '';
          if (logo && !logo.startsWith('http')) {
            logo = `https:${logo}`;
          }
          break;
        }
      }

      // 排名积分
      // XPath 路径: /div/div[1]/div/div[1]/span[2]
      let points = '';
      const pointsSelectors = [
        'div > div:nth-child(1) > div > div:nth-child(1) > span:nth-child(2)',
        '.rating',
        '.points',
        '.team-points',
        'span.rating',
        'span.points',
      ];
      for (const sel of pointsSelectors) {
        const el = $entry.find(sel).first();
        if (el.length > 0) {
          const text = el.text().trim();
          const numMatch = text.match(/([\d.]+)/);
          if (numMatch) {
            points = numMatch[1];
            break;
          }
        }
      }

      if (name) {
        teams.push({
          rank,
          name,
          teamId,
          points,
          logo
        });
      }
    });

    if (teams.length > 0) return teams;
  }

  // 回退策略 1：查找所有 .teamLine.teamLineExpanded
  console.log('  尝试 .teamLine.teamLineExpanded 选择器...');
  const teamLines = $('.teamLine.teamLineExpanded');
  if (teamLines.length > 0) {
    let rank = 0;
    teamLines.each((_, el) => {
      if (rank >= topN) return false;
      rank++;

      const $el = $(el);
      const name = $el.find('span.name').first().text().trim();

      let teamId = '';
      const link = $el.find('a[href*="/team/"]').first();
      if (link.length > 0) {
        const href = link.attr('href') || '';
        const idMatch = href.match(/\/team\/(\d+)\//);
        if (idMatch) teamId = idMatch[1];
      }

      let logo = '';
      const logoImg = $el.find('img[src*="teamlogo"], img[class*="logo"]').first();
      if (logoImg.length > 0) {
        logo = logoImg.attr('src') || '';
        if (logo && !logo.startsWith('http')) logo = `https:${logo}`;
      }

      if (name) {
        teams.push({ rank, name, teamId, points: '', logo });
      }
    });
    if (teams.length > 0) return teams;
  }

  // 回退策略 2：查找所有 a[href*="/team/"]
  console.log('  回退到通用 a[href*="/team/"] 解析...');
  const allLinks = $('a[href*="/team/"]');
  const seen = new Set();
  let rank = 0;
  allLinks.each((_, el) => {
    const name = $(el).text().trim();
    const href = $(el).attr('href') || '';
    const idMatch = href.match(/\/team\/(\d+)\//);
    const teamId = idMatch ? idMatch[1] : '';
    if (name && !seen.has(name) && name.length > 1) {
      seen.add(name);
      rank++;
      if (rank > topN) return false;
      teams.push({ rank, name, teamId, points: '', logo: '' });
    }
  });

  return teams;
}

// ======================== 数据持久化 ========================

function saveData(teams, outputPath) {
  const jsonLines = teams.map(t => JSON.stringify(t)).join('\n');
  fs.writeFileSync(outputPath, jsonLines, 'utf8');
  console.log(`\n已保存 ${teams.length} 条队伍数据到 ${outputPath}`);
}

// ======================== 主流程 ========================

/**
 * 爬取 Valve 世界排名
 * @param {number} topN - 取前多少名（默认 60）
 * @param {string} outputPath - 输出文件路径
 */
async function crawlRanking(topN = DEFAULT_TOP, outputPath = OUTPUT_FILE) {
  console.log('========================================');
  console.log('HLTV Valve 世界排名爬虫');
  console.log('========================================\n');
  console.log(`URL: ${RANKING_URL}`);
  console.log(`抓取前 ${topN} 名\n`);

  try {
    // 获取页面
    console.log('=== 获取排名页面 ===\n');
    const html = await fetchPage(RANKING_URL);

    // 解析排名
    console.log('\n=== 解析排名数据 ===\n');
    const teams = parseRanking(html, topN);

    if (teams.length === 0) {
      console.log('未解析到任何队伍，请检查页面结构是否已改版');
      // 保存 HTML 以供调试
      const debugPath = 'ranking_debug.html';
      fs.writeFileSync(debugPath, html, 'utf8');
      console.log(`已保存页面 HTML 到 ${debugPath}，可打开查看实际结构`);
      return [];
    }

    // 保存数据
    saveData(teams, outputPath);

    // 输出预览
    console.log('\n=== 排名预览 ===');
    teams.slice(0, Math.min(10, teams.length)).forEach(t => {
      console.log(`  #${t.rank}  ${t.name}${t.points ? ` (${t.points})` : ''}`);
    });
    if (teams.length > 10) {
      console.log(`  ... 共 ${teams.length} 支队伍`);
    }

    console.log('\n=== 完成 ===');
    return teams;
  } catch (error) {
    console.error('\n爬取异常:', error.message);
    return [];
  } finally {
    await closeBrowser();
  }
}

// ======================== 队伍详情爬取 ========================

const TEAM_DETAILS_FILE = path.join(__dirname, 'team_details.json');
const ROSTER_DELAY_MS = 1500;

/**
 * 从 HLTV 队伍页面爬取现役选手阵容
 * 仅提取现役阵容区域内的选手（最多 7 人：5 主力 + 替补）
 */
function parseRoster(html) {
  const $ = cheerio.load(html);
  const roster = [];
  const seen = new Set();

  // HLTV 现役阵容结构：
  //   div.bodyshot-team-bg > div.bodyshot-team.g-grid > a:nth-child(N)
  //     a > div > div > div > span.text-ellipsis.bold = 选手名
  //     a[href*="/player/{id}/"] = 选手 ID
  const rosterContainer = $('.bodyshot-team.g-grid, .bodyshot-team-bg');

  if (rosterContainer.length > 0) {
    // 在现役阵容容器内搜索选手链接
    rosterContainer.first().find('a[href*="/player/"]').each((_, el) => {
      const href = $(el).attr('href') || '';
      const idMatch = href.match(/\/player\/(\d+)\//);
      if (!idMatch) return;
      const playerId = idMatch[1];
      if (seen.has(playerId)) return;

      // 选手名在 span.text-ellipsis.bold 中
      let name = $(el).find('span.text-ellipsis.bold').text().trim()
        || $(el).find('span').text().trim()
        || $(el).attr('title') || '';
      name = name.replace(/[^\w\s\-\.]/g, '').trim();
      if (name && name.length >= 2) {
        seen.add(playerId);
        roster.push({ playerId, name });
      }
    });
  }

  return roster;
}

/**
 * 爬取排名中所有队伍的详情（队标、阵容等）
 * @param {Array} rankedTeams - crawlRanking 输出的队伍列表
 */
async function crawlTeamDetails(rankedTeams) {
  console.log('\n========================================');
  console.log('爬取队伍详情（队标 + 选手阵容）');
  console.log(`共 ${rankedTeams.length} 支队伍\n`);

  const results = [];
  for (let i = 0; i < rankedTeams.length; i++) {
    const t = rankedTeams[i];
    console.log(`[${i + 1}/${rankedTeams.length}] #${t.rank} ${t.name} (HLTV ID: ${t.teamId})`);

    if (!t.teamId) {
      console.log(`  跳过: 无 teamId`);
      results.push({ ...t, roster: [] });
      continue;
    }

    // HLTV 队伍 URL 需要带队伍名 slug，否则 404
    const slug = t.name.toLowerCase().replace(/ /g, '-').replace(/[^a-z0-9-]/g, '');
    const url = `${BASE_URL}/team/${t.teamId}/${slug}`;
    try {
      const html = await fetchPage(url);
      const roster = parseRoster(html);
      // 重新提取 logo（用 normalizeLogoUrl 转缩略图）
      const logo = extractLogoUrl(html);

      results.push({
        ...t,
        logo: logo || t.logo,
        roster,
      });
      console.log(`  ✓ ${roster.length} 名选手${logo ? '，有队标' : ''}`);
    } catch (err) {
      console.error(`  ✗ ${err.message}`);
      results.push({ ...t, roster: [] });
    }

    if (i < rankedTeams.length - 1) {
      await delay(ROSTER_DELAY_MS);
    }
  }

  // 保存到文件
  fs.writeFileSync(TEAM_DETAILS_FILE, JSON.stringify(results, null, 2), 'utf8');
  console.log(`\n已保存队伍详情到 ${TEAM_DETAILS_FILE}`);
  return results;
}

// ======================== 启动入口 ========================

if (require.main === module) {
  const args = process.argv.slice(2);

  // --logos: 队标爬取模式
  if (args.includes('--logos')) {
    const limitArg = args.find(a => a.startsWith('--limit='));
    const limit = limitArg ? parseInt(limitArg.split('=')[1]) : Infinity;
    console.log(`模式: 队标爬取${limit < Infinity ? ` (限 ${limit} 支)` : ''}\n`);

    crawlTeamLogos(limit).then(() => {
      console.log('\n队标爬取完成，结果请查看 team_logos.json');
    });
    return;
  }

  // --logos-import: 从 team_logos.json 导入到数据库
  if (args.includes('--logos-import')) {
    importLogosToDb().then(() => {
      console.log('\n队标导入完成');
    });
    return;
  }

  // --full: 全量模式（排名 + 队伍详情 + 选手阵容）
  if (args.includes('--full')) {
    console.log('模式: 全量爬取（排名 + 队伍详情 + 选手阵容）\n');

    (async () => {
      try {
        const teams = await crawlRanking(DEFAULT_TOP, OUTPUT_FILE);
        if (teams.length > 0) {
          await crawlTeamDetails(teams);
          console.log('\n全量爬取完成');
        } else {
          console.log('\n排名爬取失败，跳过队伍详情');
        }
      } finally {
        await closeBrowser();
        // 强制退出，避免 Puppeteer 残留进程卡住
        process.exit(0);
      }
    })();
    return;
  }

  // 默认：排名爬取模式
  let topN = DEFAULT_TOP;
  let outputPath = OUTPUT_FILE;

  for (const arg of args) {
    if (arg.startsWith('--top=')) {
      topN = parseInt(arg.split('=')[1], 10) || DEFAULT_TOP;
    } else if (arg.startsWith('--output=')) {
      outputPath = arg.split('=')[1];
    }
  }

  console.log(`参数: top=${topN}, output=${outputPath}\n`);

  crawlRanking(topN, outputPath).then((teams) => {
    if (teams.length > 0) {
      console.log(`成功爬取 ${teams.length} 支队伍`);
    } else {
      console.log('爬取失败，未获取到数据');
      process.exit(1);
    }
  });
}

module.exports = { crawlRanking, parseRanking, fetchPage, crawlTeamLogos, buildTeamIdMap, extractLogoUrl, importLogosToDb };
