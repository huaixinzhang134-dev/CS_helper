#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
增量爬取 + 自动重试失败选手头像。

模式说明（2026-07 更新）：
  - **增量模式（默认）**：
    - 第1步：读 avatar_map.json 缓存，跳过已有有效 URL 的选手；
      仅对"之前失败的（URL 为 None）"或"缓存中缺失的"选手重新请求 HLTV 页面。
    - 第2步：跳过已下载到本地的图片，只下载缺失的。
  - **强制全量模式（--force）**：
    忽略缓存，所有选手重新抓取 URL + 重新下载图片（覆盖已有文件）。
    注意：全量约 4600 选手，受 HLTV 限流约需 2.5 小时，网络差时可能更久。

使用：
    python download_avatars.py            # 增量 + 自动重试失败
    python download_avatars.py --force    # 强制全量覆盖

依赖：
    pip install requests beautifulsoup4
"""

import json
import os
import sys
import time

import requests

# HLTV 选手头像 URL 模板（需先用其他途径获取 playerId->imageUrl 映射，
# 或本脚本直接用 player_data.js 已经爬过的 img url 数据源）
# 由于原数据源 player.avatar 字段是 'unknown'，这里采取备用策略：
#   1) 从 playerbase_clean.json 取 HLTV _id
#   2) 请求 https://www.hltv.org/player/<_id>/<name> 抓页面里的 bodyshot-img src
# 这样不依赖 cloud:// 旧链路

BASE_URL = 'https://www.hltv.org'
HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36 Edg/149.0.0.0'
}

# HLTV 默认剪影图（"无定妆照"占位）：
#   - player_silhouette.png      男性默认
#   - player_silhouette_fe.png   女性默认
# 命中此 URL 的选手视为"无真实头像"，URL 仍保留进 MySQL（前端可识别并回退到��地默认头像），
# 但不下载图片字节到 server/public/players/（避免 4600 张同图占空间）。
SILHOUETTE_URLS = {
    f'{BASE_URL}/img/static/player/player_silhouette.png',
    f'{BASE_URL}/img/static/player/player_silhouette_fe.png',
    '/img/static/player/player_silhouette.png',
    '/img/static/player/player_silhouette_fe.png',
}

ROOT = os.path.dirname(os.path.abspath(__file__))
JSON_PATH = os.path.join(ROOT, 'playerbase_clean.json')
OUT_DIR = os.path.join(ROOT, '..', 'server', 'public', 'players')
IMG_META = os.path.join(ROOT, 'avatar_map.json')  # 缓存 id -> image url


def load_players():
    items = []
    with open(JSON_PATH, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            items.append(json.loads(line))
    return items


def fetch_image_url(player_id: str, player_name: str) -> tuple:
    """访问选手页面，提取 bodyshot img src。
    返回 (name, url) 或 (name, None)。
    若被限流（429），抛 RateLimitError 由主循环捕获做退避。
    """
    url = f"{BASE_URL}/player/{player_id}/{player_name}"
    r = requests.get(url, headers=HEADERS, timeout=20)
    if r.status_code == 429:
        raise RateLimitError(f"429 on {player_name}")
    if r.status_code != 200:
        return (player_name, None)
    # HLTV 选手头图在 <img class="bodyshot-img"> 或 playerImage
    from bs4 import BeautifulSoup
    soup = BeautifulSoup(r.text, 'html.parser')
    img = soup.find('img', class_='bodyshot-img') or soup.find('img', class_='playerImage')
    if img and img.get('src'):
        src = img['src']
        if src.startswith('/'):
            src = BASE_URL + src
        return (player_name, src)
    return (player_name, None)


class RateLimitError(Exception):
    """HLTV 返回 429"""
    pass


def should_force() -> bool:
    return '--force' in sys.argv


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    players = load_players()
    print(f"加载 {len(players)} 条选手")

    force = should_force()

    # 读取已有缓存
    cached = {}
    if os.path.exists(IMG_META) and not force:
        with open(IMG_META, 'r', encoding='utf-8') as f:
            cached = json.load(f)
        print(f"读取缓存 {len(cached)} 条 ({sum(1 for v in cached.values() if v)} 有效)")
    elif force:
        print("强制全量模式：忽略旧缓存")

    # ====== 第1步：筛选需要重新抓取 URL 的选手 ======
    to_fetch = []
    for p in players:
        name = p.get('name', '')
        pid = p.get('_id', '')
        if not name or not pid:
            continue
        if force:
            to_fetch.append((pid, name))   # 全量：全部重抓
        elif name not in cached:
            to_fetch.append((pid, name))   # 缺失：首次爬
        elif cached.get(name) is None:
            to_fetch.append((pid, name))   # 之前失败（URL 为 None）：重试

    print(f"\n=== 第1步：抓取头像 URL ===")
    print(f"待抓: {len(to_fetch)} 个选手 ({'全量覆盖' if force else '增量+重试失败'})")

    if force:
        print("⚠ 全量模式耗时较长，可随时 Ctrl+C 中断")
    else:
        print(f"预计耗时约 {max(1, len(to_fetch) * 2 // 60)} 分钟")

    fetched = {} if force else dict(cached)  # 最终 URL 映射
    consecutive_429 = 0
    total = len(to_fetch)

    for i, (pid, name) in enumerate(to_fetch):
        try:
            name_, url = fetch_image_url(pid, name)
            consecutive_429 = 0
        except RateLimitError:
            consecutive_429 += 1
            name_, url = name, None
            print(f"  [{i+1}/{total}] {name} 被限流 (429)，连续={consecutive_429}", flush=True)
        except Exception as e:
            print(f"  [{i+1}/{total}] {name} 异常: {e}", flush=True)
            name_, url = name, None

        fetched[name_] = url

        # 每 20 条落盘
        if (i + 1) % 20 == 0 or i == total - 1:
            with open(IMG_META, 'w', encoding='utf-8') as f:
                json.dump(fetched, f, ensure_ascii=False, indent=2)
            ok_count = sum(1 for v in fetched.values() if v)
            print(f"  [{i+1}/{total}] 有效 URL: {ok_count}/{len(fetched)} "
                  f"| last={name_}: {url or 'FAIL'}", flush=True)

        if consecutive_429 >= 5:
            print("  ⚠ 连续 5 次 429，暂停 60s ...", flush=True)
            time.sleep(60)
            consecutive_429 = 0
        else:
            time.sleep(2)

    print(f"\nURL 抓取完成: {sum(1 for v in fetched.values() if v)} 有效 / {len(fetched)} 个")

    # ====== 第2步：下载图片 ======
    print(f"\n=== 第2步：下载图片{'（覆盖已有）' if force else '（仅补缺失）'} ===")
    success = 0
    fail = 0
    skipped_silhouette = 0
    total_images = len(fetched)

    for i, (name, url) in enumerate(fetched.items()):
        if not url:
            fail += 1
            continue

        # silhouette 剪影图不下载
        if url in SILHOUETTE_URLS:
            skipped_silhouette += 1
            continue

        out = os.path.join(OUT_DIR, f"{name}.png")

        if not force and os.path.exists(out):
            success += 1
            continue

        try:
            r = requests.get(url, headers=HEADERS, timeout=20)
            if r.status_code == 200 and r.content:
                with open(out, 'wb') as f:
                    f.write(r.content)
                success += 1
            else:
                fail += 1
                print(f"  ⚠ {name} HTTP {r.status_code}", flush=True)
        except Exception as e:
            fail += 1
            print(f"  ⚠ {name} 下载异常: {e}", flush=True)

        if (i + 1) % 100 == 0 or i == total_images - 1:
            print(f"  [{i+1}/{total_images}] 成功={success} 失败={fail} silhouette跳过={skipped_silhouette}")

    print(f"\n完成: 成功 {success}, 失败 {fail}, silhouette 跳过 {skipped_silhouette}")
    print(f"输出目录: {OUT_DIR}")


if __name__ == '__main__':
    main()
