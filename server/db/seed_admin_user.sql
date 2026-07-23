-- ============================================================
-- 将当前唯一用户设置为全功能开放
-- 在服务器执行：
--   mysql -u root -p cs_match_pro < server/db/seed_admin_user.sql
-- ============================================================

-- 给用户大量代币
UPDATE users SET coins = 99999, total_coins_earned = 99999 LIMIT 1;

-- 解锁所有难度（设置猜对次数 >= 10）
SET @openid = (SELECT openid FROM users LIMIT 1);
INSERT INTO difficulty_progress (user_openid, difficulty, correct_count, total_games) VALUES
  (@openid, 'trivial',    10, 10),
  (@openid, 'easy',      10, 10),
  (@openid, 'normal',    10, 10),
  (@openid, 'hard',      10, 10),
  (@openid, 'hell',      10, 10),
  (@openid, 'challenge', 10, 10)
ON DUPLICATE KEY UPDATE correct_count = 10, total_games = 10;

SELECT '✅ 已完成' AS status;
SELECT openid, nickname, coins FROM users LIMIT 1;
SELECT difficulty, correct_count FROM difficulty_progress WHERE user_openid = @openid ORDER BY FIELD(difficulty, 'trivial','easy','normal','hard','hell','challenge');
