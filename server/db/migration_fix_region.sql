-- ============================================================
-- 修复选手和队伍赛区数据：从 countryCode 推断 region
--
-- 之前 player_data.js 爬虫不爬 region 字段，
-- 而 clean_playerbase_region.py + import_to_sql.py 的流程没跑，
-- 导致数据库里所有 player.region 和 team.region 都是默认 "Other"
--
-- 在阿里云服务器执行：
--   mysql -u root -p cs_match_pro < server/db/migration_fix_region.sql
-- ============================================================

-- ============================================================
-- 第一步：更新选手赛区（根据 country_code 推断）
-- ============================================================
UPDATE player SET region = 'Europe' WHERE country_code IN (
  'FR','DE','NL','BE','LU','AT','CH','IE','GB','UK',
  'SE','NO','DK','FI','IS',
  'IT','ES','PT','GR','MT','CY','AD','MC','SM','VA',
  'PL','CZ','SK','HU','SI','HR','BA','RS','ME','MK','AL','XK',
  'RU','UA','BY','MD','EE','LV','LT',
  'BG','RO','LI','FO','SJ','AX','GI'
);

UPDATE player SET region = 'Americas' WHERE country_code IN (
  'US','CA','MX',
  'GT','BZ','HN','SV','NI','CR','PA',
  'CU','JM','HT','DO','PR','BS','BB','TT','LC','GD','VC','DM',
  'AG','KN','AI','MS','TC','VG','VI','KY','BM','AW','CW',
  'BR','AR','CL','CO','PE','VE','EC','BO','PY','UY','GY'
);

UPDATE player SET region = 'Asia' WHERE country_code IN (
  'CN','JP','KR','KP','MN','TW','HK','MO',
  'SG','MY','ID','TH','VN','PH','MM','KH','LA','BN','TL',
  'IN','PK','BD','NP','BT','LK','MV','AF',
  'TR','SA','AE','QA','KW','BH','OM','YE','JO','LB','SY',
  'IQ','IR','IL','PS','AM','AZ','GE',
  'KZ','UZ','TM','KG','TJ',
  'AU','NZ','PG','FJ'
);

-- country_code 为空或不在以上列表中的保持默认 'Other'

-- ============================================================
-- 第二步：更新队伍赛区（按选手多数赛区推断）
-- V社规则：当前 5 名选手中 >=3 人同赛区 → 队伍归属该赛区
-- ============================================================

-- 先统计每支队伍各赛区选手数（仅 current_team 匹配）
DROP TEMPORARY TABLE IF EXISTS tmp_team_region;
CREATE TEMPORARY TABLE tmp_team_region AS
SELECT
  p.current_team AS team_name,
  p.region,
  COUNT(*) AS cnt
FROM player p
WHERE p.current_team != '' AND p.status IN ('active', 'coach')
GROUP BY p.current_team, p.region;

-- 按 V 社规则推断最终赛区
DROP TEMPORARY TABLE IF EXISTS tmp_team_final_region;
CREATE TEMPORARY TABLE tmp_team_final_region AS
SELECT
  t.team_name,
  CASE
    -- 有 >=3 人同赛区的取该赛区
    WHEN MAX(CASE WHEN t.cnt >= 3 THEN t.cnt ELSE 0 END) > 0
      THEN (SELECT t2.region FROM tmp_team_region t2
            WHERE t2.team_name = t.team_name AND t2.cnt >= 3
            ORDER BY t2.cnt DESC LIMIT 1)
    -- 否则默认 Europe
    ELSE 'Europe'
  END AS region
FROM tmp_team_region t
GROUP BY t.team_name;

-- 更新 team 表
UPDATE team t
JOIN tmp_team_final_region f ON f.team_name = t.name
SET t.region = f.region;

-- 处理 team 表中存在但无当前选手的队伍 → 保持默认 'Other'
-- （这些队伍可能已解散或数据不全）

-- 清理临时表
DROP TEMPORARY TABLE IF EXISTS tmp_team_region;
DROP TEMPORARY TABLE IF EXISTS tmp_team_final_region;

-- ============================================================
-- 完成
-- ============================================================
SELECT '选手赛区更新完成' AS status;
SELECT region, COUNT(*) AS cnt FROM player GROUP BY region;
SELECT '队伍赛区更新完成' AS status;
SELECT region, COUNT(*) AS cnt FROM team GROUP BY region;
