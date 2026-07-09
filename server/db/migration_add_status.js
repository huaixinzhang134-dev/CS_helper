const mysql = require('mysql2/promise');

(async () => {
  const conn = await mysql.createConnection({
    host: 'hayabusa.proxy.rlwy.net',
    port: 16612,
    user: 'root',
    password: process.env.DB_PASS || process.env.MYSQLPASSWORD || '',
    database: 'railway',
    ssl: { rejectUnauthorized: false },
    connectTimeout: 10000
  });
  console.log('✅ 已连接 Railway MySQL\n');

  // ==========================================
  // Step 1: 加 status 字段
  // ==========================================
  console.log('Step 1: 添加 status 字段...');
  try {
    await conn.execute(
      `ALTER TABLE player
       ADD COLUMN status ENUM('active','retired','coach','free_agent','unknown')
       NOT NULL DEFAULT 'unknown'
       COMMENT '职业状态：active=在役,retired=退役,coach=教练,free_agent=自由人,unknown=未知'`
    );
    console.log('  ✅ status 字段已添加');
  } catch (e) {
    if (e.code === 'ER_DUP_FIELDNAME') {
      console.log('  ⚠️ status 字段已存在，跳过');
    } else {
      throw e;
    }
  }

  // 加索引
  try {
    await conn.execute('ALTER TABLE player ADD INDEX idx_player_status (status)');
    console.log('  ✅ idx_player_status 索引已添加');
  } catch (e) {
    if (e.code === 'ER_DUP_KEYNAME') {
      console.log('  ⚠️ 索引已存在，跳过');
    } else {
      console.log('  ⚠️ 索引添加失败:', e.message);
    }
  }

  // ==========================================
  // Step 2: 回填现有数据
  // ==========================================
  console.log('\nStep 2: 回填现有数据...');

  // 教练
  const [coachResult] = await conn.execute(
    "UPDATE player SET status = 'coach' WHERE position = '教练' AND status = 'unknown'"
  );
  console.log(`  position='教练' → status='coach': ${coachResult.affectedRows} 行`);

  // 有队伍的 → active
  const [activeResult] = await conn.execute(
    "UPDATE player SET status = 'active' WHERE current_team != '' AND status = 'unknown'"
  );
  console.log(`  current_team 非空 → status='active': ${activeResult.affectedRows} 行`);

  // ==========================================
  // Step 3: 验证
  // ==========================================
  console.log('\nStep 3: 验证结果...');
  const [dist] = await conn.execute(
    'SELECT status, COUNT(*) AS cnt FROM player GROUP BY status ORDER BY FIELD(status, "active","retired","coach","free_agent","unknown")'
  );
  console.log('\n=== status 分布 ===');
  for (const r of dist) {
    console.log(`  ${r.status.padEnd(16)} ${r.cnt}`);
  }

  const total = dist.reduce((s, r) => s + r.cnt, 0);
  console.log(`  ─────────────────`);
  console.log(`  ${'总计'.padEnd(16)} ${total}`);

  await conn.end();
  console.log('\n✅ 迁移完成');
})();
