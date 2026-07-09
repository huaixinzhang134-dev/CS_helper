import { fetchMatchEvents, MatchEvent } from '../../services/api';

Page({
  data: {
    loading: true,
    events: [] as MatchEvent[]
  },

  onLoad() {
    this.loadEvents();
  },

  onPullDownRefresh() {
    this.loadEvents().finally(() => wx.stopPullDownRefresh());
  },

  async loadEvents() {
    this.setData({ loading: true });
    try {
      const res = await fetchMatchEvents();
      if (res.success) {
        this.setData({ events: res.data || [] });
      }
    } catch (err) {
      console.error('Fetch events failed', err);
    } finally {
      this.setData({ loading: false });
    }
  },

  onEventTap(e: any) {
    const name = e.currentTarget.dataset.name;
    if (!name) return;
    wx.navigateTo({
      url: `/pages/match/match?event=${encodeURIComponent(name)}`
    });
  }
});
