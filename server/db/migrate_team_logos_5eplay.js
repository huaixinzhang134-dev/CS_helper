/**
 * 历史数据迁移：旧版 sync.js 曾把 5eplay 队标写进 team.logo_url（自动创建新队伍时），
 * 新版已改为只写 logo_5eplay。本脚本把 logo_url 中非 hltv.org 域名的 URL（即 5eplay/第三方来源）
 * 迁移到 logo_5eplay，logo_url 置空等 HLTV 爬虫补充，保证 logo_url 只存 HLTV 队标。
 *
 * 识别规则：HLTV 相关导入（import_team_logos.js / crawl_ranking.js / import_ranking.js）
 * 写入的 logo_url 域名均为 hltv.org，非该域名的视为 5eplay/第三方来源。
 *
 * 保守策略：
 *   - logo_5eplay 为空 → 迁移（这些几乎都是旧版 sync.js 写入的 5eplay URL）
 *   - logo_5eplay 已有值且不同 → 不迁移也不清空，仅打印提示（可能是管理员手动设置的，人工确认）
 *
 * 运行（默认 dry-run 只打印，加 --apply 才执行）:
 *   DB_PASS=你的密码 node server/db/migrate_team_logos_5eplay.js [--apply]
 */
const mysql = require('mysql2/promise');

async function main() {
  const apply = process.argv.includes('--apply');

  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'cs_match_pro',
    ssl: { rejectUnauthorized: false },
    connectTimeout: 15000,
  });

  const [rows] = await conn.execute(
    `SELECT id, name, logo_url, logo_5eplay
     FROM team
     WHERE logo_url IS NOT NULL AND logo_url != ''`
  );

  const candidates = rows.filter(r => !r.logo_url.includes('hltv.org'));
  console.log(`扫描到 ${rows.length} 条有 logo_url 的队伍，其中 ${candidates.length} 条非 hltv.org 域名：`);

  let migratable = 0;
  let warn = 0;
  for (const r of candidates) {
    if (!r.logo_5eplay) {
      migratable++;
      console.log(`  [迁移] #${r.id} ${r.name}`);
      console.log(`    logo_url:    ${r.logo_url}`);
      console.log(`    → logo_5eplay`);
    } else {
      warn++;
      console.log(`  [跳过] #${r.id} ${r.name}（logo_5eplay 已有值，需人工确认）`);
      console.log(`    logo_url:    ${r.logo_url}`);
      console.log(`    logo_5eplay: ${r.logo_5eplay}`);
    }
  }

  if (migratable === 0) {
    console.log(`\n没有需要迁移的队伍。`);
    await conn.end();
    return;
  }

  if (!apply) {
    console.log(`\n✅ dry-run 完成：可迁移 ${migratable} 条，需人工确认 ${warn} 条。`);
    console.log(`确认无误后加 --apply 执行：DB_PASS=... node server/db/migrate_team_logos_5eplay.js --apply`);
    await conn.end();
    return;
  }

  let done = 0;
  for (const r of candidates) {
    if (r.logo_5eplay) continue; // 保守：不碰已有 logo_5eplay 的
    await conn.execute(
      'UPDATE team SET logo_5eplay = ?, logo_url = NULL WHERE id = ?',
      [r.logo_url, r.id]
    );
    done++;
  }

  console.log(`\n✅ 迁移完成: ${done}/${migratable} 条，logo_url 已置空等待 HLTV 爬虫补充。`);
  await conn.end();
}

main().catch(err => { console.error('失败:', err.message); process.exit(1); });
