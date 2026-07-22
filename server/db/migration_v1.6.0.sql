-- ============================================================
-- v1.6.0 难度改版：6档难度 + 解锁机制
-- ============================================================

-- 1. 难度解锁进度表
DROP TABLE IF EXISTS difficulty_progress;
CREATE TABLE difficulty_progress (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_openid     VARCHAR(64)     NOT NULL,
  difficulty      VARCHAR(16)     NOT NULL COMMENT 'trivial/easy/normal/hard/hell/challenge',
  correct_count   INT UNSIGNED    NOT NULL DEFAULT 0 COMMENT '该难度猜对次数',
  total_games     INT UNSIGNED    NOT NULL DEFAULT 0 COMMENT '该难度总游戏数',
  updated_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP
                                    ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_ud_user_diff (user_openid, difficulty),
  KEY idx_dp_user (user_openid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='各难度猜对次数统计（用于解锁判断）';

-- ============================================================
-- 执行后查看：
--   SELECT '✅ v1.6.0 迁移完成' AS status;
-- ============================================================
