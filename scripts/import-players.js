const cloudbase = require("@cloudbase/node-sdk");
const fs = require("fs");
const path = require("path");

// 初始化 CloudBase
const app = cloudbase.init({
  env: "cloud1-2ghbpsm69fa43fcb",
  region: "ap-shanghai",
});

const db = app.database();

/**
 * 导入玩家数据到云数据库
 */
async function importPlayers() {
  console.log('开始导入玩家数据到云数据库...\n');

  // 读取 playerbase.json
  const jsonPath = path.join(__dirname, '../crawler/playerbase.json');
  const fileContent = fs.readFileSync(jsonPath, 'utf8');

  // 解析 JSON Lines 格式
  const players = fileContent.split('\n')
    .filter(line => line.trim())
    .map(line => JSON.parse(line));

  console.log(`共读取 ${players.length} 条玩家数据\n`);

  const collection = db.collection('PlayerBase');
  let successCount = 0;
  let failCount = 0;
  const errors = [];

  // 分批导入，每批20条
  const batchSize = 20;
  const totalBatches = Math.ceil(players.length / batchSize);

  for (let i = 0; i < players.length; i += batchSize) {
    const batch = players.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;

    console.log(`正在处理第 ${batchNum}/${totalBatches} 批...`);

    for (const player of batch) {
      try {
        // 将原 _id 保存为 playerId 字段，让云数据库自动生成新的 _id
        const { _id, ...playerData } = player;
        await collection.add({
          ...playerData,
          playerId: _id  // 保留原始ID作为引用
        });
        successCount++;
        process.stdout.write(`\r成功: ${successCount}/${players.length}`);
      } catch (err) {
        failCount++;
        errors.push({ name: player.name, error: err.message });
      }
    }

    // 延迟避免请求过快
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  console.log('\n\n导入完成！');
  console.log(`成功: ${successCount}`);
  console.log(`失败: ${failCount}`);

  if (errors.length > 0) {
    console.log('\n失败的记录:');
    errors.slice(0, 10).forEach(e => {
      console.log(`  ${e.name}: ${e.error}`);
    });
  }
}

/**
 * 统计数据库中的玩家数量
 */
async function countPlayers() {
  const collection = db.collection('PlayerBase');
  const result = await collection.count();
  console.log(`数据库中玩家总��: ${result.total}`);
  return result.total;
}

/**
 * 清空玩家集合（慎用！）
 */
async function clearPlayers() {
  console.log('警告：即将清空 PlayerBase 集合！');
  const collection = db.collection('PlayerBase');
  const result = await collection.remove();
  console.log('已清空 PlayerBase 集合');
  return result;
}

// 命令行执行
const action = process.argv[2] || 'import';

(async () => {
  try {
    if (action === 'import') {
      await importPlayers();
    } else if (action === 'count') {
      await countPlayers();
    } else if (action === 'clear') {
      await clearPlayers();
    } else {
      console.log('用法: node import-players.js [import|count|clear]');
    }
  } catch (error) {
    console.error('执行错误:', error.message);
  }
})();
