/**
 * 将 playerbase.json（爬虫合并产物）导入 Railway MySQL
 * 运行: node scripts/import-players.js
 *
 * 与 import_ranking.js 一致的 env var 优先级和连接方式
 */
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

/**
 * 三大赛区国家代码集合（ISO 3166-1 alpha-2）
 * 复制自 crawler/clean_playerbase_region.py，与本地清洗逻辑保持一致
 */
const EUROPE_CODES = new Set([
  "FR","DE","NL","BE","LU","AT","CH","IE","GB","UK",
  "SE","NO","DK","FI","IS",
  "IT","ES","PT","GR","MT","CY","AD","MC","SM","VA",
  "PL","CZ","SK","HU","SI","HR","BA","RS","ME","MK","AL","XK",
  "RU","UA","BY","MD","EE","LV","LT",
  "BG","RO","LI","FO","SJ","AX","GI",
]);

const AMERICAS_CODES = new Set([
  "US","CA","MX",
  "GT","BZ","HN","SV","NI","CR","PA",
  "CU","JM","HT","DO","PR","BS","BB","TT","LC","GD","VC","DM",
  "AG","KN","AI","MS","TC","VG","VI","KY","BM","AW","CW",
  "SX","BQ","MQ","GP","RE","YT","PM","GL",
  "BR","AR","CL","CO","PE","VE","EC","BO","PY","UY","GY","SR","GF","FK",
]);

const ASIA_CODES = new Set([
  "CN","JP","KR","KP","MN","TW","HK","MO",
  "SG","MY","ID","TH","VN","PH","MM","KH","LA","BN","TL",
  "IN","PK","BD","NP","BT","LK","MV","AF",
  "TR","SA","AE","QA","KW","BH","OM","YE","JO","LB","SY","IQ","IR","IL","PS","AM","AZ","GE",
  "KZ","UZ","TM","KG","TJ",
  "AU","NZ","PG","FJ","WS","TO","VU","SB","KI","NR","TV","PW","MH","FM","CK","NU","TK","WF","PF","NC","GU","MP","AS",
]);

// 国家名称 → 赛区 兜底映射（处理无 countryCode 的情况）
const COUNTRY_NAME_REGION = {
  "United Kingdom": "Europe", "UK": "Europe", "Great Britain": "Europe",
  "England": "Europe", "Scotland": "Europe", "Wales": "Europe",
  "Northern Ireland": "Europe", "Ireland": "Europe", "Republic of Ireland": "Europe",
  "France": "Europe", "Germany": "Europe", "Spain": "Europe", "Italy": "Europe",
  "Portugal": "Europe", "Netherlands": "Europe", "Belgium": "Europe",
  "Switzerland": "Europe", "Austria": "Europe", "Poland": "Europe",
  "Czech Republic": "Europe", "Czechia": "Europe", "Slovakia": "Europe",
  "Hungary": "Europe", "Romania": "Europe", "Bulgaria": "Europe", "Greece": "Europe",
  "Croatia": "Europe", "Serbia": "Europe", "Slovenia": "Europe",
  "Bosnia and Herzegovina": "Europe", "Montenegro": "Europe", "Albania": "Europe",
  "North Macedonia": "Europe", "Macedonia": "Europe", "Kosovo": "Europe",
  "Moldova": "Europe", "Latvia": "Europe", "Lithuania": "Europe", "Estonia": "Europe",
  "Russia": "Europe", "Russian Federation": "Europe", "Ukraine": "Europe",
  "Belarus": "Europe", "Sweden": "Europe", "Norway": "Europe", "Denmark": "Europe",
  "Finland": "Europe", "Iceland": "Europe", "Malta": "Europe", "Cyprus": "Europe",
  "Luxembourg": "Europe", "Liechtenstein": "Europe", "Monaco": "Europe",
  "Andorra": "Europe", "San Marino": "Europe", "Vatican City": "Europe",
  "United States": "Americas", "USA": "Americas", "U.S.A.": "Americas",
  "Canada": "Americas", "Mexico": "Americas", "Brazil": "Americas",
  "Argentina": "Americas", "Chile": "Americas", "Colombia": "Americas",
  "Peru": "Americas", "Venezuela": "Americas", "Ecuador": "Americas",
  "Bolivia": "Americas", "Paraguay": "Americas", "Uruguay": "Americas",
  "China": "Asia", "People's Republic of China": "Asia",
  "Japan": "Asia", "South Korea": "Asia", "Korea, Republic of": "Asia",
  "North Korea": "Asia", "Mongolia": "Asia", "Taiwan": "Asia",
  "Hong Kong": "Asia", "Macao": "Asia",
  "Singapore": "Asia", "Malaysia": "Asia", "Indonesia": "Asia",
  "Thailand": "Asia", "Vietnam": "Asia", "Philippines": "Asia",
  "India": "Asia", "Pakistan": "Asia", "Bangladesh": "Asia",
  "Nepal": "Asia", "Sri Lanka": "Asia", "Afghanistan": "Asia",
  "Turkey": "Asia", "Türkiye": "Asia",
  "Saudi Arabia": "Asia", "United Arab Emirates": "Asia", "Qatar": "Asia",
  "Kuwait": "Asia", "Bahrain": "Asia", "Oman": "Asia", "Yemen": "Asia",
  "Jordan": "Asia", "Lebanon": "Asia", "Syria": "Asia", "Iraq": "Asia",
  "Iran": "Asia", "Israel": "Asia", "Palestine": "Asia",
  "Armenia": "Asia", "Azerbaijan": "Asia", "Georgia": "Asia",
  "Kazakhstan": "Asia", "Uzbekistan": "Asia", "Turkmenistan": "Asia",
  "Kyrgyzstan": "Asia", "Tajikistan": "Asia",
  "Australia": "Asia", "New Zealand": "Asia",
};

/**
 * 根据 countryCode 和 country 推断赛区
 * 优先 countryCode，兜底 country 名称；均无法识别则返回 "Other"
 */
function determineRegion(countryCode, country) {
  if (countryCode) {
    const code = countryCode.trim().toUpperCase();
    if (EUROPE_CODES.has(code)) return 'Europe';
    if (AMERICAS_CODES.has(code)) return 'Americas';
    if (ASIA_CODES.has(code)) return 'Asia';
  }
  if (country) {
    const mapped = COUNTRY_NAME_REGION[country.trim()];
    if (mapped) return mapped;
  }
  return 'Other';
}

// 导入前需要删除的无意义统计字段（爬虫原始数据中这些值均为 0）
const DROP_FIELDS = ['roundSwing', 'dpr', 'kast', 'multiKill', 'adr', 'kpr', 'firepower'];

/**
 * 国家英文名 → 中文 翻译映射
 * 复制自 crawler/clean_playerbase_region.py，与本地清洗逻辑保持一致
 */
const COUNTRY_EN_TO_CN = {
  // 欧洲
  "United Kingdom": "英国", "UK": "英国", "Great Britain": "英国",
  "England": "英格兰", "Scotland": "苏格兰", "Wales": "威尔士",
  "Northern Ireland": "北爱尔兰", "Ireland": "爱尔兰", "Republic of Ireland": "爱尔兰",
  "France": "法国", "Germany": "德国", "Spain": "西班牙", "Italy": "意大利",
  "Portugal": "葡萄牙", "Netherlands": "荷兰", "Belgium": "比利时",
  "Switzerland": "瑞士", "Austria": "奥地利", "Poland": "波兰",
  "Czech Republic": "捷克", "Czechia": "捷克", "Slovakia": "斯洛伐克",
  "Hungary": "匈牙利", "Romania": "罗马尼亚", "Bulgaria": "保加利亚", "Greece": "希腊",
  "Croatia": "克罗地亚", "Serbia": "塞尔维亚", "Slovenia": "斯洛文尼亚",
  "Bosnia and Herzegovina": "波黑",
  "Montenegro": "黑山", "Albania": "阿尔巴尼亚",
  "North Macedonia": "北马其顿", "Macedonia": "北马其顿", "Kosovo": "科索沃地区",
  "Moldova": "摩尔多瓦", "Latvia": "拉脱维亚", "Lithuania": "立陶宛", "Estonia": "爱沙尼亚",
  "Russia": "俄罗斯", "Russian Federation": "俄罗斯", "Ukraine": "乌克兰",
  "Belarus": "白俄罗斯",
  "Sweden": "瑞典", "Norway": "挪威", "Denmark": "丹麦",
  "Finland": "芬兰", "Iceland": "冰岛", "Malta": "马耳他", "Cyprus": "塞浦路斯",
  "Luxembourg": "卢森堡", "Liechtenstein": "列支敦士登", "Monaco": "摩纳哥",
  "Andorra": "安道尔", "San Marino": "圣马力诺", "Vatican City": "梵蒂冈",
  // 美洲
  "United States": "美国", "USA": "美国", "U.S.A.": "美国",
  "Canada": "加拿大", "Mexico": "墨西哥",
  "Brazil": "巴西", "Argentina": "阿根廷", "Chile": "智利",
  "Colombia": "哥伦比亚", "Peru": "秘鲁", "Venezuela": "委内瑞拉",
  "Ecuador": "厄瓜多尔", "Bolivia": "玻利维亚", "Paraguay": "巴拉圭",
  "Uruguay": "乌拉圭",
  "Costa Rica": "哥斯达黎加", "Panama": "巴拿马", "Cuba": "古巴",
  "Jamaica": "牙买加", "Dominican Republic": "多米尼加",
  "Trinidad and Tobago": "特立尼达和多巴哥",
  // 亚洲
  "China": "中国", "People's Republic of China": "中国",
  "Japan": "日本", "South Korea": "韩国", "Korea, Republic of": "韩国",
  "North Korea": "朝鲜", "Mongolia": "蒙古", "Taiwan": "中国台湾",
  "Hong Kong": "中国香港", "Macao": "中国澳门",
  "Singapore": "新加坡", "Malaysia": "马来西亚", "Indonesia": "印度尼西亚",
  "Thailand": "泰国", "Vietnam": "越南", "Philippines": "菲律宾",
  "Myanmar": "缅甸", "Cambodia": "柬埔寨", "Laos": "老挝",
  "India": "印度", "Pakistan": "巴基斯坦", "Bangladesh": "孟加拉国",
  "Nepal": "尼泊尔", "Sri Lanka": "斯里兰卡", "Afghanistan": "阿富汗",
  "Turkey": "土耳其", "Türkiye": "土耳其",
  "Saudi Arabia": "沙特阿拉伯", "United Arab Emirates": "阿联酋", "Qatar": "卡塔尔",
  "Kuwait": "科威特", "Bahrain": "巴林", "Oman": "阿曼", "Yemen": "也门",
  "Jordan": "约旦", "Lebanon": "黎巴嫩", "Syria": "叙利亚", "Iraq": "伊拉克",
  "Iran": "伊朗", "Israel": "以色列", "Palestine": "巴勒斯坦",
  "Armenia": "亚美尼亚", "Azerbaijan": "阿塞拜疆", "Georgia": "格鲁吉亚",
  "Kazakhstan": "哈萨克斯坦", "Uzbekistan": "乌兹别克斯坦",
  "Turkmenistan": "土库曼斯坦", "Kyrgyzstan": "吉尔吉斯斯坦", "Tajikistan": "塔吉克斯坦",
  "Australia": "澳大利亚", "New Zealand": "新西兰",
  // 非洲
  "South Africa": "南非", "Egypt": "埃及", "Morocco": "摩洛哥",
  "Algeria": "阿尔及利亚", "Tunisia": "突尼斯", "Nigeria": "尼日利亚",
  "Kenya": "肯尼亚",
  // 补充（HLTV 数据中出现的特殊值）
  "Unknown": "未知",
};

/**
 * 将国家英文名翻译为中文，查不到时返回原文
 */
function translateCountry(countryEn) {
  if (!countryEn) return '';
  return COUNTRY_EN_TO_CN[countryEn.trim()] || countryEn;
}

/**
 * 安全解析数字，无法解析则返回默认值
 */
function safeInt(value, defaultVal = 0) {
  const n = parseInt(value, 10);
  return isNaN(n) ? defaultVal : n;
}

/**
 * 安全解析浮点数，无法解析则返回默认值
 */
function safeFloat(value, defaultVal = 0) {
  const n = parseFloat(value);
  return isNaN(n) ? defaultVal : n;
}

async function main() {
  // 与 server/db/pool.js 保持一致的 env var 优先级
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || process.env.MYSQLHOST || process.env.MYSQL_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || process.env.MYSQLPORT || process.env.MYSQL_PORT || '3306', 10),
    user: process.env.DB_USER || process.env.MYSQLUSER || process.env.MYSQL_USER || 'root',
    password: process.env.DB_PASS || process.env.MYSQLPASSWORD || process.env.MYSQL_PASSWORD || '',
    database: process.env.DB_NAME || process.env.MYSQLDATABASE || process.env.MYSQL_DATABASE || 'cs_match_pro',
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
    charset: 'utf8mb4',
  });

  // 清理旧数据：删除 game_id 不是纯数字的行（历史遗留的 nickname 型 game_id 脏数据）
  const [cleanResult] = await conn.execute(
    `DELETE FROM player WHERE game_id NOT REGEXP '^[0-9]+$'`
  );
  if (cleanResult.affectedRows > 0) {
    console.log(`🧹 已清理 ${cleanResult.affectedRows} 条旧数据（game_id 为昵称格式）\n`);
  }

  // 读取 playerbase.json（从 crawler 目录）
  const filePath = path.join(__dirname, '..', 'crawler', 'playerbase.json');
  if (!fs.existsSync(filePath)) {
    console.error('❌ playerbase.json 不存在，先运行爬虫合并步骤');
    process.exit(1);
  }

  const fileContent = fs.readFileSync(filePath, 'utf8');
  const lines = fileContent.split('\n').filter(l => l.trim());
  console.log(`📖 共读取 ${lines.length} 条选手数据\n`);

  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  let totalBatches = Math.ceil(lines.length / 50);

  for (let i = 0; i < lines.length; i += 50) {
    const batch = lines.slice(i, i + 50);
    const batchNum = Math.floor(i / 50) + 1;
    console.log(`处理第 ${batchNum}/${totalBatches} 批...`);

    for (const line of batch) {
      try {
        const p = JSON.parse(line);

        // _id 即是 HLTV 的 game_id
        const gameId = p._id || '';
        if (!gameId) { skipped++; continue; }

        // 删除无意义的统计字段（与本地清洗脚本 clean_playerbase_region.py 一致）
        for (const field of DROP_FIELDS) {
          delete p[field];
        }

        // 推断赛区（优先 countryCode，兜底 country 名称）
        const region = determineRegion(p.countryCode, p.country);

        const [result] = await conn.execute(
          `INSERT INTO player (
            game_id, name, real_name, age, country, country_code,
            current_team, former_teams, region, major_appearances,
            position, status, avatar, rating, sniping, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
          ON DUPLICATE KEY UPDATE
            name            = VALUES(name),
            real_name       = VALUES(real_name),
            age             = VALUES(age),
            country         = VALUES(country),
            country_code    = VALUES(country_code),
            current_team    = VALUES(current_team),
            former_teams    = VALUES(former_teams),
            region          = VALUES(region),
            major_appearances = VALUES(major_appearances),
            position        = VALUES(position),
            status          = VALUES(status),
            avatar          = VALUES(avatar),
            rating          = VALUES(rating),
            sniping         = VALUES(sniping),
            updated_at      = NOW()`,
          [
            gameId,
            p.name || '',
            p.realName || '',
            safeInt(p.age),
            translateCountry(p.country || ''),
            p.countryCode || '',
            p.team || '',
            JSON.stringify(p.formerTeams || []),
            region,
            safeInt(p.majorAppearances),
            p.position || '',
            p.status || 'unknown',
            p.avatar || null,
            safeFloat(p.rating),
            safeFloat(p.sniping),
          ]
        );

        if (result.affectedRows === 1) {
          inserted++;
        } else {
          updated++;
        }
      } catch (err) {
        const name = (() => { try { return JSON.parse(line).name; } catch { return '?'; } })();
        console.error(`  ⚠️  导入失败 [${name}]: ${err.message}`);
        skipped++;
      }
    }

    // 避免写入过快
    await new Promise(r => setTimeout(r, 200));
  }

  await conn.end();

  console.log('\n✅ 选手数据导入完成！');
  console.log(`   新增: ${inserted}`);
  console.log(`   更新: ${updated}`);
  console.log(`   跳过: ${skipped}`);
}

main().catch(err => {
  console.error('❌ 执行错误:', err.message);
  process.exit(1);
});
