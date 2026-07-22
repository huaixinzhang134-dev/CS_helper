/**
 * 数据库迁移运行器
 * 运行: node scripts/migrate.js
 *
 * 工作方式：
 * 1. 在数据库中创建 _migrations 表记录已应用的迁移
 * 2. 读取 server/migrations/ 下的 .sql 文件，按编号升序执行
 * 3. 每个迁移只执行一次
 */
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

async function main() {
  // 与 server/db/pool.js 一致的连接参数
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'cs_match_pro',
    ssl: process.env.SSL === 'true' ? { rejectUnauthorized: false } : undefined,
    charset: 'utf8mb4',
    multipleStatements: true,  // 允许一个 SQL 文件包含多条语句
  });

  console.log(`📦 已连接 ${process.env.DB_HOST || 'localhost'}`);

  // 1. 创建迁移记录表
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id          INT UNSIGNED    NOT NULL AUTO_INCREMENT,
      version     VARCHAR(32)     NOT NULL,
      name        VARCHAR(255)    NOT NULL DEFAULT '',
      applied_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uk_migration_version (version)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // 2. 查询已应用的迁移
  const [applied] = await conn.execute('SELECT version FROM _migrations ORDER BY version');
  const appliedSet = new Set(applied.map(r => r.version));
  console.log(`📋 已应用 ${appliedSet.size} 个迁移`);

  // 3. 读取 migration 文件
  const migrationsDir = path.join(__dirname, '..', 'server', 'migrations');
  if (!fs.existsSync(migrationsDir)) {
    console.log('❌ migrations 目录不存在');
    process.exit(1);
  }

  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();  // 按文件名升序（001_xxx → 002_xxx）

  let appliedCount = 0;

  for (const file of files) {
    const version = file.replace(/\.sql$/, '');
    if (appliedSet.has(version)) {
      console.log(`  ⏭  ${file} (已应用，跳过)`);
      continue;
    }

    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    console.log(`  ▶  应用 ${file}...`);

    try {
      await conn.query(sql);                        // 执行迁移 SQL
      await conn.execute(                            // 记录到 _migrations
        'INSERT INTO _migrations (version, name) VALUES (?, ?)',
        [version, file]
      );
      console.log(`  ✅ ${file} 完成`);
      appliedCount++;
    } catch (err) {
      console.error(`  ❌ ${file} 失败: ${err.message}`);
      process.exit(1);
    }
  }

  await conn.end();

  console.log(`\n🎉 迁移完成！新增 ${appliedCount} 个，共 ${appliedSet.size + appliedCount} 个迁移`);
}

main().catch(err => {
  console.error('❌ 迁移失败:', err.message);
  process.exit(1);
});
