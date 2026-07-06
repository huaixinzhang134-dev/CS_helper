/**
 * POST /api/matches/sync
 *
 * 爬虫推送接口：接收 5eplay 赛事数据，检测变化后更新 MySQL 并广播 WS。
 *
 * 爬虫发送格式：
 *   { matches: [{ date, time, matchType, team1, team2, team1Score, team2Score,
 *                 eventName, status, tab }] }
 *
 * 处理流程：
 *   1. team name → team ID（不存在则自动创建）
 *   2. 按 date + time + team IDs 查找已有比赛
 *   3. 检测 score / status 变化
 *   4. 有变化 → UPDATE + WS 广播
 */
const express = require('express');
const router = express.Router();

const { query } = require('../db/pool');
// WS 广播函数通过 app.set('broadcastMatchUpdate') 注入
// 见 server/index.js

// ======================== 工具函数 ========================

/**
 * 将队伍名解析为 team ID，不存在则自动创建
 * @param {string} teamName
 * @returns {Promise<number>}
 */
async function resolveTeamId(teamName) {
  if (!teamName || !teamName.trim()) return null;

  const name = teamName.trim();

  // 尝试查找
  const [rows] = await query('SELECT id FROM team WHERE name = ? LIMIT 1', [name]);
  if (rows.length > 0) return rows[0].id;

  // 不存在，自动创建（用 "Other" 赛区占位，后续可手动修正）
  const [result] = await query(
    'INSERT INTO team (name, region, member_count) VALUES (?, ?, 0)',
    [name, 'Other']
  );
  console.log(`[sync] 自动创建新战队: ${name} (id=${result.insertId})`);
  return result.insertId;
}

/**
 * 构建 Match DTO（与 matches.js 的 toMatchDTO 一致）
 */
function toMatchDTO(row) {
  return {
    _id: String(row.id),
    event: row.event_name || '',
    status: row.status || 'Upcoming',
    teamA: {
      name: row.teamA_name || row.team_a_name || '',
      logo: row.teamA_logo || '',
      score: row.team1_score || 0
    },
    teamB: {
      name: row.teamB_name || row.team_b_name || '',
      logo: row.teamB_logo || '',
      score: row.team2_score || 0
    },
    time: row.match_date && row.match_time
      ? `${String(row.match_date).slice(0, 10)}T${row.match_time}`
      : ''
  };
}

// ======================== 主路由 ========================

/**
 * POST /api/matches/sync
 * Auth: 简单的 Bearer token 验证，防止随意调用
 * Header: Authorization: Bearer <SYNC_TOKEN>
 */
router.post('/', async (req, res, next) => {
  try {
    // 简单鉴权
    const auth = req.headers.authorization;
    const expectedToken = process.env.SYNC_TOKEN || 'cs-match-sync-token';
    if (!auth || auth !== `Bearer ${expectedToken}`) {
      return res.status(401).json({ code: 401, message: 'unauthorized', data: null });
    }

    const { matches = [] } = req.body;
    if (!Array.isArray(matches) || matches.length === 0) {
      return res.json({ code: 0, message: 'no data', data: { checked: 0, updated: 0 } });
    }

    console.log(`[sync] 收到 ${matches.length} 场比赛数据`);

    const updatedMatches = []; // 发生变化的比赛 DTO

    for (const m of matches) {
      // ----- 1. 解析队伍 ID -----
      const team1Id = await resolveTeamId(m.team1);
      const team2Id = await resolveTeamId(m.team2);
      if (!team1Id || !team2Id) continue;

      // ----- 2. 查找已有比赛 -----
      const [rows] = await query(
        `SELECT m.*, ta.name AS teamA_name, tb.name AS teamB_name
         FROM matches m
         LEFT JOIN team ta ON ta.id = m.team1_id
         LEFT JOIN team tb ON tb.id = m.team2_id
         WHERE m.match_date = ?
           AND m.match_time = ?
           AND m.team1_id = ?
           AND m.team2_id = ?
         LIMIT 1`,
        [m.date, m.time, team1Id, team2Id]
      );

      const newScore1 = m.team1Score != null ? parseInt(m.team1Score, 10) : null;
      const newScore2 = m.team2Score != null ? parseInt(m.team2Score, 10) : null;
      const newStatus = mapStatus(m.status);

      if (rows.length === 0) {
        // ----- 3a. 新比赛，INSERT -----
        const [insertResult] = await query(
          `INSERT INTO matches
           (match_date, match_time, match_type, team1_id, team2_id,
            team1_score, team2_score, event_name, status, tab)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            m.date,
            m.time,
            m.matchType || 'BO1',
            team1Id,
            team2Id,
            newScore1 ?? 0,
            newScore2 ?? 0,
            m.eventName || '',
            newStatus,
            m.tab || 'schedule'
          ]
        );
        console.log(`[sync] 新增比赛 #${insertResult.insertId}: ${m.team1} vs ${m.team2}`);

        // 回查拿到完整数据
        const [newRows] = await query(
          `SELECT m.*, ta.name AS teamA_name, tb.name AS teamB_name
           FROM matches m
           LEFT JOIN team ta ON ta.id = m.team1_id
           LEFT JOIN team tb ON tb.id = m.team2_id
           WHERE m.id = ?`,
          [insertResult.insertId]
        );
        if (newRows.length > 0) {
          updatedMatches.push(toMatchDTO(newRows[0]));
        }
      } else {
        // ----- 3b. 已有比赛，检测变化 -----
        const row = rows[0];
        const oldScore1 = row.team1_score;
        const oldScore2 = row.team2_score;
        const oldStatus = row.status;

        const scoreChanged =
          (newScore1 !== null && newScore1 !== oldScore1) ||
          (newScore2 !== null && newScore2 !== oldScore2);
        const statusChanged = newStatus !== oldStatus;

        if (scoreChanged || statusChanged) {
          // ----- 4. UPDATE -----
          const updateFields = [];
          const updateValues = [];

          if (newScore1 !== null) {
            updateFields.push('team1_score = ?');
            updateValues.push(newScore1);
          }
          if (newScore2 !== null) {
            updateFields.push('team2_score = ?');
            updateValues.push(newScore2);
          }
          if (statusChanged) {
            updateFields.push('status = ?');
            updateValues.push(newStatus);
          }

          if (updateFields.length > 0) {
            updateValues.push(row.id);
            await query(
              `UPDATE matches SET ${updateFields.join(', ')} WHERE id = ?`,
              updateValues
            );

            // 回查拿到完整数据（含联表 name/logo）
            const [updatedRows] = await query(
              `SELECT m.*, ta.name AS teamA_name, tb.name AS teamB_name,
                      ta.logo_url AS teamA_logo, tb.logo_url AS teamB_logo
               FROM matches m
               LEFT JOIN team ta ON ta.id = m.team1_id
               LEFT JOIN team tb ON tb.id = m.team2_id
               WHERE m.id = ?`,
              [row.id]
            );

            if (updatedRows.length > 0) {
              const dto = toMatchDTO(updatedRows[0]);
              updatedMatches.push(dto);

              console.log(
                `[sync] 更新比赛 #${row.id}: ${m.team1} ${oldScore1}→${newScore1} : ${oldScore2}→${newScore2} [${oldStatus}→${newStatus}]`
              );
            }
          }
        }
      }
    }

    // ----- 5. WS 广播 -----
    const broadcastMatchUpdate = req.app.get('broadcastMatchUpdate');
    const broadcastGlobal = req.app.get('broadcastGlobal');

    if (updatedMatches.length > 0) {
      // 单场广播
      for (const dto of updatedMatches) {
        if (broadcastMatchUpdate) {
          broadcastMatchUpdate(dto._id, dto);
        }
      }

      // 全量列表广播（爬虫拉取完整列表后，重新推给所有 subscribe_all 客户端）
      // 仅在手动触发时才获取全量，避免每次 sync 都查全表
      try {
        const [allRows] = await query(
          `SELECT m.*, ta.name AS teamA_name, tb.name AS teamB_name,
                  ta.logo_url AS teamA_logo, tb.logo_url AS teamB_logo
           FROM matches m
           LEFT JOIN team ta ON ta.id = m.team1_id
           LEFT JOIN team tb ON tb.id = m.team2_id
           ORDER BY m.match_date ASC, m.match_time ASC`
        );
        const statusOrder = { Live: 0, Upcoming: 1, Finished: 2 };
        allRows.sort((a, b) => {
          const sa = statusOrder[a.status] ?? 9;
          const sb = statusOrder[b.status] ?? 9;
          return sa - sb;
        });
        if (broadcastGlobal) {
          broadcastGlobal(allRows.map(toMatchDTO));
        }
      } catch (err) {
        console.error('[sync] 全量广播失败:', err.message);
      }
    }

    res.json({
      code: 0,
      message: 'sync ok',
      data: {
        checked: matches.length,
        updated: updatedMatches.length
      }
    });
  } catch (err) {
    next(err);
  }
});

/**
 * 将爬虫的状态字段映射到 DB 格式
 */
function mapStatus(status) {
  if (!status) return 'Upcoming';
  const s = status.toLowerCase();
  if (s === 'live' || s === 'playing' || s === 'ongoing') return 'Live';
  if (s === 'finished' || s === 'completed' || s === 'ended' || s === 'results') return 'Finished';
  if (s === 'upcoming' || s === 'scheduled') return 'Upcoming';
  // 如果有分数但状态不对，自动推断
  return 'Upcoming';
}

module.exports = router;
