/**
 * 迁移脚本：将所有 HLTV 队标 URL 转为缩略图版本
 *
 * 在 Railway MySQL 中运行：
 *   node server/db/migration_normalize_logos.js
 *
 * 效果：
 *   https://img-cdn.hltv.org/teamlogo/xxx.png
 *   → https://img-cdn.hltv.org/teamlogo/xxx.png?ixlib=java-2.1.0&w=50
 */
const mysql = require('mysql2/promise');

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.MYSQL_HOST || process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.MYSQL_PORT || process.env.DB_PORT || '3306'),
    user: process.env.MYSQL_USER || process.env.DB_USER || 'root',
    password: process.env.MYSQL_PASSWORD || process.env.DB_PASS || '',
    database: process.env.MYSQL_DATABASE || process.env.DB_NAME || 'cs_match_pro',
    ssl: process.env.MYSQL_SSL ? { rejectUnauthorized: false } : undefined,
  });

  console.log('已连接数据库');

  // 获取所有有 HLTV logo 的战队
  const [rows] = await conn.query(
    `SELECT id, name, logo_url FROM team WHERE logo_url LIKE '%hltv.org%teamlogo%'`
  );
  console.log(`找到 ${rows.length} 个 HLTV 队标`);

  let updated = 0;
  for (const row of rows) {
    const oldUrl = row.logo_url;
    // 如果是 SVG 或者已有 w=50，跳过
    if (oldUrl.includes('.svg') || oldUrl.includes('w=50')) {
      console.log(`  跳过: ${row.name} (SVG 或已是缩略图)`);
      continue;
    }
    // 去掉 query params，加上缩略图参数
    const base = oldUrl.split('?')[0];
    const newUrl = `${base}?ixlib=java-2.1.0&w=50`;

    await conn.execute(
      'UPDATE team SET logo_url = ? WHERE id = ?',
      [newUrl, row.id]
    );
    console.log(`  ✓ ${row.name}: ${oldUrl.slice(0, 50)}... → ${newUrl.slice(0, 50)}...`);
    updated++;
  }

  console.log(`\n完成: 更新 ${updated}/${rows.length} 个队标`);
  await conn.end();
}

main().catch(err => {
  console.error('失败:', err.message);
  process.exit(1);
});
