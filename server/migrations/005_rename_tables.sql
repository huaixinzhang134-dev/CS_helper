-- ============================================================
-- Migration 005: 重命名猜测相关表（旧名→新名）
-- ============================================================

RENAME TABLE player_vote_slots TO user_picks;
RENAME TABLE vote_slot_config   TO pick_config;
RENAME TABLE vote_winners       TO official_top30;
RENAME TABLE vote_awards        TO top30_awards;
