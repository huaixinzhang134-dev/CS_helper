#!/usr/bin/env python3
"""
将 crawler/playerbase_clean_array.json + crawler/avatar_map.json
转换为 demo/miniprogram/playerbase-data.ts

输出格式: 一个 TypeScript 文件,导出 PLAYER_DATA 数组,
与 MockPlayer 接口兼容。
"""

import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(HERE)

PLAYER_SRC = os.path.join(PROJECT_ROOT, "crawler", "playerbase_clean_array.json")
AVATAR_SRC = os.path.join(PROJECT_ROOT, "crawler", "avatar_map.json")
OUTPUT = os.path.join(PROJECT_ROOT, "demo", "miniprogram", "playerbase-data.ts")

# 位置名称映射(英文 -> 中文)
POSITION_MAP = {
    "sniper": "狙击手",
    "rifler": "步枪手",
    "captain": "指挥",
    "coach": "教练",
    "rifle": "步枪手",
    "": "步枪手",
}


def main():
    print(f"==> 读取选手数据: {PLAYER_SRC}")
    with open(PLAYER_SRC, "r", encoding="utf-8") as f:
        players = json.load(f)
    print(f"    {len(players)} 条选手")

    print(f"==> 读取头像映射: {AVATAR_SRC}")
    with open(AVATAR_SRC, "r", encoding="utf-8") as f:
        avatars = json.load(f)
    print(f"    {len(avatars)} 个头像映射")

    print(f"==> 生成 TypeScript 数据文件...")

    lines = [
        "// 自动生成 - 勿手动编辑",
        "// 来源: crawler/playerbase_clean_array.json + crawler/avatar_map.json",
        f"// 共 {len(players)} 条选手数据",
        "// 生成时间: 2026-07-06",
        "",
        "export interface PlayerDataItem {",
        "  _id: string;",
        "  playerId: string;",
        "  name: string;",
        "  realName: string;",
        "  team: string;",
        "  formerTeams?: string[];",
        "  country: string;",
        "  countryCode: string;",
        "  age: number;",
        "  majorAppearances: number;",
        "  position: string;",
        "  avatar: string;",
        "  rating?: number;",
        "  region?: string;",
        "}",
        "",
        "export const PLAYER_DATA: PlayerDataItem[] = [",
    ]

    for i, p in enumerate(players):
        player_id = p["_id"]
        name = p.get("name", "")
        real_name = p.get("realName", "")
        team = p.get("team", "") or ""
        former_teams = p.get("formerTeams", []) or []
        country = p.get("country", "") or ""
        country_code = p.get("countryCode", "") or ""
        age = p.get("age", 0) or 0
        raw_major = p.get("majorAppearances", 0)
        if isinstance(raw_major, (int, float)):
            major_appearances = int(raw_major) if raw_major else 0
        else:
            # 处理 "unknown" 等非数字字符串
            try:
                major_appearances = int(raw_major)
            except (ValueError, TypeError):
                major_appearances = 0
        position = p.get("position", "") or ""
        rating = p.get("rating", 0) or 0
        region = p.get("region", "") or ""

        # 获取头像
        avatar = avatars.get(name, "")

        # 格式化年龄
        raw_age = p.get("age", 0)
        if isinstance(raw_age, (int, float)):
            age_val = int(raw_age) if raw_age else 0
        else:
            try:
                age_val = int(raw_age)
            except (ValueError, TypeError):
                age_val = 0

        # 格式化 rating
        raw_rating = p.get("rating", 0)
        if isinstance(raw_rating, (int, float)):
            rating_val = float(raw_rating) if raw_rating else 0.0
        else:
            try:
                rating_val = float(raw_rating)
            except (ValueError, TypeError):
                rating_val = 0.0

        # 生成条目
        item = [
            f"  {{",
            f"    _id: 'p{i+1}',",
            f"    playerId: '{player_id}',",
            f"    name: {json.dumps(name, ensure_ascii=False)},",
            f"    realName: {json.dumps(real_name, ensure_ascii=False)},",
            f"    team: {json.dumps(team, ensure_ascii=False)},",
            f"    formerTeams: {json.dumps(former_teams, ensure_ascii=False)},",
            f"    country: {json.dumps(country, ensure_ascii=False)},",
            f"    countryCode: {json.dumps(country_code)},",
            f"    age: {age_val},",
            f"    majorAppearances: {major_appearances},",
            f"    position: {json.dumps(position, ensure_ascii=False)},",
            f"    avatar: {json.dumps(avatar)},",
        ]

        if rating_val > 0:
            item.append(f"    rating: {rating_val},")
        if region:
            item.append(f"    region: {json.dumps(region)},")

        item.append(f"  }},")
        lines.extend(item)

    lines.append("];")
    lines.append("")

    content = "\n".join(lines)

    with open(OUTPUT, "w", encoding="utf-8") as f:
        f.write(content)

    file_size_kb = len(content.encode("utf-8")) / 1024
    print(f"==> 写入完成: {OUTPUT}")
    print(f"    文件大小: {file_size_kb:.1f} KB")
    print(f"    共 {len(players)} 条选手数据")


if __name__ == "__main__":
    main()
