# CS Match Pro 项目指南

## 推送规则（双备份强制）
每次修改完代码必须执行完整三步，保持本地 + GitHub 两边代码一致、可互相备份：

```bash
git add <文件>
git commit -m "<描述>"
git push
```

**绝对禁止**只改本地不推送。如遇网络问题导致 push 失败，重试直到成功。

## 项目结构
- `miniprogram/` — 微信小程序前端
- `server/` — Express 后端（Node.js + MySQL）
- `crawler/` — HLTV / 5eplay 爬虫脚本
- `scripts/` — 数据导入脚本
- `.github/workflows/` — GitHub Actions 自动化工作流

## 猜一猜游戏难度分级
- 极简 (trivial)：选手现役队伍在世界排名前30的战队中
- 简单 (easy)：选手现役队伍在 team_ranking 表中（世界排名前60）
- 困难 (hard)：有现役队伍即可（含无排名战队）
- 地狱 (hell)：所有选手（含自由人/退役）
