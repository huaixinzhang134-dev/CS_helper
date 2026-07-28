#!/usr/bin/env node
/**
 * 导入初始绰号数据到数据库
 *
 * 从 nicknames.json 读取已知绰号，写入 team/player 表的 alias 字段
 *
 * 用法：
 *   DB_PASS=Yx201005 node scripts/import_nicknames.js
 *   DB_PASS=Yx201005 node scripts/import_nicknames.js --dry-run   # 只预览不写入
 */

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const NICKNAMES_PATH = path.join(__dirname, '..', 'crawler', 'nicknames.json');

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const data = JSON.parse(fs.readFileSync(NICKNAMES_PATH, 'utf-8'));

  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT || '3306'),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'cs_match_pro',
  });

  let playerUpdated = 0, playerNotFound = 0;
  let teamUpdated = 0, teamNotFound = 0;

  // ---- 导入选手绰号 ----
  console.log(`\n==> 导入 ${data.players.length} 个选手绰号...`);
  for (const p of data.players) {
    const aliases = JSON.stringify(p.aliases);
    if (dryRun) {
      console.log(`  [预览] ${p.name} → ${p.aliases.join(', ')}`);
      continue;
    }
    const [result] = await conn.execute(
      "UPDATE player SET alias = ? WHERE name = ?",
      [aliases, p.name]
    );
    if (result.affectedRows > 0) {
      playerUpdated++;
      console.log(`  ✓ ${p.name} → ${p.aliases.join(', ')}`);
    } else {
      playerNotFound++;
      console.log(`  ? ${p.name} 未在数据库中找到`);
    }
  }

  // ---- 导入战队绰号 ----
  console.log(`\n==> 导入 ${data.teams.length} 个战队绰号...`);
  for (const t of data.teams) {
    const aliases = JSON.stringify(t.aliases);
    if (dryRun) {
      console.log(`  [预览] ${t.name} → ${t.aliases.join(', ')}`);
      continue;
    }
    const [result] = await conn.execute(
      "UPDATE team SET alias = ? WHERE name = ?",
      [aliases, t.name]
    );
    if (result.affectedRows > 0) {
      teamUpdated++;
      console.log(`  ✓ ${t.name} → ${t.aliases.join(', ')}`);
    } else {
      teamNotFound++;
      console.log(`  ? ${t.name} 未在数据库中找到`);
    }
  }

  await conn.end();

  console.log(`\n=== 导入完成 ===`);
  console.log(`选手: ${playerUpdated} 更新, ${playerNotFound} 未匹配`);
  console.log(`战队: ${teamUpdated} 更新, ${teamNotFound} 未匹配`);
}

main().catch(err => { console.error(err); process.exit(1); });
