import { API_BASE, STATIC_BASE } from '../../config';
import { Player } from '../../services/api';

const PAGE_SIZE = 60;

// 定妆照占位剪影
const SILHOUETTE_URLS = [
  'https://www.hltv.org/img/static/player/player_silhouette.png',
  'https://www.hltv.org/img/static/player/player_silhouette_fe.png'
];

function normalizeAvatarUrl(avatar: string): string {
  if (!avatar) return '/assets/icons/user.png';
  if (SILHOUETTE_URLS.indexOf(avatar) >= 0) return '/assets/icons/user.png';
  if (avatar.startsWith('http://') || avatar.startsWith('https://')) return avatar;
  if (avatar.startsWith('/static/')) return `${STATIC_BASE}${avatar}`;
  return '/assets/icons/user.png';
}

interface TeamRankItem {
  teamName: string;
  ranking: number;
  points: string;
  logoUrl: string;
  region: string;
}

Page({
  data: {
    activeTab: 'player' as 'player' | 'team',
    // 选手排行
    playerList: [] as (Player & { avatarUrl?: string })[],
    playerPage: 0,
    playerHasMore: false,
    playerTotal: 0,
    playerLoading: false,
    // 队伍排行
    teamList: [] as TeamRankItem[],
    teamPage: 0,
    teamHasMore: false,
    teamTotal: 0,
    teamLoading: false,
    // 赛区筛选
    regionFilter: 'all',
    regionOptions: [
      { value: 'all', label: '全部赛区' },
      { value: 'Europe', label: '欧洲赛区' },
      { value: 'Asia', label: '亚洲赛区' },
      { value: 'Americas', label: '美洲赛区' }
    ],
    showRegionPicker: false
  },

  onLoad() {
    this.loadPlayerRanking(0);
  },

  // ========== 选项卡切换 ==========

  switchTab(e: any) {
    const tab = e.currentTarget.dataset.tab as 'player' | 'team';
    this.setData({ activeTab: tab });
    if (tab === 'player' && this.data.playerList.length === 0) {
      this.loadPlayerRanking(0);
    } else if (tab === 'team' && this.data.teamList.length === 0) {
      this.loadTeamRanking(0);
    }
  },

  // ========== 选手排行 ==========

  async loadPlayerRanking(page: number) {
    if (this.data.playerLoading) return;
    this.setData({ playerLoading: true });
    try {
      const res = await this._request('/players/ranking', { page, pageSize: PAGE_SIZE });
      if (res.success && res.data) {
        const list = (res.data as any[]).map(p => ({
          ...p,
          avatarUrl: normalizeAvatarUrl(p.avatar)
        }));
        this.setData({
          playerList: page === 0 ? list : [...this.data.playerList, ...list],
          playerPage: page,
          playerHasMore: !!res.hasMore,
          playerTotal: res.total || list.length
        });
      }
    } finally {
      this.setData({ playerLoading: false });
    }
  },

  onPlayerScrollToLower() {
    if (this.data.playerHasMore && !this.data.playerLoading) {
      this.loadPlayerRanking(this.data.playerPage + 1);
    }
  },

  goToPlayerDetail(e: any) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/player/detail?id=${id}` });
  },

  // ========== 队伍排行 ==========

  toggleRegionPicker() {
    this.setData({ showRegionPicker: !this.data.showRegionPicker });
  },

  selectRegion(e: any) {
    const val = e.currentTarget.dataset.value;
    this.setData({
      regionFilter: val,
      showRegionPicker: false,
      teamList: [],
      teamPage: 0,
      teamHasMore: false
    });
    this.loadTeamRanking(0);
  },

  getRegionLabel(val: string): string {
    const opt = this.data.regionOptions.find(o => o.value === val);
    return opt ? opt.label : '全部赛区';
  },

  async loadTeamRanking(page: number) {
    if (this.data.teamLoading) return;
    this.setData({ teamLoading: true });
    try {
      const res = await this._request('/teams/ranking', {
        region: this.data.regionFilter,
        page,
        pageSize: PAGE_SIZE
      });
      if (res.success && res.data) {
        this.setData({
          teamList: page === 0 ? res.data : [...this.data.teamList, ...res.data],
          teamPage: page,
          teamHasMore: !!res.hasMore,
          teamTotal: res.total || res.data.length
        });
      }
    } finally {
      this.setData({ teamLoading: false });
    }
  },

  onTeamScrollToLower() {
    if (this.data.teamHasMore && !this.data.teamLoading) {
      this.loadTeamRanking(this.data.teamPage + 1);
    }
  },

  // ========== 通用请求 ==========

  _request(path: string, params: any): Promise<any> {
    return new Promise((resolve) => {
      const qs = Object.entries(params)
        .filter(([_, v]) => v !== undefined && v !== null && v !== '')
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join('&');
      wx.request({
        url: `${API_BASE}${path}${qs ? '?' + qs : ''}`,
        method: 'GET',
        timeout: 18000,
        success: (r: any) => {
          const body = r.data;
          if (body && body.code === 0) {
            resolve({ success: true, data: body.data, hasMore: body.hasMore, total: body.total });
          } else {
            resolve({ success: false, data: [], hasMore: false, total: 0 });
          }
        },
        fail: () => resolve({ success: false, data: [], hasMore: false, total: 0 })
      });
    });
  }
});
