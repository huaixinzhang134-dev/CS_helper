#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
填充 team_member 表 + 修复队伍赛区。

从 player 表读取 current_team / former_teams（JSON 字段），
自动映射 team 表队名和 player 数据队名的不一致，
创建 team_member 关联记录，并推断队伍赛区。

运行：
  DB_PASS=你的密码 python scripts/sync_team_member.py
"""

import json
import os
import re
import sys
from collections import Counter, defaultdict

import pymysql

DB_CONFIG = {
    "host": os.environ.get("DB_HOST", "127.0.0.1"),
    "port": int(os.environ.get("DB_PORT", "3306")),
    "user": os.environ.get("DB_USER", "root"),
    "password": os.environ.get("DB_PASS", "201005"),
    "database": os.environ.get("DB_NAME", "cs_match_pro"),
    "charset": "utf8mb4",
    "autocommit": False,
}


def build_name_mapping(team_names, player_teams):
    """
    自动匹配 team 表队名 ↔ player 数据队名。
    策略：全名匹配 > 包含匹配 > 首字母缩写匹配
    """
    mapping = {}
    unmatched = []

    for tn in team_names:
        # 1. 完全匹配
        if tn in player_teams:
            mapping[tn] = tn
            continue

        # 2. player 队名包含 team 表队名（如 "NIP" in "Ninjas in Pyjamas"）
        found = False
        for pt in player_teams:
            if tn.upper() in pt.upper() or pt.upper() in tn.upper():
                mapping[tn] = pt
                found = True
                break
        if found:
            continue

        # 3. 首字母缩写匹配（如 "LVG" ← "Lynn Vision Gaming"）
        # 也匹配 "NIP" ← "Ninjas in Pyjamas", "EYE" ← "EYEBALLERS"
        tn_upper = tn.upper()
        for pt in player_teams:
            # 取选手数据的首字母缩写
            initials = "".join(w[0] for w in pt.split() if w[0].isupper())
            if initials and tn_upper == initials:
                mapping[tn] = pt
                found = True
                break
        if found:
            continue

        # 4. 去掉空格/特殊字符后比较
        tn_clean = re.sub(r'[^a-zA-Z0-9]', '', tn).lower()
        for pt in player_teams:
            pt_clean = re.sub(r'[^a-zA-Z0-9]', '', pt).lower()
            if tn_clean == pt_clean:
                mapping[tn] = pt
                found = True
                break
        if found:
            continue

        unmatched.append(tn)

    return mapping, unmatched


def main():
    conn = pymysql.connect(**DB_CONFIG)
    try:
        with conn.cursor() as cur:
            # ========== 1. 读取数据 ==========
            cur.execute("SELECT id, game_id, name, current_team, former_teams, region FROM player")
            players = cur.fetchall()
            print(f"选手: {len(players)} 条")

            cur.execute("SELECT id, name FROM team")
            team_rows = cur.fetchall()
            team_db = {name: tid for tid, name in team_rows}  # 数据库队名 → id
            team_by_id = {tid: name for tid, name in team_rows}
            print(f"队伍 (team 表): {len(team_rows)} 个")

            # ========== 2. 构建队伍名映射 ==========
            # player 数据中用的队名集合
            player_teams = set()
            for pid, gid, pname, team, former_json, region, *_ in players:
                if team:
                    player_teams.add(team)
                if former_json:
                    try:
                        for ft in (json.loads(former_json) if isinstance(former_json, str) else (former_json or [])):
                            if ft:
                                player_teams.add(ft)
                    except (json.JSONDecodeError, TypeError):
                        pass

            mapping, unmatched = build_name_mapping(list(team_db.keys()), player_teams)
            print(f"队名匹配: {len(mapping)}/{len(team_db)} 个")

            if unmatched:
                print(f"\n未匹配的队名 ({len(unmatched)} 个):")
                for name in unmatched:
                    print(f"  {name}")

            # ========== 3. 清空并填充 team_member ==========
            cur.execute("TRUNCATE TABLE team_member")

            sql = """INSERT IGNORE INTO team_member (team_id, team_name, player_id, player_name, is_current)
                     VALUES (%s, %s, %s, %s, %s)"""
            rows = []
            for pid, gid, pname, team, former_json, region, *_ in players:
                # 当前战队
                if team and team in mapping:
                    mapped = mapping[team]
                    tid = team_db.get(mapped)
                    if tid is None:
                        # 映射后的名字可能直接在 team 表里
                        tid = team_db.get(team)
                    if tid is not None:
                        rows.append((tid, team, pid, pname, 1))

                # 历史战队
                if former_json:
                    try:
                        former_teams = json.loads(former_json) if isinstance(former_json, str) else (former_json or [])
                        for ft in former_teams:
                            if ft and ft in mapping:
                                mapped = mapping[ft]
                                tid = team_db.get(mapped) or team_db.get(ft)
                                if tid is not None:
                                    rows.append((tid, ft, pid, pname, 0))
                    except (json.JSONDecodeError, TypeError):
                        pass

            if rows:
                # 去重保留 is_current=1
                seen = {}
                for tid, tname, pid, pname, is_current in rows:
                    key = (tid, pid)
                    if key not in seen or is_current == 1:
                        seen[key] = (tname, pname, is_current)
                final = [(k[0], v[0], k[1], v[1], v[2]) for k, v in seen.items()]
                cur.executemany(sql, final)
                print(f"写入 team_member: {len(final)} 条")
            else:
                print("team_member: 无数据写入")

            # ========== 4. 修复队伍赛区 ==========
            cur.execute("""
                SELECT tm.team_id, p.region, COUNT(*) AS cnt
                FROM team_member tm
                JOIN player p ON p.id = tm.player_id
                WHERE tm.is_current = 1
                GROUP BY tm.team_id, p.region
            """)
            team_regions = defaultdict(Counter)
            for tid, region, cnt in cur.fetchall():
                team_regions[tid][region] += cnt

            updated = 0
            for tid, counter in team_regions.items():
                final_region = "Europe"
                for r, c in counter.most_common():
                    if c >= 3:
                        final_region = r
                        break
                cur.execute("UPDATE team SET region = %s WHERE id = %s AND region != %s",
                           (final_region, tid, final_region))
                if cur.rowcount > 0:
                    updated += 1
                    team_name = team_by_id.get(tid, f"ID={tid}")
                    print(f"  {team_name:30s} → {final_region}")

            conn.commit()
            print(f"\n队伍赛区更新: {updated} 个")

            # ========== 5. 检查剩余 Other ==========
            cur.execute("SELECT name, region FROM team WHERE region = 'Other' ORDER BY name")
            others = cur.fetchall()
            if others:
                print(f"\n仍为 Other 的队伍 ({len(others)} 个):")
                for name, reg in others:
                    print(f"  {name}")

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
        sys.exit(1)
