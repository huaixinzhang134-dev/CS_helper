/**
 * 数据库迁移脚本
 * 用法：node scripts/run-migration.js <sql文件路径>
 * 例如：node scripts/run-migration.js server/migrations/004_coins_voting.sql
 */
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
require(path.join(__dirname, '..', 'server', 'node_modules', 'dotenv'))
  .config({ path: path.join(__dirname, '..', 'server', '.env') });

async function run() {
  const sqlFile = process.argv[2];
  if (!sqlFile) {
    console.error('用法: node scripts/run-migration.js <sql文件路径>');
    process.exit(1);
  }

  const sqlPath = path.resolve(sqlFile);
  if (!fs.existsSync(sqlPath)) {
    console.error(`文件不存在: ${sqlPath}`);
    process.exit(1);
  }

  const config = {
    host: process.env.DB_HOST || process.env.MYSQLHOST || process.env.MYSQL_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || process.env.MYSQLPORT || process.env.MYSQL_PORT || '3306', 10),
    user: process.env.DB_USER || process.env.MYSQLUSER || process.env.MYSQL_USER || 'root',
    password: process.env.DB_PASS || process.env.MYSQLPASSWORD || process.env.MYSQL_PASSWORD || '',
    database: process.env.DB_NAME || process.env.MYSQLDATABASE || process.env.MYSQL_DATABASE || 'cs_match_pro',
    multipleStatements: true,
    timezone: '+08:00',
  };

  console.log(`连接到 ${config.host}:${config.port}/${config.database} ...`);

  const connection = await mysql.createConnection(config);

  try {
    const sql = fs.readFileSync(sqlPath, 'utf-8');
    console.log(`执行迁移文件: ${path.basename(sqlPath)}`);

    await connection.query(sql);

    console.log('✅ 迁移成功完成！');
  } catch (err) {
    console.error('❌ 迁移失败:', err.message);
    process.exit(1);
  } finally {
    await connection.end();
  }
}

run();
