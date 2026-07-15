/**
 * 将 valve_ranking.json 导入 Railway MySQL
 * 运行: node scripts/import_ranking.js
 */
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

async function main() {
  // 与 server/db/pool.js 保持一致的 env var 优先级
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || process.env.MYSQLHOST || process.env.MYSQL_HOST || 'hayabusa.proxy.rlwy.net',
    port: parseInt(process.env.DB_PORT || process.env.MYSQLPORT || process.env.MYSQL_PORT || '16612', 10),
    user: process.env.DB_USER || process.env.MYSQLUSER || process.env.MYSQL_USER || 'root',
    password: process.env.DB_PASS || process.env.MYSQLPASSWORD || process.env.MYSQL_PASSWORD || '',
    database: process.env.DB_NAME || process.env.MYSQLDATABASE || process.env.MYSQL_DATABASE || 'railway',
    ssl: { rejectUnauthorized: false }
  });

  // 读取 valve_ranking.json
  const filePath = path.join(__dirname, '..', 'crawler', 'valve_ranking.json');
  if (!fs.existsSync(filePath)) {
    console.error('valve_ranking.json 不存在，先运行爬虫');
    process.exit(1);
  }

  const lines = fs.readFileSync(filePath, 'utf8').trim().split('\n');
  let inserted = 0;

  for (const line of lines) {
    try {
      const item = JSON.parse(line);
      await conn.execute(
        `INSERT INTO team_ranking (ranking, team_name, team_id, hltv_team_id, points, logo_url)
         VALUES (?, ?, NULL, ?, ?, ?)
         ON DUPLICATE KEY UPDATE ranking = VALUES(ranking), points = VALUES(points), logo_url = VALUES(logo_url)`,
        [item.ranking, item.name, item.teamId || '', item.points || '', item.logo || '']
      );
      // 同步更新 team 表的队标（如果存在该队伍）
      if (item.logo) {
        await conn.execute(
          `UPDATE team SET logo_url = ? WHERE name = ? AND (logo_url IS NULL OR logo_url != ?)`,
          [item.logo, item.name, item.logo]
        );
      }
      inserted++;
    } catch {}
  }

  console.log(`✅ 排名数据导入完成: ${inserted} 条`);

  // 如果存在 team_details.json（全量爬取产出），更新队标为详情页高质量版
  const detailsPath = path.join(__dirname, '..', 'crawler', 'team_details.json');
  if (fs.existsSync(detailsPath)) {
    const details = JSON.parse(fs.readFileSync(detailsPath, 'utf8'));
    let logoUpdated = 0;
    for (const team of details) {
      if (!team.logo) continue;
      const [result] = await conn.execute(
        `UPDATE team SET logo_url = ? WHERE name = ? AND logo_url != ?`,
        [team.logo, team.name, team.logo]
      );
      if (result.affectedRows > 0) logoUpdated++;
    }
    console.log(`✅ 队标更新完成: ${logoUpdated}/${details.length} 条`);
  }

  await conn.end();
}

main().catch(e => { console.error(e.message); process.exit(1); });
