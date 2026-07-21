#!/usr/bin/env python3
"""Update app.js: remove login, add mini-program prompt"""
import re

with open('server/public/web/js/app.js', 'r', encoding='utf-8') as f:
    content = f.read()

# ====== 1. Add closeMiniProgramModal function and modify init ======

old_init = """  init() {
    // 检查登录状态
    this.user = API.getCachedUser();
    this.updateNavUser();

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
  },"""

new_init = """  init() {
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
  },"""

content = content.replace(old_init, new_init)

# ====== 2. Replace updateNavUser ======
old_nav = """  updateNavUser() {
    const el = document.getElementById('navUserName');
    if (this.user && this.user.nickname) {
      el.textContent = this.user.nickname;
    } else {
      el.textContent = '未登录';
    }
  },"""

new_nav = """  updateNavUser() {
    const el = document.getElementById('navUserName');
    if (el) el.textContent = '未登录';
  },"""

content = content.replace(old_nav, new_nav)

# ====== 3. Remove login functions ======

removals = [
    "  showLogin() {\n    document.getElementById('loginModal').style.display = 'flex';\n    document.getElementById('loginPhone').value = '';\n    document.getElementById('loginError').style.display = 'none';\n    document.getElementById('loginBtn').disabled = false;\n    document.getElementById('loginBtn').textContent = '登录';\n    setTimeout(() => document.getElementById('loginPhone').focus(), 100);\n  },",
    "  closeLogin() {\n    document.getElementById('loginModal').style.display = 'none';\n  },",
    "  doLogin() {\n    const phone = document.getElementById('loginPhone').value.trim();\n    if (!phone || phone.length !== 11) {\n      this.showLoginError('请输入正确的11位手机号');\n      return;\n    }\n    const btn = document.getElementById('loginBtn');\n    btn.disabled = true;\n    btn.textContent = '登录中...';\n    try {\n      const res = await API.webLogin(phone);\n      if (res.success) {\n        this.user = res.user;\n        this.updateNavUser();\n        this.closeLogin();\n        // 重新渲染当前页\n        this.navigate(this.currentPage, this._lastQuery || {});\n        if (this._onLoginCallback) {\n          this._onLoginCallback();\n          this._onLoginCallback = null;\n        }\n      } else {\n        this.showLoginError(res.message || '登录失败');\n      }\n    } catch (e) {\n      this.showLoginError('网络错误');\n    }\n    btn.disabled = false;\n    btn.textContent = '登录';\n  },",
    "  showLoginError(msg) {\n    const el = document.getElementById('loginError');\n    el.textContent = msg;\n    el.style.display = 'block';\n  },",
    "  requireLogin(callback) {\n    if (this.user) { callback(); return; }\n    this._onLoginCallback = callback;\n    this.showLogin();\n  },",
    "  logout() {\n    if (!confirm('确定退出登录？')) return;\n    API.logout();\n    this.user = null;\n    this.updateNavUser();\n    this.navigate('home');\n  },",
]

for old in removals:
    if old in content:
        content = content.replace(old, '')
    else:
        # Try to find shortened version
        first_line = old.split('\n')[0]
        if first_line in content:
            print(f"  FOUND match start: {first_line}")

# ====== 4. Replace requireLogin calls ======

content = content.replace(
    "App.requireLogin(()=>{App.state.guess.mode='friend';App.renderGuess(document.getElementById('pageContent'))})",
    "App.showMiniProgramPrompt()"
)

content = content.replace(
    'if (!this.user) { this.requireLogin(() => this._sendComment()); return; }',
    'if (!this.user) { this.showMiniProgramPrompt(); return; }'
)

# ====== 5. Replace if (!this.user) checks ======

content = content.replace(
    "  async renderShop(container) {\n    if (!this.user) { container.innerHTML = '<div class=\"empty-state\">请先登录</div>'; return; }",
    """  async renderShop(container) {
    if (!this.user) { container.innerHTML = '<div class="empty-state" style="text-align:center;padding:60px 20px;"><div style="font-size:48px;margin-bottom:16px;">📱</div><p style="font-size:16px;margin-bottom:8px;">请使用微信小程序</p><p style="font-size:13px;color:var(--text-muted);">此功能需要在微信小程序中操作<br>打开微信 → 搜索「云雪CS助手」</p></div>'; return; }"""
)

content = content.replace(
    "  async renderPicks(container) {\n    if (!this.user) { container.innerHTML = '<div class=\"empty-state\">请先登录</div>'; return; }",
    """  async renderPicks(container) {
    if (!this.user) { container.innerHTML = '<div class="empty-state" style="text-align:center;padding:60px 20px;"><div style="font-size:48px;margin-bottom:16px;">📱</div><p style="font-size:16px;margin-bottom:8px;">请使用微信小程序</p><p style="font-size:13px;color:var(--text-muted);">此功能需要在微信小程序中操作<br>打开微信 → 搜索「云雪CS助手」</p></div>'; return; }"""
)

content = content.replace(
    "    if (!this.user) return;\n  },\n\n  async _sendComment()",
    "    if (!this.user) { this.showMiniProgramPrompt(); return; }\n  },\n\n  async _sendComment()"
)

# This one appears for _submitGuessResult
content = content.replace(
    "  async _submitGuessResult(won, attempts) {\n    if (!this.user) return;",
    "  async _submitGuessResult(won, attempts) {\n    if (!this.user) { if (won) alert('🎉 恭喜回答正确！登录后可保存记录，请使用微信小程序'); return; }"
)

# Remove _onLoginCallback references in the object
content = content.replace("  _onLoginCallback: null,\n", "")

# ====== 6. Replace renderUser entirely ======
old_user_start = "  async renderUser(container) {"
old_user_idx = content.find(old_user_start)
if old_user_idx >= 0:
    # Find the end of this method - next "  // ====================" or similar
    method_end = content.find("  // ====================\n\n  // ==================== 首页", old_user_idx)
    if method_end < 0:
        method_end = content.find("  // ====================\n\n  // ==================== 工具函数", old_user_idx)

    old_method = content[old_user_idx:method_end]
    new_method = """  async renderUser(container) {
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
"""
    content = content[:old_user_idx] + new_method + content[method_end:]
    print("  renderUser replaced")
else:
    print("  WARNING: renderUser not found")

# ====== 7. Remove references to loginModal ======
# The modal doesn't exist anymore, but JS might reference it
content = content.replace("this.closeLogin()", "App.closeMiniProgramModal()")

with open('server/public/web/js/app.js', 'w', encoding='utf-8') as f:
    f.write(content)

print('app.js updated')

# Verify
checks = {
    'showLogin': 'showLogin(',
    'closeLogin': 'closeLogin(',
    'doLogin': 'doLogin(',
    'requireLogin': 'requireLogin(',
    'logout': '.logout(',
    'getCachedUser': 'getCachedUser',
    'webLogin': 'webLogin(',
    'loginModal': 'loginModal',
}
for name, pattern in checks.items():
    count = content.count(pattern)
    status = 'OK' if count == 0 else f'WARNING: {count} remaining'
    print(f'  {name}: {status}')
