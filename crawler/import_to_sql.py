#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
将 playerbase_clean.json + matchbase.json 导入到 schema.sql 定义的 MySQL 表中。

依赖：
    pip install pymysql

使用：
    python import_to_sql.py
    # 或自定义：
    DB_HOST=127.0.0.1 DB_USER=root DB_PASS=xxx DB_NAME=cs_match_pro python import_to_sql.py
"""

import json
import os
import sys
from collections import Counter, defaultdict

import pymysql

# -------- 数据库连接配置（可通过环境变量覆盖） --------
DB_CONFIG = {
    "host": os.environ.get("DB_HOST", "127.0.0.1"),
    "port": int(os.environ.get("DB_PORT", "3306")),
    "user": os.environ.get("DB_USER", "root"),
    "password": os.environ.get("DB_PASS", "201005"),
    "database": os.environ.get("DB_NAME", "cs_match_pro"),
    "charset": "utf8mb4",
    "autocommit": False,
}

PLAYER_PATH = os.path.join(os.path.dirname(__file__), "playerbase_clean.json")
MATCH_PATH = os.path.join(os.path.dirname(__file__), "matchbase.json")

# 业务层常量
REGION_THRESHOLD = 3  # V 社规则：当前 5 人中 >=3 名选手同赛区即认定战队属于该赛区
DEFAULT_REGION = "Europe"  # 不满足阈值时按用户要求统一归类为 Europe


def load_jsonl(path: str):
    """加载每行一个 JSON 的文件"""
    items = []
    with open(path, "r", encoding="utf-8") as f:
        for lineno, raw in enumerate(f, 1):
            raw = raw.strip()
            if not raw:
                continue
            try:
                items.append(json.loads(raw))
            except json.JSONDecodeError as e:
                print(f"[WARN] {path}:{lineno} JSON 解析失败: {e}")
    return items


def load_match(path: str):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def safe_int(val, default=0) -> int:
    """将值转为 int，遇到 'unknown' / None / 非数字时返回 default。"""
    try:
        return int(val)
    except (ValueError, TypeError):
        return default


def safe_float(val, default=0.0) -> float:
    """将值转为 float，遇到 'unknown' / None / 非数字时返回 default。"""
    try:
        return float(val)
    except (ValueError, TypeError):
        return default


# ============================================================
# 1. 写入选手
# ============================================================
def insert_players(cur, players: list):
    sql = """
        INSERT INTO player
          (game_id, name, real_name, age, country, country_code,
           current_team, former_teams, region,
           major_appearances, position, rating, sniping, avatar)
        VALUES
          (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON DUPLICATE KEY UPDATE
          name=VALUES(name),
          real_name=VALUES(real_name),
          age=VALUES(age),
          country=VALUES(country),
          country_code=VALUES(country_code),
          current_team=VALUES(current_team),
          former_teams=VALUES(former_teams),
          region=VALUES(region),
          major_appearances=VALUES(major_appearances),
          position=VALUES(position),
          rating=VALUES(rating),
          sniping=VALUES(sniping),
          avatar=VALUES(avatar)
    """
    rows = []
    for p in players:
        rows.append((
            p.get("name", ""),                                   # game_id
            p.get("name", ""),                                   # name（游戏昵称）
            p.get("realName", ""),
            safe_int(p.get("age")),
            p.get("country", ""),
            p.get("countryCode", ""),
            p.get("team", "") or "",
            json.dumps(p.get("formerTeams") or [], ensure_ascii=False),
            p.get("region", "Other"),
            safe_int(p.get("majorAppearances")),
            p.get("position", ""),
            safe_float(p.get("rating")),
            safe_float(p.get("sniping")),
            p.get("avatar", "") or "",
        ))
    cur.executemany(sql, rows)
    return len(rows)


# ============================================================
# 2. 写入战队 + 战队-选手关联（含赛区推断）
# ============================================================
def determine_team_region(region_counter: Counter) -> tuple:
    """
    V 社战队赛区规则（修正版）：

        战队当前 5 名选手中，若有 3 人及以上属于同一赛区，
        即认定该战队属于这 3 人（及以上）的赛区；
        若此条件无法达成，则归类为 Europe。

    推断要点：
        - 统计范围 = 战队的"当前 5 名选手"（以 player.current_team 聚合）
        - 统计不含 formerTeams 的历史成员
        - 当存在 region 选手数 >= 3 时取该 region（若多 region 同时达标取最多）
        - 当所有 region 选手数均 < 3 时 -> Europe
        - 战队为空（无当前选手）-> Europe
    """
    if not region_counter:
        return (DEFAULT_REGION, 0)

    qualified = [(r, c) for r, c in region_counter.items() if c >= REGION_THRESHOLD]
    if qualified:
        qualified.sort(key=lambda x: x[1], reverse=True)
        return (qualified[0][0], qualified[0][1])

    # 不满足阈值时，按用户要求统一归类为 Europe
    return (DEFAULT_REGION, max(region_counter.values()))


def build_team_data(players: list):
    """
    收集战队与赛区分布。
    仅以"当前 5 人"为准：每个 player 只贡献到其 current_team，
    formerTeams 不计入 team_region 推断（仅在 team_member 表中作历史记录）。
    """
    # team_name -> Counter(region)
    team_regions: dict = defaultdict(Counter)
    # team_name -> set(player_game_id)
    team_players: dict = defaultdict(set)

    for p in players:
        game_id = p.get("name", "")
        region = p.get("region", "Other")
        # 仅取当前战队
        if p.get("team"):
            team_regions[p["team"]][region] += 1
            team_players[p["team"]].add(game_id)

    return team_regions, team_players


def insert_teams(cur, players: list):
    team_regions, team_players = build_team_data(players)

    # 计算每个战队的最终 region（按 V 社规则）
    team_info = {}
    for name, counter in team_regions.items():
        region, count = determine_team_region(counter)
        team_info[name] = {
            "region": region,
            "region_player_count": count,
            "member_count": len(team_players[name]),
        }

    sql = """
        INSERT INTO team (name, region, region_player_count, member_count)
        VALUES (%s, %s, %s, %s)
        ON DUPLICATE KEY UPDATE
          region=VALUES(region),
          region_player_count=VALUES(region_player_count),
          member_count=VALUES(member_count)
    """
    rows = [(name, info["region"], info["region_player_count"], info["member_count"])
            for name, info in team_info.items()]
    cur.executemany(sql, rows)
    return len(rows), team_info


def insert_team_members(cur, players: list, team_info: dict):
    """
    写入 team_member：
      - 选手的 current_team：is_current=1
      - 选手的 formerTeams 中的每个战队：is_current=0
      - 同时写入 team_name / player_name 冗余字段
    """
    # 先取回所有 player.id 和 team.id 的映射
    cur.execute("SELECT id, game_id FROM player")
    pid_map = {gid: pid for pid, gid in cur.fetchall()}

    cur.execute("SELECT id, name FROM team")
    tid_map = {name: tid for tid, name in cur.fetchall()}

    sql = """
        INSERT INTO team_member (team_id, team_name, player_id, player_name, is_current)
        VALUES (%s, %s, %s, %s, %s)
        ON DUPLICATE KEY UPDATE
          team_name=VALUES(team_name),
          player_name=VALUES(player_name),
          is_current=VALUES(is_current)
    """
    rows = []
    for p in players:
        player_name = p.get("name", "")
        pid = pid_map.get(player_name)
        if pid is None:
            continue
        # 当前战队
        if p.get("team"):
            tid = tid_map.get(p["team"])
            if tid is not None:
                rows.append((tid, p["team"], pid, player_name, 1))
        # 历史战队
        for ft in p.get("formerTeams") or []:
            tid = tid_map.get(ft)
            if tid is None:
                continue
            rows.append((tid, ft, pid, player_name, 0))

    # 去重：同一 (team_id, player_id) 保留 is_current=1 优先
    seen = {}
    for tid, tname, pid, pname, is_current in rows:
        key = (tid, pid)
        if key not in seen or is_current == 1:
            seen[key] = (tname, pname, is_current)
    final_rows = [(k[0], v[0], k[1], v[1], v[2]) for k, v in seen.items()]

    cur.executemany(sql, final_rows)
    return len(final_rows)


# ============================================================
# 3. 写入比赛
# ============================================================
def insert_matches(cur, matches: list):
    cur.execute("SELECT id, name FROM team")
    tid_map = {name: tid for tid, name in cur.fetchall()}

    sql = """
        INSERT INTO matches
          (match_date, match_time, match_type,
           team1_id, team2_id, team1_score, team2_score,
           round_scores, event_name, status, tab)
        VALUES
          (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
    """
    rows = []
    for m in matches:
        rows.append((
            m.get("date") or None,
            m.get("time") or None,
            m.get("matchType", ""),
            tid_map.get(m.get("team1", "")),
            tid_map.get(m.get("team2", "")),
            m.get("team1Score"),
            m.get("team2Score"),
            json.dumps(m.get("roundScores") or [], ensure_ascii=False),
            m.get("eventName", ""),
            m.get("status", "upcoming"),
            m.get("tab", ""),
        ))
    cur.executemany(sql, rows)
    return len(rows)


# ============================================================
# 主流程
# ============================================================
def main():
    print("==> 加载数据源 ...")
    players = load_jsonl(PLAYER_PATH)
    matches = load_match(MATCH_PATH)
    print(f"    player: {len(players)} 条, match: {len(matches)} 条")

    print("==> 连接数据库 ...")
    conn = pymysql.connect(**DB_CONFIG)
    try:
        with conn.cursor() as cur:
            # 清空旧数据（注意 FK 顺序）
            cur.execute("SET FOREIGN_KEY_CHECKS=0")
            for tbl in ("team_member", "matches", "team", "player"):
                cur.execute(f"TRUNCATE TABLE {tbl}")
            cur.execute("SET FOREIGN_KEY_CHECKS=1")

            print("==> 写入 player ...")
            n = insert_players(cur, players)
            print(f"    {n} 条 player")

            print("==> 写入 team + 推断 region ...")
            n_team, team_info = insert_teams(cur, players)
            print(f"    {n_team} 个 team")

            print("==> 写入 team_member ...")
            n_tm = insert_team_members(cur, players, team_info)
            print(f"    {n_tm} 条 team_member")

            print("==> 写入 match ...")
            n_match = insert_matches(cur, matches)
            print(f"    {n_match} 条 match")

        conn.commit()
        print("==> 全部提交完成")
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    try:
        main()
    except pymysql.err.OperationalError as e:
        print(f"\n[ERROR] 数据库连接失败: {e}", file=sys.stderr)
        print("提示：请先执行 schema.sql 创建数据库，并设置 DB_HOST/DB_USER/DB_PASS/DB_NAME 环境变量。",
              file=sys.stderr)
        sys.exit(1)