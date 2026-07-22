-- 修复选手 status 字段
-- 根据现有数据推断：有战队且不是教练=active，教练=coach，无战队=retired

UPDATE player SET status = 'coach' WHERE position = 'coach';
UPDATE player SET status = 'active' WHERE status != 'coach' AND current_team != '' AND current_team IS NOT NULL;
UPDATE player SET status = 'retired' WHERE status = 'unknown' AND (current_team = '' OR current_team IS NULL);

SELECT status, COUNT(*) FROM player GROUP BY status;
