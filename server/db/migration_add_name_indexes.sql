-- ============================================================
-- 为搜索性能添加 name / real_name 索引
-- 猜一猜搜索使用 name LIKE '前缀%'，全表扫描 6200+ 行导致慢
-- ============================================================

ALTER TABLE player ADD INDEX idx_player_name (name);
ALTER TABLE player ADD INDEX idx_player_real_name (real_name);

SELECT '✅ name/real_name 索引添加完成' AS status;
SHOW INDEX FROM player WHERE Key_name IN ('idx_player_name','idx_player_real_name');
