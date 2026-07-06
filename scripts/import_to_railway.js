/**
 * 导入 SQL 到 Railway MySQL（公网代理 + SSL）
 * 直接运行: node scripts/import_to_railway.js
 */
const mysql = require('mysql2/promise');
const fs = require('fs');

const SQL_FILE = 'C:\\Users\\50584\\Desktop\\cs_match_pro_clean.sql';

async function main() {
  const conn = await mysql.createConnection({
    host: 'hayabusa.proxy.rlwy.net',
    port: 16612,
    user: 'root',
    password: 'ojfZTZhWxfsJgcnKswraKulftkRjbOLG',
    database: 'railway',
    ssl: { rejectUnauthorized: false },
    charset: 'utf8mb4',
    multipleStatements: true
  });

  console.log('✅ 连接成功！正在导入...');

  const sql = fs.readFileSync(SQL_FILE, 'utf8');
  await conn.query(sql);

  console.log('🎉 导入完成！');
  await conn.end();
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
