// 统一错误处理中间件
function errorHandler(err, req, res, next) {
  console.error('[error]', err);
  const status = err.status || 500;
  res.status(status).json({
    code: err.code || status,
    message: err.message || '服务器内部错误',
    data: null
  });
}

module.exports = errorHandler;