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
    return cached.buffer;
  }

  const resp = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 5000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    }
  });

  const contentType = resp.headers['content-type'] || '';
  const rawBuffer = Buffer.from(resp.data);

  let pngBuffer;
  if (contentType.includes('svg') || url.includes('.svg')) {
    // SVG → PNG 转换
    pngBuffer = await sharp(rawBuffer).png().toBuffer();
  } else {
    // 已经是图片格式 → 直接转为 PNG（统一格式）
    try {
      pngBuffer = await sharp(rawBuffer).png().toBuffer();
    } catch {
      pngBuffer = rawBuffer; // 转换失败则返回原始数据
    }
  }

  cache.set(url, { buffer: pngBuffer, time: Date.now() });
  return pngBuffer;
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
    const png = await toPngBuffer(rows[0].logo_url);
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(png);
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

    const png = await toPngBuffer(url);
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(png);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
