-- ============================================================
-- 传奇选手机制：player 表新增 is_legendary 列（结构改动）
-- 2026-08-07
-- 说明：is_legendary=1 的选手无视难度过滤，强制出现在所有选手池
--       （代码侧 players.js / pk.js 池子 SQL 已加 OR p.is_legendary = 1）
--       具体选手数据（LJL/JBTV）不入库，手动 SQL 添加（见对话记录）
-- 用法：mysql -uroot -p<密码> cs_match_pro < migration_is_legendary.sql
-- ============================================================

ALTER TABLE player
  ADD COLUMN is_legendary TINYINT(1) NOT NULL DEFAULT 0
  COMMENT '传奇选手：无视难度过滤，强制出现在所有选手池'
  AFTER status;
