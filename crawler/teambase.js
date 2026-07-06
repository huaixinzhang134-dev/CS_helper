const fs = require('fs');
const path = require('path');
const https = require('https');
const zlib = require('zlib');

// 配置
const BASE_URL = 'https://www.hltv.org';
const OUTPUT_FILE = path.join(__dirname, 'teamID.txt');

/**
 * 获取当前日期，生成排名URL
 * @returns {string} 排名页面URL
 */
function getRankingUrl() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.toLocaleString('en-US', { month: 'long' }).toLowerCase();
  const day = now.getDate();

  const url = `${BASE_URL}/valve-ranking/teams/${year}/${month}/${day}`;
  console.log(`生成的URL: ${url}`);
  return url;
}

/**
 * 延迟函数
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 检测Cloudflare拦截
 */
function isCloudflareBlock(html) {
  return html.includes('cf-challenge') ||
         html.includes('Just a moment') ||
         html.includes('cf-browser-verification') ||
         (html.includes('Attention Required') && html.includes('Cloudflare')) ||
         html.includes('Enable JavaScript and cookies');
}

/**
 * 获取排名页面HTML (使用原生https模块)
 */
async function fetchRankingPage(url, retryCount = 0) {
  console.log(`正在访问: ${url}`);

  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36 Edg/148.0.0.0',
      }
    };

    const req = https.get(url, options, (res) => {
      let data = '';

      // 处理重定向
      if (res.statusCode === 301 || res.statusCode === 302) {
        console.log(`  重定向到: ${res.headers.location}`);
        fetchRankingPage(res.headers.location, retryCount).then(resolve).catch(reject);
        return;
      }

      // 处理gzip压缩
      if (res.headers['content-encoding'] === 'gzip') {
        const gunzip = zlib.createGunzip();
        res.pipe(gunzip);
        gunzip.on('data', (chunk) => { data += chunk.toString(); });
        gunzip.on('end', () => {
          processHtml(data, url, retryCount).then(resolve).catch(reject);
        });
        gunzip.on('error', reject);
      } else {
        res.on('data', (chunk) => { data += chunk.toString(); });
        res.on('end', () => {
          processHtml(data, url, retryCount).then(resolve).catch(reject);
        });
      }
    });

    req.on('error', (err) => {
      console.error(`请求失败: ${err.message}`);
      if (retryCount < 3) {
        const waitTime = (retryCount + 1) * 5000;
        console.log(`${(waitTime / 1000).toFixed(0)}s 后重试...`);
        setTimeout(() => {
          fetchRankingPage(url, retryCount + 1).then(resolve).catch(reject);
        }, waitTime);
      } else {
        reject(err);
      }
    });

    req.setTimeout(30000, () => {
      req.destroy();
      if (retryCount < 3) {
        const waitTime = (retryCount + 1) * 5000;
        console.log(`超时，${(waitTime / 1000).toFixed(0)}s 后重试...`);
        setTimeout(() => {
          fetchRankingPage(url, retryCount + 1).then(resolve).catch(reject);
        }, waitTime);
      } else {
        reject(new Error('请求超时'));
      }
    });
  });
}

async function processHtml(html, url, retryCount) {
  if (isCloudflareBlock(html)) {
    if (retryCount < 3) {
      const waitTime = (retryCount + 1) * 10000;
      console.log(`⚠ Cloudflare 拦截，${(waitTime / 1000).toFixed(0)}s 后重试 (${retryCount + 1}/3)...`);
      await delay(waitTime);
      return fetchRankingPage(url, retryCount + 1);
    } else {
      throw new Error('Cloudflare 拦截，已重试 3 次');
    }
  }
  return html;
}

/**
 * 解析排名页面，提取战队链接 (优先正则匹配 /team/xxx 格式)
 */
function parseTeamLinks(html) {
  // 使用正则表达式查找所有战队链接
  // 匹配模式: /team/<number>/<team-name>
  const teamLinkRegex = /href="(\/team\/\d+\/[^"]+)"/g;
  const teamLinks = [];
  const seen = new Set();

  let match;
  while ((match = teamLinkRegex.exec(html)) !== null) {
    const href = match[1];
    // 过滤掉非战队页面的链接
    if (!seen.has(href) && href.match(/^\/team\/\d+\/[\w-]+$/)) {
      seen.add(href);
      teamLinks.push({
        href: href,
        fullUrl: BASE_URL + href
      });
    }
  }

  return teamLinks;
}

/**
 * 使用 cheerio 解析（更可靠的方式）
 */
function parseTeamLinksWithCheerio(html) {
  try {
    const cheerio = require('cheerio');
    const $ = cheerio.load(html);
    const teamLinks = [];
    const seen = new Set();

    // XPath: /html/body/div[3]/div[6]/div[2]/div[1]/div[2]/div[1]/div[n]/div/div[2]/div/a[1]
    // n 从 4 开始递增，遍历所有战队行

    // 方法：查找 ranking 下的所有直接子 div，从第 4 个开始
    const rankingSection = $('div.ranking > div').first();

    if (rankingSection.length > 0) {
      // 获取所有子 div（战队行），从第 4 个开始（索引 3）
      const teamRows = rankingSection.children('div');

      teamRows.each((index, row) => {
        // 从第 4 个开始（索引 3）
        if (index < 3) return;

        const rowEl = $(row);
        // 查找该 row 下的 div/div[2]/div/a[1]
        const targetLink = rowEl.find('> div > div:nth-child(2) > div > a').first();
        const href = targetLink.attr('href');

        if (href && href.includes('/team/') && !seen.has(href)) {
          seen.add(href);
          teamLinks.push({
            href: href,
            fullUrl: href.startsWith('http') ? href : BASE_URL + href,
            teamName: targetLink.text().trim() || 'Unknown'
          });
          console.log(`  找到战队[${index - 2}]: ${href}`);
        }
      });
    }

    // 如果上面的方法没找到，使用备选选择器
    if (teamLinks.length === 0) {
      // 查找所有 .lineup-con 下的第一个 a 标签
      $('div.lineup-con, div.lineup-con.hidden').each((_, element) => {
        // 获取父 div 结构下的第一个 a
        const firstLink = $(element).find('> div > a').first();
        const href = firstLink.attr('href');

        if (href && href.includes('/team/') && !seen.has(href)) {
          seen.add(href);
          teamLinks.push({
            href: href,
            fullUrl: href.startsWith('http') ? href : BASE_URL + href,
            teamName: firstLink.text().trim() || 'Unknown'
          });
        }
      });
    }

    // 最后备选：查找所有 a.moreLink[href*="/team/"]
    if (teamLinks.length === 0) {
      $('a.moreLink[href*="/team/"]').each((_, element) => {
        const href = $(element).attr('href');
        if (href && !seen.has(href)) {
          seen.add(href);
          teamLinks.push({
            href: href,
            fullUrl: href.startsWith('http') ? href : BASE_URL + href,
            teamName: $(element).text().trim() || 'Unknown'
          });
        }
      });
    }

    return teamLinks;
  } catch (err) {
    console.warn('cheerio 解析失败，使用正则备用方案:', err.message);
    return parseTeamLinks(html);
  }
}

/**
 * 保存战队链接到文件
 */
function saveTeamLinks(teamLinks) {
  if (teamLinks.length === 0) {
    console.warn('未找到任何战队链接');
    fs.writeFileSync(OUTPUT_FILE, 'No teams found\n', 'utf8');
    return;
  }

  const lines = teamLinks.map(link => link.fullUrl);
  const content = lines.join('\n') + '\n';

  fs.writeFileSync(OUTPUT_FILE, content, 'utf8');
  console.log(`已保存 ${teamLinks.length} 个战队链接到 ${OUTPUT_FILE}`);
}

/**
 * 主爬取函数
 */
async function crawlTeamRankings() {
  console.log('========================================');
  console.log('HLTV 战队排名爬虫');
  console.log('========================================\n');

  try {
    const url = getRankingUrl();
    const html = await fetchRankingPage(url);

    console.log('正在解析战队链接...');
    let teamLinks = parseTeamLinksWithCheerio(html);

    if (teamLinks.length === 0) {
      console.log('cheerio 未找到结果，尝试正则表达式...');
      teamLinks = parseTeamLinks(html);
    }

    console.log(`找到 ${teamLinks.length} 个战队链接`);

    if (teamLinks.length > 0) {
      console.log('\n前10个战队:');
      teamLinks.slice(0, 10).forEach((link, index) => {
        console.log(`  ${index + 1}. ${link.teamName || 'N/A'} - ${link.href}`);
      });
    }

    saveTeamLinks(teamLinks);

    console.log('\n========================================');
    console.log('爬取完成！');
    console.log(`总计: ${teamLinks.length} 个战队`);
    console.log(`输出文件: ${OUTPUT_FILE}`);
    console.log('========================================');

    return {
      success: true,
      count: teamLinks.length,
      file: OUTPUT_FILE,
      teams: teamLinks
    };

  } catch (error) {
    console.error('\n爬取失败:', error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * 测试特定选择器路径
 */
async function testSpecificSelector() {
  console.log('========================================');
  console.log('测试特定选择器路径');
  console.log('========================================\n');

  const url = getRankingUrl();

  try {
    const html = await fetchRankingPage(url);
    const cheerio = require('cheerio');
    const $ = cheerio.load(html);

    // 尝试多种选择器 - 基于 XPath，遍历所有战队行
    const selectors = [
      // 通用：直接查找所有目标链接
      'div.ranking > div > div > div > div:nth-child(2) > div > a:first-child'
    ];

    console.log('测试选择器:');
    for (const selector of selectors) {
      const elements = $(selector);
      console.log(`  ${selector}: ${elements.length} 个元素`);

      if (elements.length > 0) {
        elements.slice(0, 3).each((i, el) => {
          console.log(`    ${i + 1}. ${$(el).attr('href')} - ${$(el).text().trim()}`);
        });
      }
    }

    return true;
  } catch (err) {
    console.error('测试失败:', err.message);
    return false;
  }
}

// 运行爬虫
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.includes('--test')) {
    testSpecificSelector();
  } else {
    crawlTeamRankings();
  }
}

module.exports = {
  crawlTeamRankings,
  getRankingUrl,
  testSpecificSelector
};
