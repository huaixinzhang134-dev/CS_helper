/**
 * WebSocket 服务 —— 实时比赛数据推送
 *
 * 使用方式：
 *   import { matchWS } from '../../services/ws';
 *
 *   // 赛事列表页：订阅全量更新
 *   matchWS.on('matches_update', (msg) => { ... });
 *   matchWS.connect();
 *
 *   // 赛事详情页：订阅单场比赛
 *   matchWS.on('match_update', (msg) => {
 *     if (msg.matchId === myMatchId) { ... }
 *   });
 *   matchWS.connect();
 *   matchWS.send({ type: 'subscribe_match', matchId: '123' });
 *
 * 生命周期：
 *   connect() → onShow()
 *   disconnect() → onHide() / onUnload()
 *   小程序切后台自动断开，切前台自动重连
 */
import { API_BASE } from '../config';

// ======================== 类型 ========================

type WsCallback = (data: any) => void;

interface WsMessage {
  type: string;
  [key: string]: any;
}

// ======================== WebSocket 服务类 ========================

class MatchWebSocket {
  private socket: WechatMiniprogram.SocketTask | null = null;
  private reconnectTimer: number | null = null;
  private heartbeatTimer: number | null = null;

  /** 回调集合：type → Set<callback>，* 接收所有消息 */
  private callbacks: Map<string, Set<WsCallback>> = new Map();

  /** 待发送消息队列（连接未就绪时缓冲） */
  private pendingQueue: string[] = [];

  /** 是否主动销毁（true 则不重连） */
  private destroyed = false;

  /** WebSocket URL，由 API_BASE 推导 */
  private get wsUrl(): string {
    const base = API_BASE.replace('/api', '');
    const wsBase = base.replace(/^http/, 'ws');
    return `${wsBase}/ws`;
  }

  // ======================== 公共 API ========================

  /**
   * 建立 WebSocket 连接
   */
  connect(): void {
    if (this.socket) return;
    this.destroyed = false;

    console.log('[WS] 正在连接...', this.wsUrl);

    this.socket = wx.connectSocket({
      url: this.wsUrl,
      success: () => {
        console.log('[WS] 连接请求已发送');
      },
      fail: (err) => {
        console.error('[WS] 连接请求失败', err);
      }
    });

    this.socket.onOpen(() => {
      console.log('[WS] 已连接');
      // 发送队列中积压的消息（连接建立前调用的 send 会排队到这里）
      this.flushQueue();
      this.send({ type: 'subscribe_all' });
      this.startHeartbeat();
    });

    this.socket.onMessage((res) => {
      try {
        const msg = JSON.parse(res.data as string) as WsMessage;
        this.dispatch(msg);
      } catch (e) {
        console.error('[WS] 消息解析失败', e);
      }
    });

    this.socket.onClose(() => {
      console.log('[WS] 连接已关闭');
      this.cleanup();
      if (!this.destroyed) {
        this.reconnectTimer = setTimeout(() => {
          console.log('[WS] 尝试重连...');
          this.connect();
        }, 3000) as any;
      }
    });

    this.socket.onError((err) => {
      console.error('[WS] 错误', err);
      this.socket?.close();
    });
  }

  /**
   * 断开 WebSocket 连接（不重连）
   */
  disconnect(): void {
    this.destroyed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.cleanup();
    this.socket?.close();
    this.socket = null;
  }

  /**
   * 发送消息（自动排队，连接就绪后发送）
   */
  send(data: object): void {
    const msg = JSON.stringify(data);
    // 仅当 readyState === 1 (OPEN) 时才真正发送，否则入队
    // (socket 存在但还在 CONNECTING 时发送会报 readyState is not OPEN)
    if (this.socket && this.socket.readyState === 1) {
      try {
        this.socket.send({ data: msg });
      } catch (e) {
        console.error('[WS] 发送失败，加入重试队列', e);
        this.pendingQueue.push(msg);
      }
    } else {
      this.pendingQueue.push(msg);
    }
  }

  /**
   * 注册消息回调
   */
  on(type: string, cb: WsCallback): () => void {
    if (!this.callbacks.has(type)) {
      this.callbacks.set(type, new Set());
    }
    this.callbacks.get(type)!.add(cb);
    return () => this.callbacks.get(type)?.delete(cb);
  }

  /**
   * 移除回调
   */
  off(type: string, cb: WsCallback): void {
    this.callbacks.get(type)?.delete(cb);
  }

  // ======================== 内部实现 ========================

  /** 发送排队的消息 */
  private flushQueue(): void {
    if (this.pendingQueue.length === 0 || !this.socket) return;
    const queue = this.pendingQueue.slice();
    this.pendingQueue = [];
    for (const msg of queue) {
      try {
        this.socket.send({ data: msg });
      } catch (e) {
        console.error('[WS] 发送缓冲消息失败', e);
      }
    }
  }

  /** 分发消息 */
  private dispatch(msg: WsMessage): void {
    const typeCbs = this.callbacks.get(msg.type);
    if (typeCbs) {
      for (const cb of typeCbs) {
        try { cb(msg); } catch (e) { console.error('[WS] 回调异常', e); }
      }
    }
    const allCbs = this.callbacks.get('*');
    if (allCbs) {
      for (const cb of allCbs) {
        try { cb(msg); } catch (e) { console.error('[WS] 回调异常', e); }
      }
    }
  }

  /** 心跳（30s 一次） */
  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.send({ type: 'pong' });
    }, 30000) as any;
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /** 清理状态 */
  private cleanup(): void {
    this.stopHeartbeat();
    this.socket = null;
  }
}

// 全局单例
export const matchWS = new MatchWebSocket();
