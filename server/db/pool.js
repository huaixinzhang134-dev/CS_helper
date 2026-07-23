// MySQL 连接池（mysql2/promise）
const mysql = require('mysql2/promise');
require('dotenv').config();

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
  // 连接超时（获取连接 + 查询执行）
  connectTimeout: 10000,        // 10s 连不上 MySQL 就报错
  acquireTimeout: 15000,        // 15s 拿不到连接就报错（防止请求堆积）
  idleTimeout: 60000,           // 60s 空闲连接自动释放
  enableKeepAlive: true,
  keepAliveInitialDelay: 30000
});

/**
 * 执行 SQL 查询（带超时保护，15s 查询未完成则抛出错误）
 * @param {string} sql  SQL 语句（占位符 ?）
 * @param {Array<any>} params  参数
 * @returns {Promise<[rows, fields]>}
 */
async function query(sql, params = []) {
  const timeout = 15000;
  try {
    const connection = await pool.getConnection();
    try {
      const [rows, fields] = await connection.execute({
        sql,
        values: params,
        timeout
      });
      return [rows, fields];
    } finally {
      connection.release();
    }
  } catch (err) {
    // 连接超时/查询超时统一抛出
    throw err;
  }
}

module.exports = {
  pool,
  query
};