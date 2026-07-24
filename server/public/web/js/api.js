/**
 * Web 端 API 客户端
 * 基于 fetch 封装，替代小程序 wx.request
 */
const API = {

  /** 设置 auth token */



  async request(method, path, body, opts = {}) {
    const headers = { 'Content-Type': 'application/json' };

    try {
      const res = await fetch(`/api${path}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      const json = await res.json();
      return json;
    } catch (err) {
      console.error(`[API] ${method} ${path} error:`, err);
      return { code: -1, message: '网络请求失败', data: null };
    }
  },

  get(path, params, opts) {
    const qs = params ? '?' + Object.entries(params)
      .filter(([_, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join('&') : '';
    return this.request('GET', `${path}${qs}`, undefined, opts);
  },
  post(path, body, opts) { return this.request('POST', path, body, opts); },
  put(path, body, opts) { return this.request('PUT', path, body, opts); },
  del(path, opts) { return this.request('DELETE', path, undefined, opts); },

  // ================== 用户认证 ==================

  /** Web 端手机号登录 */

  /** 管理员登录 */
  async adminLogin(username, password) {
    const res = await this.post('/admin/login', { username, password }, { noAuth: true });
    if (res.code === 0 && res.data) {
      localStorage.setItem('adminToken', res.data.token);
      return { success: true, data: res.data };
    }
    return { success: false, message: res.message || '登录失败' };
  },

  /** 获取本地缓存的用户信息 */

  /** 清除登录 */

  /** 从后端获取用户信息 */
  async fetchProfile() {
    return this.get('/users/profile');
  },

  /** 更新用户信息 */
  async updateProfile(data) {
    return this.put('/users/profile', data);
  },

  // ================== 选手 API ==================

  async fetchPlayers(skip = 0, limit = 20) {
    const res = await this.get('/players', { skip, limit });
    return { success: res.code === 0, data: res.data || [] };
  },

  async fetchPlayerDetail(playerId) {
    const res = await this.get(`/players/${encodeURIComponent(playerId)}`);
    return { success: res.code === 0, data: res.data || null };
  },

  async searchPlayers(keyword, page = 0, pageSize = 20, difficulty) {
    if (!keyword || !keyword.trim()) return { success: true, data: [], hasMore: false, total: 0 };
    let qs = `q=${encodeURIComponent(keyword)}&page=${page}&pageSize=${pageSize}`;
    if (difficulty) qs += `&difficulty=${encodeURIComponent(difficulty)}`;
    const res = await fetch(`/api/players/search?${qs}`);
    const json = await res.json();
    if (json.code === 0) {
      return { success: true, data: json.data || [], hasMore: !!json.hasMore, total: json.total || 0 };
    }
    return { success: false, data: [], hasMore: false, total: 0 };
  },

  async fetchPlayerCount() {
    const res = await this.get('/players/count');
    return res.code === 0 ? res.data : { total: 0 };
  },

  async fetchPlayerRanking(page = 0, pageSize = 60) {
    const res = await this.get('/players/ranking', { page, pageSize });
    if (res.code === 0) {
      return { success: true, data: res.data || [], hasMore: !!res.hasMore, total: res.total || 0 };
    }
    return { success: false, data: [], hasMore: false, total: 0 };
  },

  async fetchPlayerPoolByDifficulty(difficulty) {
    const res = await this.get('/players/pool', { difficulty });
    return { success: res.code === 0, data: res.data || [] };
  },

  async fetchRandomPlayerByDifficulty(difficulty) {
    const res = await this.get('/players/random-by-difficulty', { difficulty });
    return { success: res.code === 0, data: res.data || null };
  },

  async advancedSearch(params) {
    const qs = Object.entries(params)
      .filter(([_, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join('&');
    const res = await fetch(`/api/players/search?${qs}`);
    const json = await res.json();
    if (json.code === 0) {
      return { success: true, data: json.data || [], hasMore: !!json.hasMore, total: json.total || 0 };
    }
    return { success: false, data: [], hasMore: false, total: 0 };
  },

  // ================== 比赛 API ==================

  async fetchMatchEvents(grade) {
    const params = grade ? { grade } : {};
    const res = await this.get('/matches/events', params);
    return { success: res.code === 0, data: res.data || [] };
  },

  async fetchMatches(event) {
    const params = event ? { event } : {};
    const res = await this.get('/matches', params);
    return { success: res.code === 0, data: res.data || [] };
  },

  async fetchMatchDetail(id) {
    const res = await this.get(`/matches/${id}`);
    return { success: res.code === 0, data: res.data || null };
  },

  async fetchMatchPlayers(matchId) {
    if (!matchId) return { success: false, data: null, message: 'matchId 必填' };
    const res = await this.get(`/matches/${matchId}/players`);
    return { success: res.code === 0, data: res.data || null };
  },

  // ================== 评论 API ==================

  async fetchComments(playerGameId, page = 0, pageSize = 20) {
    return this.get('/comments', { playerGameId, page, pageSize });
  },

  async addComment(playerGameId, content, userId) {
    return this.post('/comments', { playerGameId, content, userId });
  },

  async deleteComment(commentId, userId) {
    return this.del(`/comments/${commentId}`, { userId });
  },

  // ================== 战队 API ==================

  async fetchTeamRanking(region = 'all', page = 0, pageSize = 60) {
    const res = await this.get('/teams/ranking', { region, page, pageSize });
    if (res.code === 0) {
      return { success: true, data: res.data || [], hasMore: !!res.hasMore, total: res.total || 0 };
    }
    return { success: false, data: [], hasMore: false, total: 0 };
  },

  // ================== 竞猜记录 API ==================

  async fetchGuessRecords(page = 0, pageSize = 20) {
    return this.get('/users/guess/records', { page, pageSize });
  },

  async submitGuessRecord(data) {
    return this.post('/users/guess/record', data);
  },

  async fetchRanking(mode) {
    const res = await this.get('/users/ranking', { mode });
    return { success: res.code === 0, data: res.data || [] };
  },

  // ================== 代币系统 API ==================

  async fetchCoinBalance() {
    return this.get('/coins/balance');
  },

  async fetchShopItems() {
    const res = await this.get('/coins/shop');
    return { success: res.code === 0, data: res.data || [] };
  },

  async fetchUserItems() {
    const res = await this.get('/coins/items');
    return { success: res.code === 0, data: res.data || [] };
  },

  async buyShopItem(itemId, quantity = 1) {
    return this.post('/coins/shop/buy', { itemId, quantity });
  },

  // ================== 年度猜测 API ==================

  async submitPick(slot, playerGameId, playerName, year = 2026) {
    return this.post('/picks/submit-slot', { year, slot, playerGameId, playerName });
  },

  async fetchMyPicks(year = 2026) {
    return this.get(`/picks/my-picks?year=${year}`);
  },

  async fetchPickConfig(year = 2026) {
    const res = await this.get(`/picks/config?year=${year}`);
    return { success: res.code === 0, data: res.data || null };
  },

  // ================== 管理后台 API ==================

  adminGetToken() { return localStorage.getItem('adminToken'); },

  async adminRequest(method, path, body) {
    const headers = { 'Content-Type': 'application/json' };
    const token = this.adminGetToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
    try {
      const res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
      const json = await res.json();
      if (json.code === 0) return json.data;
      throw new Error(json.message || '请求失败');
    } catch (err) {
      throw err;
    }
  },

  adminGet(path) { return this.adminRequest('GET', path); },
  adminPost(path, body) { return this.adminRequest('POST', path, body); },
  adminPut(path, body) { return this.adminRequest('PUT', path, body); },
  adminDel(path) { return this.adminRequest('DELETE', path); },

  async adminLoginRequest(username, password) {
    return this.adminPost('/api/admin/login', { username, password });
  },
  async adminVerify() { return this.adminGet('/api/admin/verify'); },
  async adminGetUsers(page = 0, pageSize = 20) {
    return this.adminGet(`/api/users/admin/list?page=${page}&pageSize=${pageSize}`);
  },
  async adminUpdateUser(openid, data) {
    return this.adminPut(`/api/users/admin/${encodeURIComponent(openid)}`, data);
  },
  async adminDeleteUser(openid) {
    return this.adminDel(`/api/users/admin/${encodeURIComponent(openid)}`);
  },
  async adminGetPendingComments(page = 0, pageSize = 20) {
    return this.adminGet(`/api/comments/admin/pending?page=${page}&pageSize=${pageSize}`);
  },
  async adminReviewComment(id, status) {
    return this.adminPost(`/api/comments/${id}/review`, { status, reviewer: 'admin' });
  },
  async adminGetPickConfig(year = 2026) {
    return this.adminGet(`/api/picks/config?year=${year}`);
  },
  async adminSetPickConfig(year, config) {
    return this.adminPost('/api/picks/admin/config', { year, config });
  },
  async adminGetOfficialTop30(year = 2026) {
    return this.adminGet(`/api/picks/admin/official?year=${year}`);
  },
  async adminSetOfficialTop30(year, winners) {
    return this.adminPost('/api/picks/admin/official', { year, winners, adminOpenid: 'admin' });
  },
  async adminCheckPicks(year = 2026, threshold = 15, page = 0) {
    return this.adminGet(`/api/picks/admin/check?year=${year}&matchThreshold=${threshold}&page=${page}`);
  },
  async adminAwardPicks(year = 2026, threshold = 15) {
    return this.adminPost('/api/picks/admin/award', { year, matchThreshold: threshold, coinsPerMatch: 10, adminOpenid: 'admin' });
  },
};
