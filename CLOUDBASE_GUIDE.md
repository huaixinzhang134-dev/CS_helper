# CloudBase AI 开发指南

## 环境配置

- **环境 ID**: `cloud1-2ghbpsm69fa43fcb`
- **区域**: `ap-shanghai`
- **MCP 版本**: 2.8.0

## 微信小程序云开发初始化

```typescript
// app.ts
App<IAppOption>({
  onLaunch() {
    wx.cloud.init({
      env: 'cloud1-2ghbpsm69fa43fcb',
      traceUser: true,
    });
  }
});
```

## 数据库操作

### 玩家 (players) 集合结构

```typescript
interface Player {
  _id: string           // 玩家ID
  name: string          // 游戏ID
  realName: string      // 真实姓名
  country: string       // 国家
  countryCode: string   // 国家代码 (如: CN, US)
  age: number           // 年龄
  team: string          // 当前战队
  teamId: string        // 战队ID
  formerTeams: string[] // 曾服役战队
  majorAppearances: number // Major参与次数
  position: string      // 位置 (狙击手/步枪手/指挥/教练)
  avatar: string        // 头像路径
}
```

### 常用数据库操作

```typescript
const db = wx.database()

// 查询所有玩家
db.collection('players').get().then(res => {
  console.log(res.data)
})

// 随机获取一个玩家
db.collection('players')
  .skip(Math.floor(Math.random() * total))
  .limit(1)
  .get()

// 根据ID查询
db.collection('players').doc('player-id').get()

// 添加玩家
db.collection('players').add({
  data: {
    name: 's1mple',
    team: 'NAVI',
    country: 'Ukraine'
  }
})
```

## AI 模型调用

```typescript
const app = cloudbase.init({ env: 'cloud1-2ghbpsm69fa43fcb' })
const ai = app.ai()

// 创建模型
const model = ai.createModel('hunyuan-lite')

// 文本生成
const res = await model.generateText({
  model: 'hunyuan-lite',
  messages: [
    { role: 'user', content: '你好' }
  ]
})
console.log(res.text)

// 流式文本生成
const res = await model.streamText({
  model: 'hunyuan-lite',
  messages: [
    { role: 'user', content: '介绍一下CS2' }
  ]
})

for await (let str of res.textStream) {
  console.log(str)
}
```

## MCP 工具（需要重启IDE后可用）

配置文件 `.mcp.json` 已创建，包含以下工具类别：

- `login` - 登录 CloudBase 环境
- `readNoSqlDatabaseStructure` - 读取数据库结构
- `writeNoSqlDatabaseStructure` - 修改数据库结构
- `readNoSqlDatabaseContent` - 查询数据库记录
- `writeNoSqlDatabaseContent` - 修改数据库记录
- `getFunctionList` - 获取云函数列表
- `createFunction` - 创建云函数
- `uploadFiles` - 上传静态网站文件
- `manageStorage` - 管理云存储
- `searchKnowledgeBase` - 搜索知识库
- `downloadTemplate` - 下载项目模板

**注意**: MCP 配置需要重启 IDE 才能生效。

## 项目结构

```
miniprogram/
├── services/
│   ├── cloudbase.ts   # CloudBase 初始化
│   ├── database.ts    # 数据库操作
│   └── index.ts       # 统一导出
├── pages/
│   ├── guess/         # 猜选手页面
│   ├── player/        # 选手详情
│   └── user/          # 用户中心
└── crawler/
    └── hltv-players-crawler.js  # 数据爬虫
```
