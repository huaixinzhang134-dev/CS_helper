-- 001_initial_schema.sql
-- 初始数据库结构（与 schema_full.sql 一致）

CREATE TABLE IF NOT EXISTS player (
  id              INT UNSIGNED    NOT NULL AUTO_INCREMENT,
  game_id         VARCHAR(64)     NOT NULL,
  name            VARCHAR(64)     NOT NULL DEFAULT '',
  real_name       VARCHAR(128)    NOT NULL DEFAULT '',
  age             INT             NOT NULL DEFAULT 0,
  country         VARCHAR(64)     NOT NULL DEFAULT '',
  country_code    VARCHAR(8)      NOT NULL DEFAULT '',
  current_team    VARCHAR(128)    NOT NULL DEFAULT '',
  former_teams    JSON,
  region          VARCHAR(32)     NOT NULL DEFAULT 'Other',
  major_appearances INT           NOT NULL DEFAULT 0,
  position        VARCHAR(32)     NOT NULL DEFAULT '步枪手',
  status          ENUM('active','retired','coach','free_agent','unknown') NOT NULL DEFAULT 'unknown',
  avatar          VARCHAR(512)    NOT NULL DEFAULT '',
  rating          DECIMAL(4,2)    NOT NULL DEFAULT 0.00,
  sniping         decimal(8,2)    NOT NULL DEFAULT 0.00,
  created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_player_game_id (game_id),
  KEY idx_player_region (region),
  KEY idx_player_current_team (current_team),
  KEY idx_player_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS team (
  id                  INT UNSIGNED    NOT NULL AUTO_INCREMENT,
  name                VARCHAR(128)    NOT NULL DEFAULT '',
  region              VARCHAR(32)     NOT NULL DEFAULT 'Other',
  region_player_count INT             NOT NULL DEFAULT 0,
  member_count        INT             NOT NULL DEFAULT 0,
  created_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_team_name (name),
  KEY idx_team_region (region)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS team_member (
  id              INT UNSIGNED    NOT NULL AUTO_INCREMENT,
  team_id         INT UNSIGNED    NOT NULL,
  team_name       VARCHAR(128)    NOT NULL DEFAULT '',
  player_id       INT UNSIGNED    NOT NULL,
  player_name     VARCHAR(64)     NOT NULL DEFAULT '',
  is_current      TINYINT(1)      NOT NULL DEFAULT 0,
  created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_team_player (team_id, player_id),
  KEY idx_tm_player (player_id),
  KEY idx_tm_team_current (team_id, is_current)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS matches (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  match_date      DATE,
  match_time      TIME,
  match_type      VARCHAR(32)     NOT NULL DEFAULT '',
  team1_id        INT UNSIGNED,
  team2_id        INT UNSIGNED,
  team1_score     INT             NOT NULL DEFAULT 0,
  team2_score     INT             NOT NULL DEFAULT 0,
  round_scores    JSON,
  event_name      VARCHAR(255)    NOT NULL DEFAULT '',
  status          VARCHAR(32)     NOT NULL DEFAULT 'upcoming',
  tab             VARCHAR(32)     NOT NULL DEFAULT '',
  eplay_id        VARCHAR(64)     NOT NULL DEFAULT '',
  created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_match_eplay_id (eplay_id),
  KEY idx_match_date (match_date),
  KEY idx_match_team1 (team1_id),
  KEY idx_match_team2 (team2_id),
  KEY idx_match_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS player_comments (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id         VARCHAR(64)     NOT NULL DEFAULT '',
  player_game_id  VARCHAR(64)     NOT NULL,
  content         VARCHAR(500)    NOT NULL,
  created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_pc_player (player_game_id),
  KEY idx_pc_user (user_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS team_ranking (
  id              INT UNSIGNED    NOT NULL AUTO_INCREMENT,
  team_name       VARCHAR(128)    NOT NULL DEFAULT '',
  ranking         INT             NOT NULL DEFAULT 0,
  points          INT             NOT NULL DEFAULT 0,
  change_from_last VARCHAR(16)    NOT NULL DEFAULT '',
  created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ranking_rank (ranking),
  KEY idx_ranking_team_name (team_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS users (
  id              INT UNSIGNED    NOT NULL AUTO_INCREMENT,
  openid          VARCHAR(128)    NOT NULL DEFAULT '',
  nickname        VARCHAR(64)     NOT NULL DEFAULT '',
  avatar_url      VARCHAR(512)    NOT NULL DEFAULT '',
  win_count       INT             NOT NULL DEFAULT 0,
  total_games     INT             NOT NULL DEFAULT 0,
  created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_user_openid (openid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS match_players (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  match_id        BIGINT UNSIGNED NOT NULL,
  player_game_id  VARCHAR(64)     NOT NULL DEFAULT '',
  player_name     VARCHAR(64)     NOT NULL DEFAULT '',
  team_name       VARCHAR(128)    NOT NULL DEFAULT '',
  kills           INT             NOT NULL DEFAULT 0,
  deaths          INT             NOT NULL DEFAULT 0,
  assists         INT             NOT NULL DEFAULT 0,
  kd_diff         INT             NOT NULL DEFAULT 0,
  rating          DECIMAL(4,2)    NOT NULL DEFAULT 0.00,
  adr             DECIMAL(5,1)    NOT NULL DEFAULT 0.0,
  created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_match_player (match_id, player_name, team_name),
  KEY idx_mp_match (match_id),
  KEY idx_mp_player (player_game_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS guess_records (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id           VARCHAR(64)     NOT NULL DEFAULT '',
  won               TINYINT(1)      NOT NULL DEFAULT 0,
  attempts          INT             NOT NULL DEFAULT 0,
  difficulty        VARCHAR(32)     NOT NULL DEFAULT '',
  target_player_id  VARCHAR(64)     NOT NULL DEFAULT '',
  target_player_name VARCHAR(128)   NOT NULL DEFAULT '',
  played_at         DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_gr_user (user_id, played_at),
  KEY idx_gr_difficulty (difficulty)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
