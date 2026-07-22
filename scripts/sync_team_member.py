#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
只填充 team_member 表 + 修复队伍赛区。

从 player 表中读取 current_team / formerTeams（JSON 字段），
创建 team_member 关联记录，并推断队伍赛区。

运行：
  DB_PASS=你的密码 python scripts/sync_team_member.py
"""

import json
import os
import sys
from collections import Counter

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

# HLTV 全名 → team 表短名 映射
NAME_MAP = {
    "Lynn Vision": "LVG",
    "Ninjas in Pyjamas": "NIP",
    "EYEBALLERS": "EYE",
    "B8": "BB",
}


def main():
    conn = pymysql.connect(**DB_CONFIG)
    try:
        with conn.cursor() as cur:
            # 1. 读取所有选手
            cur.execute("SELECT id, game_id, name, current_team, former_teams, region FROM player")
            players = cur.fetchall()
            print(f"选手: {len(players)} 条")

            # 2. 读取 team 表：名字 → id
            cur.execute("SELECT id, name FROM team")
            team_rows = cur.fetchall()
            team_by_name = {name: tid for tid, name in team_rows}
            team_by_id = {tid: name for tid, name in team_rows}
            print(f"队伍: {len(team_rows)} 个")

            # 检查需要映射的队伍
            for full_name, short_name in NAME_MAP.items():
                if full_name not in team_by_name and short_name in team_by_name:
                    team_by_name[full_name] = team_by_name[short_name]
                    print(f"  映射: {full_name} → {short_name}")

            # 3. 清空 team_member
            cur.execute("TRUNCATE TABLE team_member")
            print("已清空 team_member")

            # 4. 写入 team_member
            sql = """INSERT IGNORE INTO team_member (team_id, team_name, player_id, player_name, is_current)
                     VALUES (%s, %s, %s, %s, %s)"""
            rows = []
            for pid, gid, pname, team, former_json, region, *_ in players:
                # 当前战队
                if team:
                    tid = team_by_name.get(team)
                    if tid is not None:
                        rows.append((tid, team, pid, pname, 1))

                # 历史战队
                if former_json:
                    try:
                        former_teams = json.loads(former_json) if isinstance(former_json, str) else former_json
                        for ft in (former_teams or []):
                            tid = team_by_name.get(ft)
                            if tid is not None:
                                rows.append((tid, ft, pid, pname, 0))
                    except (json.JSONDecodeError, TypeError):
                        pass

            if rows:
                cur.executemany(sql, rows)
            print(f"写入 team_member: {len(rows)} 条")

            # 5. 修复队伍赛区（从选手赛区推断）
            cur.execute("""
                SELECT tm.team_id, p.region, COUNT(*) AS cnt
                FROM team_member tm
                JOIN player p ON p.id = tm.player_id
                WHERE tm.is_current = 1
                GROUP BY tm.team_id, p.region
            """)
            team_regions = {}
            for tid, region, cnt in cur.fetchall():
                if tid not in team_regions:
                    team_regions[tid] = Counter()
                team_regions[tid][region] += cnt

            updated = 0
            for tid, counter in team_regions.items():
                # V社规则：>=3 人同赛区取该赛区，否则 Europe
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

            # 6. 检查还有哪些队伍的赛区是 Other
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
