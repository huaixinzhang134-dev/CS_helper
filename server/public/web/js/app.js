/**
 * CS Match Pro Web — 主应用（SPA）
 * 包含路由、页面渲染、状态管理
 */
const App = {
  currentPage: 'home',
  user: null,
  state: {},

  // ==================== 初始化 ====================
  init() {
    this.user = null;

    // 绑定导航点击
    document.getElementById('navItems').addEventListener('click', (e) => {
      const btn = e.target.closest('.nav-item');
      if (!btn) return;
      const page = btn.dataset.page;
      if (page) this.goTo(page);
    });

    // 监听 hash 变化
    window.addEventListener('hashchange', () => this.handleRoute());

    // 初始路由
    this.handleRoute();
  },

  closeMiniProgramModal() {
    document.getElementById('miniProgramModal').style.display = 'none';
  },

  showMiniProgramPrompt() {
    document.getElementById('miniProgramModal').style.display = 'flex';
  },

  _showAbout() {
    // 移除已存在的弹窗
    const existing = document.getElementById('aboutModalOverlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'aboutModalOverlay';
    overlay.className = 'modal-mask';
    overlay.style.cssText = 'display:flex;z-index:300;';
    overlay.innerHTML = `
      <div class="modal-content" style="max-width:400px;text-align:center;">
        <div class="modal-title" style="font-size:18px;margin-bottom:16px;">关于我们</div>
        <div class="modal-body" style="white-space:pre-line;line-height:1.8;font-size:14px;">
云雪CS助手 - 为CS玩家提供赛事查询、选手资料、竞猜互动等服务。

联系电话：15909235312
        </div>
        <div class="modal-footer" style="justify-content:center;margin-top:16px;">
          <button class="btn" onclick="this.closest('.modal-mask').remove()">关闭</button>
        </div>
      </div>
    `;
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });
    document.body.appendChild(overlay);
  },

  // ==================== 路由 ====================
  handleRoute() {
    const hash = window.location.hash.slice(1) || 'home';
    const [page, ...params] = hash.split('?');
    const query = {};
    if (params.length) {
      params.join('?').split('&').forEach(p => {
        const [k, v] = p.split('=');
        query[decodeURIComponent(k)] = decodeURIComponent(v || '');
      });
    }
    this.navigate(page, query);
  },

  goTo(page, params = {}) {
    const qs = Object.keys(params).length
      ? '?' + Object.entries(params).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&')
      : '';
    window.location.hash = `${page}${qs}`;
  },

  navigate(page, query) {
    this.currentPage = page;

    // 高亮导航
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    const navBtn = document.querySelector(`.nav-item[data-page="${page}"]`);
    if (navBtn) navBtn.classList.add('active');

    const content = document.getElementById('pageContent');

    // 页面路由
    switch (page) {
      case 'home': this.renderHome(content); break;
      case 'events': this.renderEvents(content); break;
      case 'match': this.renderMatchList(content, query); break;
      case 'matchDetail': this.renderMatchDetail(content, query); break;
      case 'guess': this.renderGuess(content); break;
      case 'players': this.renderPlayerList(content); break;
      case 'playerDetail': this.renderPlayerDetail(content, query); break;
      case 'ranking': this.renderRanking(content); break;
      case 'user': this.renderUser(content); break;
      case 'shop': this.renderShop(content); break;
      case 'picks': this.renderPicks(content); break;
      case 'admin': this.renderAdmin(content); break;
      default: this.renderHome(content);
    }
  },
  updateNavUser() {
    const el = document.getElementById('navUserName');
    if (el) el.textContent = '未登录';
  },

  // ==================== 首页 ====================
  _homeVersion: 'v1.5.1',
  _homeVersionKey: 'web_home_version_shown',

  renderHome(container) {
    const showUpdate = !localStorage.getItem(this._homeVersionKey) || localStorage.getItem(this._homeVersionKey) !== this._homeVersion;
    container.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;padding:40px 16px;position:relative;min-height:60vh;">
        <div style="position:fixed;top:0;left:0;width:100%;height:100%;z-index:-1;opacity:0.15;background:url('/beijing.png') center/cover no-repeat;pointer-events:none;"></div>
        <div style="text-align:center;margin-bottom:36px;">
          <div style="font-size:60px;margin-bottom:12px;">🎯</div>
          <h1 style="font-size:28px;font-weight:700;margin-bottom:6px;">云雪CS助手</h1>
          <p style="color:var(--text-muted);font-size:14px;">赛事查询 · 选手资料 · 趣味竞猜</p>
        </div>
        <div class="mode-grid" style="max-width:500px;width:100%;">
          <div class="mode-btn-card" onclick="App.goTo('events')">
            <span class="mode-icon">📅</span>
            <span class="mode-name">赛事中心</span>
            <span class="mode-desc">查看比赛与赛事信息</span>
          </div>
          <div class="mode-btn-card" onclick="App.goTo('guess')">
            <span class="mode-icon">🎯</span>
            <span class="mode-name">猜一猜</span>
            <span class="mode-desc">看看你对CS职业有多了解</span>
          </div>
          <div class="mode-btn-card" onclick="App.goTo('players')">
            <span class="mode-icon">📋</span>
            <span class="mode-name">选手资料库</span>
            <span class="mode-desc">选手数据与排行榜</span>
          </div>
          <div class="mode-btn-card" onclick="App.goTo('shop')">
            <span class="mode-icon">🛒</span>
            <span class="mode-name">道具商城</span>
            <span class="mode-desc">代币购买道具</span>
          </div>
          <div class="mode-btn-card" onclick="App.goTo('user')">
            <span class="mode-icon">👤</span>
            <span class="mode-name">我的</span>
            <span class="mode-desc">个人信息与代币管理</span>
          </div>
          <div class="mode-btn-card" onclick="App.goTo('picks')">
            <span class="mode-icon">📊</span>
            <span class="mode-name">年度Top30</span>
            <span class="mode-desc">2026年度Top30猜测</span>
          </div>
        </div>
        <p style="margin-top:40px;font-size:12px;color:var(--text-muted);">为CS玩家提供一站式服务</p>
      </div>

      ${showUpdate ? `
      <div class="modal-mask" id="homeUpdateModal" style="display:flex;z-index:300;">
        <div class="modal-content" style="max-width:480px;">
          <div class="modal-title" style="text-align:center;font-size:20px;">📢 版本更新公告</div>
          <div class="modal-body" style="max-height:50vh;overflow-y:auto;white-space:pre-line;line-height:1.8;font-size:14px;">
欢迎也感谢各位使用云雪CS助手${this._homeVersion}！
本次更新内容如下：

1. 修复了部分真机上版本更新弹窗不显示的问题，现在小程序和网页端均可正常显示

2. 网页端关于我们弹窗优化，改为页面内弹窗，体验更佳

3. 在"关于我们"中增加了联系方式（联系电话：15909235312），方便大家反馈问题

4. 修复了若干已知问题，提升了整体稳定性
          </div>
          <div class="modal-footer" style="justify-content:center;">
            <button class="btn" onclick="App._dismissHomeUpdate()">我收到</button>
          </div>
        </div>
      </div>` : ''}
    `;
  },

  _dismissHomeUpdate() {
    localStorage.setItem(App._homeVersionKey, App._homeVersion);
    const modal = document.getElementById('homeUpdateModal');
    if (modal) modal.style.display = 'none';
  },

  // ==================== 赛事中心 ====================
  async renderEvents(container) {
    container.innerHTML = '<div class="page-header"><h1>赛事中心</h1><span class="subtitle">按赛事分类浏览</span></div><div class="loading">加载中</div>';
    try {
      const res = await API.fetchMatchEvents();
      if (!res.success || !res.data.length) {
        container.innerHTML += '<div class="empty-state">暂无赛事数据</div>';
        return;
      }
      let html = '<div class="event-list">';
      res.data.forEach(ev => {
        html += `<div class="event-item" onclick="App.goTo('match',{event:'${encodeURIComponent(ev.name)}'})">
          <div><div class="event-name">${esc(ev.name)}</div>
          <div class="event-meta">${ev.matchCount} 场比赛 · 最近: ${formatDate(ev.latestDate)}</div></div>
          <span class="event-arrow">›</span>
        </div>`;
      });
      html += '</div>';
      container.querySelector('.page-header').insertAdjacentHTML('afterend', html);
    } catch (e) { container.innerHTML += '<div class="empty-state">加载失败</div>'; }
  },

  // ==================== 比赛列表 ====================
  async renderMatchList(container, query) {
    const eventName = query.event ? decodeURIComponent(query.event) : '';
    container.innerHTML = `<div class="page-header"><h1>${esc(eventName || '全部赛事')}</h1></div><div class="loading">加载中</div>`;
    try {
      const res = await API.fetchMatches(eventName || undefined);
      if (!res.success || !res.data.length) {
        container.innerHTML += '<div class="empty-state">暂无比赛数据</div>';
        return;
      }
      this._lastQuery = query;
      const matches = this._sortMatches(res.data);
      let html = '<div class="match-list">';
      matches.forEach(m => {
        const isLive = m.status === 'Live';
        const isFinished = m.status === 'Finished';
        const badgeClass = isLive ? 'badge-live' : isFinished ? 'badge-finished' : 'badge-upcoming';
        html += `<div class="card match-card" onclick="App.goTo('matchDetail',{id:'${esc(m._id||m.id)}'})">
          <div class="card-header">
            <span class="card-title">${esc(m.roundName || m.event)}</span>
            <span class="badge ${badgeClass}">${isLive ? '直播中' : isFinished ? '已结束' : '未开始'}</span>
          </div>
          <div class="matchup">
            <div class="team-block">
              <img class="team-logo" src="${m.teamA.logo || ''}" alt="${esc(m.teamA.name)}" onerror="this.style.display='none'">
              <span class="team-name">${esc(m.teamA.name)}</span>
            </div>
            <div class="score-block">
              ${isLive || isFinished
                ? `<div class="score-text"><span class="${m.teamA.score > m.teamB.score ? 'score-winner' : ''}">${m.teamA.score}</span> : <span class="${m.teamB.score > m.teamA.score ? 'score-winner' : ''}">${m.teamB.score}</span></div>`
                : '<div class="vs-text">VS</div>'}
              <div class="match-time">${this._formatMatchTime(m.time)}</div>
            </div>
            <div class="team-block">
              <img class="team-logo" src="${m.teamB.logo || ''}" alt="${esc(m.teamB.name)}" onerror="this.style.display='none'">
              <span class="team-name">${esc(m.teamB.name)}</span>
            </div>
          </div>
        </div>`;
      });
      html += '</div>';
      container.querySelector('.page-header').insertAdjacentHTML('afterend', html);
    } catch (e) { container.innerHTML += '<div class="empty-state">加载失败</div>'; }
  },

  _sortMatches(matches) {
    const now = Date.now();
    const live = matches.filter(m => m.status === 'Live');
    const finished = matches.filter(m => m.status === 'Finished').sort((a, b) => new Date(b.time) - new Date(a.time));
    const upcoming = matches.filter(m => m.status !== 'Live' && m.status !== 'Finished').sort((a, b) => new Date(a.time) - new Date(b.time));
    return [...live, ...finished, ...upcoming];
  },

  _formatMatchTime(raw) {
    if (!raw) return '';
    const d = new Date(raw);
    if (isNaN(d.getTime())) return raw;
    return `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  },

  // ==================== 比赛详情 ====================
  async renderMatchDetail(container, query) {
    const id = query.id;
    if (!id) { container.innerHTML = '<div class="empty-state">比赛不存在</div>'; return; }
    container.innerHTML = '<div class="loading">加载中</div>';
    try {
      const [matchRes, playersRes] = await Promise.all([
        API.fetchMatchDetail(id),
        API.fetchMatchPlayers(id)
      ]);
      if (!matchRes.success || !matchRes.data) {
        container.innerHTML = '<div class="empty-state">比赛不存在</div>';
        return;
      }
      const m = matchRes.data;
      const pd = playersRes.data;
      let html = '';

      // 比赛头部
      const isLive = m.status === 'Live';
      const isFinished = m.status === 'Finished';
      html += `<div class="card" style="text-align:center;">
        <div style="color:var(--text-muted);font-size:13px;margin-bottom:8px;">${esc(m.roundName || m.event)}</div>
        <div style="display:flex;align-items:center;justify-content:center;gap:20px;">
          <div><div style="font-size:14px;font-weight:600;margin-bottom:4px;">${esc(m.teamA.name)}</div></div>
          <div style="font-size:32px;font-weight:700;">${isLive || isFinished ? `${m.teamA.score} : ${m.teamB.score}` : 'VS'}</div>
          <div><div style="font-size:14px;font-weight:600;margin-bottom:4px;">${esc(m.teamB.name)}</div></div>
        </div>
        <div style="margin-top:8px;">
          <span class="badge ${isLive?'badge-live':isFinished?'badge-finished':'badge-upcoming'}">
            ${isLive?'直播中':isFinished?'已结束':'未开始'}
          </span>
          <span style="color:var(--text-muted);font-size:12px;margin-left:8px;">${this._formatMatchTime(m.time)}</span>
        </div>
      </div>`;

      // 局分详情
      if (m.roundScores && m.roundScores.length) {
        html += `<div class="page-header" style="margin-bottom:8px;"><h1 style="font-size:18px;">局分详情</h1></div>
        <div class="card" style="padding:8px;">
          <table style="width:100%;font-size:13px;border-collapse:collapse;">
            <thead><tr style="color:var(--text-muted);font-size:11px;">
              <th style="padding:6px;text-align:left;">地图</th>
              <th style="padding:6px;text-align:center;">${esc(m.teamA.name)}</th>
              <th style="padding:6px;text-align:center;">${esc(m.teamB.name)}</th>
            </tr></thead>
            <tbody>`;
        m.roundScores.forEach(rs => {
          html += `<tr><td style="padding:6px;">${esc(rs.map)}</td>
            <td style="padding:6px;text-align:center;${rs.team1Score > rs.team2Score ? 'color:var(--success);font-weight:600;' : ''}">${rs.team1Score}</td>
            <td style="padding:6px;text-align:center;${rs.team2Score > rs.team1Score ? 'color:var(--success);font-weight:600;' : ''}">${rs.team2Score}</td></tr>`;
        });
        html += `</tbody></table></div>`;
      }

      // 选手数据
      if (pd && pd.team1 && pd.team1.players && pd.team1.players.length) {
        this._renderMatchPlayersData(container, pd, html, m);
        return;
      }
      container.innerHTML = html + '<div class="empty-state">暂无选手数据</div>';
    } catch (e) { container.innerHTML = '<div class="empty-state">加载失败</div>'; }
  },

  _renderMatchPlayersData(container, pd, preHtml, m) {
    let html = preHtml;
    if (m.status === 'Finished') {
      html += `<div class="page-header" style="margin-bottom:8px;"><h1 style="font-size:18px;">选手数据</h1></div>`;
      [pd.team1, pd.team2].forEach(team => {
        html += `<div class="card" style="padding:8px;margin-bottom:8px;">
          <div style="font-weight:600;font-size:14px;margin-bottom:6px;color:var(--accent);">${esc(team.name)}</div>
          <table style="width:100%;font-size:12px;border-collapse:collapse;">
            <thead><tr style="color:var(--text-muted);font-size:10px;">
              <th style="padding:4px;text-align:left;">选手</th><th style="padding:4px;text-align:center;">K</th>
              <th style="padding:4px;text-align:center;">D</th><th style="padding:4px;text-align:center;">A</th>
              <th style="padding:4px;text-align:center;">Rating</th>
            </tr></thead><tbody>`;
        team.players.forEach(p => {
          html += `<tr><td style="padding:4px;">${esc(p.name)}</td>
            <td style="padding:4px;text-align:center;">${p.kills != null ? p.kills : '-'}</td>
            <td style="padding:4px;text-align:center;">${p.deaths != null ? p.deaths : '-'}</td>
            <td style="padding:4px;text-align:center;">${p.assists != null ? p.assists : '-'}</td>
            <td style="padding:4px;text-align:center;font-weight:600;">${p.rating != null ? p.rating : '-'}</td></tr>`;
        });
        html += `</tbody></table></div>`;
      });
    }

    // 评论区
    const allPlayers = [...pd.team1.players, ...pd.team2.players];
    html += `<div class="page-header" style="margin-top:16px;margin-bottom:8px;"><h1 style="font-size:18px;">选手评价</h1></div>
    <div id="commentArea">
      <div style="display:flex;gap:6px;overflow-x:auto;margin-bottom:12px;padding:4px 0;" id="playerTabs">
        <button class="btn btn-ghost btn-sm active-tab" data-pid="all" onclick="App._commentTab='all';App._refreshComments()">全部</button>
      </div>
      <div id="commentList" class="comment-list"></div>
    </div>`;

    container.innerHTML = html;
    this._commentPlayers = allPlayers;
    this._commentMatchId = m._id || m.id;

    // 渲染选手 tab
    const tabsContainer = document.getElementById('playerTabs');
    allPlayers.forEach(p => {
      tabsContainer.innerHTML += `<button class="btn btn-ghost btn-sm" data-pid="${esc(p.playerId)}" onclick="App._commentTab='${esc(p.playerId)}';document.querySelectorAll('#playerTabs .active-tab').forEach(e=>e.classList.remove('active-tab'));this.classList.add('active-tab');App._refreshComments()">${esc(p.name)}</button>`;
    });
    this._commentTab = 'all';
    this._refreshComments();

    // 评论输入框
    const bar = document.createElement('div');
    bar.className = 'comment-bar';
    bar.innerHTML = `
      <select class="input" style="width:auto;flex-shrink:0;padding:8px;" id="commentPlayer">
        <option value="">选择选手</option>
        ${allPlayers.map(p => `<option value="${esc(p.playerId)}">${esc(p.name)}</option>`).join('')}
      </select>
      <input class="input" id="commentInput" placeholder="说点什么..." maxlength="500" style="flex:1;">
      <span style="font-size:11px;color:var(--text-muted);" id="commentCount">0/500</span>
      <button class="btn btn-sm" onclick="App._sendComment()" id="sendCommentBtn">发送</button>
    `;
    container.appendChild(bar);
    document.getElementById('commentInput').addEventListener('input', function() {
      document.getElementById('commentCount').textContent = `${this.value.length}/500`;
    });
  },

  _commentTab: 'all',
  _commentPlayers: [],
  _commentMatchId: null,

  async _refreshComments() {
    const list = document.getElementById('commentList');
    if (!list) return;
    if (this._commentTab === 'all') {
      list.innerHTML = '<div class="loading">加载中</div>';
      const allComments = [];
      for (const p of this._commentPlayers) {
        const res = await API.fetchComments(p.playerId, 0, 10);
        if (res.code === 0 && res.data && res.data.list) {
          res.data.list.forEach(c => allComments.push({ ...c, _playerName: p.name, _playerTeam: p.team }));
        }
      }
      allComments.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      if (!allComments.length) { list.innerHTML = '<div class="empty-state">暂无评价</div>'; return; }
      list.innerHTML = allComments.map(c =>
        `<div class="comment-item">
          <div class="comment-header"><span class="comment-user">${esc(c.userName)}</span> → <span class="comment-player">${esc(c._playerName)}</span>${c._playerTeam ? ' · ' + esc(c._playerTeam) : ''}</div>
          <div class="comment-text">${esc(c.content)}</div>
          <div class="comment-time">${this._formatCommentTime(c.createdAt)}</div>
        </div>`
      ).join('');
    } else {
      list.innerHTML = '<div class="loading">加载中</div>';
      const res = await API.fetchComments(this._commentTab, 0, 30);
      if (res.code === 0 && res.data && res.data.list) {
        const comments = res.data.list;
        if (!comments.length) { list.innerHTML = '<div class="empty-state">暂无评价</div>'; return; }
        list.innerHTML = comments.map(c =>
          `<div class="comment-item">
            <div class="comment-header"><span class="comment-user">${esc(c.userName)}</span> → <span class="comment-player">${esc(c.playerGameId)}</span></div>
            <div class="comment-text">${esc(c.content)}</div>
            <div class="comment-time">${this._formatCommentTime(c.createdAt)}</div>
          </div>`
        ).join('');
      } else {
        list.innerHTML = '<div class="empty-state">暂无评价</div>';
      }
    }
  },

  async _sendComment() {
    const playerId = document.getElementById('commentPlayer').value;
    const content = document.getElementById('commentInput').value.trim();
    if (!playerId) { alert('请选择选手'); return; }
    if (!content) { alert('请输入评论内容'); return; }
    if (!this.user) { this.showMiniProgramPrompt(); return; }
    document.getElementById('sendCommentBtn').disabled = true;
    const res = await API.addComment(playerId, content, this.user.openid);
    document.getElementById('sendCommentBtn').disabled = false;
    if (res.code === 0) {
      document.getElementById('commentInput').value = '';
      this._refreshComments();
    } else {
      alert(res.message || '发送失败');
    }
  },

  _formatCommentTime(raw) {
    if (!raw) return '';
    const d = new Date(raw);
    if (isNaN(d.getTime())) return '';
    const m = String(d.getMonth()+1).padStart(2,'0');
    const day = String(d.getDate()).padStart(2,'0');
    const h = String(d.getHours()).padStart(2,'0');
    const min = String(d.getMinutes()).padStart(2,'0');
    return `${m}-${day} ${h}:${min}`;
  },

  // ==================== 猜一猜 ====================
  renderGuess(container) {
    let state = this.state.guess || (this.state.guess = {});
    container.innerHTML = `
      <div class="page-header" style="display:flex;justify-content:space-between;align-items:center;">
        <div><h1>弗一把</h1><span class="subtitle">猜选手游戏</span></div>
        <div style="display:flex;gap:8px;">
          <button class="btn btn-ghost btn-sm" onclick="App.state.guess={};App.renderGuess(document.getElementById('pageContent'))">新游戏</button>
          <button class="btn btn-ghost btn-sm" id="guessRulesBtn" onclick="App._showGuessRules()">玩法</button>
        </div>
      </div>
      <div id="guessContent">
        ${state.target ? this._renderGuessBoard(state) : this._renderGuessStart(state)}
      </div>
    `;
  },

  _renderGuessStart(state) {
    return `
      <div style="text-align:center;padding:30px 0;">
        <p style="margin-bottom:20px;color:var(--text-secondary);">选择游戏模式和难度，开始挑战</p>
        <div style="margin-bottom:24px;">
          <h3 style="margin-bottom:12px;">选择模式</h3>
          <div style="display:flex;gap:8px;justify-content:center;">
            <button class="btn ${state.mode==='personal'?'btn-success':'btn-ghost'}" onclick="App.state.guess.mode='personal';App.renderGuess(document.getElementById('pageContent'))">个人练习</button>
            <button class="btn ${state.mode==='friend'?'btn-success':'btn-ghost'}" onclick="App.showMiniProgramPrompt()">好友PK</button>
          </div>
        </div>
        ${state.mode ? `
        <div>
          <h3 style="margin-bottom:12px;">选择难度</h3>
          <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;">
            <button class="btn ${state.difficulty==='trivial'?'btn-success':'btn-ghost'}" onclick="App._startGuess('trivial')">🌱 极简</button>
            <button class="btn ${state.difficulty==='easy'?'btn-success':'btn-ghost'}" onclick="App._startGuess('easy')">🌟 简单</button>
            <button class="btn ${state.difficulty==='hard'?'btn-success':'btn-ghost'}" onclick="App._startGuess('hard')">⚔️ 困难</button>
            <button class="btn ${state.difficulty==='hell'?'btn-success':'btn-ghost'}" onclick="App._startGuess('hell')">💀 地狱</button>
          </div>
        </div>` : ''}
      </div>
    `;
  },

  async _startGuess(difficulty) {
    const state = this.state.guess;
    state.difficulty = difficulty;
    try {
      const res = await API.fetchRandomPlayerByDifficulty(difficulty);
      if (res.success && res.data) {
        state.target = res.data;
        state.guesses = [];
        state.gameStatus = 'playing';
        state.attempts = 0;
        state.hintUsed = false;
        this.renderGuess(document.getElementById('pageContent'));
      } else {
        alert('获取选手失败');
      }
    } catch (e) { alert('加载失败'); }
  },

  _renderGuessBoard(state) {
    const target = state.target;
    const isPersonal = state.mode !== 'friend';
    const maxAttempts = state.mode === 'friend' ? 8 : 999;
    const guessRows = state.guesses || [];

    let html = `
      <div style="margin-bottom:12px;">
        <div class="search-bar" style="margin-bottom:8px;">
          <span>🔍</span>
          <input class="input" id="guessSearch" placeholder="输入选手ID或姓名搜索" oninput="App._guessSearch(this.value)">
        </div>
        <div id="guessResults"></div>
      </div>
      <div id="guessGameStatus"></div>
      ${state.gameStatus !== 'playing' ? `
        <div class="card" style="text-align:center;margin-bottom:12px;">
          <div style="font-size:18px;font-weight:700;margin-bottom:8px;color:${state.gameStatus==='won'?'var(--success)':'var(--danger)'}">
            ${state.gameStatus==='won'?'🎉 恭喜回答正确！':'😞 游戏结束'}
          </div>
          <div style="color:var(--text-secondary);margin-bottom:12px;">
            ${state.gameStatus==='won'?`猜对了选手 ${esc(target.name)}`:`正确答案: ${esc(target.name)}`}
          </div>
          <button class="btn" onclick="App.state.guess={};App.renderGuess(document.getElementById('pageContent'))">再来一局</button>
        </div>` : ''}
      <div style="overflow-x:auto;">
        <table class="guess-table">
          <thead><tr>
            <th>姓名</th><th>战队</th><th>国家</th><th>年龄</th><th>位置</th><th>Major</th>
          </tr></thead>
          <tbody>
            ${guessRows.slice().reverse().map(g => {
              const s = g.status;
              return `<tr>
                <td style="font-weight:500;">${esc(g.player.name)}</td>
                <td class="td-${s.team}">${esc(g.player.team||'-')}</td>
                <td class="td-${s.country}">${esc(g.player.country)}</td>
                <td class="td-${s.age}">${g.player.age}${s.ageDir==='up'?'↑':s.ageDir==='down'?'↓':''}</td>
                <td class="td-${s.position}">${esc(g.player.position)}</td>
                <td class="td-${s.major}">${g.player.majorAppearances}${s.majorDir==='up'?'↑':s.majorDir==='down'?'↓':''}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
      ${!isPersonal && state.gameStatus === 'playing' ? `
      <div class="attempts-bar" style="margin-top:12px;">
        ${Array.from({length:maxAttempts},(_,i)=>`<div class="attempt-box ${i < state.attempts ? (state.gameStatus==='won'&&i===state.attempts-1?'success':'used'):''}"></div>`).join('')}
      </div>` : ''}
      ${state.gameStatus === 'playing' ? `
      <div style="text-align:center;margin-top:12px;">
        <button class="btn btn-ghost btn-sm" onclick="App._guessGiveUp()">服了，认输</button>
        ${state.attempts > 5 && !state.hintUsed ? `<button class="btn btn-ghost btn-sm" style="margin-left:8px;" onclick="App._guessHint()">💡 提示</button>` : ''}
      </div>` : ''}
      ${state.hintContent ? `<div class="card" style="margin-top:12px;text-align:center;color:var(--accent);font-size:14px;">💡 ${esc(state.hintContent)}</div>` : ''}
    `;
    return html;
  },

  async _guessSearch(query) {
    const results = document.getElementById('guessResults');
    if (!query || !query.trim()) { results.innerHTML = ''; return; }
    const state = this.state.guess;
    if (this._guessTimer) clearTimeout(this._guessTimer);
    this._guessTimer = setTimeout(async () => {
      const res = await API.searchPlayers(query, 0, 20);
      if (res.success && res.data.length) {
        results.innerHTML = '<div class="search-results">' +
          res.data.map(p => `<div class="search-result-item" onclick="App._guessSelect('${esc(p.playerId)}')">
            <span class="sr-name">${esc(p.name)}</span>
            <span class="sr-team">${esc(p.team||'')}</span>
            <span class="sr-id">ID: ${esc(p.playerId)}</span>
          </div>`).join('') + '</div>';
        window._guessSearchResults = res.data;
      } else {
        results.innerHTML = '';
      }
    }, 400);
  },

  async _guessSelect(playerId) {
    const state = this.state.guess;
    const results = window._guessSearchResults || [];
    const player = results.find(p => p.playerId === playerId);
    if (!player || !state.target) return;

    // 去重
    if (state.guesses.some(g => g.player.playerId === playerId)) {
      alert('已经猜过该选手');
      return;
    }

    const target = state.target;
    const feedback = {
      team: player.team === target.team ? 'correct' :
        ((target.formerTeams||[]).includes(player.team) ? 'close' : 'incorrect'),
      country: player.country === target.country ? 'correct' :
        (player.region && target.region && player.region === target.region ? 'close' : 'incorrect'),
      age: player.age === target.age ? 'correct' : (Math.abs(player.age - target.age) <= 2 ? 'close' : 'incorrect'),
      ageDir: player.age < target.age ? 'up' : (player.age > target.age ? 'down' : ''),
      major: player.majorAppearances === target.majorAppearances ? 'correct' : (Math.abs(player.majorAppearances - target.majorAppearances) <= 2 ? 'close' : 'incorrect'),
      majorDir: player.majorAppearances < target.majorAppearances ? 'up' : (player.majorAppearances > target.majorAppearances ? 'down' : ''),
      position: player.position === target.position ? 'correct' : 'incorrect',
    };

    const won = player.playerId === target.playerId;
    state.guesses.push({ player, status: feedback });
    state.attempts++;

    if (won) {
      state.gameStatus = 'won';
      this._submitGuessResult(true, state.attempts);
    } else if (state.mode === 'friend' && state.attempts >= 8) {
      state.gameStatus = 'lost';
      this._submitGuessResult(false, state.attempts);
    } else if (state.mode === 'personal' && state.attempts >= 999) {
      // 个人模式不限次数
    }

    document.getElementById('guessResults').innerHTML = '';
    document.getElementById('guessSearch').value = '';
    this.renderGuess(document.getElementById('pageContent'));
  },

  async _submitGuessResult(won, attempts) {
    if (!this.user) { if (won) alert('🎉 恭喜回答正确！登录后可保存记录，请使用微信小程序'); return; }
    const state = this.state.guess;
    try {
      await API.submitGuessRecord({
        won, attempts,
        difficulty: state.difficulty,
        targetPlayerId: state.target.playerId,
        targetPlayerName: state.target.name,
        gameMode: state.mode || 'personal'
      });
    } catch (e) {}
  },

  _guessGiveUp() {
    const state = this.state.guess;
    if (!state.target) return;
    state.gameStatus = 'lost';
    this._submitGuessResult(false, state.attempts);
    this.renderGuess(document.getElementById('pageContent'));
  },

  _guessHint() {
    const state = this.state.guess;
    const target = state.target;
    if (!target || state.hintUsed) return;
    const hints = [];
    if (target.team) hints.push(`该选手的战队为：${target.team}`);
    if (target.country) hints.push(`该选手的国家为：${target.country}`);
    if (target.age != null) hints.push(`该选手的年龄为：${target.age}`);
    if (target.majorAppearances != null) hints.push(`该选手的Major参赛次数为：${target.majorAppearances}`);
    if (!hints.length) return;
    state.hintContent = hints[Math.floor(Math.random() * hints.length)];
    state.hintUsed = true;
    this.renderGuess(document.getElementById('pageContent'));
  },

  _showGuessRules() {
    alert(`猜选手游戏：点击搜索框输入选手ID（无大小写区分），选择你要猜测的选手，根据下方的信息提示猜出正确选手吧！

绿色：该选手的此项信息正确
黄色：该选手的此项信息接近正确（战队黄色→目标选手在该战队待过；国籍黄色→同V社赛区；年龄/Major差≤3）
无色：该选手的此项信息不正确

数值信息的上下箭头表示更大/更小
选手位置包括：步枪手、狙击手、教练`);
  },

  // ==================== 选手列表 ====================
  async renderPlayerList(container) {
    container.innerHTML = `
      <div class="page-header" style="display:flex;justify-content:space-between;align-items:center;">
        <div><h1>选手资料库</h1><span class="subtitle">CS 职业选手数据查询</span></div>
        <button class="btn btn-ghost btn-sm" onclick="App.goTo('ranking')">排行榜 ></button>
      </div>
      <div class="search-bar">
        <span>🔍</span>
        <input class="input" id="playerSearch" placeholder="搜索选手 ID..." oninput="App._playerSearch(this.value)">
      </div>
      <div id="playerListContent"><div class="loading">加载中</div></div>
    `;
    this._playerPage = 0;
    this._playerHasMore = true;
    this._playerData = [];
    this._playerTotal = 0;
    await this._loadPlayers();
  },

  async _loadPlayers() {
    const content = document.getElementById('playerListContent');
    try {
      const countData = await API.fetchPlayerCount();
      this._playerTotal = countData.total || 0;
      const res = await API.fetchPlayers(0, 40);
      if (res.success) {
        this._playerData = res.data;
        this._renderPlayerGrid(content);
      }
    } catch (e) { content.innerHTML = '<div class="empty-state">加载失败</div>'; }
  },

  async _playerSearch(query) {
    const content = document.getElementById('playerListContent');
    if (!query || !query.trim()) {
      this._loadPlayers();
      return;
    }
    if (this._psTimer) clearTimeout(this._psTimer);
    this._psTimer = setTimeout(async () => {
      content.innerHTML = '<div class="loading">搜索中</div>';
      const res = await API.searchPlayers(query, 0, 100);
      if (res.success && res.data.length) {
        this._playerData = res.data;
        this._renderPlayerGrid(content, res.total);
      } else {
        content.innerHTML = '<div class="empty-state">未找到相关选手</div>';
      }
    }, 300);
  },

  _renderPlayerGrid(container, total) {
    const data = this._playerData;
    const hasMore = this._playerHasMore;
    container.innerHTML = `
      <div class="player-grid">
        ${data.map(p => `<div class="player-grid-item" onclick="App.goTo('playerDetail',{id:'${esc(p.playerId)}'})">
          <div class="p-name">${esc(p.name)}</div>
          <div style="font-size:11px;color:var(--text-muted);">${esc(p.team||'')}</div>
        </div>`).join('')}
      </div>
      ${total ? `<div style="text-align:center;padding:12px;font-size:13px;color:var(--text-muted);">共找到 ${total} 个结果</div>` : ''}
      ${!query && data.length ? `<div style="text-align:center;padding:12px;font-size:12px;color:var(--text-muted);">已加载 ${data.length} 名选手</div>` : ''}
    `;
  },

  // ==================== 选手详情 ====================
  async renderPlayerDetail(container, query) {
    const id = query.id;
    if (!id) { container.innerHTML = '<div class="empty-state">选手不存在</div>'; return; }
    container.innerHTML = '<div class="loading">加载中</div>';
    try {
      const res = await API.fetchPlayerDetail(id);
      if (!res.success || !res.data) {
        container.innerHTML = '<div class="empty-state">选手不存在</div>';
        return;
      }
      const p = res.data;
      const statusMap = { active: '现役', retired: '退役', coach: '教练', free_agent: '自由人' };
      const statusText = statusMap[p.status] || p.status;
      const avatarUrl = this._normalizeAvatar(p.avatar);

      container.innerHTML = `
        <div class="player-profile">
          <img class="player-avatar" src="${avatarUrl}" alt="${esc(p.name)}" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><rect fill=%22%23333%22 width=%22100%22 height=%22100%22/><text x=%2250%22 y=%2260%22 text-anchor=%22middle%22 fill=%22%23666%22 font-size=%2230%22>?</text></svg>'">
          <div class="player-body">
            <div class="player-name-row">
              <span class="player-nickname">${esc(p.name)}</span>
              <span class="player-tag">${esc(p.country)}</span>
              <span class="player-tag" style="border-color:${p.status==='active'?'var(--success)':p.status==='retired'?'var(--danger)':'var(--border)'}">${statusText}</span>
            </div>
            <div class="player-realname">${esc(p.realName)}</div>
            <div class="player-team-info"><strong>现役队伍：</strong>${esc(p.team||'无')}</div>
            ${p.formerTeams && p.formerTeams.length ? `
            <div><strong style="font-size:13px;">曾属队伍：</strong>
              <div class="player-former-teams">${p.formerTeams.map(t => `<span class="player-former-tag">${esc(t)}</span>`).join('')}</div>
            </div>` : ''}
          </div>
        </div>
        <div class="stats-grid">
          <div class="stat-card"><div class="stat-label">年龄</div><div class="stat-value">${p.age}</div></div>
          <div class="stat-card"><div class="stat-label">位置</div><div class="stat-value">${esc(p.position)}</div></div>
          <div class="stat-card"><div class="stat-label">Major次数</div><div class="stat-value">${p.majorAppearances}</div></div>
          <div class="stat-card"><div class="stat-label">Rating</div><div class="stat-value">${p.rating || '-'}</div></div>
        </div>
        <div style="text-align:center;padding:16px 0;">
          <button class="btn btn-ghost" onclick="history.back()">返回</button>
        </div>
      `;
    } catch (e) { container.innerHTML = '<div class="empty-state">加载失败</div>'; }
  },

  _normalizeAvatar(avatar) {
    if (!avatar) return 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect fill="%23333" width="100" height="100"/><text x="50" y="60" text-anchor="middle" fill="%23666" font-size="30">?</text></svg>';
    if (avatar.startsWith('http')) return avatar;
    if (avatar.startsWith('/static/')) return avatar;
    return 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect fill="%23333" width="100" height="100"/><text x="50" y="60" text-anchor="middle" fill="%23666" font-size="30">?</text></svg>';
  },

  // ==================== 排行 ====================
  async renderRanking(container) {
    container.innerHTML = `
      <div class="page-header"><h1>排行榜</h1></div>
      <div class="tab-bar">
        <button class="tab-item active" data-tab="player" onclick="App._switchRankingTab('player')">选手排行</button>
        <button class="tab-item" data-tab="team" onclick="App._switchRankingTab('team')">队伍排行</button>
      </div>
      <div id="rankingContent"><div class="loading">加载中</div></div>
    `;
    this._rankingTab = 'player';
    this._rankingPlayerPage = 0;
    this._rankingTeamPage = 0;
    await this._loadPlayerRanking();
  },

  async _switchRankingTab(tab) {
    this._rankingTab = tab;
    document.querySelectorAll('.tab-item').forEach(el => {
      el.classList.toggle('active', el.dataset.tab === tab);
    });
    const content = document.getElementById('rankingContent');
    content.innerHTML = '<div class="loading">加载中</div>';
    if (tab === 'player') await this._loadPlayerRanking();
    else await this._loadTeamRanking();
  },

  async _loadPlayerRanking(page) {
    const content = document.getElementById('rankingContent');
    if (!content) return;
    try {
      const res = await API.fetchPlayerRanking(page || 0, 60);
      if (res.success && res.data.length) {
        content.innerHTML = `<div class="rank-list">${res.data.map((p, i) => `
          <div class="rank-item" onclick="App.goTo('playerDetail',{id:'${esc(p.playerId)}'})">
            <div class="rank-num ${i<3?'top3':''}">${i + 1 + (page||0)*60}</div>
            <div class="rank-info">
              <div class="rank-name">${esc(p.name)}</div>
              <div class="rank-meta">${esc(p.country)} · ${esc(p.team||'')}</div>
            </div>
            <div class="rank-value">
              <div class="rank-rating" style="color:${p.rating>1?'var(--success)':p.rating>0.9?'var(--warning)':'var(--text-muted)'}">${p.rating||'-'}</div>
              <div class="rank-label">Rating</div>
            </div>
          </div>`).join('')}</div>
          ${res.hasMore ? '<div style="text-align:center;padding:12px;"><button class="btn btn-ghost btn-sm" onclick="App._rankingPlayerPage++;App._loadPlayerRanking(App._rankingPlayerPage)">加载更多</button></div>' : ''}
          <div style="text-align:center;padding:8px;font-size:12px;color:var(--text-muted);">共 ${res.total} 名选手</div>
        `;
      } else {
        content.innerHTML = '<div class="empty-state">暂无数据</div>';
      }
    } catch (e) { content.innerHTML = '<div class="empty-state">加载失败</div>'; }
  },

  async _loadTeamRanking(page) {
    const content = document.getElementById('rankingContent');
    if (!content) return;
    try {
      const res = await API.fetchTeamRanking('all', page || 0, 60);
      if (res.success && res.data.length) {
        const regionLabel = { Europe: '欧洲赛区', Asia: '亚洲赛区', Americas: '美洲赛区' };
        content.innerHTML = `<div class="rank-list">${res.data.map((t, i) => `
          <div class="rank-item">
            <div class="rank-num ${i<3?'top3':''}">${i + 1 + (page||0)*60}</div>
            <div class="rank-info">
              <div class="rank-name">${esc(t.teamName)}</div>
              <div class="rank-meta">${regionLabel[t.region]||t.region||'其他'}</div>
            </div>
            <div class="rank-value">
              <div class="rank-rating">${t.points||'-'}</div>
              <div class="rank-label">V社积分</div>
            </div>
          </div>`).join('')}</div>
          ${res.hasMore ? '<div style="text-align:center;padding:12px;"><button class="btn btn-ghost btn-sm" onclick="App._rankingTeamPage++;App._loadTeamRanking(App._rankingTeamPage)">加载更多</button></div>' : ''}
          <div style="text-align:center;padding:8px;font-size:12px;color:var(--text-muted);">共 ${res.total} 支队伍</div>
        `;
      } else {
        content.innerHTML = '<div class="empty-state">暂无数据</div>';
      }
    } catch (e) { content.innerHTML = '<div class="empty-state">加载失败</div>'; }
  },

  // ==================== 个人中心 ====================
  async renderUser(container) {
    container.innerHTML = `
      <div class="page-header"><h1>我的</h1></div>
      <div class="user-header" style="flex-direction:column;text-align:center;padding:40px;">
        <div style="margin:16px auto;width:160px;height:160px;background:#f0f0f0;border-radius:12px;display:flex;align-items:center;justify-content:center;border:2px dashed var(--border);">
          <div style="text-align:center;color:var(--text-muted);font-size:12px;">
            <div style="font-size:40px;margin-bottom:8px;">📱</div>
            <div>微信小程序码</div>
            <div style="font-size:10px;margin-top:4px;">（替换为实际小程序码图片）</div>
          </div>
        </div>
        <h3 style="margin:12px 0 8px;">使用微信小程序</h3>
        <p style="font-size:13px;color:var(--text-muted);margin-bottom:16px;">竞猜记录、代币管理、个人设置等<br>请在微信小程序中操作</p>
        <p style="font-size:12px;color:var(--text-muted);">打开微信 → 搜索「云雪CS助手」</p>
      </div>
      <div class="menu-list" style="margin-top:12px;max-width:400px;margin-left:auto;margin-right:auto;">
        <div class="menu-item" onclick="App._showAbout()">
          <span class="menu-item-text">ℹ️ 关于我们</span>
          <span class="menu-item-arrow">›</span>
        </div>
      </div>
    `;
  },

  async _showGuessRecords() {
    if (!this.user) return;
    const res = await API.fetchGuessRecords(0, 20);
    const records = res.code === 0 && res.data ? res.data.list : [];
    const diffLabel = { easy: '简单', hard: '困难', hell: '地狱', trivial: '极简', personal: '个人' };
    const html = `<div class="modal-mask" onclick="this.remove()">
      <div class="modal-content" onclick="event.stopPropagation()">
        <div class="modal-title">竞猜记录</div>
        <div class="modal-body">
          ${records.length ? records.map(r => `
            <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border);">
              <span class="badge ${r.won?'badge-won':'badge-lost'}">${r.won?'胜':'负'}</span>
              <div style="flex:1;">
                <div style="font-size:13px;font-weight:500;">${esc(r.targetPlayerName||'未知')}</div>
                <div style="font-size:11px;color:var(--text-muted);">${diffLabel[r.difficulty]||r.difficulty} · ${r.attempts}次</div>
              </div>
              <div style="font-size:11px;color:var(--text-muted);">${r.playedAt ? new Date(r.playedAt).toLocaleDateString() : ''}</div>
            </div>`).join('') : '<div style="text-align:center;padding:20px;color:var(--text-muted);">暂无竞猜记录</div>'}
        </div>
        <div class="modal-footer"><button class="btn btn-sm" onclick="this.closest('.modal-mask').remove()">关闭</button></div>
      </div>
    </div>`;
    document.body.insertAdjacentHTML('beforeend', html);
  },

  async _showRankingModal() {
    if (!this.user) return;
    const res = await API.fetchRanking('pk');
    const list = res.success ? res.data : [];
    const html = `<div class="modal-mask" onclick="this.remove()">
      <div class="modal-content" onclick="event.stopPropagation()">
        <div class="modal-title">封神榜</div>
        <div class="modal-body">
          ${list.length ? list.map((u, i) => `
            <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border);">
              <span style="width:24px;text-align:center;font-weight:700;color:${i<3?'var(--warning)':'var(--text-muted)'};">${i+1}</span>
              <div style="flex:1;">
                <div style="font-size:13px;font-weight:500;">${esc(u.nickname)}</div>
              </div>
              <div style="text-align:right;">
                <div style="font-size:14px;font-weight:600;">${u.winRate}%</div>
                <div style="font-size:11px;color:var(--text-muted);">${u.winCount}胜/${u.totalGames}局</div>
              </div>
            </div>`).join('') : '<div style="text-align:center;padding:20px;color:var(--text-muted);">暂无数据</div>'}
        </div>
        <div class="modal-footer"><button class="btn btn-sm" onclick="this.closest('.modal-mask').remove()">关闭</button></div>
      </div>
    </div>`;
    document.body.insertAdjacentHTML('beforeend', html);
  },

  // ==================== 商城 ====================
  async renderShop(container) {
    if (!this.user) { container.innerHTML = '<div class="empty-state">请先登录</div>'; return; }
    container.innerHTML = '<div class="loading">加载中</div>';
    try {
      const [balanceRes, shopRes] = await Promise.all([
        API.fetchCoinBalance(),
        API.fetchShopItems()
      ]);
      const coins = balanceRes.code === 0 ? (balanceRes.data?.coins || 0) : 0;
      const items = shopRes.success ? shopRes.data : [];

      let html = `
        <div class="shop-header">
          <span style="font-size:32px;">🪙</span>
          <div><div style="font-size:13px;color:var(--text-muted);">我的代币</div>
          <div class="shop-balance">${coins}</div></div>
        </div>
        <div class="page-header"><h1 style="font-size:18px;">道具商城</h1></div>
      `;

      if (items.length) {
        items.forEach(item => {
          const emoji = item.icon && item.icon.includes('hint') ? '💡' : '⭐';
          html += `<div class="shop-item">
            <div class="shop-item-icon">${emoji}</div>
            <div class="shop-item-info">
              <div class="shop-item-name">${esc(item.name)}</div>
              <div class="shop-item-desc">${esc(item.description)}</div>
            </div>
            <div style="text-align:right;">
              <div class="shop-item-price">🪙 ${item.price}</div>
              <button class="btn btn-sm" onclick="App._buyItem(${item.id},${item.price})">购买</button>
            </div>
          </div>`;
        });
      } else {
        html += '<div class="empty-state">暂无商品上架</div>';
      }

      container.innerHTML = html;
    } catch (e) { container.innerHTML = '<div class="empty-state">加载失败</div>'; }
  },

  async _buyItem(itemId, price) {
    if (!confirm(`确定花费 ${price} 代币购买该商品吗？`)) return;
    const res = await API.buyShopItem(itemId);
    if (res.code === 0) {
      alert('购买成功');
      this.renderShop(document.getElementById('pageContent'));
    } else {
      alert(res.message || '购买失败');
    }
  },

  // ==================== 年度 Top30 猜测 ====================
  async renderPicks(container) {
    if (!this.user) { container.innerHTML = '<div class="empty-state">请先登录</div>'; return; }
    container.innerHTML = '<div class="loading">加载中</div>';
    try {
      const [picksRes, configRes] = await Promise.all([
        API.fetchMyPicks(2026),
        API.fetchPickConfig(2026)
      ]);

      const slots = Array.from({length: 30}, (_, i) => ({
        slot: i+1, playerGameId: '', playerName: '',
        submissionNo: 0, maxSubmissions: 3, canSubmit: true
      }));

      if (picksRes.code === 0 && picksRes.data?.selections) {
        picksRes.data.selections.forEach(sel => {
          if (sel.slot >= 1 && sel.slot <= 30) {
            slots[sel.slot-1].playerGameId = sel.playerGameId;
            slots[sel.slot-1].playerName = sel.playerName;
            slots[sel.slot-1].submissionNo = sel.submissionNo;
            slots[sel.slot-1].maxSubmissions = sel.maxSubmissions || 3;
          }
        });
      }

      if (configRes.success && configRes.data?.config) {
        Object.entries(configRes.data.config).forEach(([k, v]) => {
          const idx = parseInt(k) - 1;
          if (idx >= 0 && idx < 30) slots[idx].canSubmit = v;
        });
      }

      const filled = slots.filter(s => s.playerName).length;

      container.innerHTML = `
        <div class="page-header">
          <h1>2026 年度 Top30 猜测</h1>
          <span class="subtitle">每位 top 独立提交，每位置最多 3 次覆盖式提交</span>
        </div>
        <div style="margin-bottom:16px;">
          <div class="progress-bar"><div class="progress-fill" style="width:${filled/30*100}%"></div></div>
          <div style="font-size:13px;color:var(--text-muted);text-align:center;">${filled} / 30 已选</div>
        </div>
        <div class="pick-grid">
          ${slots.map(s => `
            <div class="pick-slot ${s.playerName?'filled':''} ${!s.canSubmit?'disabled':''}"
                 onclick="App._openPickSlot(${s.slot},'${s.playerName}',${s.submissionNo},${s.maxSubmissions})">
              <div class="slot-label">Top${s.slot}</div>
              <div class="slot-name">${s.playerName ? esc(s.playerName) : (s.canSubmit ? '+ 选择' : '关闭')}</div>
              ${s.submissionNo > 0 ? `<div style="font-size:10px;color:var(--text-muted);margin-top:2px;">${s.submissionNo}/${s.maxSubmissions}</div>` : ''}
            </div>`).join('')}
        </div>
      `;
    } catch (e) { container.innerHTML = '<div class="empty-state">加载失败</div>'; }
  },

  _openPickSlot(slot, playerName, submissionNo, maxSubmissions) {
    submissionNo = parseInt(submissionNo) || 0;
    maxSubmissions = parseInt(maxSubmissions) || 3;
    if (submissionNo >= maxSubmissions) { alert(`已达最大提交次数 ${maxSubmissions}`); return; }

    const html = `<div class="modal-mask" id="pickModal">
      <div class="search-panel" onclick="event.stopPropagation()">
        <div class="search-panel-header">
          <span class="modal-title">选择 Top${slot}</span>
          <button class="modal-close" onclick="document.getElementById('pickModal').remove()">×</button>
        </div>
        <div style="padding:0 16px;font-size:12px;color:var(--text-muted);">
          当前提交: 第 ${submissionNo + 1} / ${maxSubmissions} 次
        </div>
        <div class="search-panel-body">
          <div class="input-group" style="margin-bottom:12px;">
            <input class="input" id="pickSearch" placeholder="输入选手名称搜索" oninput="App._pickSearch(this.value, ${slot})">
          </div>
          <div id="pickResults"></div>
        </div>
        <div class="search-panel-footer" id="pickFooter" style="display:none;">
          <span id="pickSelected" style="font-size:13px;flex:1;"></span>
          <button class="btn btn-sm" id="pickSubmitBtn" onclick="App._submitPick(${slot})">提交</button>
        </div>
      </div>
    </div>`;
    document.body.insertAdjacentHTML('beforeend', html);
    this._pickSlot = slot;
    this._pickSelected = null;
    setTimeout(() => {
      const input = document.getElementById('pickSearch');
      if (input) input.focus();
    }, 100);
  },

  _pickSlot: 0,
  _pickSelected: null,

  async _pickSearch(query, slot) {
    if (!query || !query.trim()) { document.getElementById('pickResults').innerHTML = ''; return; }
    if (this._pkTimer) clearTimeout(this._pkTimer);
    this._pkTimer = setTimeout(async () => {
      const res = await API.searchPlayers(query, 0, 30);
      const results = document.getElementById('pickResults');
      if (res.success && res.data.length) {
        results.innerHTML = '<div class="search-results">' +
          res.data.map(p => `<div class="search-result-item" onclick="App._pickSelect('${esc(p.playerId)}','${esc(p.name)}')">
            <span class="sr-name">${esc(p.name)}</span>
            <span class="sr-team">${esc(p.team||'')}</span>
          </div>`).join('') + '</div>';
        this._pickSearchResults = res.data;
      } else {
        results.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted);">未找到匹配选手</div>';
      }
    }, 300);
  },

  _pickSelect(playerId, name) {
    this._pickSelected = { playerId, name };
    const footer = document.getElementById('pickFooter');
    footer.style.display = 'flex';
    document.getElementById('pickSelected').textContent = `已选: ${name}`;
    document.getElementById('pickResults').innerHTML = '';
    document.getElementById('pickSearch').value = '';
  },

  async _submitPick(slot) {
    if (!this._pickSelected) return;
    const btn = document.getElementById('pickSubmitBtn');
    btn.disabled = true; btn.textContent = '提交中...';
    const res = await API.submitPick(slot, this._pickSelected.playerId, this._pickSelected.name);
    if (res.code === 0) {
      alert(`提交成功！第 ${res.data?.submissionNo} 次`);
      document.getElementById('pickModal')?.remove();
      this.renderPicks(document.getElementById('pageContent'));
    } else {
      alert(res.message || '提交失败');
    }
    btn.disabled = false; btn.textContent = '提交';
  },

  // ==================== 管理后台 ====================
  async renderAdmin(container) {
    const token = API.adminGetToken();
    if (!token) {
      container.innerHTML = `
        <div class="page-header"><h1>管理后台</h1></div>
        <div class="card" style="max-width:400px;margin:40px auto;">
          <div style="margin-bottom:16px;">
            <input class="input" id="adminUser" placeholder="用户名" style="margin-bottom:8px;">
            <input class="input" id="adminPass" type="password" placeholder="密码" onkeydown="if(event.key==='Enter')App._adminLogin()">
          </div>
          <p id="adminLoginError" style="color:var(--danger);font-size:13px;display:none;margin-bottom:8px;"></p>
          <button class="btn btn-block" onclick="App._adminLogin()">登录</button>
        </div>
      `;
      return;
    }
    try {
      await API.adminVerify();
      this._renderAdminPanel(container);
    } catch (e) {
      localStorage.removeItem('adminToken');
      this.renderAdmin(container);
    }
  },

  async _adminLogin() {
    const username = document.getElementById('adminUser')?.value.trim();
    const password = document.getElementById('adminPass')?.value;
    if (!username || !password) { document.getElementById('adminLoginError').textContent = '请输入用户名和密码'; document.getElementById('adminLoginError').style.display = 'block'; return; }
    try {
      await API.adminLoginRequest(username, password);
      this._renderAdminPanel(document.getElementById('pageContent'));
    } catch (e) {
      document.getElementById('adminLoginError').textContent = e.message;
      document.getElementById('adminLoginError').style.display = 'block';
    }
  },

  async _renderAdminPanel(container) {
    container.innerHTML = `
      <div class="admin-topbar">
        <h2>管理后台</h2>
        <button class="btn btn-ghost btn-sm" onclick="localStorage.removeItem('adminToken');App.renderAdmin(document.getElementById('pageContent'))">退出</button>
      </div>
      <div class="tab-bar">
        <button class="tab-item active" data-tab="users" onclick="App._adminSwitchTab('users')">用户管理</button>
        <button class="tab-item" data-tab="comments" onclick="App._adminSwitchTab('comments')">评论审核</button>
        <button class="tab-item" data-tab="votes" onclick="App._adminSwitchTab('votes')">猜测管理</button>
      </div>
      <div id="adminTabContent">
        <div id="adminUsersTab" style="display:block;"></div>
        <div id="adminCommentsTab" style="display:none;"></div>
        <div id="adminVotesTab" style="display:none;"></div>
      </div>
    `;
    this._adminTab = 'users';
    this._adminUserPage = 0;
    this._adminCommentPage = 0;
    this._adminLoadUsers();
    this._adminLoadComments();
    this._adminLoadVotes();
  },

  _adminSwitchTab(tab) {
    this._adminTab = tab;
    document.getElementById('adminUsersTab').style.display = tab === 'users' ? 'block' : 'none';
    document.getElementById('adminCommentsTab').style.display = tab === 'comments' ? 'block' : 'none';
    document.getElementById('adminVotesTab').style.display = tab === 'votes' ? 'block' : 'none';
    if (tab === 'users') this._adminLoadUsers();
    else if (tab === 'comments') this._adminLoadComments();
    else if (tab === 'votes') this._adminLoadVotes();
  },

  async _adminLoadUsers() {
    const el = document.getElementById('adminUsersTab');
    if (!el) return;
    try {
      const data = await API.adminGetUsers(this._adminUserPage, 20);
      el.innerHTML = `
        <div style="overflow-x:auto;">
          <table class="admin-table">
            <thead><tr><th>ID</th><th>昵称</th><th>胜场</th><th>总局</th><th>胜率</th><th>代币</th><th>操作</th></tr></thead>
            <tbody>${data.list.map(u => `<tr>
              <td>${u.id}</td><td>${esc(u.nickname)}</td><td>${u.winCount}</td><td>${u.totalGames}</td>
              <td>${u.winRate}%</td><td>${u.coins}</td>
              <td><button class="btn btn-sm" onclick="App._adminEditUser('${esc(u.openid)}','${esc(u.nickname)}',${u.coins})">编辑</button>
                  <button class="btn btn-sm btn-danger" onclick="App._adminDeleteUser('${esc(u.openid)}')">删除</button></td>
            </tr>`).join('')}</tbody>
          </table>
        </div>
        <div style="text-align:center;padding:8px;font-size:13px;color:var(--text-muted);">共 ${data.total} 条</div>
      `;
    } catch (e) { el.innerHTML = '<div class="empty-state">加载失败</div>'; }
  },

  async _adminEditUser(openid, nickname, coins) {
    const newNick = prompt('昵称:', nickname);
    if (newNick === null) return;
    const newCoins = prompt('代币:', coins);
    if (newCoins === null) return;
    try {
      await API.adminUpdateUser(openid, { nickname: newNick, coins: parseInt(newCoins) || 0 });
      alert('更新成功');
      this._adminLoadUsers();
    } catch (e) { alert(e.message); }
  },

  async _adminDeleteUser(openid) {
    if (!confirm('确定删除此用户？')) return;
    try {
      await API.adminDeleteUser(openid);
      this._adminLoadUsers();
    } catch (e) { alert(e.message); }
  },

  async _adminLoadComments() {
    const el = document.getElementById('adminCommentsTab');
    if (!el) return;
    try {
      const data = await API.adminGetPendingComments(this._adminCommentPage, 20);
      el.innerHTML = data.list.length ? `
        <div style="overflow-x:auto;">
          <table class="admin-table">
            <thead><tr><th>用户</th><th>选手</th><th>内容</th><th>时间</th><th>操作</th></tr></thead>
            <tbody>${data.list.map(c => `<tr>
              <td>${esc(c.userName)}</td><td>${esc(c.playerGameId)}</td>
              <td>${esc(c.content)}</td><td>${c.createdAt||''}</td>
              <td><button class="btn btn-sm btn-success" onclick="App._adminReviewComment('${c._id}','approved')">通过</button>
                  <button class="btn btn-sm btn-danger" onclick="App._adminReviewComment('${c._id}','rejected')">驳回</button></td>
            </tr>`).join('')}</tbody>
          </table>
        </div>
        <div style="text-align:center;padding:8px;font-size:13px;color:var(--text-muted);">共 ${data.total} 条待审核</div>
      ` : '<div class="empty-state">暂无待审核评论</div>';
    } catch (e) { el.innerHTML = '<div class="empty-state">加载失败</div>'; }
  },

  async _adminReviewComment(id, status) {
    try {
      await API.adminReviewComment(id, status);
      this._adminLoadComments();
    } catch (e) { alert(e.message); }
  },

  async _adminLoadVotes() {
    const el = document.getElementById('adminVotesTab');
    if (!el) return;
    try {
      const [configData, officialData] = await Promise.all([
        API.adminGetPickConfig(2026),
        API.adminGetOfficialTop30(2026)
      ]);
      const config = configData.config || {};
      const winners = officialData.winners || [];

      el.innerHTML = `
        <div style="margin-bottom:24px;">
          <h3 style="margin-bottom:12px;">提交开关控制</h3>
          <div class="slot-switch-grid" id="slotSwitchGrid">
            ${Array.from({length:30}, (_,i) => {
              const on = config[i+1] !== false;
              return `<div class="slot-toggle ${on?'on':'off'}" data-slot="${i+1}" onclick="App._adminToggleSlot(${i+1})">
                <span>Top${i+1}</span>
                <span style="font-size:11px;">${on?'开启':'关闭'}</span>
              </div>`;
            }).join('')}
          </div>
          <button class="btn btn-sm" onclick="App._adminSaveSlotConfig()" id="saveSlotBtn" style="margin-top:8px;">保存开关配置</button>
          <span id="slotDirty" style="display:none;color:var(--warning);font-size:12px;margin-left:8px;">有未保存更改</span>
        </div>
        <div style="margin-bottom:24px;">
          <h3 style="margin-bottom:12px;">官方 Top30 设定</h3>
          <div id="winnerInputs">
            ${Array.from({length:30}, (_,i) => {
              const w = winners.find(x => x.rank === i+1);
              return `<div style="display:flex;gap:8px;margin-bottom:6px;align-items:center;">
                <span style="font-size:12px;min-width:40px;">Top${i+1}</span>
                <input class="input" style="flex:1;" placeholder="选手ID" value="${esc(w?.playerGameId||'')}" data-rank="${i+1}" id="winnerId${i+1}">
                <input class="input" style="flex:1;" placeholder="选手名称" value="${esc(w?.playerName||'')}" id="winnerName${i+1}">
              </div>`;
            }).join('')}
          </div>
          <button class="btn btn-sm" onclick="App._adminSaveWinners()">保存 Top30</button>
        </div>
        <div>
          <h3 style="margin-bottom:12px;">核对发奖</h3>
          <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;">
            <label style="font-size:13px;">猜对阈值：</label>
            <input class="input" style="width:80px;" id="matchThreshold" value="15">
            <button class="btn btn-sm" onclick="App._adminCheckPicks()">核对</button>
            <button class="btn btn-sm btn-danger" onclick="App._adminAwardPicks()">发放代币奖励</button>
          </div>
          <div id="adminCheckResult" style="font-size:13px;color:var(--text-secondary);"></div>
        </div>
      `;
      this._adminSlotConfig = { ...config };
    } catch (e) { el.innerHTML = '<div class="empty-state">加载失败</div>'; }
  },

  _adminSlotConfig: {},

  _adminToggleSlot(slot) {
    this._adminSlotConfig[slot] = !(this._adminSlotConfig[slot] !== false);
    const grid = document.getElementById('slotSwitchGrid');
    if (grid) {
      grid.querySelectorAll('.slot-toggle').forEach(el => {
        const s = parseInt(el.dataset.slot);
        const on = this._adminSlotConfig[s] !== false;
        el.className = `slot-toggle ${on?'on':'off'}`;
        el.querySelector('span:last-child').textContent = on?'开启':'关闭';
      });
    }
    document.getElementById('slotDirty').style.display = 'inline';
  },

  async _adminSaveSlotConfig() {
    try {
      await API.adminSetPickConfig(2026, this._adminSlotConfig);
      document.getElementById('slotDirty').style.display = 'none';
      alert('配置已保存');
    } catch (e) { alert(e.message); }
  },

  async _adminSaveWinners() {
    const winners = [];
    for (let i = 1; i <= 30; i++) {
      const id = document.getElementById(`winnerId${i}`)?.value.trim();
      const name = document.getElementById(`winnerName${i}`)?.value.trim();
      if (id && name) winners.push({ rank: i, playerGameId: id, playerName: name });
    }
    if (!winners.length) { alert('请至少填写一名选手'); return; }
    try {
      await API.adminSetOfficialTop30(2026, winners);
      alert('已保存');
    } catch (e) { alert(e.message); }
  },

  async _adminCheckPicks() {
    const threshold = parseInt(document.getElementById('matchThreshold')?.value) || 15;
    try {
      const data = await API.adminCheckPicks(2026, threshold);
      const el = document.getElementById('adminCheckResult');
      if (data.total === 0) {
        el.innerHTML = '<span style="color:var(--success);">无人达标</span>';
      } else {
        el.innerHTML = `<span style="color:var(--success);">共 ${data.total} 名用户达标</span><br>` +
          (data.list || []).slice(0, 20).map(u => `${esc(u.nickname)}: 猜对 ${u.matchedCount}/${u.totalSlots}`).join('<br>');
      }
    } catch (e) { alert(e.message); }
  },

  async _adminAwardPicks() {
    if (!confirm('确定向达标用户发放代币奖励？不可重复发放！')) return;
    try {
      const data = await API.adminAwardPicks(2026, parseInt(document.getElementById('matchThreshold')?.value) || 15);
      document.getElementById('adminCheckResult').innerHTML =
        `<span style="color:var(--success);">已向 ${data.awardedUsers} 人发放 ${data.totalCoinsAwarded} 代币</span>`;
    } catch (e) { alert(e.message); }
  },
};

// ==================== 工具函数 ====================
function esc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function formatDate(raw) {
  if (!raw) return '';
  const d = new Date(raw);
  if (isNaN(d.getTime())) return raw;
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// ==================== 启动 ====================
document.addEventListener('DOMContentLoaded', () => App.init());

