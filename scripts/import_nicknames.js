#!/usr/bin/env node
/**
 * 导入初始绰号数据到数据库
 *
 * 从 nicknames.json 读取已知绰号，写入 team/player 表的 alias 字段
 * 匹配规则：精确 → 忽略大小写 → 去除词组前缀（Team/Clan/Esports/Gaming）
 *
 * 用法：
 *   DB_PASS=Yx201005 node scripts/import_nicknames.js
 *   DB_PASS=Yx201005 node scripts/import_nicknames.js --dry-run
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
  // 注意：必须按唯一 id 定位选手，不能按 name 匹配。
  // player 表存在大小写不同但同名的多个不同选手（如 niko / NiKo / Niko，game_id 各不相同），
  // 而 utf8mb4_unicode_ci 排序规则大小写不敏感，WHERE name = ? 会一次命中所有同名行，
  // 导致绰号被错误地打在所有重名选手身上。
  console.log(`\n==> 导入 ${data.players.length} 个选手绰号...`);
  for (const p of data.players) {
    // 1. 大小写精确匹配（nicknames.json 中的名字与 HLTV 官方名一致，唯一对应）
    let [rows] = await conn.execute(
      "SELECT id, name, alias FROM player WHERE name = ? COLLATE utf8mb4_bin LIMIT 1",
      [p.name]
    );
    if (!rows.length) {
      // 2. 回退：大小写不敏感匹配，仅当结果唯一时才采用
      [rows] = await conn.execute(
        "SELECT id, name, alias FROM player WHERE LOWER(name) = LOWER(?)",
        [p.name]
      );
      if (rows.length > 1) {
        console.log(`  ! ${p.name} 大小写不敏感匹配到 ${rows.length} 个选手（${rows.map(r => `${r.name}#${r.id}`).join(', ')}），无法唯一对应，跳过，请手动处理`);
        continue;
      }
    }
    if (!rows.length) {
      playerNotFound++;
      console.log(`  ? ${p.name} 未在数据库中找到`);
      continue;
    }
    const row = rows[0];

    // 合并而非覆盖：保留已审核通过的绰号，只追加缺失的
    let current = [];
    if (row.alias) {
      try {
        current = typeof row.alias === 'string' ? JSON.parse(row.alias) : row.alias;
      } catch (_) { current = []; }
    }
    if (!Array.isArray(current)) current = [];
    let changed = false;
    for (const a of p.aliases) {
      if (!current.includes(a)) { current.push(a); changed = true; }
    }

    if (dryRun) {
      console.log(`  [预览] ${row.name} (id=${row.id}) → ${current.join(', ')}`);
      continue;
    }
    if (!changed) {
      console.log(`  - ${row.name} (id=${row.id}) 已有全部绰号，无变更`);
      continue;
    }
    const [result] = await conn.execute(
      "UPDATE player SET alias = ? WHERE id = ?",
      [JSON.stringify(current), row.id]
    );
    if (result.affectedRows > 0) {
      playerUpdated++;
      console.log(`  ✓ ${row.name} (id=${row.id}) → ${current.join(', ')}`);
    }
  }

  // ---- 导入战队绰号（支持模糊匹配） ----
  // 先获取所有数据库中的战队名
  const [allTeams] = await conn.execute("SELECT id, name FROM team");
  const [allRankings] = await conn.execute(
    "SELECT DISTINCT team_name FROM team_ranking"
  );
  const dbTeamNames = allTeams.map(r => r.name);
  const rankingNames = allRankings.map(r => r.team_name);

  console.log(`\n==> 导入 ${data.teams.length} 个战队绰号...`);
  for (const t of data.teams) {
    const aliases = JSON.stringify(t.aliases);
    const matchedName = fuzzyMatch(t.name, dbTeamNames, rankingNames);

    if (!matchedName) {
      teamNotFound++;
      console.log(`  ? ${t.name} 未在数据库中找到`);
      continue;
    }
    if (dryRun) {
      console.log(`  [预览] ${t.name} → ${t.aliases.join(', ')} (→ ${matchedName})`);
      continue;
    }

    const [result] = await conn.execute(
      "UPDATE team SET alias = ? WHERE name = ?",
      [aliases, matchedName]
    );
    if (result.affectedRows > 0) {
      teamUpdated++;
      console.log(`  ✓ ${t.name} → ${t.aliases.join(', ')} (匹配: ${matchedName})`);
    } else {
      teamNotFound++;
      console.log(`  ? ${t.name} 匹配到 ${matchedName} 但更新失败`);
    }
  }

  await conn.end();

  console.log(`\n=== 导入完成 ===`);
  console.log(`选手: ${playerUpdated} 更新, ${playerNotFound} 未匹配`);
  console.log(`战队: ${teamUpdated} 更新, ${teamNotFound} 未匹配`);
}

/**
 * 模糊匹配队名：精确 → 忽略大小写 → 去前缀再忽略大小写 → team_ranking 表匹配
 */
function fuzzyMatch(name, dbTeamNames, rankingNames) {
  // 1. 精确匹配
  if (dbTeamNames.includes(name)) return name;

  const lowerName = name.toLowerCase();

  // 2. 忽略大小写匹配
  const exactCi = dbTeamNames.find(n => n.toLowerCase() === lowerName);
  if (exactCi) return exactCi;

  // 3. 去常见前缀后匹配（忽略大小写）
  const prefixes = ['Team ', 'Clan ', 'Esports ', 'Gaming '];
  for (const prefix of prefixes) {
    if (!lowerName.startsWith(prefix.toLowerCase())) continue;
    const strippedName = name.slice(prefix.length);
    const strippedLower = strippedName.toLowerCase();
    const strippedCi = dbTeamNames.find(n => n.toLowerCase() === strippedLower);
    if (strippedCi) return strippedCi;
  }

  // 4. 反过来：DB 不带前缀，JSON 带了全名 → 给 DB 加前缀再匹配
  // 例如 JSON "FaZe Clan" → DB 可能是 "FaZe"
  // 去掉前缀后和 DB 名匹配，再按 DB 原始名去找
  for (const prefix of prefixes) {
    if (!lowerName.startsWith(prefix.toLowerCase())) continue;
    const stripped = name.slice(prefix.length);
    // 精确匹配剩余部分
    if (dbTeamNames.includes(stripped)) return stripped;
    // 忽略大小写匹配剩余部分
    const found = dbTeamNames.find(n => n.toLowerCase() === stripped.toLowerCase());
    if (found) return found;
  }

  // 5. 用 team_ranking 表匹配
  const rankingMatch = rankingNames.find(rn => rn.toLowerCase() === lowerName);
  if (rankingMatch) {
    // 在 team 表中找对应的名字
    const teamRow = dbTeamNames.find(n => n.toLowerCase() === rankingMatch.toLowerCase());
    if (teamRow) return teamRow;
    // team 表里没有的话... 这种情况比较少，跳过
  }

  // 6. 去掉 team_ranking 表中名字的前缀再匹配
  for (const prefix of prefixes) {
    const rnMatch = rankingNames.find(rn => {
      if (!rn.toLowerCase().startsWith(prefix.toLowerCase())) return false;
      return rn.slice(prefix.length).toLowerCase() === lowerName;
    });
    if (rnMatch) {
      const teamRow = dbTeamNames.find(n => n.toLowerCase() === rnMatch.toLowerCase());
      if (teamRow) return teamRow;
    }
  }

  return null;
}

main().catch(err => { console.error(err); process.exit(1); });
