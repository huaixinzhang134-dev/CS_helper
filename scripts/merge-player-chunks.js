#!/usr/bin/env node
/**
 * 合并爬虫分片产物 → crawler/playerbase.json
 *
 * 用于爬虫结束后将多个 playerbase_chunk{N}.json 合并为一个文件，
 * 供 scripts/import-players.js 使用。
 *
 * 支持的搜索路径（按优先级）：
 *   1. playerbase-chunk-*/ 子目录（GitHub Actions actions/download-artifact 产物）
 *   2. crawler/ 目录（本地爬虫分片输出）
 *   3. 当前目录（直接放置的分片文件）
 *
 * 使用:
 *   node scripts/merge-player-chunks.js
 *
 * 自定义路径:
 *   CHUNK_DIR=/root/cs node scripts/merge-player-chunks.js   # 从 /root/cs 搜索
 *   node scripts/merge-player-chunks.js --dir /root/cs
 */
const fs = require('fs');
const path = require('path');

// ---------- 目录解析 ----------

function resolveBaseDir() {
  // 优先 --dir 参数
  const dirIdx = process.argv.indexOf('--dir');
  if (dirIdx >= 0 && dirIdx + 1 < process.argv.length) {
    return path.resolve(process.argv[dirIdx + 1]);
  }
  // 其次 CHUNK_DIR 环境变量
  if (process.env.CHUNK_DIR) {
    return path.resolve(process.env.CHUNK_DIR);
  }
  // 默认：repo 根目录（本脚本在 scripts/ 下）
  return path.resolve(__dirname, '..');
}

// ---------- 分片文件发现 ----------

/**
 * 在 baseDir 下搜索所有分片文件，按完整路径返回。
 * 处理三种布局：
 *   playerbase-chunk-N/playerbase_chunkN.json   (GA artifact)
 *   crawler/playerbase_chunkN.json               (本地 crawler)
 *   playerbase_chunkN.json                       (当前目录)
 */
function findChunkFiles(baseDir) {
  const found = [];

  // 1. GitHub Actions 布局：playerbase-chunk-*/playerbase_chunk*.json
  const gaDirs = fs.readdirSync(baseDir).filter(
    d => d.startsWith('playerbase-chunk-') &&
      fs.statSync(path.join(baseDir, d)).isDirectory()
  );
  for (const dir of gaDirs) {
    const files = fs.readdirSync(path.join(baseDir, dir))
      .filter(f => f.startsWith('playerbase_chunk') && f.endsWith('.json'));
    for (const f of files) {
      found.push(path.join(baseDir, dir, f));
    }
  }

  // 2. crawler/ 子目录布局
  const crawlerDir = path.join(baseDir, 'crawler');
  if (fs.existsSync(crawlerDir)) {
    const files = fs.readdirSync(crawlerDir)
      .filter(f => f.startsWith('playerbase_chunk') && f.endsWith('.json'));
    for (const f of files) {
      found.push(path.join(crawlerDir, f));
    }
  }

  // 3. 当前目录布局
  const files = fs.readdirSync(baseDir)
    .filter(f => f.startsWith('playerbase_chunk') && f.endsWith('.json'));
  for (const f of files) {
    const fp = path.join(baseDir, f);
    if (fs.statSync(fp).isFile() && !found.includes(fp)) {
      found.push(fp);
    }
  }

  // 去重 + 排序
  return [...new Set(found)].sort();
}

// ---------- 合并去重 ----------

function mergeAndDeduplicate(filePaths) {
  const seen = new Set();
  const uniqueLines = [];
  let totalLines = 0;

  for (const fp of filePaths) {
    const content = fs.readFileSync(fp, 'utf8');
    const lines = content.split('\n').filter(l => l.trim());
    totalLines += lines.length;

    for (const line of lines) {
      try {
        const p = JSON.parse(line);
        if (p._id && !seen.has(p._id)) {
          seen.add(p._id);
          uniqueLines.push(line);
        }
      } catch (e) {
        // 跳过格式错误的行
      }
    }
  }

  return { uniqueLines, totalLines, uniqueCount: uniqueLines.length };
}

// ---------- 输出 ----------

function writeOutput(baseDir, uniqueLines) {
  const outDir = path.join(baseDir, 'crawler');
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }
  const outPath = path.join(outDir, 'playerbase.json');
  fs.writeFileSync(outPath, uniqueLines.join('\n'), 'utf8');
  console.log(`✅ 已写入 ${uniqueLines.length} 条 → ${outPath}`);
  return outPath;
}

// ---------- 主流程 ----------

function main() {
  const baseDir = resolveBaseDir();
  console.log(`🔍 搜索路径: ${baseDir}`);
  process.stdout.write('🔎 搜索分片文件... ');

  const chunkFiles = findChunkFiles(baseDir);

  if (chunkFiles.length === 0) {
    console.log('未找到任何分片文件');
    console.error('❌ playerbase_chunk*.json 不存在');
    console.log('\n可能的原因:');
    console.log('  1. 爬虫尚未执行分片爬取步骤');
    console.log('  2. 分片文件在其它目录（用 --dir 指定）');
    console.log('  3. GitHub Actions 产物未下载（需要先下载）');
    process.exit(1);
  }

  console.log(`找到 ${chunkFiles.length} 个分片文件`);
  for (const f of chunkFiles) {
    const stat = fs.statSync(f);
    console.log(`  📄 ${f} (${(stat.size / 1024).toFixed(1)} KB)`);
  }

  console.log('\n🔄 合并去重中...');
  const { uniqueLines, totalLines, uniqueCount } = mergeAndDeduplicate(chunkFiles);

  console.log(`  原始行数: ${totalLines}`);
  console.log(`  去重后:   ${uniqueCount}`);
  console.log(`  重复:     ${totalLines - uniqueCount}`);

  const outPath = writeOutput(baseDir, uniqueLines);

  console.log('\n✅ 合并完成！');
  console.log(`  输出: ${outPath}`);
  console.log(`  共 ${uniqueCount} 条选手数据`);
  console.log('\n💡 下一步运行导入: node scripts/import-players.js');
}

main();
