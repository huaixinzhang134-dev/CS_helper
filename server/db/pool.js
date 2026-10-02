// MySQL 连接池（mysql2/promise）
const mysql = require('mysql2/promise');
require('dotenv').config();

/**
 * 连接级致命错误码：出现这些错误后连接不可再复用，必须 destroy 而不是 release。
 *
 * 背景（2026-10-02 生产事故）：mysql2 的 execute({ timeout }) 只是客户端计时器，
 * 超时后仅让当前 Promise 报错，连接上仍挂着未完成的命令；若把这种连接 release 回池，
 * 下次复用时新命令永远排在旧命令后面且超时计时器不武装 → 永久卡住 →
 * 10 个连接逐一流失后整个池耗尽、全站数据库接口挂死。
 */
const FATAL_CODES = new Set([
  'PROTOCOL_SEQUENCE_TIMEOUT',      // 客户端查询超时：连接上仍挂着未完成命令
  'PROTOCOL_CONNECTION_LOST',       // 服务端断开
  'PROTOCOL_PACKETS_OUT_OF_ORDER',  // 协议乱序
  'PROTOCOL_INVALID_CONNECTION_ID',
  'ER_CLIENT_INTERACTION_TIMEOUT',  // MySQL 主动断开交互超时会话
  'ETIMEDOUT',
  'ECONNRESET',
  'ECONNREFUSED',
  'EPIPE'
]);

function isConnectionFatal(err) {
  if (!err) return false;
  if (err.fatal) return true;
  return FATAL_CODES.has(err.code);
}

/** 妥善处置连接：致命错误 → 销毁；普通业务错误 → 归还 */
function disposeConnection(connection, err) {
  if (isConnectionFatal(err)) {
    connection.destroy();
  } else {
    connection.release();
  }
}

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '3306', 10),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASS || '',
  database: process.env.DB_NAME || 'cs_match_pro',
  connectionLimit: 10,
  waitForConnections: true,
  queueLimit: 0,
  charset: 'utf8mb4',
  timezone: '+08:00',
  // 连接超时（连接握手）
  connectTimeout: 10000,        // 10s 连不上 MySQL 就报错
  idleTimeout: 60000,           // 60s 空闲连接自动释放
  enableKeepAlive: true,
  keepAliveInitialDelay: 30000
  // 注意：mysql2 不支持 acquireTimeout（会被静默忽略），
  // “拿不到连接就报错”由下方 getConnectionWithTimeout 实现
});

/**
 * 从池中获取连接（带真实生效的获取超时）
 * 池耗尽时 15s 内报错，而不是无限排队
 */
function getConnectionWithTimeout(timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      const err = new Error('获取数据库连接超时（连接池已耗尽）');
      err.code = 'POOL_ACQUIRE_TIMEOUT';
      reject(err);
    }, timeoutMs);

    pool.getConnection().then(
      (connection) => {
        if (settled) {
          // 超时之后才拿到：直接还回池，避免泄漏
          connection.release();
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve(connection);
      },
      (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

/**
 * 执行 SQL 查询（带超时保护，15s 查询未完成则抛出错误）
 * 超时/连接级错误会销毁该连接（池会自动补新连接），不再污染连接池
 * @param {string} sql  SQL 语句（占位符 ?）
 * @param {Array<any>} params  参数
 * @returns {Promise<[rows, fields]>}
 */
async function query(sql, params = []) {
  const timeout = 15000;
  const connection = await getConnectionWithTimeout(15000);
  try {
    const [rows, fields] = await connection.execute({
      sql,
      values: params,
      timeout
    });
    connection.release();
    return [rows, fields];
  } catch (err) {
    disposeConnection(connection, err);
    throw err;
  }
}

/**
 * 执行 SQL 查询（不写 binlog，用于爬虫高频写入）
 * 用法同 query()，每次查询前执行 SET SESSION sql_log_bin = 0，
 * 无论成功失败都会恢复 sql_log_bin（失败无法恢复时销毁连接，防止状态泄漏进池）
 */
async function queryNoBinlog(sql, params = []) {
  const timeout = 15000;
  const connection = await getConnectionWithTimeout(15000);
  let binlogOff = false;
  try {
    await connection.execute({ sql: 'SET SESSION sql_log_bin = 0', timeout: 5000 });
    binlogOff = true;
    const [rows, fields] = await connection.execute({
      sql,
      values: params,
      timeout
    });
    await connection.execute({ sql: 'SET SESSION sql_log_bin = 1', timeout: 5000 });
    binlogOff = false;
    connection.release();
    return [rows, fields];
  } catch (err) {
    if (binlogOff && !isConnectionFatal(err)) {
      // 主查询业务性失败：连接仍健康，尽量先恢复会话变量
      try {
        await connection.execute({ sql: 'SET SESSION sql_log_bin = 1', timeout: 5000 });
      } catch (restoreErr) {
        connection.destroy();
        throw err;
      }
    }
    disposeConnection(connection, err);
    throw err;
  }
}

module.exports = {
  pool,
  query,
  queryNoBinlog,
  getConnectionWithTimeout
};
