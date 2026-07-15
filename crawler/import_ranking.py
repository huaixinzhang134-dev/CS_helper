#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
将 valve_ranking.json（爬虫输出）导入到 team_ranking 表。

依赖：
    pip install pymysql

使用：
    python import_ranking.py
    # 或自定义：
    DB_HOST=127.0.0.1 DB_USER=root DB_PASS=xxx DB_NAME=cs_match_pro python import_ranking.py
"""

import json
import os
import sys
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

RANKING_PATH = os.path.join(os.path.dirname(__file__), "valve_ranking.json")


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


def insert_rankings(cur, rankings: list):
    """
    写入 team_ranking 表。
    先清空旧数据（每次重爬后重新导入），再逐条插入。
    """
    # 清空旧数据
    cur.execute("TRUNCATE TABLE team_ranking")

    # 预取 team 表的 (name → id) 映射，用于关联已有队伍
    cur.execute("SELECT id, name FROM team")
    team_map = {name: tid for tid, name in cur.fetchall()}

    sql = """
        INSERT INTO team_ranking
          (ranking, team_name, team_id, hltv_team_id, points, logo_url)
        VALUES
          (%s, %s, %s, %s, %s, %s)
    """
    rows = []
    matched = 0
    unmatched = 0

    for r in rankings:
        team_name = r.get("name", "")
        team_id = team_map.get(team_name)  # 可能为 None

        if team_id is not None:
            matched += 1
        else:
            unmatched += 1

        rows.append((
            int(r.get("ranking", 0)),
            team_name,
            team_id,
            str(r.get("teamId", "")),
            str(r.get("points", "")),
            r.get("logo", "") or "",
        ))

    cur.executemany(sql, rows)
    return len(rows), matched, unmatched


def main():
    print("==> 加载数据源 ...")
    if not os.path.exists(RANKING_PATH):
        print(f"[ERROR] 文件不存在: {RANKING_PATH}", file=sys.stderr)
        print("提示：请先运行 crawl_ranking.js 生成 valve_ranking.json", file=sys.stderr)
        sys.exit(1)

    rankings = load_jsonl(RANKING_PATH)
    print(f"    共 {len(rankings)} 条排名数据")

    print("==> 连接数据库 ...")
    conn = pymysql.connect(**DB_CONFIG)
    try:
        with conn.cursor() as cur:
            print("==> 写入 team_ranking ...")
            n, matched, unmatched = insert_rankings(cur, rankings)
            print(f"    写入 {n} 条排名")
            print(f"    关联已有队伍: {matched} 条")
            print(f"    未关联队伍（team 表中无对应记录）: {unmatched} 条")

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
        print("提示：请先执行 schema_ranking.sql 创建表，并设置环境变量。", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"\n[ERROR] {e}", file=sys.stderr)
        sys.exit(1)
