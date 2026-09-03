/**
 * 管理后台主逻辑
 */
let userPage = 0, commentPage = 0;

// ==================== 登录 ====================
async function doLogin() {
  const username = document.getElementById('loginUsername').value.trim();
  const password = document.getElementById('loginPassword').value;
  if (!username || !password) return showLoginError('请输入用户名和密码');

  document.getElementById('loginBtn').disabled = true;
  try {
    const data = await API.login(username, password);
    localStorage.setItem('adminToken', data.token);
    document.getElementById('adminUserDisplay').textContent = data.username;
    showPage('mainPage');
    loadUsers();
  } catch (e) {
    showLoginError(e.message);
  }
  document.getElementById('loginBtn').disabled = false;
}

function showLoginError(msg) {
  document.getElementById('loginError').textContent = msg;
}

function doLogout() {
  localStorage.removeItem('adminToken');
  showPage('loginPage');
  document.getElementById('loginUsername').value = '';
  document.getElementById('loginPassword').value = '';
}

function showPage(id) {
  document.querySelectorAll('.page').forEach(p => p.style.display = 'none');
  document.getElementById(id).style.display = 'block';
}

// ==================== 初始化 ====================
async function init() {
  const token = API.getToken();
  if (!token) { showPage('loginPage'); return; }
  try {
    await API.verify();
    showPage('mainPage');
    loadUsers();
  } catch (e) {
    localStorage.removeItem('adminToken');
    showPage('loginPage');
  }
}

// ==================== Tab 切换 ====================
function switchTab(tab) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelector(`.tab[data-tab="${tab}"]`).classList.add('active');
  document.querySelectorAll('.tab-content').forEach(c => c.style.display = 'none');
  document.getElementById(`tab-${tab}`).style.display = 'block';

  if (tab === 'users') loadUsers();
  else if (tab === 'players') loadPlayers();
  else if (tab === 'teams') loadTeams();
  else if (tab === 'comments') loadComments();
  else if (tab === 'nicknames') loadNicknames();
  else if (tab === 'votes') { loadSlotConfig(); loadWinners(); }
}

// ==================== 用户管理 ====================
async function loadUsers() {
  const search = document.getElementById('userSearch')?.value || '';
  try {
    const data = await API.getUsers(userPage, 20);
    const tbody = document.getElementById('userTableBody');
    tbody.innerHTML = data.list.map(u => `<tr>
      <td>${u.id}</td>
      <td>${esc(u.nickname)}</td>
      <td>${u.winCount}</td>
      <td>${u.totalGames}</td>
      <td>${u.winRate}%</td>
      <td>${u.coins}</td>
      <td>
        <button class="btn-edit" onclick="openUserModal('${esc(u.openid)}','${esc(u.nickname)}',${u.coins})">编辑</button>
        <button class="btn-del" onclick="deleteUser('${esc(u.openid)}')">删除</button>
      </td>
    </tr>`).join('');
    renderUserPagination(data.total);
  } catch (e) { showError(e); }
}

function renderUserPagination(total) {
  const pageSize = 20;
  const totalPages = Math.ceil(total / pageSize);
  const el = document.getElementById('userPagination');
  let html = `<span>共 ${total} 条，第 ${userPage + 1}/${totalPages} 页</span>`;
  html += `<button class="btn-page" onclick="goUserPage(${userPage - 1})" ${userPage <= 0 ? 'disabled' : ''}>上一页</button>`;
  html += `<button class="btn-page" onclick="goUserPage(${userPage + 1})" ${userPage >= totalPages - 1 ? 'disabled' : ''}>下一页</button>`;
  el.innerHTML = html;
}

function goUserPage(page) {
  userPage = Math.max(0, page);
  loadUsers();
}

function openUserModal(openid, nickname, coins) {
  document.getElementById('editOpenid').value = openid;
  document.getElementById('editNickname').value = nickname;
  document.getElementById('editCoins').value = coins;
  document.getElementById('userModal').style.display = 'flex';
}

function closeModal(id) {
  document.getElementById(id).style.display = 'none';
}

async function saveUser() {
  const openid = document.getElementById('editOpenid').value;
  const nickname = document.getElementById('editNickname').value.trim();
  const coins = parseInt(document.getElementById('editCoins').value) || 0;
  try {
    await API.updateUser(openid, { nickname, coins });
    alert('更新成功');
    closeModal('userModal');
    loadUsers();
  } catch (e) { alert(e.message); }
}

async function deleteUser(openid) {
  if (!confirm('确定删除此用户？')) return;
  try {
    await API.deleteUser(openid);
    loadUsers();
  } catch (e) { alert(e.message); }
}

// ==================== 选手管理 ====================
let playerPage = 0;
let playerSearchTimer = null;

function debouncePlayerSearch() {
  clearTimeout(playerSearchTimer);
  playerSearchTimer = setTimeout(() => { playerPage = 0; loadPlayers(); }, 300);
}

async function loadPlayers() {
  const q = document.getElementById('playerSearch')?.value || '';
  try {
    const data = await API.getAdminPlayers(playerPage, 20, q);
    const tbody = document.getElementById('playerTableBody');
    const STATUS_MAP = { active: '现役', retired: '退役', coach: '教练', free_agent: '自由人', unknown: '未知' };
    tbody.innerHTML = (data.list || []).map(p => `<tr>
      <td>${p.playerId}</td>
      <td><strong>${esc(p.name)}</strong></td>
      <td>${esc(p.realName || '-')}</td>
      <td>${esc(p.team || '-')}</td>
      <td>${p.position || '-'}</td>
      <td>${STATUS_MAP[p.status] || p.status}</td>
      <td>${p.rating || '-'}</td>
      <td>
        <button class="btn-edit" onclick="openPlayerModal('${esc(p.playerId)}')">编辑</button>
      </td>
    </tr>`).join('');
    renderPlayerPagination(data.total || 0);
  } catch (e) { showError(e); }
}

function renderPlayerPagination(total) {
  const pageSize = 20;
  const totalPages = Math.ceil(total / pageSize) || 1;
  const el = document.getElementById('playerPagination');
  if (total === 0) { el.innerHTML = '暂无选手数据'; return; }
  el.innerHTML = `<span>共 ${total} 条，第 ${playerPage + 1}/${totalPages} 页</span>
    <button class="btn-page" onclick="goPlayerPage(${playerPage - 1})" ${playerPage <= 0 ? 'disabled' : ''}>上一页</button>
    <button class="btn-page" onclick="goPlayerPage(${playerPage + 1})" ${playerPage >= totalPages - 1 ? 'disabled' : ''}>下一页</button>`;
}

function goPlayerPage(page) {
  playerPage = Math.max(0, page);
  loadPlayers();
}

async function openPlayerModal(playerId) {
  try {
    const p = await API.getAdminPlayer(playerId);
    document.getElementById('editPlayerId').value = p.playerId;
    document.getElementById('editPlayerName').value = p.name || '';
    document.getElementById('editPlayerRealName').value = p.realName || '';
    document.getElementById('editPlayerTeam').value = p.team || '';
    document.getElementById('editPlayerFormerTeams').value =
      Array.isArray(p.formerTeams) ? p.formerTeams.join(', ') : (p.formerTeams || '');
    document.getElementById('editPlayerPosition').value = p.position || '步枪手';
    document.getElementById('editPlayerStatus').value = p.status || 'active';
    document.getElementById('editPlayerRating').value = p.rating || 0;
    document.getElementById('editPlayerSniping').value = p.sniping || 0;
    document.getElementById('editPlayerMajor').value = p.majorAppearances || 0;
    document.getElementById('playerModal').style.display = 'flex';
  } catch (e) { alert(e.message); }
}

async function savePlayer() {
  const playerId = document.getElementById('editPlayerId').value;
  const data = {
    name: document.getElementById('editPlayerName').value.trim(),
    realName: document.getElementById('editPlayerRealName').value.trim(),
    team: document.getElementById('editPlayerTeam').value.trim(),
    formerTeams: document.getElementById('editPlayerFormerTeams').value
      .split(/[,，]/).map(s => s.trim()).filter(Boolean),
    position: document.getElementById('editPlayerPosition').value,
    status: document.getElementById('editPlayerStatus').value,
    rating: parseFloat(document.getElementById('editPlayerRating').value) || 0,
    sniping: parseInt(document.getElementById('editPlayerSniping').value) || 0,
    majorAppearances: parseInt(document.getElementById('editPlayerMajor').value) || 0,
  };
  try {
    await API.updateAdminPlayer(playerId, data);
    alert('更新成功');
    closeModal('playerModal');
    loadPlayers();
  } catch (e) { alert(e.message); }
}

// ==================== 战队管理 ====================
let teamPage = 0;
let teamSearchTimer = null;

function debounceTeamSearch() {
  clearTimeout(teamSearchTimer);
  teamSearchTimer = setTimeout(() => { teamPage = 0; loadTeams(); }, 300);
}

async function loadTeams() {
  const q = document.getElementById('teamSearch')?.value || '';
  try {
    const data = await API.getAdminTeams(teamPage, 20, q);
    const tbody = document.getElementById('teamTableBody');
    const REGION_MAP = { Europe: '欧洲', Americas: '美洲', Asia: '亚洲', Other: '其他' };
    tbody.innerHTML = (data.list || []).map(t => `<tr>
      <td>${t.id}</td>
      <td><strong>${esc(t.name)}</strong></td>
      <td>${REGION_MAP[t.region] || t.region}</td>
      <td>${t.memberCount}</td>
      <td>${t.logoUrl ? `<img src="${esc(t.logoUrl)}" style="height:24px;width:auto" title="HLTV">` : '-'}</td>
      <td>${t.logo5eplayUrl ? `<img src="${esc(t.logo5eplayUrl)}" style="height:24px;width:auto" title="5eplay">` : '-'}</td>
      <td>
        <button class="btn-edit" onclick="openTeamModal(${t.id})">编辑</button>
      </td>
    </tr>`).join('');
    renderTeamPagination(data.total || 0);
  } catch (e) { showError(e); }
}

function renderTeamPagination(total) {
  const pageSize = 20;
  const totalPages = Math.ceil(total / pageSize) || 1;
  const el = document.getElementById('teamPagination');
  if (total === 0) { el.innerHTML = '暂无战队数据'; return; }
  el.innerHTML = `<span>共 ${total} 条，第 ${teamPage + 1}/${totalPages} 页</span>
    <button class="btn-page" onclick="goTeamPage(${teamPage - 1})" ${teamPage <= 0 ? 'disabled' : ''}>上一页</button>
    <button class="btn-page" onclick="goTeamPage(${teamPage + 1})" ${teamPage >= totalPages - 1 ? 'disabled' : ''}>下一页</button>`;
}

function goTeamPage(page) {
  teamPage = Math.max(0, page);
  loadTeams();
}

async function openTeamModal(teamId) {
  try {
    const t = await API.getAdminTeam(teamId);
    document.getElementById('editTeamId').value = t.id;
    document.getElementById('editTeamName').value = t.name || '';
    document.getElementById('editTeamRegion').value = t.region || 'Other';
    document.getElementById('editTeamLogoUrl').value = t.logoUrl || '';
    document.getElementById('editTeamLogo5eplayUrl').value = t.logo5eplayUrl || '';
    document.getElementById('teamMemberSearch').value = '';
    document.getElementById('teamMemberSearchResults').innerHTML = '';
    document.getElementById('teamModal').style.display = 'flex';
    loadTeamMembers(t.id);
  } catch (e) { alert(e.message); }
}

async function saveTeam() {
  const teamId = document.getElementById('editTeamId').value;
  const data = {
    name: document.getElementById('editTeamName').value.trim(),
    region: document.getElementById('editTeamRegion').value,
    logoUrl: document.getElementById('editTeamLogoUrl').value.trim(),
    logo5eplayUrl: document.getElementById('editTeamLogo5eplayUrl').value.trim(),
  };
  if (!data.name) { alert('队名不能为空'); return; }
  try {
    await API.updateAdminTeam(teamId, data);
    alert('更新成功');
    closeModal('teamModal');
    loadTeams();
  } catch (e) { alert(e.message); }
}

// ==================== 战队成员管理 ====================
const STATUS_TEXT = { active: '现役', retired: '退役', coach: '教练', free_agent: '自由人', unknown: '未知' };
const POSITION_TEXT = { awper: '狙击手', rifler: '步枪手', igl: '指挥', coach: '教练', analyst: '分析师' };

function getCurrentTeamId() {
  return document.getElementById('editTeamId').value;
}

async function loadTeamMembers(teamId) {
  try {
    const members = await API.getTeamMembers(teamId);
    const el = document.getElementById('teamMembersList');
    if (!members || members.length === 0) {
      el.innerHTML = '<div style="color:#999;font-size:13px;padding:4px 0">暂无成员</div>';
      return;
    }
    el.innerHTML = members.map(m => `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:4px 0;border-bottom:1px dashed #eee">
        <span>${esc(m.playerName)} <small style="color:#999">${esc(m.realName || '')} (${esc(m.playerId)})</small></span>
        <span style="flex:1;margin:0 8px;color:#666;font-size:12px">
          ${POSITION_TEXT[m.position] || esc(m.position || '')}
          ${m.status ? '<span style="margin-left:6px;color:#1890ff">' + (STATUS_TEXT[m.status] || esc(m.status)) + '</span>' : ''}
        </span>
        <button class="btn-reject" style="font-size:12px;padding:2px 8px" onclick="removeTeamMember('${esc(m.playerId)}')">移除</button>
      </div>`).join('');
  } catch (e) { alert(e.message); }
}

// 添加选手搜索（防抖）
let teamMemberSearchTimer = null;
function debounceTeamMemberSearch() {
  clearTimeout(teamMemberSearchTimer);
  teamMemberSearchTimer = setTimeout(() => searchTeamMemberCandidates(), 300);
}

async function searchTeamMemberCandidates() {
  const q = document.getElementById('teamMemberSearch').value.trim();
  const box = document.getElementById('teamMemberSearchResults');
  if (!q) { box.innerHTML = ''; return; }
  try {
    const data = await API.getAdminPlayers(0, 8, q);
    const list = data.list || [];
    if (list.length === 0) { box.innerHTML = '<div style="color:#999;font-size:12px;padding:2px 0">未找到选手</div>'; return; }
    box.innerHTML = list.map(p => `
      <div style="padding:4px 8px;cursor:pointer;border-bottom:1px solid #f0f0f0" onclick="addTeamMember('${esc(p.playerId)}')"
           title="点击加入">
        ${esc(p.name)} <small style="color:#999">${esc(p.realName || '')} (${esc(p.playerId)})</small>
        <span style="margin-left:8px;color:#666;font-size:12px">
          ${p.team ? '现属：' + esc(p.team) : '<span style="color:#999">自由身</span>'}
        </span>
      </div>`).join('');
  } catch (e) { box.innerHTML = ''; }
}

async function addTeamMember(playerId) {
  const teamId = getCurrentTeamId();
  try {
    const data = await API.addTeamMember(teamId, playerId);
    alert((data && data.message) || '已加入');
    document.getElementById('teamMemberSearch').value = '';
    document.getElementById('teamMemberSearchResults').innerHTML = '';
    loadTeamMembers(teamId);
    loadTeams();
  } catch (e) { alert(e.message); }
}

async function removeTeamMember(playerId) {
  const teamId = getCurrentTeamId();
  if (!confirm(`确认将 ${playerId} 移出本队？\n将同步清空其所属队伍（进历史队伍、状态改自由人）。`)) return;
  try {
    const data = await API.removeTeamMember(teamId, playerId);
    alert((data && data.message) || '已移除');
    loadTeamMembers(teamId);
    loadTeams();
  } catch (e) { alert(e.message); }
}

// ==================== 评论审核 ====================
async function loadComments() {
  try {
    const data = await API.getPendingComments(commentPage, 20);
    const tbody = document.getElementById('commentTableBody');
    tbody.innerHTML = (data.list || []).map(c => `<tr>
      <td>${esc(c.userName)}</td>
      <td>${esc(c.playerGameId)}</td>
      <td>${esc(c.content)}</td>
      <td>${c.createdAt}</td>
      <td>
        <button class="btn-approve" onclick="reviewComment('${c._id}','approved')">通过</button>
        <button class="btn-reject" onclick="reviewComment('${c._id}','rejected')">驳回</button>
      </td>
    </tr>`).join('');
    renderCommentPagination(data.total || 0);
  } catch (e) { showError(e); }
}

function renderCommentPagination(total) {
  const pageSize = 20;
  const totalPages = Math.ceil(total / pageSize) || 1;
  const el = document.getElementById('commentPagination');
  if (total === 0) { el.innerHTML = '暂无待审核评论'; return; }
  el.innerHTML = `<span>共 ${total} 条，第 ${commentPage + 1}/${totalPages} 页</span>
    <button class="btn-page" onclick="goCommentPage(${commentPage - 1})" ${commentPage <= 0 ? 'disabled' : ''}>上一页</button>
    <button class="btn-page" onclick="goCommentPage(${commentPage + 1})" ${commentPage >= totalPages - 1 ? 'disabled' : ''}>下一页</button>`;
}

function goCommentPage(page) {
  commentPage = Math.max(0, page);
  loadComments();
}

async function reviewComment(id, status) {
  try {
    await API.reviewComment(id, status);
    loadComments();
  } catch (e) { alert(e.message); }
}

// ==================== 猜测管理 ====================
async function loadSlotConfig() {
  try {
    const data = await API.getPickConfig(2026);
    const grid = document.getElementById('slotGrid');
    let html = '';
    for (let i = 1; i <= 30; i++) {
      const can = data.config[i] !== false;
      html += `<div class="slot-switch ${can ? 'on' : 'off'}" data-slot="${i}" onclick="toggleSlot(${i})">
        <span class="label">Top${i}</span>
        <div class="switch-track"><div class="switch-knob"></div></div>
        <span class="status">${can ? '开启' : '关闭'}</span>
      </div>`;
    }
    grid.innerHTML = html;
    window._slotConfig = data.config;
  } catch (e) { showError(e); }
}

function toggleSlot(slot) {
  window._slotConfig = window._slotConfig || {};
  window._slotConfig[slot] = !(window._slotConfig[slot] !== false);
  loadSlotConfig(); // 刷新显示
  document.getElementById('saveSlotBtn').style.background = '#e67e22';
  document.getElementById('saveSlotBtn').textContent = '有未保存更改，点击保存';
}

async function saveSlotConfig() {
  try {
    await API.setPickConfig(2026, window._slotConfig);
    document.getElementById('saveSlotBtn').style.background = '#0066cc';
    document.getElementById('saveSlotBtn').textContent = '保存开关配置';
    alert('配置已保存');
  } catch (e) { alert(e.message); }
}

async function loadWinners() {
  try {
    const data = await API.getOfficialTop30(2026);
    renderWinners(data.winners || []);
  } catch (e) { showError(e); }
}

function renderWinners(winners) {
  const list = document.getElementById('winnerList');
  const rows = [];
  for (let i = 1; i <= 30; i++) {
    const w = winners.find(x => x.rank === i);
    rows.push({ rank: i, playerGameId: w ? w.playerGameId : '', playerName: w ? w.playerName : '' });
  }
  list.innerHTML = rows.map(r => `<div class="winner-row">
    <input class="rank" value="Top${r.rank}" readonly>
    <input class="player-id" placeholder="选手ID" value="${esc(r.playerGameId)}">
    <input class="player-name" placeholder="选手名称" value="${esc(r.playerName)}">
  </div>`).join('');
  window._winners = rows;
}

function addWinnerRow() {
  // 找到第一个空的 slot 自动填充
  const inputs = document.querySelectorAll('#winnerList .winner-row');
  let nextSlot = 1;
  for (const row of inputs) {
    const name = row.querySelector('.player-name').value.trim();
    if (name) nextSlot++;
  }
  if (nextSlot > 30) { alert('已达 30 名上限'); return; }
  // scroll to the slot
}

async function saveWinners() {
  const rows = document.querySelectorAll('#winnerList .winner-row');
  const winners = [];
  for (const row of rows) {
    const rankText = row.querySelector('.rank').value;
    const pid = row.querySelector('.player-id').value.trim();
    const pname = row.querySelector('.player-name').value.trim();
    const rank = parseInt(rankText.replace('Top',''));
    if (pid && pname) {
      winners.push({ rank, playerGameId: pid, playerName: pname });
    }
  }
  if (winners.length === 0) { alert('请至少填写一名选手'); return; }
  try {
    await API.setOfficialTop30(2026, winners);
    alert('已保存');
  } catch (e) { alert(e.message); }
}

async function checkResults() {
  const threshold = parseInt(document.getElementById('matchThreshold').value) || 15;
  try {
    const data = await API.checkPicks(2026, threshold);
    const el = document.getElementById('checkResult');
    if (data.total === 0) {
      el.innerHTML = '<span class="success">无人达标</span>';
    } else {
      el.innerHTML = `<span class="success">共 ${data.total} 名用户达标</span>\n${
        data.list.slice(0, 20).map(u => `${u.nickname}: 猜对 ${u.matchedCount}/${u.totalSlots}`).join('\n')
      }`;
    }
  } catch (e) { alert(e.message); }
}

async function awardCoins() {
  if (!confirm('确定向达标用户发放代币奖励？不可重复发放！')) return;
  const threshold = parseInt(document.getElementById('matchThreshold').value) || 15;
  try {
    const data = await API.awardPicks(2026, threshold, 10);
    document.getElementById('awardResult').innerHTML =
      `<span class="success">已向 ${data.awardedUsers} 人发放 ${data.totalCoinsAwarded} 代币</span>`;
  } catch (e) { alert(e.message); }
}

// ==================== 绰号审核 ====================
let nicknamePage = 0;

async function loadNicknames() {
  const status = document.getElementById('nicknameFilter').value;
  try {
    const data = await API.getNicknames(status, nicknamePage, 20);
    const tbody = document.getElementById('nicknameTableBody');
    const STATUS_MAP = { pending: '待审核', approved: '已通过', rejected: '已拒绝' };
    tbody.innerHTML = (data.data || []).map(n => `<tr>
      <td>${n.id}</td>
      <td>${n.targetType === 'player' ? '选手' : '战队'}</td>
      <td>
        ${n.targetType === 'player'
          ? `<strong>${esc(n.targetName)}</strong>${n.targetGameId ? ' (' + esc(n.targetGameId) + ')' : ''}`
          : esc(n.targetName || n.targetId)}
      </td>
      <td><strong>${esc(n.alias)}</strong></td>
      <td>${esc(n.submitterName)}</td>
      <td>${STATUS_MAP[n.status] || n.status}</td>
      <td>${n.createdAt}</td>
      <td>
        ${n.status === 'pending'
          ? `<button class="btn-approve" onclick="approveNickname(${n.id})">通过</button>
             <button class="btn-reject" onclick="rejectNickname(${n.id})">驳回</button>`
          : '<span style="color:var(--text-muted)">已处理</span>'}
      </td>
    </tr>`).join('');
    document.getElementById('nicknamePagination').textContent =
      data.data.length === 0 ? '暂无数据' : `共 ${data.total} 条`;
  } catch (e) { showError(e); }
}

async function approveNickname(id) {
  try {
    await API.approveNickname(id);
    loadNicknames();
  } catch (e) { alert(e.message); }
}

async function rejectNickname(id) {
  try {
    await API.rejectNickname(id);
    loadNicknames();
  } catch (e) { alert(e.message); }
}

// ==================== 工具 ====================
function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function showError(e) { console.error(e); }

// 启动
init();
