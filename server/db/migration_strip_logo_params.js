/**
 * 迁移脚本：将所有 HLTV 队标 URL 替换为后端代理地址
 * HLTV CDN 屏蔽外部请求（403），需通过 /api/logo 代理
 *
 * 运行: node server/db/migration_strip_logo_params.js
 *   API_BASE 环境变量可选，默认为 https://cshelper-production.up.railway.app
 */
const mysql = require('mysql2/promise');

const API_BASE = process.env.API_BASE || 'https://cshelper-production.up.railway.app';

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || process.env.MYSQLHOST || 'hayabusa.proxy.rlwy.net',
    port: parseInt(process.env.DB_PORT || process.env.MYSQLPORT || '16612', 10),
    user: process.env.DB_USER || process.env.MYSQLUSER || 'root',
    password: process.env.DB_PASS || process.env.MYSQLPASSWORD || '',
    database: process.env.DB_NAME || process.env.MYSQLDATABASE || 'railway',
    ssl: { rejectUnauthorized: false },
  });

  // 1. 先去 ?w=50 等 query 参数
  const [rows1] = await conn.query(
    `SELECT id, name, logo_url FROM team WHERE logo_url LIKE '%?%' AND logo_url LIKE '%hltv.org%'`
  );
  for (const row of rows1) {
    const newUrl = row.logo_url.split('?')[0];
    await conn.execute('UPDATE team SET logo_url = ? WHERE id = ?', [newUrl, row.id]);
    console.log(`  ${row.name}: 去掉 query 参数`);
  }

  // 2. 所有 HLTV 源队标改为后端代理地址
  const [rows2] = await conn.query(
    `SELECT id, name, logo_url FROM team WHERE logo_url LIKE '%hltv.org%'`
  );
  console.log(`\n需要代理的 HLTV 队标: ${rows2.length} 个`);

  let updated = 0;
  for (const row of rows2) {
    const proxyUrl = `${API_BASE}/api/logo?url=${encodeURIComponent(row.logo_url)}`;
    await conn.execute('UPDATE team SET logo_url = ? WHERE id = ?', [proxyUrl, row.id]);
    console.log(`  ${row.name}: → 代理地址`);
    updated++;
  }

  console.log(`\n完成: 更新 ${updated} 个队标为代理地址`);
  await conn.end();
}

main().catch(err => { console.error('失败:', err.message); process.exit(1); });
