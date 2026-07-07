/**
 * 迁移脚本：去掉 HLTV 队标 URL 中的 query 参数（?ixlib=...&w=50）
 * HLTV CDN 对无签名的缩放请求返回 403
 *
 * 运行: node server/db/migration_strip_logo_params.js
 */
const mysql = require('mysql2/promise');

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || process.env.MYSQLHOST || 'hayabusa.proxy.rlwy.net',
    port: parseInt(process.env.DB_PORT || process.env.MYSQLPORT || '16612', 10),
    user: process.env.DB_USER || process.env.MYSQLUSER || 'root',
    password: process.env.DB_PASS || process.env.MYSQLPASSWORD || '',
    database: process.env.DB_NAME || process.env.MYSQLDATABASE || 'railway',
    ssl: { rejectUnauthorized: false },
  });

  const [rows] = await conn.query(
    `SELECT id, name, logo_url FROM team WHERE logo_url LIKE '%?%' AND logo_url LIKE '%hltv.org%'`
  );
  console.log(`找到 ${rows.length} 个含 query 参数的 HLTV 队标`);

  let updated = 0;
  for (const row of rows) {
    const newUrl = row.logo_url.split('?')[0];
    await conn.execute('UPDATE team SET logo_url = ? WHERE id = ?', [newUrl, row.id]);
    console.log(`  ${row.name}: ${row.logo_url.slice(0, 60)}... → ${newUrl.slice(0, 60)}...`);
    updated++;
  }

  console.log(`\n完成: 更新 ${updated} 个队标`);
  await conn.end();
}

main().catch(err => { console.error('失败:', err.message); process.exit(1); });
