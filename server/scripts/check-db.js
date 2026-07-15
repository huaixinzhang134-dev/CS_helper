/**
 * 检查数据库表结构
 * 用法: railway run node scripts/check-db.js
 */
const path = require('path');
const mysql = require('mysql2');

if (!process.env.MYSQLHOST) {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
}

const config = {
  host: process.env.MYSQLHOST || process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.MYSQLPORT || process.env.DB_PORT || '3306', 10),
  user: process.env.MYSQLUSER || process.env.DB_USER || 'root',
  password: process.env.MYSQLPASSWORD || process.env.DB_PASS || '',
  database: process.env.MYSQLDATABASE || process.env.DB_NAME || 'cs_match_pro',
};

async function run() {
  const connection = await mysql.createConnection(config).promise();
  try {
    const [rows] = await connection.query('SHOW TABLES');
    console.log('表列表:');
    for (const r of rows) {
      console.log(`  - ${Object.values(r)[0]}`);
    }

    const [userCols] = await connection.query('SHOW COLUMNS FROM users');
    console.log('\nusers 表列:');
    for (const c of userCols) {
      console.log(`  ${c.Field.padEnd(20)} ${c.Type.padEnd(30)} ${c.Default === null ? 'NULL' : c.Default}`);
    }
  } finally {
    await connection.end();
  }
}
run();
