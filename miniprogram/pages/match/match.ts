import { fetchLiveMatches, Match } from '../../services/api';
import { matchWS } from '../../services/ws';

Page({
  data: {
    loading: true,
    matches: [] as Match[],
    anchorId: '',
    refreshTriggered: false,

    // 赛事筛选
    eventName: '',

    // WS 状态
    wsConnected: false,
    liveCount: 0
  },

  onLoad(options: any) {
    // 支持按赛事名称过滤
    if (options.event) {
      this.setData({ eventName: decodeURIComponent(options.event) });
      wx.setNavigationBarTitle({ title: this.data.eventName });
    }

    this.loadMatches();
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
      const data = msg.data || [];
      const { list, anchorId } = this.sortMatches(data);
      const liveCount = list.filter(m => m.status === 'Live').length;
      this.setData({
        matches: list,
        anchorId,
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

  sortMatches(matches: any[]) {
    if (matches.length === 0) return { list: [], anchorId: '' };

    const now = new Date().getTime();

    // 给每个比赛加上格式化后的显示时间
    matches.forEach(m => { m.displayTime = this.formatTime(m.time); });

    // 分离 Live / 已完成 / 未开始
    const live = matches.filter(m => m.status === 'Live');
    const finished = matches.filter(m => m.status === 'Finished');
    const upcoming = matches.filter(m => m.status !== 'Live' && m.status !== 'Finished');

    // 已完成：按时间倒序（最新的排前面）
    finished.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());

    // 未开始：按时间正序（最早的排前面）
    upcoming.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());

    // 找距当前时间最近的比赛作为锚点（优先从 Live 中选，其次未开始，最后已完成）
    let anchorMatch: Match | null = null;
    let minDiff = Infinity;
    for (const m of [...live, ...upcoming, ...finished]) {
      if (!m.time) continue;
      const diff = Math.abs(new Date(m.time).getTime() - now);
      if (diff < minDiff) {
        minDiff = diff;
        anchorMatch = m;
      }
    }

    // 最终顺序：Live → 已完成(倒序) → 未开始(正序)
    // 这样 Live 始终在顶部，已完成的最新比赛紧接着，然后才是未开始
    const list = [...live, ...finished, ...upcoming];

    return {
      list,
      anchorId: anchorMatch ? anchorMatch._id : ''
    };
  },

  async loadMatches() {
    this.setData({ loading: true });
    try {
      const res = await fetchLiveMatches(this.data.eventName || undefined);
      if (res.success) {
        const data = res.data || [];
        const { list, anchorId } = this.sortMatches(data);
        const liveCount = list.filter(m => m.status === 'Live').length;
        this.setData({ matches: list, anchorId, liveCount });
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
  formatTime(raw: string) {
    if (!raw) return '';
    // 兜底：如果后端返回 ISO 格式（含毫秒+Z），前端也能正确解析
    const date = new Date(raw);
    if (isNaN(date.getTime())) return raw;
    const m = date.getMonth() + 1;
    const d = date.getDate();
    const h = date.getHours().toString().padStart(2, '0');
    const min = date.getMinutes().toString().padStart(2, '0');
    return `${m}/${d} ${h}:${min}`;
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
