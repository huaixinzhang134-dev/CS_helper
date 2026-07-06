const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

// 配置
const BASE_URL = 'https://event.5eplay.com/csgo/matches?grade=1%2C7%2C2%2C3%2C8%2C9';
const OUTPUT_FILE = path.join(__dirname, 'matchbase.json');
const DELAY_MIN = 2000;
const DELAY_MAX = 4000;

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36 Edg/148.0.0.0';

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function randomDelay() {
  return delay(DELAY_MIN + Math.random() * (DELAY_MAX - DELAY_MIN));
}

/**
 * 用 Puppeteer 抓取指定 tab 渲染后的 HTML
 * - 等待 Vue 应用挂载 + 列表数据出现
 * - 返回完整的 document HTML 字符串
 */
// 优先用本地 Chrome,其次 Edge
function pickExecutablePath() {
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
  ];
  for (const p of candidates) {
    try { if (fs.existsSync(p)) return p; } catch (_) {}
  }
  return undefined;
}

async function fetchRenderedPage(url, waitForTab) {
  const executablePath = pickExecutablePath();
  console.log(`  使用浏览器: ${executablePath || 'puppeteer 默认路径'}`);

  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--lang=zh-CN,zh'
    ]
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent(USER_AGENT);
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    });
    await page.setViewport({ width: 1440, height: 900 });

    console.log(`正在访问: ${url}`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

    // 等待 #app 节点出现
    await page.waitForSelector('#app', { timeout: 30000 });

    // 如果指定了目标 tab(赛程 schedule / 赛果 results),点击对应 span
    if (waitForTab) {
      // 等待两个 tab span 都渲染好
      await page.waitForFunction(
        () => {
          const spans = document.querySelectorAll('#app div div div div div span');
          return spans && spans.length >= 2;
        },
        { timeout: 30000 }
      );

      const tabClicked = await page.evaluate((targetTab) => {
        // 通过 Xpath 定位两个 span
        const xpath = '//*[@id="app"]/div/div[3]/div/div[1]/div/div/span';
        const result = document.evaluate(
          xpath + '[1]',
          document,
          null,
          XPathResult.FIRST_ORDERED_NODE_TYPE,
          null
        );
        const span1 = result.singleNodeValue;
        const result2 = document.evaluate(
          xpath + '[2]',
          document,
          null,
          XPathResult.FIRST_ORDERED_NODE_TYPE,
          null
        );
        const span2 = result2.singleNodeValue;

        if (!span1 || !span2) return { ok: false, reason: 'tab spans not found' };

        const s1Text = (span1.textContent || '').trim();
        const s2Text = (span2.textContent || '').trim();
        const target = targetTab === 'schedule' ? s1Text : s2Text;

        const targetSpan = targetTab === 'schedule' ? span1 : span2;
        if (!targetSpan) return { ok: false, reason: 'target span not found' };

        targetSpan.click();
        return { ok: true, span1: s1Text, span2: s2Text, clicked: target };
      }, waitForTab);

      console.log(`Tab 点击: ${JSON.stringify(tabClicked)}`);

      // 给 Vue 时间去切 tab + 拉数据
      await delay(2500);
    }

    // 等待比赛列表实际渲染出来(等 .match-card 或 .match-date 等)
    try {
      await page.waitForFunction(
        () => {
          return document.querySelector('.match-card')
              || document.querySelector('.match-time-star')
              || document.querySelector('.match-date')
              || document.querySelector('.match-item-row');
        },
        { timeout: 30000 }
      );
    } catch (e) {
      console.log('警告: 等待比赛列表节点超时,继续抓取当前 HTML');
    }

    // 多等一会确保列表渲染完毕
    await delay(1500);

    // ===== 全量抓取:滚动到底部触发分页/懒加载,直到连续 N 次无新增 =====
    console.log('  开始滚动加载更多比赛...');
    let prevRowCount = 0;
    let noChangeStreak = 0;
    const MAX_NO_CHANGE = 3;          // 连续 3 次无新增就停止
    const MAX_SCROLL_ROUNDS = 30;     // 最多滚 30 轮,避免无限循环
    for (let round = 0; round < MAX_SCROLL_ROUNDS; round++) {
      // 滚到页面底部
      await page.evaluate(() => {
        const scroller = document.querySelector('.matches-list-wrap')
                      || document.querySelector('.matches-tab')
                      || document.scrollingElement;
        if (scroller && scroller.scrollTo) {
          scroller.scrollTo(0, scroller.scrollHeight);
        } else {
          window.scrollTo(0, document.body.scrollHeight);
        }
      });
      // 给 Vue 时间加载下一页
      await delay(1200);

      const curRowCount = await page.evaluate(
        () => document.querySelectorAll('.match-item-row').length
      );
      console.log(`  滚动 #${round + 1}: 当前 .match-item-row 数量 = ${curRowCount}`);

      if (curRowCount > prevRowCount) {
        prevRowCount = curRowCount;
        noChangeStreak = 0;
      } else {
        noChangeStreak += 1;
        if (noChangeStreak >= MAX_NO_CHANGE) {
          console.log(`  连续 ${MAX_NO_CHANGE} 次无新增,停止滚动`);
          break;
        }
      }
    }
    // 滚回顶部
    await page.evaluate(() => window.scrollTo(0, 0));
    await delay(500);

    const html = await page.content();
    return html;
  } finally {
    await browser.close();
  }
}

/**
 * 判断当前页面激活的 Tab
 * 通过 Xpath: //*[@id="app"]/div/div[3]/div/div[1]/div/div/span[1] / span[2]
 * 赛程: span[1] 含 "active" 类
 * 赛果: span[2] 含 "active" 类
 */
function detectTab($) {
  // 真实 DOM:两个 tab 都在 #app 下,标签文本就是 "赛程" / "赛果"
  let activeSpan = null;
  $('#app span').each((_, el) => {
    const $el = $(el);
    const t = ($el.text() || '').trim();
    if ($el.hasClass('active') && (t === '赛程' || t === '赛果')) {
      activeSpan = t;
    }
  });
  if (activeSpan === '赛程') return 'schedule';
  if (activeSpan === '赛果') return 'results';
  return 'unknown';
}

/**
 * 安全获取 cheerio 节点文本
 */
function txt($el) {
  if (!$el || $el.length === 0) return '';
  return $el.text().trim();
}

/**
 * 从一段节点里只取出直接文本节点(对应 Xpath text()[1] + text()[2])
 */
function directTextOnly($, $el) {
  if (!$el || $el.length === 0) return '';
  const parts = $el.contents()
    .filter(function () { return this.type === 'text'; })
    .map(function () { return $(this).text().trim(); })
    .get()
    .filter(Boolean);
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * 解析 HTML 中的比赛列表
 *
 * 真实 DOM 结构(从 #app 向下):
 *   <div class="matches-list-wrap">
 *     <div class="match-item">                              <-- **按日期分组的容器**(每天一个)
 *       <div class="match-time-title">2026-06-03<span>(今天)</span></div>   <-- 日期
 *       <div class="match-item-row">                         <-- **单场比赛**
 *         <div class="match-item match-item-left">
 *           <div class="match-time-star"><div>20:30</div>...</div>          <-- 时间
 *           <div><div class="match-rule tcenter">BO1</div></div>           <-- 类型
 *           <div class="match-team">                                          <-- 队伍容器
 *             <p class="ellip">NRG</p>
 *             <p class="ellip">FlyQuest</p>
 *           </div>
 *           <div class="all-score-box">                                       <-- 总比分(赛果)
 *             <div class="all-score"><div class="team-win">13</div></div>
 *             <div class="all-score"><div class="">9</div></div>
 *           </div>
 *         </div>
 *         <div class="match-item match-item-right">
 *           <div class="match-system"><div class="ellip">IEM 科隆Major</div></div> <-- 赛事名
 *         </div>
 *       </div>
 *     </div>
 *   </div>
 */
function parseMatches(html, tabType) {
  const $ = cheerio.load(html);
  const matches = [];

  const detectedTab = detectTab($);
  const effectiveTab = detectedTab !== 'unknown' ? detectedTab : tabType;

  // 一级:按日期分组的 .match-item
  const $groups = $('.matches-list-wrap > .match-item');
  console.log(`  解析到日期分组: ${$groups.length} 个`);

  $groups.each((_, groupEl) => {
    const $group = $(groupEl);

    // 1) 比赛日期: .match-time-title (例: "2026-06-03(今天)")
    //    对应 Xpath 形式:  //*[@id="app"]/.../div[1]/div[1]/div[1]/text()
    const $dateEl = $group.children('.match-time-title').first();
    let date = directTextOnly($, $dateEl);
    if (!date) {
      // 兜底:把 <span> 移除后取剩余文本
      const $clone = $dateEl.clone();
      $clone.children().remove();
      date = $clone.text().trim();
    }
    date = date.replace(/\s+/g, ' ').trim();

    // 二级:组内的每一场 .match-item-row
    const $rows = $group.children('.match-item-row');
    if ($rows.length === 0) return;

    $rows.each((_, rowEl) => {
      const $row = $(rowEl);

      // 2) 比赛时间: .match-time-star > div:first-child
      const $timeWrap = $row.find('.match-item-left > .match-time-star').first();
      const time = txt($timeWrap.children('div').first()) || txt($timeWrap);

      // 3) 比赛类型: .match-rule.tcenter (class="match-rule tcenter",中间是空格)
      const $typeEl = $row.find('.match-rule.tcenter').first();
      const typeText = directTextOnly($, $typeEl) || txt($typeEl);

      // 4) 队伍名: .match-item-left .match-team p.ellip (左/右各一个)
      const $team1El = $row.find('.match-item-left .match-team p.ellip').first();
      const $team2El = $row.find('.match-item-left .match-team p.ellip').last();
      const team1 = txt($team1El);
      const team2 = txt($team2El);

      // 5) 总比分(赛果)
      //    .all-score-box > .all-score (两个数字)
      let score1 = null, score2 = null;
      const $scoreBox = $row.find('.match-item-left .all-score-box').first();
      if ($scoreBox.length) {
        const $scores = $scoreBox.children('.all-score');
        const s1 = parseInt(txt($scores.eq(0).children('div').first()), 10);
        const s2 = parseInt(txt($scores.eq(1).children('div').first()), 10);
        if (!Number.isNaN(s1)) score1 = s1;
        if (!Number.isNaN(s2)) score2 = s2;
      }

      // 6) 小局比分:本页面没有,留空(该网站不显示各小局比分)
      const roundScores = [];

      // 7) 赛事名称: .match-item-right .ellip (注意是 div.ellip,不是 p.ellip)
      const $event = $row.find('.match-item-right .ellip').first();
      const eventName = txt($event) || 'unknown';

      if (!team1 || !team2) return; // 没拿到两支队就跳过

      matches.push({
        date,
        time,
        matchType: typeText || 'unknown',
        team1,
        team2,
        team1Score: effectiveTab === 'results' ? (score1 ?? 0) : null,
        team2Score: effectiveTab === 'results' ? (score2 ?? 0) : null,
        roundScores: effectiveTab === 'results' ? roundScores : [],
        eventName,
        status: effectiveTab === 'results' ? 'finished' : 'upcoming',
        tab: effectiveTab,
        updatedAt: new Date().toISOString()
      });
    });
  });

  console.log(`  共解析出 ${matches.length} 场比赛`);
  return { matches, detectedTab };
}

async function crawlMatches() {
  console.log('========================================');
  console.log('5EPlay 赛事数据爬虫');
  console.log('========================================\n');

  let scheduleMatches = [];
  let resultsMatches = [];

  try {
    // ---------- 1. 赛程部分 ----------
    console.log('--- 爬取赛程部分 ---');
    const scheduleHtml = await fetchRenderedPage(BASE_URL, 'schedule');
    fs.writeFileSync(path.join(__dirname, 'debug_schedule.html'), scheduleHtml);
    const { matches: sMatches, detectedTab: sTab } = parseMatches(scheduleHtml, 'schedule');
    scheduleMatches = sMatches;
    console.log(`赛程 Tab 判定: ${sTab}, 抓到 ${scheduleMatches.length} 场`);

    await randomDelay();

    // ---------- 2. 赛果部分 ----------
    console.log('\n--- 爬取赛果部分 ---');
    const resultsHtml = await fetchRenderedPage(BASE_URL, 'results');
    fs.writeFileSync(path.join(__dirname, 'debug_results.html'), resultsHtml);
    const { matches: rMatches, detectedTab: rTab } = parseMatches(resultsHtml, 'results');
    resultsMatches = rMatches;
    console.log(`赛果 Tab 判定: ${rTab}, 抓到 ${resultsMatches.length} 场`);

    // ---------- 3. 合并去重 ----------
    const allMatches = [...scheduleMatches, ...resultsMatches];
    const seen = new Set();
    const uniqueMatches = allMatches.filter(m => {
      const key = `${m.date}|${m.time}|${m.team1}|${m.team2}|${m.tab}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // ---------- 4. 落盘 ----------
    const jsonData = JSON.stringify(uniqueMatches, null, 2);
    fs.writeFileSync(OUTPUT_FILE, jsonData, 'utf8');

    console.log('\n========================================');
    console.log('爬取完成!');
    console.log(`赛程: ${scheduleMatches.length} 场`);
    console.log(`赛果: ${resultsMatches.length} 场`);
    console.log(`去重后: ${uniqueMatches.length} 场`);
    console.log(`输出文件: ${OUTPUT_FILE}`);
    console.log('========================================');

    if (uniqueMatches.length > 0) {
      console.log('\n=== 示例数据 (前 3 条) ===');
      uniqueMatches.slice(0, 3).forEach((match, i) => {
        console.log(`\n比赛 ${i + 1}:`);
        console.log(`  日期:    ${match.date}`);
        console.log(`  时间:    ${match.time}`);
        console.log(`  类型:    ${match.matchType}`);
        console.log(`  战队:    ${match.team1} vs ${match.team2}`);
        console.log(`  比分:    ${match.status === 'finished' ? `${match.team1Score} - ${match.team2Score}` : '未开始'}`);
        console.log(`  小局:    ${match.roundScores.length ? JSON.stringify(match.roundScores) : '-'}`);
        console.log(`  赛事:    ${match.eventName}`);
        console.log(`  Tab:     ${match.tab}`);
        console.log(`  状态:    ${match.status}`);
      });
    }

    return {
      success: true,
      scheduleCount: scheduleMatches.length,
      resultsCount: resultsMatches.length,
      total: uniqueMatches.length,
      file: OUTPUT_FILE
    };
  } catch (error) {
    console.error('\n爬取失败:', error);
    return { success: false, error: error.message, stack: error.stack };
  }
}

if (require.main === module) {
  crawlMatches().catch(err => {
    console.error('爬虫出错:', err);
    process.exit(1);
  });
}

module.exports = {
  crawlMatches,
  fetchRenderedPage,
  detectTab,
  parseMatches
};
