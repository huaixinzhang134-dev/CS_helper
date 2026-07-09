import { fetchMatchEvents, MatchEvent } from '../../services/api';

// 回合名关键词：这类名称应作为比赛回合而非赛事分类，不在赛事列表中展示
const ROUND_PATTERNS = /(总决赛|半决赛|季军赛|小组赛|淘汰赛|排位赛|八强赛|四强赛|十六强|第[一二三四五六七八九十\d]+轮|瑞士轮|胜者组|败者组|入围赛|附加赛|升降级赛|复活赛)/;

function isRoundName(name: string): boolean {
  // 去除末尾 G+数字（如 G4）后匹配回合名
  const cleaned = name.replace(/\s*G\d+$/, '').trim();
  return ROUND_PATTERNS.test(cleaned);
}

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
        // 过滤掉回合名（总决赛G4等），只保留真正的赛事名称
        const filtered = (res.data || []).filter(e => !isRoundName(e.name));
        this.setData({ events: filtered });
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
