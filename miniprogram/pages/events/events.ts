import { fetchMatchEvents, MatchEvent } from '../../services/api';

const GRADE_OPTIONS = [
  { value: null, label: '全部' },
  { value: 1, label: 'S' },
  { value: 2, label: 'A' },
  { value: 3, label: 'B' },
  { value: 7, label: 'C' },
  { value: 8, label: 'D' },
];

const GRADE_COLORS: Record<number, string> = { 1: '#ff4757', 2: '#ff6b81', 3: '#ffa502', 7: '#2ed573', 8: '#70a1ff' };
const GRADE_LABELS: Record<number, string> = { 1: 'S', 2: 'A', 3: 'B', 7: 'C', 8: 'D', 9: '其他' };

Page({
  data: {
    loading: true,
    events: [] as MatchEvent[],
    gradeFilter: null as number | null,
    gradeOptions: GRADE_OPTIONS,
  },

  onLoad() {
    this.loadEvents();
  },

  onPullDownRefresh() {
    this.loadEvents().finally(() => wx.stopPullDownRefresh());
  },

  onSelectGrade(e: any) {
    const grade = e.currentTarget.dataset.value;
    const val = grade === 'null' ? null : parseInt(grade, 10);
    this.setData({ gradeFilter: val }, () => this.loadEvents());
  },

  async loadEvents() {
    this.setData({ loading: true });
    try {
      const res = await fetchMatchEvents(this.data.gradeFilter ?? undefined);
      if (res.success) {
        const events = (res.data || []).map(ev => ({
          ...ev,
          gradeLabel: GRADE_LABELS[ev.grade ?? -1] || '',
          badgeColor: GRADE_COLORS[ev.grade ?? -1] || '#999',
        }));
        this.setData({ events });
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
