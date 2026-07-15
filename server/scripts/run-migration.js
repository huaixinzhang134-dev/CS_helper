/**
 * 数据库迁移脚本
 * 用法: railway run node scripts/run-migration.js <sql文件路径>
 */
const path = require('path');
const fs = require('fs');
const mysql = require('mysql2');

// 仅当 Railway 环境变量不存在时才加载本地 .env
if (!process.env.MYSQLHOST) {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
}

const config = {
  host: process.env.MYSQLHOST || process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.MYSQLPORT || process.env.DB_PORT || '3306', 10),
  user: process.env.MYSQLUSER || process.env.DB_USER || 'root',
  password: process.env.MYSQLPASSWORD || process.env.DB_PASS || '',
  database: process.env.MYSQLDATABASE || process.env.DB_NAME || 'cs_match_pro',
  charset: 'utf8mb4',
  timezone: '+08:00',
};

async function run() {
  const sqlFile = process.argv[2];
  if (!sqlFile) {
    console.error('用法: railway run node scripts/run-migration.js <sql文件路径>');
    process.exit(1);
  }

  const sqlPath = path.resolve(sqlFile);
  if (!fs.existsSync(sqlPath)) {
    console.error(`文件不存在: ${sqlPath}`);
    process.exit(1);
  }

  console.log(`连接到 ${config.host}:${config.port}/${config.database} ...`);

  const connection = await mysql.createConnection(config).promise();

  try {
    const rawSql = fs.readFileSync(sqlPath, 'utf-8');

    // 按行处理：移除单行注释，保留有效 SQL
    // 然后按 ; 分割为独立语句
    const lines = rawSql.split('\n').filter(line => !line.trim().startsWith('--'));
    const fullSql = lines.join('\n').trim();

    // 分割为独立语句
    const statements = fullSql
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0);

    console.log(`共 ${statements.length} 条语句\n`);

    let success = 0, skip = 0, fail = 0;

    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i];
      try {
        await connection.query(stmt);
        success++;
        const preview = stmt.replace(/\s+/g, ' ').substring(0, 70);
        console.log(`  [${i+1}/${statements.length}] ✅ ${preview}`);
      } catch (err) {
        // 幂等错误：列/表/索引已存在，或删除不存在的表
        if ([1050, 1060, 1061, 1091].includes(err.errno)) {
          skip++;
          console.log(`  [${i+1}/${statements.length}] ⏭️  跳过 (${err.errno}): ${err.message.substring(0, 60)}`);
        } else {
          fail++;
          console.log(`  [${i+1}/${statements.length}] ❌ ${err.message.substring(0, 120)}`);
        }
      }
    }

    console.log(`\n✅ 迁移完成! 成功=${success} 跳过=${skip} 失败=${fail}`);
    process.exit(fail > 0 ? 1 : 0);
  } catch (err) {
    console.error('❌ 迁移失败:', err.message);
    process.exit(1);
  } finally {
    await connection.end();
  }
}

run();
