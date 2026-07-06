-- ============================================================
-- CS Match Pro 数据库结构文件
-- 数据源：
--   - playerbase_clean.json  (选手数据，4654 条)
--   - matchbase.json        (比赛数据，518 条)
-- 目标数据库：MySQL 8.0+ (utf8mb4)
-- 字符集：utf8mb4 / 排序规则：utf8mb4_unicode_ci
-- ============================================================

CREATE DATABASE IF NOT EXISTS cs_match_pro
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_unicode_ci;

USE cs_match_pro;

-- ============================================================
-- 1. 选手表  player
-- ============================================================
DROP TABLE IF EXISTS player;
CREATE TABLE player (
  -- 自增主键（数据库内部 ID）
  id              INT UNSIGNED    NOT NULL AUTO_INCREMENT,
  -- 选手在 HLTV/HLTV.org 上的游戏 ID（业务唯一键）
  game_id         VARCHAR(64)     NOT NULL,
  real_name       VARCHAR(128)    NOT NULL DEFAULT '',
  age             INT             NOT NULL DEFAULT 0,
  country         VARCHAR(64)     NOT NULL DEFAULT '',
  -- 国家代码（ISO 3166-1 alpha-2，如 UA / CN / PS / XK）
  country_code    VARCHAR(8)      NOT NULL DEFAULT '',
  -- 当前所属战队名（冗余存储，便于查询；正式关系以 team_member 表为准）
  current_team    VARCHAR(128)    NOT NULL DEFAULT '',
  -- 历史所属战队列表（JSON 数组字符串，保留清洗前的原始顺序）
  former_teams    JSON            NULL,
  -- 所属赛区：Europe / Americas / Asia / Other
  region          ENUM('Europe','Americas','Asia','Other') NOT NULL DEFAULT 'Other',
  major_appearances INT UNSIGNED  NOT NULL DEFAULT 0,
  position        VARCHAR(32)     NOT NULL DEFAULT '',
  rating          DECIMAL(5,2)    NOT NULL DEFAULT 0.00,
  -- 爬取/更新时间
  updated_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP
                                    ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  -- game_id 在数据源中是 HLTV _id（如 "25337"），但业务上以选手名 game_id 唯一
  UNIQUE KEY uk_player_game_id (game_id),
  KEY idx_player_region (region),
  KEY idx_player_current_team (current_team),
  KEY idx_player_country_code (country_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='选手信息表';


-- ============================================================
-- 2. 战队表  team
-- 战队所属赛区（team_region）按 V 社规则确定：
--   "战队当前 5 名选手中，若有 3 人及以上属于同一赛区，即认定该战队
--    属于这 3 人（及以上）的赛区；若此条件无法达成，则归类为 Europe。"
-- 推断边界：
--   - 统计范围 = 战队的"当前 5 名选手"（以 player.current_team 聚合）
--   - 统计不含 formerTeams 的历史成员（历史仅写入 team_member）
--   - 若某 region 当前选手数 >= 3 且为最多 -> 取该 region
--   - 若所有 region 当前选手数均 < 3 -> 归 Europe
--   - 战队为空（无当前选手）-> 归 Europe
-- ============================================================
DROP TABLE IF EXISTS team;
CREATE TABLE team (
  id              INT UNSIGNED    NOT NULL AUTO_INCREMENT,
  -- 战队名（业务唯一键；playerbase 中同一战队名可能对应不同 teamId 段，
  -- 此处统一以战队名为唯一标识）
  name            VARCHAR(128)    NOT NULL,
  -- 战队队标 URL（先不填，保留字段供后续接入）
  logo_url        VARCHAR(512)    NULL,
  -- 战队所属赛区（由 player.formerTeams + player.current_team 联合统计得出）
  -- 取值同 player.region：Europe / Americas / Asia / Other
  region          ENUM('Europe','Americas','Asia','Other') NOT NULL DEFAULT 'Other',
  -- 该战队在所属赛区下拥有的选手数（便于回溯推断）
  region_player_count INT UNSIGNED NOT NULL DEFAULT 0,
  -- 战队成员数（与 player.current_team 关联的实际选手数）
  member_count    INT UNSIGNED    NOT NULL DEFAULT 0,
  updated_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP
                                    ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_team_name (name),
  KEY idx_team_region (region)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='战队信息表';


-- ============================================================
-- 3. 战队成员关联表  team_member
-- 实现"战队 - 选手"多对多关系：
--   - 选手可能有多段历史战队经历
--   - 通过 is_current 区分当前/历史
--   - team_name / player_name 为冗余字段，便于直接查询展示
-- ============================================================
DROP TABLE IF EXISTS team_member;
CREATE TABLE team_member (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  team_id         INT UNSIGNED    NOT NULL,
  team_name       VARCHAR(128)    NOT NULL DEFAULT '',
  player_id       INT UNSIGNED    NOT NULL,
  player_name     VARCHAR(64)     NOT NULL DEFAULT '',
  -- 是否当前成员（1=当前，0=历史）
  is_current      TINYINT(1)      NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  -- 一名选手在同一个战队只可能出现一次（不论当前/历史）
  UNIQUE KEY uk_team_player (team_id, player_id),
  KEY idx_tm_player (player_id),
  KEY idx_tm_team_current (team_id, is_current)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='战队-选手关联表';


-- ============================================================
-- 4. 比赛表  matches
-- 数据来源：matchbase.json
-- 注意：原拟用 "match"，但 match 是 MySQL 保留字（全文索引 MATCH ... AGAINST），
--      故改为 matches。
-- ============================================================
DROP TABLE IF EXISTS matches;
CREATE TABLE matches (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  match_date      DATE            NOT NULL,
  match_time      TIME            NOT NULL,
  match_type      VARCHAR(8)      NOT NULL DEFAULT '',   -- BO1 / BO3 / BO5
  team1_id        INT UNSIGNED    NULL,
  team2_id        INT UNSIGNED    NULL,
  team1_score     INT             NULL,
  team2_score     INT             NULL,
  round_scores    JSON            NULL,
  event_name      VARCHAR(256)    NOT NULL DEFAULT '',
  -- upcoming / live / finished
  status          VARCHAR(16)     NOT NULL DEFAULT 'upcoming',
  tab             VARCHAR(32)     NOT NULL DEFAULT '',    -- schedule / results
  updated_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP
                                    ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_match_date (match_date),
  KEY idx_match_team1 (team1_id),
  KEY idx_match_team2 (team2_id),
  KEY idx_match_status (status),
  KEY idx_match_event (event_name(191))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='比赛信息表';


-- ============================================================
-- 视图：选手-当前战队 关联视图
-- ============================================================
DROP VIEW IF EXISTS v_player_current_team;
CREATE VIEW v_player_current_team AS
SELECT
  p.id          AS player_id,
  p.game_id,
  p.real_name,
  p.country,
  p.country_code,
  p.region      AS player_region,
  p.position,
  p.rating,
  t.id          AS team_id,
  t.name        AS team_name,
  t.region      AS team_region
FROM player p
LEFT JOIN team_member tm
       ON tm.player_id = p.id AND tm.is_current = 1
LEFT JOIN team t
       ON t.id = tm.team_id;

-- ============================================================
-- 视图：战队成员数（仅含当前成员）
-- ============================================================
DROP VIEW IF EXISTS v_team_member_count;
CREATE VIEW v_team_member_count AS
SELECT
  t.id   AS team_id,
  t.name AS team_name,
  t.region AS team_region,
  COUNT(tm.player_id) AS current_member_count
FROM team t
LEFT JOIN team_member tm
       ON tm.team_id = t.id AND tm.is_current = 1
GROUP BY t.id, t.name, t.region;