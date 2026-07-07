/**
 * 队标代理路由
 *
 * 微信小程序 <image> 不支持 SVG，此路由将 SVG 队标实时转换为 PNG。
 *
 * GET /api/logo/:teamId  以 PNG 格式返回队标（SVG 自动转换）
 * GET /api/logo?url=...  代理任意队标 URL（SVG 自动转换）
 */

const express = require('express');
const router = express.Router();
const axios = require('axios');
const sharp = require('sharp');

const { query } = require('../db/pool');

// 简单的内存缓存（避免重复请求 HLTV CDN）
const cache = new Map();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 小时

/**
 * 下载图片并转为 PNG Buffer
 */
async function toPngBuffer(url) {
  const cached = cache.get(url);
  if (cached && Date.now() - cached.time < CACHE_TTL) {
    return { buffer: cached.buffer, contentType: cached.contentType || 'image/png' };
  }

  const resp = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 5000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      'Referer': 'https://www.hltv.org/',
      'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Sec-Fetch-Site': 'cross-site',
      'Sec-Fetch-Mode': 'no-cors',
    }
  });

  const contentType = resp.headers['content-type'] || '';
  const rawBuffer = Buffer.from(resp.data);

  let pngBuffer;
  if (contentType.includes('svg') || url.includes('.svg')) {
    try {
      pngBuffer = await sharp(rawBuffer).png().toBuffer();
    } catch {
      // sharp 不可用时返回原始 SVG（微信不支持，但总比没有好）
      pngBuffer = rawBuffer;
    }
  } else {
    // 非 SVG 直接返回原始数据（不做 sharp 转换，避免依赖问题）
    pngBuffer = rawBuffer;
  }

  // 缓存时标记 content-type
  cache.set(url, {
    buffer: pngBuffer,
    time: Date.now(),
    contentType: contentType.includes('svg') ? 'image/png' : contentType || 'image/png'
  });
  return { buffer: pngBuffer, contentType: contentType.includes('svg') ? 'image/png' : contentType || 'image/png' };
}

/**
 * GET /api/logo/:teamId — 按战队 ID 获取队标
 */
router.get('/:teamId', async (req, res, next) => {
  try {
    const [rows] = await query('SELECT logo_url FROM team WHERE id = ? LIMIT 1', [req.params.teamId]);
    if (!rows.length || !rows[0].logo_url) {
      return res.status(404).end();
    }
    const result = await toPngBuffer(rows[0].logo_url);
    res.set('Content-Type', result.contentType || 'image/png');
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(result.buffer);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/logo — 按 url 参数代理
 */
router.get('/', async (req, res, next) => {
  try {
    const url = req.query.url;
    if (!url) return res.status(400).json({ code: 400, message: '缺少 url 参数' });

    const result = await toPngBuffer(url);
    res.set('Content-Type', result.contentType || 'image/png');
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(result.buffer);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
