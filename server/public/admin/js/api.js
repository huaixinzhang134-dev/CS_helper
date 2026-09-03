/**
 * 管理后台 API 客户端
 */
const API = {
  getToken() { return localStorage.getItem('adminToken'); },

  async request(method, path, body) {
    const headers = { 'Content-Type': 'application/json' };
    const token = this.getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const json = await res.json();
    if (json.code === 0) return json.data;
    throw new Error(json.message || '请求失败');
  },

  get(path) { return this.request('GET', path); },
  post(path, body) { return this.request('POST', path, body); },
  put(path, body) { return this.request('PUT', path, body); },
  del(path) { return this.request('DELETE', path); },

  // 登录
  login(username, password) { return this.post('/api/admin/login', { username, password }); },
  verify() { return this.get('/api/admin/verify'); },

  // 用户管理
  getUsers(page = 0, pageSize = 20) { return this.get(`/api/users/admin/list?page=${page}&pageSize=${pageSize}`); },
  updateUser(openid, data) { return this.put(`/api/users/admin/${encodeURIComponent(openid)}`, data); },
  deleteUser(openid) { return this.del(`/api/users/admin/${encodeURIComponent(openid)}`); },

  // 评论审核
  getPendingComments(page = 0, pageSize = 20) { return this.get(`/api/comments/admin/pending?page=${page}&pageSize=${pageSize}`); },
  reviewComment(id, status) { return this.post(`/api/comments/${id}/review`, { status, reviewer: 'admin' }); },

  // 猜测
  getPickConfig(year = 2026) { return this.get(`/api/picks/config?year=${year}`); },
  setPickConfig(year, config) { return this.post('/api/picks/admin/config', { year, config }); },
  getOfficialTop30(year = 2026) { return this.get(`/api/picks/admin/official?year=${year}`); },
  setOfficialTop30(year, winners) { return this.post('/api/picks/admin/official', { year, winners, adminOpenid: 'admin' }); },
  checkPicks(year = 2026, threshold = 15, page = 0) { return this.get(`/api/picks/admin/check?year=${year}&matchThreshold=${threshold}&page=${page}`); },
  awardPicks(year = 2026, threshold = 15, coinsPerMatch = 10) { return this.post('/api/picks/admin/award', { year, matchThreshold: threshold, coinsPerMatch, adminOpenid: 'admin' }); },

  // 选手管理
  getAdminPlayers(page = 0, pageSize = 20, q = '') { return this.get(`/api/players/admin/list?page=${page}&pageSize=${pageSize}&q=${encodeURIComponent(q)}`); },
  getAdminPlayer(playerId) { return this.get(`/api/players/admin/${encodeURIComponent(playerId)}`); },
  updateAdminPlayer(playerId, data) { return this.put(`/api/players/admin/${encodeURIComponent(playerId)}`, data); },

  // 战队管理
  getAdminTeams(page = 0, pageSize = 20, q = '') { return this.get(`/api/teams/admin/list?page=${page}&pageSize=${pageSize}&q=${encodeURIComponent(q)}`); },
  getAdminTeam(teamId) { return this.get(`/api/teams/admin/${encodeURIComponent(teamId)}`); },
  updateAdminTeam(teamId, data) { return this.put(`/api/teams/admin/${encodeURIComponent(teamId)}`, data); },
  getTeamMembers(teamId) { return this.get(`/api/teams/admin/${encodeURIComponent(teamId)}/members`); },
  addTeamMember(teamId, playerId) { return this.post(`/api/teams/admin/${encodeURIComponent(teamId)}/members`, { playerId }); },
  removeTeamMember(teamId, playerId) { return this.del(`/api/teams/admin/${encodeURIComponent(teamId)}/members/${encodeURIComponent(playerId)}`); },

  // 绰号审核
  getNicknames(status = 'pending', page = 0, pageSize = 20) { return this.get(`/api/admin/nicknames?status=${status}&page=${page}&pageSize=${pageSize}`); },
  approveNickname(id) { return this.post(`/api/admin/nicknames/${id}/approve`); },
  rejectNickname(id) { return this.post(`/api/admin/nicknames/${id}/reject`); },
};
