-- ============================================================
-- 迁移脚本：给已有 matches 表增加 eplay_id 支持覆盖更新
-- 在 Railway MySQL 中手动执行
-- ============================================================

-- 1. 添加 eplay_id 列（允许 NULL，UNIQUE KEY 允许多个 NULL 值）
ALTER TABLE matches
  ADD COLUMN eplay_id VARCHAR(128) NULL DEFAULT NULL
  AFTER id;

-- 2. 给 eplay_id 建唯一索引（多个 NULL 不冲突）
ALTER TABLE matches
  ADD UNIQUE KEY uk_match_eplay_id (eplay_id);
