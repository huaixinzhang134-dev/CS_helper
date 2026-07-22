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
  timezone: '+08:00'
});

/**
 * 执行 SQL 查询
 * @param {string} sql  SQL 语句（占位符 ?）
 * @param {Array<any>} params  参数
 * @returns {Promise<[rows, fields]>}
 */
async function query(sql, params = []) {
  return await pool.execute(sql, params);
}

module.exports = {
  pool,
  query
};