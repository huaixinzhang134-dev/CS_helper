/**
 * 数据库迁移脚本（直连 Railway 公网地址）
 * 用法: node scripts/run-migration-tunnel.js <sql文件路径>
 */
const path = require('path');
const fs = require('fs');
const mysql = require('mysql2/promise');

// Railway MySQL 公网地址
const config = {
  host: 'mysql-production-0b76.up.railway.app',
  port: 3306,
  user: 'root',
  password: 'ojfZTZhWxfsJgcnKswraKulftkRjbOLG',
  database: 'railway',
};

async function run() {
  const sqlFile = process.argv[2];
  if (!sqlFile) {
    console.error('用法: node scripts/run-migration-tunnel.js <sql文件路径>');
    process.exit(1);
  }

  const sqlPath = path.resolve(sqlFile);
  if (!fs.existsSync(sqlPath)) {
    console.error(`文件不存在: ${sqlPath}`);
    process.exit(1);
  }

  console.log(`连接到 ${config.host}:${config.port}/${config.database} ...`);

  const connection = await mysql.createConnection(config);

  try {
    const rawSql = fs.readFileSync(sqlPath, 'utf-8');

    // 移除注释行，按 ; 分割为独立语句
    const statements = rawSql
      .split('\n')
      .filter(line => !line.trim().startsWith('--'))
      .join('\n')
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
        if ([1050, 1060, 1061, 1091].includes(err.errno)) {
          skip++;
          console.log(`  [${i+1}/${statements.length}] ⏭️  跳过 (${err.errno})`);
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
