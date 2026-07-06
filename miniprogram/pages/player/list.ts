import {
  fetchPlayerListPaginated,
  searchPlayers,
  fetchPlayerCount,
  Player
} from '../../services/api';
import { STATIC_BASE } from '../../config';

// HLTV 占位剪影 URL（"无定妆照"），需当作无头像处理
const SILHOUETTE_URLS = [
  'https://www.hltv.org/img/static/player/player_silhouette.png',
  'https://www.hltv.org/img/static/player/player_silhouette_fe.png'
];

// 头像 URL 归一化：
//   - 空 / 未知 / silhouette → 兜底本地默认头像
//   - /static/... 后端相对路径 → 拼 STATIC_BASE
//   - 其他完整 URL（http(s)://）→ 直接用
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

const PAGE_SIZE = 20; // 每页加载50条

Page({
  data: {
    loading: true,
    loadingMore: false,
    displayPlayers: [] as (Player & { avatarUrl?: string })[],
    searchQuery: '',
    hasMore: true,
    page: 0,
    totalCount: 0
  },

  onLoad() {
    this.loadPlayers();
  },

  async loadPlayers() {
    this.setData({ loading: true });
    try {
      // 先获取总数
      const countRes = await fetchPlayerCount();
      const totalCount = countRes.success && countRes.data ? countRes.data.total : 0;

      // 加载第一页数据
      const res = await fetchPlayerListPaginated(0, PAGE_SIZE);
      if (res.success) {
        const playersWithAvatar = res.data.map(player => ({
          ...player,
          avatarUrl: normalizeAvatarUrl(player.avatar)
        }));

        // 计算 hasMore：返回数据大于0且总数大于当前数量
        const newCount = res.data.length;
        const hasMore = newCount > 0 && newCount < totalCount;

        this.setData({
          displayPlayers: playersWithAvatar,
          hasMore: hasMore,
          page: 0,
          totalCount
        });
        console.log(`数据库共 ${totalCount} 条，已加载 ${newCount} 条，hasMore: ${hasMore}`);
      }
    } catch (err) {
      console.error('Fetch players failed', err);
    } finally {
      this.setData({ loading: false });
    }
  },

  async loadMorePlayers() {
    if (this.data.loadingMore || !this.data.hasMore || this.data.searchQuery) {
      console.log('跳过加载:', { loadingMore: this.data.loadingMore, hasMore: this.data.hasMore, searchQuery: this.data.searchQuery });
      return;
    }

    this.setData({ loadingMore: true });
    const nextPage = this.data.page + 1;
    console.log(`开始加载第 ${nextPage} 页...`);

    try {
      const res = await fetchPlayerListPaginated(nextPage, PAGE_SIZE);
      if (res.success) {
        const newPlayersWithAvatar = res.data.map(player => ({
          ...player,
          avatarUrl: normalizeAvatarUrl(player.avatar)
        }));
        const currentCount = this.data.displayPlayers.length;
        const newCount = res.data.length;
        // 安全检查：如果返回0条或已加载完所有数据，则没有更多了
        const hasMore = newCount > 0 && currentCount + newCount < this.data.totalCount;

        this.setData({
          displayPlayers: [...this.data.displayPlayers, ...newPlayersWithAvatar],
          hasMore: hasMore,
          page: nextPage
        });
        console.log(`第 ${nextPage + 1} 页加载完成，本页 ${newCount} 条，累计 ${currentCount + newCount} 条，总共 ${this.data.totalCount} 条，hasMore: ${hasMore}`);
      }
    } catch (err) {
      console.error('Load more players failed', err);
    } finally {
      this.setData({ loadingMore: false });
    }
  },

  onSearchInput(e: WechatMiniprogram.Input) {
    const query = e.detail.value.trim();
    this.setData({ searchQuery: query });

    if (!query) {
      // 清空搜索时重新加载第一页
      this.setData({ page: 0, hasMore: true });
      this.loadPlayers();
      return;
    }

    // 使用云数据库模糊搜索（不区分大小写）
    searchPlayers(query).then(res => {
      if (res.success) {
        const playersWithAvatar = res.data.map(player => ({
          ...player,
          avatarUrl: normalizeAvatarUrl(player.avatar)
        }));
        this.setData({ displayPlayers: playersWithAvatar, hasMore: false });
        wx.showToast({ title: `找到 ${res.data.length} 个结果`, icon: 'none' });
      }
    });
  },

  // 页面滑动到底部事件
  onReachBottom() {
    console.log('页面触底，当前页:', this.data.page, 'hasMore:', this.data.hasMore, 'totalCount:', this.data.totalCount, 'displayPlayers.length:', this.data.displayPlayers.length);
    if (!this.data.searchQuery) {
      this.loadMorePlayers();
    }
  },

  goToDetail(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({
      url: `/pages/player/detail?id=${id}`
    });
  }
});
