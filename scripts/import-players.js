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
 * 根据 country_code 推断地区
 */
function inferRegion(countryCode) {
  const europe = ['GB','DE','FR','SE','DK','NO','FI','PL','UA','RU','NL','BE','CH',
    'AT','IT','ES','PT','CZ','SK','HU','RO','BG','RS','HR','BA','LT','LV','EE',
    'SI','AL','MK','ME','LU','MT','IS','IE','GR','TR','CY','GE','AM','AZ'];
  const americas = ['US','CA','BR','AR','MX','CL','CO','PE','UY','BO','EC','VE',
    'CR','PA','DO','JM','TT'];
  const asia = ['CN','KR','JP','AU','NZ','SG','MY','ID','PH','TH','VN','IN',
    'MN','KZ','UZ','KG','HK','TW','MO','QA','SA','AE','IL','JO','LB'];

  const code = countryCode.toUpperCase();
  if (europe.includes(code)) return 'Europe';
  if (americas.includes(code)) return 'Americas';
  if (asia.includes(code)) return 'Asia';
  return 'Other';
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
            p.country || '',
            p.countryCode || '',
            p.team || '',
            JSON.stringify(p.formerTeams || []),
            inferRegion(p.countryCode || ''),
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
