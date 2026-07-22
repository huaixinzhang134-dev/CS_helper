#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
从 playerbase_clean.json 读取正确的 status 数据并更新 MySQL。
因为 import_to_sql.py 的 INSERT 语句漏掉了 status 字段。

运行：
  DB_PASS=你的密码 python scripts/fix_player_status.py
"""

import json
import os
import sys
import pymysql

DB_CONFIG = {
    "host": os.environ.get("DB_HOST", "127.0.0.1"),
    "port": int(os.environ.get("DB_PORT", "3306")),
    "user": os.environ.get("DB_USER", "root"),
    "password": os.environ.get("DB_PASS", "201005"),
    "database": os.environ.get("DB_NAME", "cs_match_pro"),
    "charset": "utf8mb4",
}

JSON_PATH = os.path.join(os.path.dirname(__file__), "..", "crawler", "playerbase_clean.json")


def main():
    # 读取 JSON 中的 status
    status_map = {}  # game_id -> status
    with open(JSON_PATH, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            p = json.loads(line)
            pid = p.get("name", "")  # HLTV nickname = game_id
            s = p.get("status", "")
            if pid and s:
                status_map[pid] = s

    print(f"JSON 中 {len(status_map)} 条 status 数据")

    # 连接数据库
    conn = pymysql.connect(**DB_CONFIG)
    try:
        with conn.cursor() as cur:
            # 按 game_id 逐条更新
            updated = 0
            errors = 0
            for pid, status in status_map.items():
                try:
                    cur.execute(
                        "UPDATE player SET status = %s WHERE game_id = %s AND status != %s",
                        (status, pid, status),
                    )
                    if cur.rowcount > 0:
                        updated += 1
                except Exception as e:
                    errors += 1

            conn.commit()
            print(f"更新: {updated} 条, 错误: {errors}")

            # 验证
            cur.execute("SELECT status, COUNT(*) FROM player GROUP BY status")
            print("\n修复后 status 分布:")
            for row in cur.fetchall():
                print(f"  {row[0]}: {row[1]}")

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
