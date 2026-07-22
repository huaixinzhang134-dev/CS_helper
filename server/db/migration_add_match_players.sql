-- ============================================================
-- 迁移脚本：新建 match_players 表，存储每场比赛选手个人数据
-- 在 MySQL 中手动执行
-- ============================================================

CREATE TABLE IF NOT EXISTS match_players (
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
