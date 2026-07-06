/**
 * WebSocket 服务 - 实时比赛数据推送
 *
 * 架构：
 *   爬虫 (crawler-service) → POST /api/matches/sync → 本模块广播
 *
 * 两种订阅模式：
 *   subscribe_all      赛事列表页用，接收所有比赛更新
 *   subscribe_match    赛事详情页用，只接收某一场更新
 *
 * 使用方式（server/index.js）：
 *   const http = require('http');
 *   const { setupWebSocket } = require('./ws');
 *   const server = http.createServer(app);
 *   const { broadcastMatchUpdate, broadcastGlobal } = setupWebSocket(server);
 *   server.listen(PORT);
 */
const WebSocket = require('ws');

// ======================== 订阅者集合 ========================

/** 订阅全部更新的客户端 */
const globalSubscribers = new Set();

/**
 * 按 matchId 订阅的客户端
 * Map<string, Set<WebSocket>>
 */
const matchSubscribers = new Map();

/** 心跳相关 */
const HEARTBEAT_INTERVAL = 30000; // 30s
const HEARTBEAT_TIMEOUT = 10000;  // 10s 无响应视为断开

// ======================== 服务设置 ========================

/**
 * 在已有的 HTTP Server 上附着 WebSocket 服务
 * @param {import('http').Server} server
 * @returns {{ wss: WebSocket.Server, broadcastMatchUpdate, broadcastGlobal }}
 */
function setupWebSocket(server) {
  const wss = new WebSocket.Server({
    server,
    // 挂载到 /ws 路径，方便 Nginx 代理
    path: '/ws'
  });

  wss.on('connection', (ws, req) => {
    const clientIP = req.socket.remoteAddress || 'unknown';
    console.log(`[WS] 客户端连接: ${clientIP}`);

    // 客户端状态
    ws.subscribedMatches = new Set();
    ws.isAlive = true;
    ws.clientIP = clientIP;

    // ---------- 消息处理 ----------
    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch (e) {
        ws.send(JSON.stringify({ type: 'error', message: 'invalid JSON' }));
        return;
      }

      switch (msg.type) {
        // 订阅全部比赛更新（赛事列表页）
        case 'subscribe_all':
          globalSubscribers.add(ws);
          console.log(`[WS] ${clientIP} 订阅全部更新`);
          ws.send(JSON.stringify({ type: 'subscribed', scope: 'all' }));
          break;

        // 取消订阅全部
        case 'unsubscribe_all':
          globalSubscribers.delete(ws);
          break;

        // 订阅单场比赛（赛事详情页）
        case 'subscribe_match': {
          const matchId = String(msg.matchId);
          if (!matchId) break;
          ws.subscribedMatches.add(matchId);
          if (!matchSubscribers.has(matchId)) {
            matchSubscribers.set(matchId, new Set());
          }
          matchSubscribers.get(matchId).add(ws);
          console.log(`[WS] ${clientIP} 订阅比赛 #${matchId}`);
          ws.send(JSON.stringify({ type: 'subscribed', scope: 'match', matchId }));
          break;
        }

        // 取消订阅单场
        case 'unsubscribe_match': {
          const matchId = String(msg.matchId);
          ws.subscribedMatches.delete(matchId);
          const subs = matchSubscribers.get(matchId);
          if (subs) {
            subs.delete(ws);
            if (subs.size === 0) matchSubscribers.delete(matchId);
          }
          break;
        }

        // 心跳 pong
        case 'pong':
          ws.isAlive = true;
          break;

        default:
          ws.send(JSON.stringify({ type: 'error', message: `unknown type: ${msg.type}` }));
      }
    });

    // ---------- 连接关闭 ----------
    ws.on('close', () => {
      console.log(`[WS] 客户端断开: ${clientIP}`);
      globalSubscribers.delete(ws);
      for (const matchId of ws.subscribedMatches) {
        const subs = matchSubscribers.get(matchId);
        if (subs) {
          subs.delete(ws);
          if (subs.size === 0) matchSubscribers.delete(matchId);
        }
      }
      ws.subscribedMatches.clear();
    });

    // ---------- 错误处理 ----------
    ws.on('error', (err) => {
      console.error(`[WS] 客户端 ${clientIP} 错误:`, err.message);
    });
  });

  // ---------- 心跳检测（服务端 ping） ----------
  const heartbeatTimer = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (!ws.isAlive) {
        // 上次 ping 无响应，断开
        console.log(`[WS] 心跳超时，断开 ${ws.clientIP}`);
        return ws.terminate();
      }
      ws.isAlive = false;
      ws.send(JSON.stringify({ type: 'ping' }));
    });
  }, HEARTBEAT_INTERVAL);

  wss.on('close', () => {
    clearInterval(heartbeatTimer);
  });

  console.log(`[WS] WebSocket 服务已启动，路径 /ws`);

  // ======================== 广播函数 ========================

  /**
   * 广播某场比赛的更新给订阅了该场比赛的客户端
   * @param {string|number} matchId
   * @param {object} data - Match DTO
   */
  function broadcastMatchUpdate(matchId, data) {
    const id = String(matchId);
    const subs = matchSubscribers.get(id);
    if (!subs || subs.size === 0) return;

    const message = JSON.stringify({
      type: 'match_update',
      matchId: id,
      data
    });

    let count = 0;
    for (const ws of subs) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(message);
        count++;
      }
    }
    console.log(`[WS] 广播 match_update #${id} → ${count} 个客户端`);
  }

  /**
   * 广播全量比赛列表给所有 subscribe_all 客户端
   * @param {Array} matches - Match DTO 数组
   */
  function broadcastGlobal(matches) {
    if (globalSubscribers.size === 0) return;

    const message = JSON.stringify({
      type: 'matches_update',
      data: matches
    });

    let count = 0;
    for (const ws of globalSubscribers) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(message);
        count++;
      }
    }
    console.log(`[WS] 广播 matches_update → ${count} 个客户端`);
  }

  /**
   * 获取当前订阅统计
   */
  function getStats() {
    return {
      global: globalSubscribers.size,
      byMatch: Array.from(matchSubscribers.entries()).map(
        ([id, set]) => ({ matchId: id, count: set.size })
      ),
      total: wss.clients.size
    };
  }

  return { wss, broadcastMatchUpdate, broadcastGlobal, getStats };
}

module.exports = { setupWebSocket };
