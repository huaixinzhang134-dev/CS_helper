-- 修复选手 status 字段
-- 规则：教练=coach，有战队=active
-- 无战队选手由爬虫通过 HLTV URL 确定退役/自由人，不做统一推断

UPDATE player SET status = 'coach' WHERE position = 'coach';
UPDATE player SET status = 'active' WHERE status != 'coach' AND current_team != '' AND current_team IS NOT NULL;

SELECT status, COUNT(*) FROM player GROUP BY status;
