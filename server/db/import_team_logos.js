/**
 * 从 team.sql 文件中提取队标 URL，更新到数据库
 * 按 team.name 匹配，只更新 logo_url 字段
 *
 * 运行:
 *   DB_PASS=你的密码 node server/db/import_team_logos.js
 */
const fs = require('fs');
const mysql = require('mysql2/promise');

async function main() {
  const filePath = process.argv[2] || 'C:\\Users\\50584\\Desktop\\team.sql';
  if (!fs.existsSync(filePath)) {
    console.error('文件不存在:', filePath);
    process.exit(1);
  }

  // 读取 SQL 文件，提取 (name, logo_url)
  const sql = fs.readFileSync(filePath, 'utf8');
  const regex = /INSERT INTO `team`[^)]+\)\s*VALUES\s*\((\d+),\s*'((?:[^']|'(?!,))*?)',\s*'((?:[^']|'(?!,))*?)'/g;
  const teams = [];
  let match;
  while ((match = regex.exec(sql)) !== null) {
    teams.push({ name: match[2], logoUrl: match[3] });
  }
  console.log(`从 SQL 中提取 ${teams.length} 个队伍`);

  // 连接数据库
  console.log(`正在连接 ${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || '3306'} ...`);
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'cs_match_pro',
    ssl: { rejectUnauthorized: false },
    connectTimeout: 15000,
  });

  let updated = 0, notFound = 0;
  for (const t of teams) {
    const name = t.name.replace(/''/g, "'");
    const [result] = await conn.execute(
      'UPDATE team SET logo_url = ? WHERE name = ?',
      [t.logoUrl, name]
    );
    if (result.affectedRows > 0) updated++;
    else notFound++;
  }

  console.log(`\n完成: 更新 ${updated} 个，未匹配 ${notFound} 个`);
  await conn.end();
}

main().catch(err => { console.error('失败:', err.message); process.exit(1); });
