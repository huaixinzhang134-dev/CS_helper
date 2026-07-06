-- ============================================================
-- schema_ranking.sql
-- Valve 官方世界排名存储表
--
-- 数据来源：HLTV Valve 世界排名爬虫（crawl_ranking.js）
-- 爬虫输出：valve_ranking.json（JSON Lines 格式）
--
-- 使用：
--   mysql -u root -p cs_match_pro < crawler/schema_ranking.sql
--
-- 关联说明：
--   - team_id 引用 team 表的 id（已存在的队伍记录）
--   - 若 crawler_import 中找不到对应 team 记录，team_id 可为 NULL
-- ============================================================

USE cs_match_pro;

DROP TABLE IF EXISTS team_ranking;

CREATE TABLE team_ranking (
  id              INT UNSIGNED    NOT NULL AUTO_INCREMENT,
  -- 排名（1 = 世界第一）
  `rank`          INT UNSIGNED    NOT NULL,
  -- 队伍名称（冗余存储，便于直接查询）
  team_name       VARCHAR(128)    NOT NULL DEFAULT '',
  -- 队伍 ID（关联 team 表，可为 NULL 表示尚未收录到 team 表）
  team_id         INT UNSIGNED    NULL,
  -- HLTV 队伍数字 ID（从链接中提取，如 /team/12237/vitality → 12237）
  hltv_team_id    VARCHAR(32)     NOT NULL DEFAULT '',
  -- 排名积分（Valve 官方积分）
  points          VARCHAR(32)     NOT NULL DEFAULT '',
  -- 队伍队标 URL
  logo_url        VARCHAR(512)    NOT NULL DEFAULT '',
  -- 数据抓取时间
  fetched_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- 记录更新时间（重爬后更新）
  updated_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP
                                    ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ranking_rank (`rank`),
  KEY idx_ranking_team_name (team_name),
  KEY idx_ranking_team_id (team_id),
  KEY idx_ranking_hltv_id (hltv_team_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Valve 官方世界排名（爬取自 HLTV）';
