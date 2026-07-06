const fs = require('fs');
const path = require('path');
const https = require('https');
const zlib = require('zlib');

// 配置
const BASE_URL = 'https://www.hltv.org';
const TEAM_ID_FILE = path.join(__dirname, 'teamID.txt');
const IMAGE_DIR = path.join(__dirname, 'image');
const OUTPUT_FILE = path.join(__dirname, 'teamdetails.json');

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
 * 确保输出目录存在
 */
function ensureOutputDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`创建目录: ${dir}`);
  }
}

/**
 * 获取战队页面HTML
 */
async function fetchTeamPage(url, retryCount = 0) {
  console.log(`\n正在访问: ${url}`);

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
        fetchTeamPage(res.headers.location, retryCount).then(resolve).catch(reject);
        return;
      }

      // 处理gzip压缩
      if (res.headers['content-encoding'] === 'gzip') {
        const gunzip = zlib.createGunzip();
        res.pipe(gunzip);
        gunzip.on('data', (chunk) => { data += chunk.toString(); });
        gunzip.on('end', () => {
          if (isCloudflareBlock(data)) {
            reject(new Error('Cloudflare 拦截'));
          } else {
            resolve(data);
          }
        });
        gunzip.on('error', reject);
      } else {
        res.on('data', (chunk) => { data += chunk.toString(); });
        res.on('end', () => {
          if (isCloudflareBlock(data)) {
            reject(new Error('Cloudflare 拦截'));
          } else {
            resolve(data);
          }
        });
      }
    });

    req.on('error', (err) => {
      console.error(`请求失败: ${err.message}`);
      if (retryCount < 3) {
        setTimeout(() => {
          fetchTeamPage(url, retryCount + 1).then(resolve).catch(reject);
        }, (retryCount + 1) * 5000);
      } else {
        reject(err);
      }
    });

    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error('请求超时'));
    });
  });
}

/**
 * 下载图片
 */
async function downloadImage(imageUrl, outputPath) {
  return new Promise((resolve, reject) => {
    if (!imageUrl) {
      resolve(null);
      return;
    }

    const protocol = imageUrl.startsWith('https') ? https : require('http');
    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8'
      }
    };

    protocol.get(imageUrl, options, (res) => {
      // 处理重定向
      if (res.statusCode === 301 || res.statusCode === 302) {
        downloadImage(res.headers.location, outputPath).then(resolve).catch(reject);
        return;
      }

      if (res.statusCode !== 200) {
        console.log(`  图片下载失败: HTTP ${res.statusCode}`);
        resolve(null);
        return;
      }

      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        fs.writeFileSync(outputPath, buffer);
        resolve(outputPath);
      });
    }).on('error', (err) => {
      console.log(`  图片下载失败: ${err.message}`);
      resolve(null);
    });
  });
}

/**
 * 解析战队详情
 * XPath:
 * - img[2]: /html/body/div[3]/div[6]/div[2]/div[1]/div[2]/div[2]/div[1]/div[1]/div[1]/img[2] (logo)
 * - text(): /html/body/div[3]/div[6]/div[2]/div[1]/div[2]/div[2]/div[1]/div[1]/div[2]/div/text()
 * - h1: /html/body/div[3]/div[6]/div[2]/div[1]/div[2]/div[2]/div[1]/div[1]/div[2]/h1
 * - a: /html/body/div[3]/div[6]/div[2]/div[1]/div[2]/div[2]/div[2]/div[1]/div[1]/span/a
 * - a/span: /html/body/div[3]/div[6]/div[2]/div[1]/div[2]/div[2]/div[2]/div[4]/a/span
 */
function parseTeamDetails(html, teamUrl) {
  try {
    const cheerio = require('cheerio');
    const $ = cheerio.load(html);
    const teamDetails = {
      url: teamUrl,
      logo: '',
      country: '',
      countryCode: '',
      teamName: '',
      countryUrl: '',
      roster: []
    };

    // 解析 logo 图片
    // div[1]/div[1]/div[1]/img[2]
    const logoImg = $('body > div.bgPadding > div.widthControl > div:nth-child(2) > div.contentCol > div.profileCon > div > div:nth-child(1) > div:nth-child(1) > div:nth-child(1) > img:nth-child(2)');
    if (logoImg.length > 0) {
      teamDetails.logo = logoImg.attr('src') || '';
    }

    // 如果上面没找到，尝试备选
    if (!teamDetails.logo) {
      const logoAlt = $('div.profileCon img[alt*="logo"], div.profileCon img.logo').first();
      if (logoAlt.length > 0) {
        teamDetails.logo = logoAlt.attr('src') || '';
      }
    }

    // 解析国家代码 (text())
    // div[1]/div[1]/div[2]/div/text()
    const countryDiv = $('body > div.bgPadding > div.widthControl > div:nth-child(2) > div.contentCol > div.profileCon > div > div:nth-child(1) > div:nth-child(1) > div:nth-child(2) > div');
    if (countryDiv.length > 0) {
      const text = countryDiv.text().trim();
      teamDetails.country = text;
    }

    // 如果上面没找到，尝试备选
    if (!teamDetails.country) {
      const countryFlag = $('span.flag').first();
      if (countryFlag.length > 0) {
        teamDetails.country = countryFlag.attr('title') || '';
      }
    }

    // 解析战队名称 (h1)
    // div[1]/div[1]/div[2]/h1
    const teamNameEl = $('body > div.bgPadding > div.widthControl > div:nth-child(2) > div.contentCol > div.profileCon > div > div:nth-child(1) > div:nth-child(1) > div:nth-child(2) > h1');
    if (teamNameEl.length > 0) {
      teamDetails.teamName = teamNameEl.text().trim();
    }

    // 如果上面没找到，尝试备选
    if (!teamDetails.teamName) {
      const teamNameAlt = $('div.profileCon h1.team-name, div.profileCon h1').first();
      if (teamNameAlt.length > 0) {
        teamDetails.teamName = teamNameAlt.text().trim();
      }
    }

    // 解析国家链接 (a标签)
    // div[2]/div[1]/div[1]/span/a
    const countryLink = $('body > div.bgPadding > div.widthControl > div:nth-child(2) > div.contentCol > div.profileCon > div > div:nth-child(2) > div:nth-child(1) > div:nth-child(1) > span > a');
    if (countryLink.length > 0) {
      const href = countryLink.attr('href');
      if (href) {
        teamDetails.countryUrl = href.startsWith('http') ? href : BASE_URL + href;
      }
    }

    // 如果上面没找到，尝试备选
    if (!teamDetails.countryUrl) {
      const countryLinkAlt = $('span.flag > a, a[href*="/country/"]').first();
      if (countryLinkAlt.length > 0) {
        const href = countryLinkAlt.attr('href');
        if (href) {
          teamDetails.countryUrl = href.startsWith('http') ? href : BASE_URL + href;
        }
      }
    }

    // 解析阵容 (a/span)
    // div[2]/div[4]/a/span
    const rosterLinks = $('body > div.bgPadding > div.widthControl > div:nth-child(2) > div.contentCol > div.profileCon > div > div:nth-child(2) > div:nth-child(4) > a > span');
    rosterLinks.each((_, el) => {
      const playerName = $(el).text().trim();
      const link = $(el).parent('a');
      const playerUrl = link.attr('href');
      if (playerName) {
        teamDetails.roster.push({
          name: playerName,
          url: playerUrl ? (playerUrl.startsWith('http') ? playerUrl : BASE_URL + playerUrl) : ''
        });
      }
    });

    // 如果上面没找到，尝试备选 - 查找阵容区域
    if (teamDetails.roster.length === 0) {
      // 尝试查找阵容相关的 a 标签
      $('div.lineup a, div.players a, div.profileCon a[href*="/player/"]').each((_, el) => {
        const playerName = $(el).text().trim();
        const playerUrl = $(el).attr('href');
        if (playerName && playerName.length > 1 && playerName.length < 30 && playerUrl && playerUrl.includes('/player/')) {
          if (!teamDetails.roster.find(p => p.name === playerName)) {
            teamDetails.roster.push({
              name: playerName,
              url: playerUrl.startsWith('http') ? playerUrl : BASE_URL + playerUrl
            });
          }
        }
      });
    }

    // 从URL提取战队ID和名称
    const urlMatch = teamUrl.match(/\/team\/(\d+)\/([^/]+)/);
    if (urlMatch) {
      teamDetails.teamId = urlMatch[1];
      teamDetails.teamSlug = urlMatch[2];
    }

    return teamDetails;
  } catch (err) {
    console.error(`解析失败: ${err.message}`);
    return null;
  }
}

/**
 * 从URL获取战队标识
 */
function getTeamIdentifierFromUrl(url) {
  const match = url.match(/\/team\/\d+\/([^/]+)/);
  return match ? match[1] : 'unknown';
}

/**
 * 主爬取函数
 */
async function crawlTeamDetails() {
  console.log('========================================');
  console.log('HLTV 战队详情爬虫');
  console.log('========================================\n');

  // 确保输出目录存在
  ensureOutputDir(IMAGE_DIR);

  // 读取战队ID列表
  if (!fs.existsSync(TEAM_ID_FILE)) {
    console.error(`错误: 找不到 ${TEAM_ID_FILE}`);
    return { success: false, error: 'teamID.txt not found' };
  }

  const urls = fs.readFileSync(TEAM_ID_FILE, 'utf8')
    .split('\n')
    .filter(line => line.trim() && line.startsWith('http'))
    .map(line => line.trim());

  console.log(`读取到 ${urls.length} 个战队URL\n`);

  if (urls.length === 0) {
    console.error('错误: teamID.txt 中没有有效的URL');
    return { success: false, error: 'No valid URLs in teamID.txt' };
  }

  const allTeams = [];
  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < urls.length; i++) {
    const teamUrl = urls[i];
    console.log(`[${i + 1}/${urls.length}]`);

    try {
      const html = await fetchTeamPage(teamUrl);
      const details = parseTeamDetails(html, teamUrl);

      if (details) {
        // 下载 logo 图片
        if (details.logo) {
          const teamSlug = details.teamSlug || getTeamIdentifierFromUrl(teamUrl);
          const imagePath = path.join(IMAGE_DIR, `${teamSlug}.png`);

          console.log(`  下载图片: ${details.logo}`);
          const downloaded = await downloadImage(details.logo, imagePath);
          if (downloaded) {
            console.log(`  图片已保存: ${downloaded}`);
          }
        }

        allTeams.push(details);
        successCount++;

        console.log(`  ✓ 战队: ${details.teamName || 'N/A'}`);
        console.log(`    国家: ${details.country || 'N/A'}`);
        console.log(`    阵容: ${details.roster.length} 人`);

        // 每处理10个保存一次
        if ((i + 1) % 10 === 0) {
          saveResults(allTeams);
          console.log(`\n--- 已保存进度: ${i + 1}/${urls.length} ---\n`);
        }
      } else {
        failCount++;
        console.log(`  ✗ 解析失败`);
      }
    } catch (err) {
      failCount++;
      console.error(`  ✗ 失败: ${err.message}`);
    }

    await delay(3000);
  }

  // 保存最终结果
  saveResults(allTeams);

  console.log('\n========================================');
  console.log('爬取完成！');
  console.log(`总计: ${urls.length} 个战队`);
  console.log(`成功: ${successCount} 个`);
  console.log(`失败: ${failCount} 个`);
  console.log(`输出文件: ${OUTPUT_FILE}`);
  console.log(`图片目录: ${IMAGE_DIR}`);
  console.log('========================================');

  return {
    success: true,
    total: urls.length,
    successCount,
    failCount,
    outputFile: OUTPUT_FILE,
    imageDir: IMAGE_DIR
  };
}

/**
 * 保存结果到 JSON 文件
 */
function saveResults(teams) {
  const data = JSON.stringify(teams, null, 2);
  fs.writeFileSync(OUTPUT_FILE, data, 'utf8');
  console.log(`已保存 ${teams.length} 个战队详情到 ${OUTPUT_FILE}`);
}

/**
 * 测试特定 XPath
 */
async function testXPath() {
  console.log('========================================');
  console.log('测试 XPath 选择器');
  console.log('========================================\n');

  if (!fs.existsSync(TEAM_ID_FILE)) {
    console.error(`错误: 找不到 ${TEAM_ID_FILE}`);
    return;
  }

  const urls = fs.readFileSync(TEAM_ID_FILE, 'utf8')
    .split('\n')
    .filter(line => line.trim() && line.startsWith('http'))
    .map(line => line.trim());

  if (urls.length === 0) {
    console.error('错误: teamID.txt 中没有有效的URL');
    return;
  }

  try {
    const html = await fetchTeamPage(urls[0]);
    const cheerio = require('cheerio');
    const $ = cheerio.load(html);

    // 测试各种选择器
    const tests = [
      { name: 'logo img[2]', sel: 'body > div.bgPadding > div.widthControl > div:nth-child(2) > div.contentCol > div.profileCon > div > div:nth-child(1) > div:nth-child(1) > div:nth-child(1) > img:nth-child(2)' },
      { name: 'country div', sel: 'body > div.bgPadding > div.widthControl > div:nth-child(2) > div.contentCol > div.profileCon > div > div:nth-child(1) > div:nth-child(1) > div:nth-child(2) > div' },
      { name: 'team name h1', sel: 'body > div.bgPadding > div.widthControl > div:nth-child(2) > div.contentCol > div.profileCon > div > div:nth-child(1) > div:nth-child(1) > div:nth-child(2) > h1' },
      { name: 'country link', sel: 'body > div.bgPadding > div.widthControl > div:nth-child(2) > div.contentCol > div.profileCon > div > div:nth-child(2) > div:nth-child(1) > div:nth-child(1) > span > a' },
      { name: 'roster a/span', sel: 'body > div.bgPadding > div.widthControl > div:nth-child(2) > div.contentCol > div.profileCon > div > div:nth-child(2) > div:nth-child(4) > a > span' },
    ];

    for (const test of tests) {
      const el = $(test.sel);
      console.log(`${test.name}: ${el.length} 个元素`);
      if (el.length > 0) {
        console.log(`  文本: ${el.first().text().trim()}`);
        console.log(`  HTML: ${el.first().html() || 'N/A'}`);
        if (el.first().attr('src')) console.log(`  src: ${el.first().attr('src')}`);
        if (el.first().attr('href')) console.log(`  href: ${el.first().attr('href')}`);
      }
      console.log('');
    }

    // 备选测试
    console.log('=== 备选选择器测试 ===\n');

    const altTests = [
      { name: 'img.logo', sel: 'img.logo' },
      { name: 'h1.team-name', sel: 'h1.team-name' },
      { name: 'div.profileCon h1', sel: 'div.profileCon h1' },
      { name: 'span.flag', sel: 'span.flag' },
      { name: 'a[href*="/player/"]', sel: 'a[href*="/player/"]' },
      { name: 'div.lineup a', sel: 'div.lineup a' },
    ];

    for (const test of altTests) {
      const els = $(test.sel);
      console.log(`${test.name}: ${els.length} 个元素`);
      if (els.length > 0) {
        els.slice(0, 3).each((i, el) => {
          console.log(`  ${i + 1}. ${$(el).text().trim().substring(0, 50)}`);
          if ($(el).attr('href')) console.log(`     href: ${$(el).attr('href')}`);
          if ($(el).attr('src')) console.log(`     src: ${$(el).attr('src')}`);
        });
      }
    }

  } catch (err) {
    console.error('测试失败:', err.message);
  }
}

// 运行爬虫
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.includes('--test')) {
    testXPath();
  } else {
    crawlTeamDetails();
  }
}

module.exports = {
  crawlTeamDetails,
  testXPath
};