#!/usr/bin/env python3
"""Update api.js: remove user login, keep admin login"""
with open('server/public/web/js/api.js', 'r', encoding='utf-8') as f:
    content = f.read()

# Remove _token field
content = content.replace('  _token: null,\n', '')

# Remove setToken
content = content.replace(
    '  setToken(token) {\n'
    '    this._token = token;\n'
    "    localStorage.setItem('web_token', token || '');\n"
    '  },\n',
    ''
)

# Remove getToken
content = content.replace(
    '  getToken() {\n'
    "    if (!this._token) this._token = localStorage.getItem('web_token') || '';\n"
    '    return this._token;\n'
    '  },\n',
    ''
)

# Remove clearToken
content = content.replace(
    '  clearToken() {\n'
    '    this._token = null;\n'
    "    localStorage.removeItem('web_token');\n"
    '  },\n',
    ''
)

# Remove Authorization header from request
old_request = (
    "    const headers = { 'Content-Type': 'application/json' };\n"
    '    const token = this.getToken();\n'
    "    if (token && !opts.noAuth) headers['Authorization'] = `Bearer ${token}`;"
)
new_request = "    const headers = { 'Content-Type': 'application/json' };"
content = content.replace(old_request, new_request)

# Remove webLogin
content = content.replace(
    '  async webLogin(phone) {\n'
    "    const res = await this.post('/users/web-login', { phone }, { noAuth: true });\n"
    '    if (res.code === 0 && res.data) {\n'
    '      this.setToken(res.data.token);\n'
    "      localStorage.setItem('web_user', JSON.stringify(res.data.user));\n"
    '      return { success: true, user: res.data.user };\n'
    '    }\n'
    '    return { success: false, message: res.message || \'登录失败\' };\n'
    '  },\n',
    ''
)

# Remove getCachedUser
content = content.replace(
    '  getCachedUser() {\n'
    '    try {\n'
    "      const user = localStorage.getItem('web_user');\n"
    '      return user ? JSON.parse(user) : null;\n'
    "    } catch { return null; }\n"
    '  },\n',
    ''
)

# Remove logout
content = content.replace(
    '  logout() {\n'
    '    this.clearToken();\n'
    "    localStorage.removeItem('web_user');\n"
    '  },\n',
    ''
)

with open('server/public/web/js/api.js', 'w', encoding='utf-8') as f:
    f.write(content)

print('api.js updated')

# Verify
for name in ['_token', 'setToken(', 'getToken(', 'clearToken', 'webLogin(', 'getCachedUser', '.logout(']:
    count = content.count(name)
    status = 'OK' if count == 0 else f'WARNING: {count} remaining'
    print(f'  {name}: {status}')

# Check admin functions intact
for name in ['adminLogin(', 'adminGetToken(', 'adminVerify']:
    count = content.count(name)
    print(f'  admin {name}: {count} (should be > 0)')
