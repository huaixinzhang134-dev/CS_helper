-- 2026-07-13: 分离 PK/单人竞猜记录列
ALTER TABLE users
  ADD COLUMN pk_win_count    INT UNSIGNED NOT NULL DEFAULT 0 AFTER win_rate,
  ADD COLUMN pk_total_games  INT UNSIGNED NOT NULL DEFAULT 0 AFTER pk_win_count,
  ADD COLUMN pk_win_rate     DECIMAL(5,2) NOT NULL DEFAULT 0.00 AFTER pk_total_games,
  ADD COLUMN solo_win_count  INT UNSIGNED NOT NULL DEFAULT 0 AFTER pk_win_rate,
  ADD COLUMN solo_total_games INT UNSIGNED NOT NULL DEFAULT 0 AFTER solo_win_count,
  ADD COLUMN solo_win_rate   DECIMAL(5,2) NOT NULL DEFAULT 0.00 AFTER solo_total_games;
