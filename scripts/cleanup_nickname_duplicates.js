#!/usr/bin/env node
/**
 * 清理重名选手被误刷的绰号（一次性修复脚本）
 *
 * 背景：player 表存在大小写不同但同名的多个不同选手
 * （如 niko / NiKo / Niko，game_id 各不相同且各是唯一索引下的独立 HLTV 选手）。
 * 旧版 import_nicknames.js 用 `UPDATE player SET alias = ? WHERE name = ?` 导入，
 * utf8mb4_unicode_ci 排序规则大小写不敏感，一次命中全部同名行，
 * 导致同一个绰号被错误地打在多个重名选手身上。
 *
 * 判定规则（每个大小写不敏感的重名组）：
 *   保留 —— 有 status='approved' 的 nickname_suggestions 的选手（合法审核目标）；
 *            名字与 nicknames.json 大小写精确一致的选手（官方目标）；
 *            歧义表 AMBIGUOUS_GAME_ID 中的名字还必须匹配对应 game_id，
 *            例如 rain → gid 8183（挪威/rating 1.04，FaZe 的 rain），其余 rain 行一律清理。
 *   清空 —— 其余【有绰号】的行（别名只可能来自旧版批量导入的误刷，审核记录里查不到对应建议）。
 *   跳过 —— 无法判定（组内没有任何保留理由）时跳过并警告，请手动处理。
 *   无绰号的行：不做任何更改，也不参与检测/报告。
 *
 * 用法：
 *   DB_PASS=xxx node scripts/cleanup_nickname_duplicates.js          # dry-run 只打印
 *   DB_PASS=xxx node scripts/cleanup_nickname_duplicates.js --apply  # 实际清空
 */

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const NICKNAMES_PATH = path.join(__dirname, '..', 'crawler', 'nicknames.json');

async function main() {
  const apply = process.argv.includes('--apply');
  const data = JSON.parse(fs.readFileSync(NICKNAMES_PATH, 'utf-8'));
  const jsonPlayerNames = new Set(data.players.map(p => p.name));

  // 重名歧义表：player 表存在多条名字完全相同（或大小写不同）但并非同一人的选手行，
  // 仅凭名字无法判定官方目标时，用 game_id（HLTV 选手 ID）精确定位。
  // rain：gid 8183（挪威，rating 1.04）才是 FaZe 的 rain，其余 rain 行全部清理。
  const AMBIGUOUS_GAME_ID = {
    'rain': '8183',
  };

  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT || '3306'),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'cs_match_pro',
  });

  // 1. 全量选手
  const [players] = await conn.execute(
    "SELECT id, name, game_id, alias FROM player ORDER BY id ASC"
  );

  // 2. 有审核通过记录的选手 id（合法目标）
  const [approvedRows] = await conn.execute(
    "SELECT DISTINCT target_id FROM nickname_suggestions WHERE target_type = 'player' AND status = 'approved'"
  );
  const approvedIds = new Set(approvedRows.map(r => String(r.target_id)));

  // 3. 按大小写不敏感名字分组，找出重名组
  const groups = new Map();
  for (const p of players) {
    const key = p.name.toLowerCase();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }

  let groupCount = 0, cleared = 0, skipped = 0;
  console.log(apply ? '==> 执行清理（--apply）' : '==> 预演模式（dry-run，加 --apply 才会写入）');

  for (const [key, rows] of groups) {
    if (rows.length < 2) continue;
    groupCount++;

    // 保留理由：有审核通过记录；或名字与 nicknames.json 大小写精确一致
    // （歧义表中的名字还必须匹配对应 game_id，如 rain → gid 8183）
    const keep = rows.filter(r => {
      if (approvedIds.has(String(r.id))) return true;
      if (!jsonPlayerNames.has(r.name)) return false;
      const gid = AMBIGUOUS_GAME_ID[r.name];
      return gid ? String(r.game_id) === gid : true;
    });

    // 无绰号的行：不做更改也不检测，只有确实带别名的行才需要清理
    const hasAlias = r => {
      if (!r.alias) return false;
      try {
        const arr = typeof r.alias === 'string' ? JSON.parse(r.alias) : r.alias;
        return Array.isArray(arr) && arr.length > 0;
      } catch (_) { return true; }
    };
    const keepListed = keep.filter(hasAlias);
    const victims = rows.filter(r => !keep.includes(r) && hasAlias(r));

    const fmt = r => `${r.name}#${r.id} (gid=${r.game_id}) alias=${r.alias ? JSON.stringify(r.alias) : 'NULL'}`;

    if (!keep.length) {
      skipped++;
      console.log(`\n? 重名组 "${key}"（${rows.length} 人）无法判定目标，跳过，请手动处理:`);
      rows.filter(hasAlias).forEach(r => console.log(`    - ${fmt(r)}`));
      continue;
    }

    const aliasCount = rows.filter(hasAlias).length;
    console.log(`\n== 重名组 "${key}"（${rows.length} 人，其中 ${aliasCount} 人有绰号）`);
    console.log(`   保留（官方/已审核）:`);
    keepListed.forEach(r => console.log(`    ✓ ${fmt(r)}`));
    if (!victims.length) {
      console.log('   无需要清理的行');
      continue;
    }
    console.log(`   清理:`);
    victims.forEach(r => console.log(`    ✗ ${fmt(r)}`));

    if (!apply) continue;
    for (const v of victims) {
      await conn.execute("UPDATE player SET alias = NULL WHERE id = ?", [v.id]);
      cleared++;
    }
  }

  await conn.end();

  console.log(`\n=== 完成 ===`);
  console.log(`重名组: ${groupCount} 个`);
  console.log(`清空行: ${cleared} 条${apply ? '' : '（预演，未实际写入）'}`);
  console.log(`跳过组: ${skipped} 个（无法判定，需手动处理）`);
}

main().catch(err => { console.error(err); process.exit(1); });
