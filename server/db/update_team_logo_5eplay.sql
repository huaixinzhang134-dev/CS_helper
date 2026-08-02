-- ============================================================
-- team 表新增 logo_5eplay 字段（5eplay 队标）
-- 在 MySQL 中执行一次即可：
--   mysql -h <host> -u <user> -p <database> < server/db/update_team_logo_5eplay.sql
-- 幂等：字段已存在时 ALTER 会报错，忽略即可
-- ============================================================

ALTER TABLE team
  ADD COLUMN logo_5eplay VARCHAR(512) NULL COMMENT '5eplay 队标（赛事爬虫写入，HLTV 为空/不可用时兜底）'
  AFTER logo_url;
