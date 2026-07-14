-- ============================================================
-- Migration 004: 代币系统 + 选手投票（问卷形式）
-- ============================================================

-- 1. users 表添加代币列
ALTER TABLE users
  ADD COLUMN coins              INT UNSIGNED NOT NULL DEFAULT 0 AFTER solo_win_rate,
  ADD COLUMN total_coins_earned INT UNSIGNED NOT NULL DEFAULT 0 AFTER coins;

-- 2. 代币交易记录表
DROP TABLE IF EXISTS coin_transactions;
CREATE TABLE coin_transactions (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_openid     VARCHAR(64)     NOT NULL,
  amount          INT             NOT NULL COMMENT '正数收入/负数支出',
  balance_after   INT UNSIGNED    NOT NULL COMMENT '交易后余额',
  type            VARCHAR(32)     NOT NULL COMMENT 'recharge/spend/activity/reward/admin',
  description     VARCHAR(255)    NOT NULL DEFAULT '',
  created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ct_user (user_openid),
  KEY idx_ct_type (type),
  KEY idx_ct_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='代币交易记录';

-- 3. 评论审核列
ALTER TABLE player_comments
  ADD COLUMN status   ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending' AFTER content,
  ADD COLUMN reviewed_by VARCHAR(64) NULL AFTER status;

-- 4. 道具表
DROP TABLE IF EXISTS shop_items;
CREATE TABLE shop_items (
  id              INT UNSIGNED    NOT NULL AUTO_INCREMENT,
  name            VARCHAR(64)     NOT NULL,
  description     VARCHAR(255)    NOT NULL DEFAULT '',
  price           INT UNSIGNED    NOT NULL COMMENT '代币价格',
  icon            VARCHAR(128)    NOT NULL DEFAULT '',
  item_type       VARCHAR(32)     NOT NULL COMMENT 'hint_ticket/extra_attempt/...',
  max_per_user    INT UNSIGNED    NOT NULL DEFAULT 0 COMMENT '0=不限',
  enabled         TINYINT(1)      NOT NULL DEFAULT 1,
  created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_shop_enabled (enabled)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='商城道具';

-- 5. 用户道具库存
DROP TABLE IF EXISTS user_items;
CREATE TABLE user_items (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_openid     VARCHAR(64)     NOT NULL,
  item_type       VARCHAR(32)     NOT NULL,
  quantity        INT UNSIGNED    NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uk_user_item (user_openid, item_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='用户道具库存';

-- 6. 选手投票（问卷形式：每人3次覆盖提交，每次选top1~top30）
DROP TABLE IF EXISTS player_vote_records;
CREATE TABLE player_vote_records (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_openid     VARCHAR(64)     NOT NULL,
  year            YEAR            NOT NULL COMMENT '投票年份（如2026）',
  submission_no   TINYINT UNSIGNED NOT NULL COMMENT '第几次提交(1-3)',
  created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_pvr_user_year (user_openid, year)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='选手投票提交记录';

DROP TABLE IF EXISTS player_vote_items;
CREATE TABLE player_vote_items (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  record_id       BIGINT UNSIGNED NOT NULL COMMENT '关联vote_records.id',
  slot            TINYINT UNSIGNED NOT NULL COMMENT 'top1~30 序号(1-30)',
  player_game_id  VARCHAR(64)     NOT NULL DEFAULT '',
  player_name     VARCHAR(64)     NOT NULL DEFAULT '',
  PRIMARY KEY (id),
  KEY idx_pvi_record (record_id),
  KEY idx_pvi_player (player_game_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='选手投票具体选项';

-- 7. 管理员设定的年度官方Top30（用于核对发奖）
DROP TABLE IF EXISTS vote_winners;
CREATE TABLE vote_winners (
  id              INT UNSIGNED    NOT NULL AUTO_INCREMENT,
  year            YEAR            NOT NULL,
  `rank`          TINYINT UNSIGNED NOT NULL COMMENT '排名 1-30',
  player_game_id  VARCHAR(64)     NOT NULL DEFAULT '',
  player_name     VARCHAR(64)     NOT NULL DEFAULT '',
  set_by          VARCHAR(64)     NULL COMMENT '管理员openid',
  created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_vw_year_rank (year, rank)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='年度官方Top30（管理员设定）';

-- 8. 发奖记录
DROP TABLE IF EXISTS vote_awards;
CREATE TABLE vote_awards (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  year            YEAR            NOT NULL,
  user_openid     VARCHAR(64)     NOT NULL,
  match_count     INT UNSIGNED    NOT NULL DEFAULT 0 COMMENT '猜对人数',
  reward_coins    INT UNSIGNED    NOT NULL DEFAULT 0 COMMENT '奖励代币',
  awarded_by      VARCHAR(64)     NULL COMMENT '管理员openid',
  created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_va_year_user (year, user_openid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='投票发奖记录';

-- 插入默认道具
INSERT INTO shop_items (name, description, price, icon, item_type, max_per_user) VALUES
('提示券', '额外提示一次，提示一个你尚未猜对的数据项；若所有数据均已猜对则无法使用', 40, '/assets/icons/hint.png', 'hint_ticket', 0),
('额外机会', '好友PK模式中增加3次猜测机会（一局有效）', 90, '/assets/icons/extra.png', 'extra_attempt', 0);
