-- ============================================================
-- schema_v2.sql
-- 在 schema.sql 基础上补：player.name / player.avatar / match_comments 表
-- 用法（MySQL 已建好 cs_match_pro 库）：
--   mysql -u root -p cs_match_pro < crawler/schema_v2.sql
-- ============================================================

USE cs_match_pro;

-- 1. player 表补 name（游戏昵称）/ avatar（图片 URL）
ALTER TABLE player
  ADD COLUMN name   VARCHAR(64)  NOT NULL DEFAULT '' AFTER game_id,
  ADD COLUMN avatar VARCHAR(512) NULL                AFTER position;

-- 2. match_comments 表（评论功能依赖）
CREATE TABLE IF NOT EXISTS match_comments (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  match_id    BIGINT UNSIGNED NOT NULL,
  player_id   VARCHAR(64)     NOT NULL,   -- = player.game_id
  content     VARCHAR(500)    NOT NULL,
  user_openid VARCHAR(64)     NOT NULL DEFAULT '',
  status      TINYINT         NOT NULL DEFAULT 1,  -- 1=正常 0=软删除
  created_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_mc_match_created (match_id, created_at),
  KEY idx_mc_player (player_id),
  KEY idx_mc_openid (user_openid, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='赛事评论区';