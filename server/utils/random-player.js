/**
 * 随机选手工具：id 区间法替代 ORDER BY RAND() + 近期不重复
 *
 * 背景（2026-08-02 修复）：
 *   1. ORDER BY RAND() 每次全表扫描 + 全量排序，猜一猜/PK 选目标是玩家高频路径，
 *      在 1 核小服务器上并发时 CPU 压力大 → 改为主键索引随机跳转（O(1)）
 *   2. 纯随机在选手池小时（如 trivial ~170 人）10 局可能重复出 3-4 个同一选手，
 *      体验差 → 服务端维护每个难度的"最近已出"队列，查询时排除，
 *      MAX_RECENT 局之内同一个选手绝不可能出现第二次
 */

/** 每个难度记住最近 N 个已出选手，N 局之内同一个选手不会再次出现 */
const MAX_RECENT = 10;

/** difficulty → number[]（队尾最新，超出容量丢队头） */
const recentByDifficulty = new Map();

/**
 * 记录一次已出的选手 id
 */
function remember(difficulty, id) {
  if (!difficulty || !id) return;
  let q = recentByDifficulty.get(difficulty);
  if (!q) {
    q = [];
    recentByDifficulty.set(difficulty, q);
  }
  // 去重后入队尾，保证最近 N 次内唯一
  const idx = q.indexOf(id);
  if (idx !== -1) q.splice(idx, 1);
  q.push(id);
  if (q.length > MAX_RECENT) q.shift();
}

/**
 * 生成排除最近已出选手的 SQL 片段 + 参数
 * @param {string} difficulty 难度 key
 * @param {string} alias 表别名（统一 'p'）
 * @returns {{ clause: string, params: number[] }} 无历史时 clause 为空串
 */
function excludeRecentSql(difficulty, alias = 'p') {
  const q = recentByDifficulty.get(difficulty);
  if (!q || q.length === 0) return { clause: '', params: [] };
  const prefix = alias ? alias + '.' : '';
  const placeholders = q.map(() => '?').join(',');
  return {
    clause: ` AND ${prefix}id NOT IN (${placeholders})`,
    params: q
  };
}

module.exports = { remember, excludeRecentSql, MAX_RECENT };
