#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
将选手头像 URL 写回 MySQL player.avatar。
配合 download_avatars.py 使用，**两个数据源合并**：

  1. server/public/players/ 下实际下载到的图片：
       avatar = "/static/players/<name>.<ext>"   ← 前端走 STATIC_BASE 拼完整 URL
  2. avatar_map.json 中保留的 silhouette URL（HLTV 占位剪影，未下载）：
       avatar = 完整 HLTV URL（如 https://www.hltv.org/img/static/player/player_silhouette.png）
       前端 normalizeAvatarUrl 会识别 silhouette 走本地默认头像兜底
"""

import json
import os

import pymysql

ROOT = os.path.dirname(os.path.abspath(__file__))
PLAYER_DIR = os.path.join(ROOT, '..', 'server', 'public', 'players')
AVATAR_MAP = os.path.join(ROOT, 'avatar_map.json')

# 与 download_avatars.py 保持同步的 silhouette URL 列表
HLTV_BASE = 'https://www.hltv.org'
SILHOUETTE_URLS = {
    f'{HLTV_BASE}/img/static/player/player_silhouette.png',
    f'{HLTV_BASE}/img/static/player/player_silhouette_fe.png',
}

DB_CONFIG = {
    "host": os.environ.get('DB_HOST', 'localhost'),
    "port": int(os.environ.get('DB_PORT', '3306')),
    "user": os.environ.get('DB_USER', 'root'),
    "password": os.environ.get('DB_PASS', '201005'),
    "database": os.environ.get('DB_NAME', 'cs_match_pro'),
    "charset": 'utf8mb4',
    "autocommit": False,
}


def main():
    # 数据源 1：本地下载到的图片
    rows = []
    local_count = 0
    if os.path.isdir(PLAYER_DIR):
        for f in os.listdir(PLAYER_DIR):
            if not f.lower().endswith(('.png', '.jpg', '.jpeg', '.webp')):
                continue
            name = os.path.splitext(f)[0]
            rows.append((f"/static/players/{f}", name))
            local_count += 1
    print(f"本地图片: {local_count} 张")

    # 数据源 2：avatar_map.json 中的 silhouette URL（未下载但需保留到 MySQL）
    silhouette_count = 0
    if os.path.exists(AVATAR_MAP):
        with open(AVATAR_MAP, 'r', encoding='utf-8') as f:
            avatar_map = json.load(f)
        for name, url in avatar_map.items():
            if not name or not url:
                continue
            if url in SILHOUETTE_URLS:
                rows.append((url, name))
                silhouette_count += 1
        print(f"silhouette URL: {silhouette_count} 条")

    if not rows:
        print("无可用数据，请先跑 crawler/download_avatars.py")
        return

    print(f"合计更新: {len(rows)} 条")

    conn = pymysql.connect(**DB_CONFIG)
    try:
        with conn.cursor() as cur:
            cur.executemany(
                "UPDATE player SET avatar = %s WHERE game_id = %s",
                rows
            )
            # executemany 的 rowcount 在 MySQL 里是匹配到的总行数（含未变更）
            print(f"  MySQL 返回 affected: {cur.rowcount}")

        conn.commit()
        print("提交完成")
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


if __name__ == '__main__':
    main()
