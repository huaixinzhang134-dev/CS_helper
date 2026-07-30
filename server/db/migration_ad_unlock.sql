-- ============================================================
-- Migration: 广告解锁 + 代币支付功能
-- 1. difficulty_extra_unlocks 表（广告/管理员额外解锁）
-- ============================================================

CREATE TABLE IF NOT EXISTS difficulty_extra_unlocks (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_openid VARCHAR(64) NOT NULL,
  difficulty  VARCHAR(32) NOT NULL COMMENT 'trivial/easy/normal/hard/hell/challenge',
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_ud (user_openid, difficulty),
  KEY idx_deu_user (user_openid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='广告/管理员额外解锁记录（跳过前一个难度10次限制）';

-- 执行后查看：
--   SELECT '✅ migration_ad_unlock 完成' AS status;
