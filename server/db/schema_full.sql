-- ============================================================
-- CS Match Pro 完整数据库结构（合并版）
-- 用于 Railway MySQL 初始化
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
  id              INT UNSIGNED    NOT NULL AUTO_INCREMENT,
  game_id         VARCHAR(64)     NOT NULL,
  name            VARCHAR(64)     NOT NULL DEFAULT '',
  real_name       VARCHAR(128)    NOT NULL DEFAULT '',
  age             INT             NOT NULL DEFAULT 0,
  country         VARCHAR(64)     NOT NULL DEFAULT '',
  country_code    VARCHAR(8)      NOT NULL DEFAULT '',
  current_team    VARCHAR(128)    NOT NULL DEFAULT '',
  former_teams    JSON            NULL,
  region          ENUM('Europe','Americas','Asia','Other') NOT NULL DEFAULT 'Other',
  major_appearances INT UNSIGNED  NOT NULL DEFAULT 0,
  position        VARCHAR(32)     NOT NULL DEFAULT '',
  status          ENUM('active','retired','coach','free_agent','unknown') NOT NULL DEFAULT 'unknown' COMMENT '职业状态',
  avatar          VARCHAR(512)    NULL,
  rating          DECIMAL(5,2)    NOT NULL DEFAULT 0.00,
  sniping         DECIMAL(5,1)    NOT NULL DEFAULT 0.0,
  updated_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP
                                    ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_player_game_id (game_id),
  KEY idx_player_region (region),
  KEY idx_player_current_team (current_team),
  KEY idx_player_country_code (country_code),
  KEY idx_player_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='选手信息表';


-- ============================================================
-- 2. 战队表  team
-- ============================================================
DROP TABLE IF EXISTS team;
CREATE TABLE team (
  id              INT UNSIGNED    NOT NULL AUTO_INCREMENT,
  name            VARCHAR(128)    NOT NULL,
  logo_url        VARCHAR(512)    NULL,
  region          ENUM('Europe','Americas','Asia','Other') NOT NULL DEFAULT 'Other',
  region_player_count INT UNSIGNED NOT NULL DEFAULT 0,
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
-- ============================================================
DROP TABLE IF EXISTS team_member;
CREATE TABLE team_member (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  team_id         INT UNSIGNED    NOT NULL,
  team_name       VARCHAR(128)    NOT NULL DEFAULT '',
  player_id       INT UNSIGNED    NOT NULL,
  player_name     VARCHAR(64)     NOT NULL DEFAULT '',
  is_current      TINYINT(1)      NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uk_team_player (team_id, player_id),
  KEY idx_tm_player (player_id),
  KEY idx_tm_team_current (team_id, is_current)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='战队-选手关联表';


-- ============================================================
-- 4. 比赛表  matches
-- ============================================================
DROP TABLE IF EXISTS matches;
CREATE TABLE matches (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  eplay_id        VARCHAR(128)    NULL DEFAULT NULL,
  match_date      DATE            NOT NULL,
  match_time      TIME            NOT NULL,
  match_type      VARCHAR(8)      NOT NULL DEFAULT '',
  team1_id        INT UNSIGNED    NULL,
  team2_id        INT UNSIGNED    NULL,
  team1_score     INT             NULL,
  team2_score     INT             NULL,
  round_scores    JSON            NULL,
  event_name      VARCHAR(256)    NOT NULL DEFAULT '',
  status          VARCHAR(16)     NOT NULL DEFAULT 'upcoming',
  tab             VARCHAR(32)     NOT NULL DEFAULT '',
  updated_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP
                                    ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_match_eplay_id (eplay_id),
  KEY idx_match_date (match_date),
  KEY idx_match_team1 (team1_id),
  KEY idx_match_team2 (team2_id),
  KEY idx_match_status (status),
  KEY idx_match_event (event_name(191))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='比赛信息表（eplay_id 唯一键保证覆盖更新）';


-- ============================================================
-- 5. 选手评论表  player_comments
-- ============================================================
CREATE TABLE IF NOT EXISTS player_comments (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id         VARCHAR(64)     NOT NULL DEFAULT '',
  player_game_id  VARCHAR(64)     NOT NULL,
  content         VARCHAR(500)    NOT NULL,
  created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_pc_player (player_game_id),
  KEY idx_pc_user (user_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='选手评论表';


-- ============================================================
-- 6. Valve 世界排名表  team_ranking
-- ============================================================
DROP TABLE IF EXISTS team_ranking;
CREATE TABLE team_ranking (
  id              INT UNSIGNED    NOT NULL AUTO_INCREMENT,
  ranking         INT UNSIGNED    NOT NULL,
  team_name       VARCHAR(128)    NOT NULL DEFAULT '',
  team_id         INT UNSIGNED    NULL,
  hltv_team_id    VARCHAR(32)     NOT NULL DEFAULT '',
  points          VARCHAR(32)     NOT NULL DEFAULT '',
  logo_url        VARCHAR(512)    NOT NULL DEFAULT '',
  fetched_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP
                                    ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ranking_rank (ranking),
  UNIQUE KEY uk_ranking_team_name (team_name),
  KEY idx_ranking_team_id (team_id),
  KEY idx_ranking_hltv_id (hltv_team_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Valve 官方世界排名';


-- ============================================================
-- 7. 用户表  users
-- ============================================================
DROP TABLE IF EXISTS users;
CREATE TABLE users (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  openid          VARCHAR(64)     NOT NULL,
  nickname        VARCHAR(64)     NOT NULL DEFAULT '微信用户',
  avatar_url      VARCHAR(512)    NULL,
  win_count       INT UNSIGNED    NOT NULL DEFAULT 0,
  total_games     INT UNSIGNED    NOT NULL DEFAULT 0,
  win_rate        DECIMAL(5,2)    NOT NULL DEFAULT 0.00,
  guess_records   JSON            NULL,
  created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP
                                    ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_user_openid (openid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='用户表（微信登录信息、竞猜数据）';


-- ============================================================
-- 8. 比赛选手数据表  match_players
-- ============================================================
DROP TABLE IF EXISTS match_players;
CREATE TABLE match_players (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  match_id        BIGINT UNSIGNED NOT NULL,
  player_game_id  VARCHAR(64)     NOT NULL DEFAULT '',
  player_name     VARCHAR(64)     NOT NULL DEFAULT '',
  team_name       VARCHAR(128)    NOT NULL DEFAULT '',
  kills           INT             NOT NULL DEFAULT 0,
  deaths          INT             NOT NULL DEFAULT 0,
  assists         INT             NOT NULL DEFAULT 0,
  rating          DECIMAL(5,2)    NOT NULL DEFAULT 0.00,
  adr             DECIMAL(5,1)    NOT NULL DEFAULT 0.0,
  plus_minus      INT             NOT NULL DEFAULT 0,
  raw_data        JSON            NULL,
  updated_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP
                                    ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_match_player (match_id, player_name, team_name),
  KEY idx_mp_match (match_id),
  KEY idx_mp_player (player_game_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='每场比赛选手个人数据（K/D/A/Rating/ADR 等）';


-- ============================================================
-- 视图
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
