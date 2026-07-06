import { fetchLiveMatches, Match } from '../../services/api';
import { matchWS } from '../../services/ws';

Page({
  data: {
    loading: true,
    matches: [] as Match[],
    refreshTriggered: false,

    // WS 状态
    wsConnected: false,
    liveCount: 0          // 当前直播场次数
  },

  onLoad() {
    // 1. HTTP 拉取初始数据（fallback）
    this.loadMatches();

    // 2. 建立 WebSocket 实时连接
    this.setupWS();
  },

  /**
   * 建立 WS 连接 + 注册回调
   */
  setupWS() {
    // 取消旧订阅
    matchWS.disconnect();

    // 注册全量列表更新回调
    this._unsubUpdates = matchWS.on('matches_update', (msg: { data: Match[] }) => {
      const matches = this.sortMatches(msg.data || []);
      const liveCount = matches.filter(m => m.status === 'Live').length;
      this.setData({
        matches,
        liveCount,
        wsConnected: true
      });
    });

    // 注册连接状态（通配符消息用来检测 pong）
    this._unsubAll = matchWS.on('*', (msg: any) => {
      if (msg.type === 'subscribed' && msg.scope === 'all') {
        this.setData({ wsConnected: true });
      }
    });

    // 连接
    matchWS.connect();
  },

  /**
   * 按 Live > Upcoming > Finished 排序
   */
  sortMatches(matches: Match[]): Match[] {
    const statusOrder = { 'Live': 0, 'Upcoming': 1, 'Finished': 2 };
    return matches.sort((a, b) => {
      const sa = statusOrder[a.status] ?? 9;
      const sb = statusOrder[b.status] ?? 9;
      return sa - sb;
    });
  },

  async loadMatches() {
    this.setData({ loading: true });
    try {
      const res = await fetchLiveMatches();
      if (res.success) {
        const sorted = this.sortMatches(res.data);
        const liveCount = sorted.filter(m => m.status === 'Live').length;
        this.setData({ matches: sorted, liveCount });
      }
    } catch (err) {
      console.error('Fetch matches failed', err);
      wx.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      this.setData({
        loading: false,
        refreshTriggered: false
      });
    }
  },

  /**
   * 下拉刷新（HTTP fallback + WS 重连）
   */
  onPullDownRefresh() {
    this.setData({ refreshTriggered: true });
    // 既 HTTP 拉取，也确保 WS 在线
    this.loadMatches();
    if (!this.data.wsConnected) {
      matchWS.connect();
    }
  },

  /**
   * 小程序切到前台 → 重连 WS
   */
  onShow() {
    if (this.data.matches.length > 0) {
      matchWS.connect();
    }
  },

  /**
   * 小程序切到后台 → 断开 WS（省流量）
   */
  onHide() {
    matchWS.disconnect();
  },

  /**
   * 页面卸载 → 清理 WS
   */
  onUnload() {
    if (this._unsubUpdates) this._unsubUpdates();
    if (this._unsubAll) this._unsubAll();
    matchWS.disconnect();
  },

  /**
   * 格式化时间显示
   */
  formatTime(isoString: string) {
    const date = new Date(isoString);
    return `${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:${date.getMinutes().toString().padStart(2, '0')}`;
  },

  /**
   * 点击比赛卡片 → 跳详情页（含评论区）
   */
  onMatchTap(e: any) {
    const matchId = e.currentTarget.dataset.id;
    if (!matchId) return;
    wx.navigateTo({
      url: `/pages/matchDetail/matchDetail?id=${matchId}`
    });
  }
});
