/**
 * 清理 Navicat 导出的 SQL，使其兼容 MySQL 9.x
 *
 * 用法: node scripts/clean_sql.js
 * 输入: C:\Users\50584\Desktop\cs_match_pro.sql
 * 输出: C:\Users\50584\Desktop\cs_match_pro_clean.sql
 */

const fs = require('fs');
const path = require('path');

const inputFile = 'C:\\Users\\50584\\Desktop\\cs_match_pro.sql';
const outputFile = 'C:\\Users\\50584\\Desktop\\cs_match_pro_clean.sql';

let sql = fs.readFileSync(inputFile, 'utf8');

// 1. 移除 Navicat 头部注释
sql = sql.replace(/^\/\*[\s\S]*?\*\/\s*\n?/, '');

// 2. 移除 SET NAMES（MySQL 9.x 可能不兼容）
sql = sql.replace(/^SET NAMES utf8mb4;\s*\n?/gm, '');

// 3. 移除 USING BTREE（MySQL 9.x 已废弃）
sql = sql.replace(/ USING BTREE/g, '');

// 4. 移除 ROW_FORMAT = Dynamic（InnoDB 默认）
sql = sql.replace(/ ROW_FORMAT = Dynamic/g, '');

// 5. 移除列级别的 CHARACTER SET / COLLATE（表级别已设置，减少冗余）
sql = sql.replace(/ CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci/g, '');
sql = sql.replace(/ CHARACTER SET utf8mb4 COLLATE utf8mb4_bin/g, '');

// 6. 保留 AUTO_INCREMENT 但确保格式正确
// (Navicat 导出的 AUTO_INCREMENT 值是当前最大值+1，保留它)

// 7. 替换 MySQL 8.4 特有的 ENUM 语法
sql = sql.replace(/ENUM\('([^']+)'\) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci/g, "ENUM('$1')");

// 8. 确保 utf8mb4 被正确处理
sql = sql.replace(/utf8mb4_0900_ai_ci/g, 'utf8mb4_unicode_ci');

// 9. 移除 USING BTREE (也出现在 KEY/INDEX 定义中)
sql = sql.replace(/USING BTREE\s*/g, '');

// 10. 修复多余的空格
sql = sql.replace(/  +/g, ' ');

fs.writeFileSync(outputFile, sql, 'utf8');
console.log(`✅ 清理完成！输出文件: ${outputFile}`);

// 统计信息
const lines = sql.split('\n').filter(l => l.trim());
const createTables = lines.filter(l => l.includes('CREATE TABLE'));
const inserts = lines.filter(l => l.startsWith('INSERT INTO'));
console.log(`   CREATE TABLE 语句: ${createTables.length}`);
console.log(`   INSERT 语句: ${inserts.length}`);
console.log(`   总行数: ${lines.length}`);
