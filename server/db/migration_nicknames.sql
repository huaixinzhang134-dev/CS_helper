-- ============================================================
-- Migration: 添加别称/绰号支持
-- 1. team 表和 player 表增加 alias JSON 字段
-- 2. 创建 nickname_suggestions 表（用户提交绰号审核）
-- ============================================================

-- Step 1: 在 team 和 player 表添加 alias 字段
ALTER TABLE team
  ADD COLUMN alias JSON DEFAULT NULL COMMENT '战队别称列表';

ALTER TABLE player
  ADD COLUMN alias JSON DEFAULT NULL COMMENT '选手别称列表';

-- Step 2: 创建绰号建议表（用户提交 + 审核）
CREATE TABLE IF NOT EXISTS nickname_suggestions (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  target_type ENUM('player','team') NOT NULL COMMENT '目标类型',
  target_id   VARCHAR(64) NOT NULL COMMENT '目标ID（player._id 或 team.id）',
  alias       VARCHAR(100) NOT NULL COMMENT '建议的绰号',
  submitter_openid VARCHAR(64) NOT NULL COMMENT '提交用户openid',
  status      ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending' COMMENT '审核状态',
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_target (target_type, target_id),
  INDEX idx_status (status),
  INDEX idx_submitter (submitter_openid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='绰号建议审核表';
