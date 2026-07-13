import {
  fetchPlayerListPaginated,
  searchPlayers,
  advancedSearchPlayers,
  fetchPlayerCount,
  Player
} from '../../services/api';
import { STATIC_BASE } from '../../config';

// HLTV 占位剪影 URL（"无定妆照"），需当作无头像处理
const SILHOUETTE_URLS = [
  'https://www.hltv.org/img/static/player/player_silhouette.png',
  'https://www.hltv.org/img/static/player/player_silhouette_fe.png'
];

// 头像 URL 归一化
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

const PAGE_SIZE = 20;

Page({
  data: {
    loading: true,
    loadingMore: false,
    displayPlayers: [] as (Player & { avatarUrl?: string })[],
    hasMore: true,
    page: 0,
    totalCount: 0,
    searchTotal: 0,          // 搜索结果总数

    // 简单搜索
    searchQuery: '',
    searchPage: 0,
    searchHasMore: false,

    // 高级搜索
    showAdvanced: false,
    advName: '',
    advAgeMin: '',
    advAgeMax: '',
    advCountry: '',
    advTeam: '',
    advFormerTeam: '',
    isAdvancedSearch: false   // 当前是否处于高级搜索模式
  },

  onLoad() {
    this.loadPlayers();
  },

  async loadPlayers() {
    this.setData({ loading: true, isAdvancedSearch: false });
    try {
      const countRes = await fetchPlayerCount();
      const totalCount = countRes.success && countRes.data ? countRes.data.total : 0;

      const res = await fetchPlayerListPaginated(0, PAGE_SIZE);
      if (res.success) {
        const playersWithAvatar = res.data.map(player => ({
          ...player,
          avatarUrl: normalizeAvatarUrl(player.avatar)
        }));

        const newCount = res.data.length;
        const hasMore = newCount > 0 && newCount < totalCount;

        this.setData({
          displayPlayers: playersWithAvatar,
          hasMore,
          page: 0,
          totalCount,
          searchTotal: 0
        });
      }
    } catch (err) {
      console.error('Fetch players failed', err);
    } finally {
      this.setData({ loading: false });
    }
  },

  async loadMorePlayers() {
    if (this.data.loadingMore || !this.data.hasMore) return;

    this.setData({ loadingMore: true });

    if (this.data.isAdvancedSearch) {
      // 高级搜索加载更多（带上搜索框关键词 q）
      const nextPage = this.data.searchPage + 1;
      try {
        const filters = this.getAdvancedFilters();
        const keyword = this.data.searchQuery.trim();
        const res = await advancedSearchPlayers({ q: keyword || undefined, ...filters, page: nextPage, pageSize: PAGE_SIZE });
        if (res.success) {
          const newPlayersWithAvatar = res.data.map(player => ({
            ...player,
            avatarUrl: normalizeAvatarUrl(player.avatar)
          }));
          this.setData({
            displayPlayers: [...this.data.displayPlayers, ...newPlayersWithAvatar],
            searchHasMore: res.hasMore,
            hasMore: res.hasMore,
            searchPage: nextPage
          });
        }
      } catch (err) {
        console.error('Load more advanced search failed', err);
      } finally {
        this.setData({ loadingMore: false });
      }
      return;
    }

    if (this.data.searchQuery) {
      // 简单搜索加载更多
      const nextPage = this.data.searchPage + 1;
      try {
        const res = await searchPlayers(this.data.searchQuery, nextPage, PAGE_SIZE);
        if (res.success) {
          const newPlayersWithAvatar = res.data.map(player => ({
            ...player,
            avatarUrl: normalizeAvatarUrl(player.avatar)
          }));
          this.setData({
            displayPlayers: [...this.data.displayPlayers, ...newPlayersWithAvatar],
            searchHasMore: res.hasMore,
            hasMore: res.hasMore,
            searchPage: nextPage
          });
        }
      } catch (err) {
        console.error('Load more search failed', err);
      } finally {
        this.setData({ loadingMore: false });
      }
      return;
    }

    // 浏览模式加载更多
    const nextPage = this.data.page + 1;
    try {
      const res = await fetchPlayerListPaginated(nextPage, PAGE_SIZE);
      if (res.success) {
        const newPlayersWithAvatar = res.data.map(player => ({
          ...player,
          avatarUrl: normalizeAvatarUrl(player.avatar)
        }));
        const currentCount = this.data.displayPlayers.length;
        const newCount = res.data.length;
        const hasMore = newCount > 0 && currentCount + newCount < this.data.totalCount;

        this.setData({
          displayPlayers: [...this.data.displayPlayers, ...newPlayersWithAvatar],
          hasMore,
          page: nextPage
        });
      }
    } catch (err) {
      console.error('Load more players failed', err);
    } finally {
      this.setData({ loadingMore: false });
    }
  },

  // ============ 简单搜索 ============

  onSearchInput(e: WechatMiniprogram.Input) {
    const query = e.detail.value.trim();
    this.setData({ searchQuery: query });

    // 高级模式下，搜索框仅提供关键词输入，不自动搜索
    if (this.data.isAdvancedSearch) return;

    if (!query) {
      this.setData({ page: 0, hasMore: true, searchTotal: 0 });
      this.loadPlayers();
      return;
    }

    searchPlayers(query, 0, PAGE_SIZE).then(res => {
      if (res.success) {
        const playersWithAvatar = res.data.map(player => ({
          ...player,
          avatarUrl: normalizeAvatarUrl(player.avatar)
        }));
        const total = res.total ?? res.data.length;
        this.setData({
          displayPlayers: playersWithAvatar,
          searchHasMore: res.hasMore,
          hasMore: res.hasMore,
          searchPage: 0,
          searchTotal: total
        });
        if (res.data.length > 0) {
          wx.showToast({ title: `找到 ${total} 个结果${res.hasMore ? '+' : ''}`, icon: 'none' });
        }
      }
    });
  },

  // ============ 模式切换 ============

  toggleSearchMode() {
    const switchingToAdvanced = !this.data.isAdvancedSearch;
    if (switchingToAdvanced) {
      // 切换到高级模式：隐藏普通搜索结果，显示高级搜索面板
      this.setData({
        isAdvancedSearch: true,
        searchQuery: ''
      });
    } else {
      // 切换回普通模式：隐藏高级面板，恢复全部选手列表
      this.setData({
        isAdvancedSearch: false,
        advName: '',
        advAgeMin: '',
        advAgeMax: '',
        advCountry: '',
        advTeam: '',
        advFormerTeam: '',
        searchTotal: 0
      });
      this.loadPlayers();
    }
  },

  // ============ 高级搜索 ============

  onAdvNameInput(e: WechatMiniprogram.Input) { this.setData({ advName: e.detail.value }); },
  onAdvAgeMinInput(e: WechatMiniprogram.Input) { this.setData({ advAgeMin: e.detail.value }); },
  onAdvAgeMaxInput(e: WechatMiniprogram.Input) { this.setData({ advAgeMax: e.detail.value }); },
  onAdvCountryInput(e: WechatMiniprogram.Input) { this.setData({ advCountry: e.detail.value }); },
  onAdvTeamInput(e: WechatMiniprogram.Input) { this.setData({ advTeam: e.detail.value }); },
  onAdvFormerTeamInput(e: WechatMiniprogram.Input) { this.setData({ advFormerTeam: e.detail.value }); },

  getAdvancedFilters() {
    return {
      name: this.data.advName,
      ageMin: this.data.advAgeMin,
      ageMax: this.data.advAgeMax,
      country: this.data.advCountry,
      team: this.data.advTeam,
      formerTeam: this.data.advFormerTeam
    };
  },

  /**
   * 执行高级搜索（将搜索框关键词作为 q 参数传入后端）
   */
  doAdvancedSearch() {
    const filters = this.getAdvancedFilters();
    const keyword = this.data.searchQuery.trim();
    const hasAny = keyword || filters.name || filters.ageMin || filters.ageMax || filters.country || filters.team || filters.formerTeam;
    if (!hasAny) {
      wx.showToast({ title: '请至少填写一个搜索条件', icon: 'none' });
      return;
    }

    this.setData({ loading: true, isAdvancedSearch: true });

    advancedSearchPlayers({ q: keyword || undefined, ...filters, page: 0, pageSize: PAGE_SIZE }).then(res => {
      if (res.success) {
        const playersWithAvatar = res.data.map(player => ({
          ...player,
          avatarUrl: normalizeAvatarUrl(player.avatar)
        }));
        const total = res.total ?? res.data.length;
        this.setData({
          displayPlayers: playersWithAvatar,
          searchHasMore: res.hasMore,
          hasMore: res.hasMore,
          searchPage: 0,
          searchTotal: total
        });
        wx.showToast({ title: `共找到 ${total} 个结果${res.hasMore ? '+' : ''}`, icon: 'none' });
      }
    }).catch(err => {
      console.error('Advanced search failed', err);
    }).finally(() => {
      this.setData({ loading: false });
    });
  },

  // 高级面板中的"搜索"按钮
  onAdvancedSearch() {
    this.doAdvancedSearch();
  },

  // 搜索框右侧的"搜索"按钮（高级模式）
  onAdvancedSearchFromBar() {
    this.doAdvancedSearch();
  },

  onAdvancedClear() {
    this.setData({
      advName: '',
      advAgeMin: '',
      advAgeMax: '',
      advCountry: '',
      advTeam: '',
      advFormerTeam: '',
      isAdvancedSearch: false,
      showAdvanced: false
    });
    this.loadPlayers();
  },

  // ============ 通用 ============

  onReachBottom() {
    if (this.data.loadingMore || !this.data.hasMore) return;
    this.loadMorePlayers();
  },

  goToDetail(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({
      url: `/pages/player/detail?id=${id}`
    });
  }
});
