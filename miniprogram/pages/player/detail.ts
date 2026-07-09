import { fetchPlayerDetail, Player } from '../../services/api';
import { STATIC_BASE } from '../../config';

// HLTV 占位剪影 URL
const SILHOUETTE_URLS = [
  'https://www.hltv.org/img/static/player/player_silhouette.png',
  'https://www.hltv.org/img/static/player/player_silhouette_fe.png'
];

// 头像 URL 归一化（与 list.ts 一致）
function normalizeAvatarUrl(avatar: string): string {
  if (!avatar) return '/assets/icons/user.png';
  if (SILHOUETTE_URLS.indexOf(avatar) >= 0) return '/assets/icons/user.png';
  if (avatar.startsWith('http://') || avatar.startsWith('https://')) {
    return avatar;
  }
  if (avatar.startsWith('/static/')) {
    return `${STATIC_BASE}${avatar}`;
  }
  return '/assets/icons/user.png';
}

const STATUS_MAP: Record<string, string> = {
  active: '现役',
  retired: '退役',
  coach: '教练',
  free_agent: '自由人',
  unknown: '未知'
};

Page({
  data: {
    loading: true,
    player: null as (Player & { avatarUrl?: string; statusText?: string }) | null
  },

  onLoad(options: any) {
    if (options.id) {
      this.loadPlayerDetail(options.id);
    }
  },

  async loadPlayerDetail(id: string) {
    this.setData({ loading: true });
    try {
      const res = await fetchPlayerDetail(id);
      if (res.success && res.data) {
        const playerWithAvatar = {
          ...res.data,
          avatarUrl: normalizeAvatarUrl(res.data.avatar),
          statusText: STATUS_MAP[res.data.status] || '未知'
        };
        this.setData({ player: playerWithAvatar });
        wx.setNavigationBarTitle({ title: res.data.name });
      } else {
        wx.showToast({ title: '选手不存在', icon: 'none' });
      }
    } catch (err) {
      console.error('Fetch player detail failed', err);
      wx.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  }
});