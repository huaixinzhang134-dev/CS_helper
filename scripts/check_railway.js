/**
 * 检查 Railway MySQL 数据状态
 * 运行: railway run node scripts/check_railway.js
 */
const mysql = require('mysql2/promise');

async function main() {
  // Railway 环境变量（注意：无下划线）
  const conn = await mysql.createConnection({
    host: process.env.MYSQLHOST || process.env.MYSQL_HOST,
    port: parseInt(process.env.MYSQLPORT || process.env.MYSQL_PORT || '3306'),
    user: process.env.MYSQLUSER || process.env.MYSQL_USER || 'root',
    password: process.env.MYSQLPASSWORD || process.env.MYSQL_PASSWORD,
    database: process.env.MYSQLDATABASE || process.env.MYSQL_DATABASE || 'railway',
    ssl: { rejectUnauthorized: false }
  });

  const [tables] = await conn.execute('SHOW TABLES');
  console.log('📋 数据库中的表:');
  if (tables.length === 0) {
    console.log('  (空)');
  } else {
    for (const t of tables) {
      const name = Object.values(t)[0];
      const [cnt] = await conn.execute(`SELECT COUNT(*) AS c FROM \`${name}\``);
      console.log(`  ${name}: ${cnt[0].c} 行`);
    }
  }
  await conn.end();
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
