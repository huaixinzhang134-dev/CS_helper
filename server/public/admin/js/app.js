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
  else if (tab === 'comments') loadComments();
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
    document.getElementById('userPagination').textContent = `共 ${data.total} 条`;
  } catch (e) { showError(e); }
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

// ==================== 评论审核 ====================
async function loadComments() {
  try {
    const data = await API.getPendingComments(commentPage, 20);
    const tbody = document.getElementById('commentTableBody');
    tbody.innerHTML = data.list.map(c => `<tr>
      <td>${esc(c.userName)}</td>
      <td>${esc(c.playerGameId)}</td>
      <td>${esc(c.content)}</td>
      <td>${c.createdAt}</td>
      <td>
        <button class="btn-approve" onclick="reviewComment('${c._id}','approved')">通过</button>
        <button class="btn-reject" onclick="reviewComment('${c._id}','rejected')">驳回</button>
      </td>
    </tr>`).join('');
    document.getElementById('commentPagination').textContent = data.list.length === 0 ? '暂无待审核评论' : `共 ${data.total} 条待审核`;
  } catch (e) { showError(e); }
}

async function reviewComment(id, status) {
  try {
    await API.reviewComment(id, status);
    loadComments();
  } catch (e) { alert(e.message); }
}

// ==================== 投票管理 ====================
async function loadSlotConfig() {
  try {
    const data = await API.getSlotConfig(2026);
    const grid = document.getElementById('slotGrid');
    let html = '';
    for (let i = 1; i <= 30; i++) {
      const can = data.config[i] !== false;
      html += `<div class="slot-toggle ${can ? 'on' : 'off'}" data-slot="${i}" onclick="toggleSlot(${i})">
        <span class="label">Top${i}</span>
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
    await API.setSlotConfig(2026, window._slotConfig);
    document.getElementById('saveSlotBtn').style.background = '#0066cc';
    document.getElementById('saveSlotBtn').textContent = '保存开关配置';
    alert('配置已保存');
  } catch (e) { alert(e.message); }
}

async function loadWinners() {
  try {
    const data = await API.getWinners(2026);
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
    await API.setWinners(2026, winners);
    alert('已保存');
  } catch (e) { alert(e.message); }
}

async function checkResults() {
  const threshold = parseInt(document.getElementById('matchThreshold').value) || 15;
  try {
    const data = await API.checkVotes(2026, threshold);
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
    const data = await API.awardVotes(2026, threshold, 10);
    document.getElementById('awardResult').innerHTML =
      `<span class="success">已向 ${data.awardedUsers} 人发放 ${data.totalCoinsAwarded} 代币</span>`;
  } catch (e) { alert(e.message); }
}

// ==================== 工具 ====================
function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function showError(e) { console.error(e); }

// 启动
init();
