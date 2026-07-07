/**
 * 迁移脚本：修复数据库队标 URL
 * 1. 将已有代理地址恢复为原始 HLTV 地址（如有必要）
 * 2. 保留 CDN 签名参数（?ixlib=...&w=50&s=...）
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

  // 1. 把误改为代理地址的恢复为原始 HLTV URL
  const [rows1] = await conn.query(
    `SELECT id, name, logo_url FROM team WHERE logo_url LIKE '%/api/logo%'`
  );
  for (const row of rows1) {
    // 从代理地址中提取原始 URL
    const match = row.logo_url.match(/url=([^&]+)/);
    if (match) {
      const originalUrl = decodeURIComponent(match[1]);
      await conn.execute('UPDATE team SET logo_url = ? WHERE id = ?', [originalUrl, row.id]);
      console.log(`  ${row.name}: 恢复原始 URL`);
    }
  }

  // 2. 统计目前队标状态
  const [rows2] = await conn.query(
    `SELECT logo_url FROM team WHERE logo_url LIKE '%hltv.org%'`
  );
  const withSignature = rows2.filter(r => r.logo_url.includes('&s=')).length;
  const withoutSignature = rows2.filter(r => r.logo_url.includes('hltv.org') && !r.logo_url.includes('&s=') && !r.logo_url.includes('/api/logo')).length;
  console.log(`\nHLTV 队标: ${rows2.length} 个（含签名: ${withSignature}，无签名: ${withoutSignature}）`);
  if (withoutSignature > 0) {
    console.log('⚠ 无签名的 HLTV URL 可能会 403，建议使用带 CDN 签名的版本');
  }

  console.log('\n完成');
  await conn.end();
}

main().catch(err => { console.error('失败:', err.message); process.exit(1); });
