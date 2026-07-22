-- ============================================================
-- 修复选手和队伍赛区数据：从 countryCode 推断 region
--
-- 之前 player_data.js 爬虫不爬 region 字段，
-- 而 clean_playerbase_region.py + import_to_sql.py 的流程没跑，
-- 导致数据库里所有 player.region 和 team.region 都是默认 "Other"
--
-- 执行：
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

-- ============================================================
-- 第二步：通过 team_member 表关联选手→队伍（用 team_id 不用队名）
-- V社规则：当前 5 名选手中 >=3 人同赛区 → 队伍归属该赛区
-- ============================================================

-- 统计每支队伍各赛区选手数（通过 team_member 关联）
DROP TABLE IF EXISTS _tmp_team_region;
CREATE TABLE _tmp_team_region (
  team_id INT UNSIGNED NOT NULL,
  region VARCHAR(16) NOT NULL,
  cnt INT NOT NULL DEFAULT 0,
  PRIMARY KEY (team_id, region)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO _tmp_team_region (team_id, region, cnt)
SELECT tm.team_id, p.region, COUNT(*)
FROM team_member tm
JOIN player p ON p.game_id = tm.player_game_id
WHERE tm.is_current = 1
GROUP BY tm.team_id, p.region;

-- 按 V 社规则推断每支队伍的最終赛区
DROP TABLE IF EXISTS _tmp_team_final;
CREATE TABLE _tmp_team_final (
  team_id INT UNSIGNED NOT NULL PRIMARY KEY,
  region VARCHAR(16) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO _tmp_team_final (team_id, region)
SELECT
  r.team_id,
  CASE
    -- 有赛区 >=3 人 → 取该赛区（按人数降序取第一个达标的）
    WHEN MAX(CASE WHEN r.cnt >= 3 THEN r.cnt ELSE 0 END) > 0
      THEN SUBSTRING_INDEX(
             GROUP_CONCAT(CASE WHEN r.cnt >= 3 THEN r.region END ORDER BY r.cnt DESC),
             ',', 1)
    -- 无赛区 >=3 人 → 默认 Europe
    ELSE 'Europe'
  END
FROM _tmp_team_region r
GROUP BY r.team_id;

-- 通过 team_id 更新 team 表
UPDATE team t
JOIN _tmp_team_final f ON f.team_id = t.id
SET t.region = f.region;

-- 清理
DROP TABLE IF EXISTS _tmp_team_region;
DROP TABLE IF EXISTS _tmp_team_final;

-- ============================================================
-- 完成
-- ============================================================
SELECT '✅ 选手赛区更新完成' AS status;
SELECT region, COUNT(*) AS cnt FROM player GROUP BY region;
SELECT '✅ 队伍赛区更新完成' AS status;
SELECT region, COUNT(*) AS cnt FROM team GROUP BY region;
