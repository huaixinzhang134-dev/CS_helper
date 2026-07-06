/**
 * 全局配置：API 后端地址
 *
 * 本地开发：使用 http://localhost:3000
 *   - 微信开发者工具 → 详情 → 本地设置 → 勾选"不校验合法域名"
 *
 * 公网部署：改为 https://your.domain
 *   - 小程序后台 → 开发管理 → 服务器域名 → request 合法域名添加
 *   - 同时 downloadFile 合法域名也要添加（用于 <image> 加载）
 */
export const API_BASE = 'http://192.168.2.166:3000/api';

/**
 * 静态资源 base（图片、文件等）
 * 与 API_BASE 同源，便于本地开发与小程序的 request / downloadFile 复用域名白名单
 * 后端通过 express.static 暴露 /static/ 目录
 */
export const STATIC_BASE = 'http://192.168.2.166:3000';