#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
选手数据清洗脚本：为每条记录添加 region 字段（Europe / Americas / Asia / Other），
并删除若干未填充的统计指标字段。

规则：
- 优先使用 countryCode（ISO 3166-1 alpha-2），缺失则用 country 名称。
- 非洲国家（南 ZA、阿尔及利亚 DZ 等）不在三大赛区中，统一划为 Other。
- Kosovo（XK）划入 Europe。
- Palestine（PS）划入 Asia。
- Wales / England / Scotland 等（英国构成国）划入 Europe。
- 既无 countryCode 也无 country，或都不在已知列表中，则 region = "Other"，
  并在控制台输出警告（包含原始数据）。
- 删除下列无数据的统计字段（值为 0 也一并删除）：
  roundSwing、dpr、kast、multiKill、adr、kpr、firepower。
"""

import json
import os
import sys
import warnings

# 三大赛区国家代码集合（ISO 3166-1 alpha-2）
EUROPE_CODES = {
    # 西欧
    "FR", "DE", "NL", "BE", "LU", "AT", "CH", "IE", "GB", "UK",  # UK 作为通用兼容
    # 北欧
    "SE", "NO", "DK", "FI", "IS",
    # 南欧
    "IT", "ES", "PT", "GR", "MT", "CY", "AD", "MC", "SM", "VA",
    # 中欧
    "PL", "CZ", "SK", "HU", "SI", "HR", "BA", "RS", "ME", "MK", "AL", "XK",
    # 东欧 + 独联体（含俄罗斯、乌克兰、白俄罗斯等）
    "RU", "UA", "BY", "MD", "EE", "LV", "LT",
    # 中东归入 Europe（按题目要求 Kosovo / Palestine 单独说明，
    # 土耳其/以色列/黎巴嫩等地理上跨欧亚的，按"西亚国家"放到 Asia），
    # 此处 Europe 仅保留地理欧洲。
    # 巴尔干补充
    "BG", "RO",
    # 袖珍国
    "LI", "FO", "SJ", "AX", "GI",
    # 英国构成国（虽然官方 ISO 是 GB，但数据中可能直接写国家名）
}

AMERICAS_CODES = {
    # 北美
    "US", "CA", "MX",
    # 中美
    "GT", "BZ", "HN", "SV", "NI", "CR", "PA",
    # 加勒比
    "CU", "JM", "HT", "DO", "PR", "BS", "BB", "TT", "LC", "GD", "VC", "DM",
    "AG", "KN", "AI", "MS", "TC", "VG", "VI", "KY", "BM", "AW", "CW",
    "SX", "BQ", "MQ", "GP", "RE", "YT", "PM", "GL",  # 法国海外领地也按地理归入
    # 南美
    "BR", "AR", "CL", "CO", "PE", "VE", "EC", "BO", "PY", "UY", "GY",
    "SR", "GF", "FK",
}

ASIA_CODES = {
    # 东亚
    "CN", "JP", "KR", "KP", "MN", "TW", "HK", "MO",
    # 东南亚
    "SG", "MY", "ID", "TH", "VN", "PH", "MM", "KH", "LA", "BN", "TL",
    # 南亚
    "IN", "PK", "BD", "NP", "BT", "LK", "MV", "AF",
    # 西亚
    "TR", "SA", "AE", "QA", "KW", "BH", "OM", "YE", "JO", "LB", "SY",
    "IQ", "IR", "IL", "PS", "AM", "AZ", "GE",
    # 中亚
    "KZ", "UZ", "TM", "KG", "TJ",
    # 大洋洲
    "AU", "NZ", "PG", "FJ", "WS", "TO", "VU", "SB", "KI", "NR", "TV",
    "PW", "MH", "FM", "CK", "NU", "TK", "WF", "PF", "NC", "GU", "MP", "AS",
}

# 非洲（明确划为 Other 的国家代码，方便调试与回溯）
AFRICA_CODES = {
    "DZ", "AO", "BJ", "BW", "BF", "BI", "CM", "CV", "CF", "TD", "KM", "CG",
    "CD", "CI", "DJ", "EG", "GQ", "ER", "SZ", "ET", "GA", "GM", "GH", "GN",
    "GW", "KE", "LS", "LR", "LY", "MG", "MW", "ML", "MR", "MU", "MA", "MZ",
    "NA", "NE", "NG", "RW", "ST", "SN", "SC", "SL", "SO", "ZA", "SS", "SD",
    "TZ", "TG", "TN", "UG", "ZM", "ZW", "RE", "YT", "SH", "EH", "GG",  # GG 属英吉利海峡,通常归欧洲;此处只用于提示
}

# 已知 country 名称 -> region 的兜底映射（处理无 countryCode 或不在 code 列表的情况）
COUNTRY_NAME_REGION = {
    # 欧洲（地理欧洲 + 独联体）
    "United Kingdom": "Europe", "UK": "Europe", "Great Britain": "Europe",
    "England": "Europe", "Scotland": "Europe", "Wales": "Europe",
    "Northern Ireland": "Europe", "Ireland": "Europe", "Republic of Ireland": "Europe",
    "France": "Europe", "Germany": "Europe", "Spain": "Europe", "Italy": "Europe",
    "Portugal": "Europe", "Netherlands": "Europe", "Belgium": "Europe",
    "Switzerland": "Europe", "Austria": "Europe", "Poland": "Europe",
    "Czech Republic": "Europe", "Czechia": "Europe", "Slovakia": "Europe",
    "Hungary": "Europe", "Romania": "Europe", "Bulgaria": "Europe", "Greece": "Europe",
    "Croatia": "Europe", "Serbia": "Europe", "Slovenia": "Europe", "Slavonia": "Europe",
    "Bosnia and Herzegovina": "Europe", "Montenegro": "Europe", "Albania": "Europe",
    "North Macedonia": "Europe", "Macedonia": "Europe", "Kosovo": "Europe",
    "Moldova": "Europe", "Latvia": "Europe", "Lithuania": "Europe", "Estonia": "Europe",
    "Russia": "Europe", "Russian Federation": "Europe", "Ukraine": "Europe",
    "Belarus": "Europe", "Sweden": "Europe", "Norway": "Europe", "Denmark": "Europe",
    "Finland": "Europe", "Iceland": "Europe", "Malta": "Europe", "Cyprus": "Europe",
    "Luxembourg": "Europe", "Liechtenstein": "Europe", "Monaco": "Europe",
    "Andorra": "Europe", "San Marino": "Europe", "Vatican City": "Europe",
    # 美洲
    "United States": "Americas", "USA": "Americas", "U.S.A.": "Americas",
    "Canada": "Americas", "Mexico": "Americas", "Brazil": "Americas",
    "Argentina": "Americas", "Chile": "Americas", "Colombia": "Americas",
    "Peru": "Americas", "Venezuela": "Americas", "Ecuador": "Americas",
    "Bolivia": "Americas", "Paraguay": "Americas", "Uruguay": "Americas",
    "Costa Rica": "Americas", "Panama": "Americas", "Cuba": "Americas",
    "Jamaica": "Americas", "Dominican Republic": "Americas",
    "Trinidad and Tobago": "Americas",
    # 亚洲（含大洋洲）
    "China": "Asia", "People's Republic of China": "Asia",
    "Japan": "Asia", "South Korea": "Asia", "Korea, Republic of": "Asia",
    "North Korea": "Asia", "Mongolia": "Asia", "Taiwan": "Asia",
    "Hong Kong": "Asia", "Macao": "Asia",
    "Singapore": "Asia", "Malaysia": "Asia", "Indonesia": "Asia",
    "Thailand": "Asia", "Vietnam": "Asia", "Philippines": "Asia",
    "Myanmar": "Asia", "Cambodia": "Asia", "Laos": "Asia",
    "India": "Asia", "Pakistan": "Asia", "Bangladesh": "Asia",
    "Nepal": "Asia", "Sri Lanka": "Asia", "Afghanistan": "Asia",
    "Turkey": "Asia", "Türkiye": "Asia",
    "Saudi Arabia": "Asia", "United Arab Emirates": "Asia", "Qatar": "Asia",
    "Kuwait": "Asia", "Bahrain": "Asia", "Oman": "Asia", "Yemen": "Asia",
    "Jordan": "Asia", "Lebanon": "Asia", "Syria": "Asia", "Iraq": "Asia",
    "Iran": "Asia", "Israel": "Asia", "Palestine": "Asia",
    "Armenia": "Asia", "Azerbaijan": "Asia", "Georgia": "Asia",
    "Kazakhstan": "Asia", "Uzbekistan": "Asia", "Turkmenistan": "Asia",
    "Kyrgyzstan": "Asia", "Tajikistan": "Asia",
    "Australia": "Asia", "New Zealand": "Asia",
}


# ============================================================
# 国家英文 → 中文 翻译映射
# ============================================================
COUNTRY_EN_TO_CN = {
    # 欧洲
    "United Kingdom": "英国", "UK": "英国", "Great Britain": "英国",
    "England": "英格兰", "Scotland": "苏格兰", "Wales": "威尔士",
    "Northern Ireland": "北爱尔兰", "Ireland": "爱尔兰", "Republic of Ireland": "爱尔兰",
    "France": "法国", "Germany": "德国", "Spain": "西班牙", "Italy": "意大利",
    "Portugal": "葡萄牙", "Netherlands": "荷兰", "Belgium": "比利时",
    "Switzerland": "瑞士", "Austria": "奥地利", "Poland": "波兰",
    "Czech Republic": "捷克", "Czechia": "捷克", "Slovakia": "斯洛伐克",
    "Hungary": "匈牙利", "Romania": "罗马尼亚", "Bulgaria": "保加利亚", "Greece": "希腊",
    "Croatia": "克罗地亚", "Serbia": "塞尔维亚", "Slovenia": "斯洛文尼亚",
    "Bosnia and Herzegovina": "波黑",
    "Montenegro": "黑山", "Albania": "阿尔巴尼亚",
    "North Macedonia": "北马其顿", "Macedonia": "北马其顿", "Kosovo": "科索沃地区",
    "Moldova": "摩尔多瓦", "Latvia": "拉脱维亚", "Lithuania": "立陶宛", "Estonia": "爱沙尼亚",
    "Russia": "俄罗斯", "Russian Federation": "俄罗斯", "Ukraine": "乌克兰",
    "Belarus": "白俄罗斯",
    "Sweden": "瑞典", "Norway": "挪威", "Denmark": "丹麦",
    "Finland": "芬兰", "Iceland": "冰岛", "Malta": "马耳他", "Cyprus": "塞浦路斯",
    "Luxembourg": "卢森堡", "Liechtenstein": "列支敦士登", "Monaco": "摩纳哥",
    "Andorra": "安道尔", "San Marino": "圣马力诺", "Vatican City": "梵蒂冈",
    # 美洲
    "United States": "美国", "USA": "美国", "U.S.A.": "美国",
    "Canada": "加拿大", "Mexico": "墨西哥",
    "Brazil": "巴西", "Argentina": "阿根廷", "Chile": "智利",
    "Colombia": "哥伦比亚", "Peru": "秘鲁", "Venezuela": "委内瑞拉",
    "Ecuador": "厄瓜多尔", "Bolivia": "玻利维亚", "Paraguay": "巴拉圭",
    "Uruguay": "乌拉圭",
    "Costa Rica": "哥斯达黎加", "Panama": "巴拿马", "Cuba": "古巴",
    "Jamaica": "牙买加", "Dominican Republic": "多米尼加",
    "Trinidad and Tobago": "特立尼达和多巴哥",
    # 亚洲
    "China": "中国", "People's Republic of China": "中国",
    "Japan": "日本", "South Korea": "韩国", "Korea, Republic of": "韩国",
    "North Korea": "朝鲜", "Mongolia": "蒙古", "Taiwan": "中国台湾",
    "Hong Kong": "中国香港", "Macao": "中国澳门",
    "Singapore": "新加坡", "Malaysia": "马来西亚", "Indonesia": "印度尼西亚",
    "Thailand": "泰国", "Vietnam": "越南", "Philippines": "菲律宾",
    "Myanmar": "缅甸", "Cambodia": "柬埔寨", "Laos": "老挝",
    "India": "印度", "Pakistan": "巴基斯坦", "Bangladesh": "孟加拉国",
    "Nepal": "尼泊尔", "Sri Lanka": "斯里兰卡", "Afghanistan": "阿富汗",
    "Turkey": "土耳其", "Türkiye": "土耳其",
    "Saudi Arabia": "沙特阿拉伯", "United Arab Emirates": "阿联酋", "Qatar": "卡塔尔",
    "Kuwait": "科威特", "Bahrain": "巴林", "Oman": "阿曼", "Yemen": "也门",
    "Jordan": "约旦", "Lebanon": "黎巴嫩", "Syria": "叙利亚", "Iraq": "伊拉克",
    "Iran": "伊朗", "Israel": "以色列", "Palestine": "巴勒斯坦",
    "Armenia": "亚美尼亚", "Azerbaijan": "阿塞拜疆", "Georgia": "格鲁吉亚",
    "Kazakhstan": "哈萨克斯坦", "Uzbekistan": "乌兹别克斯坦",
    "Turkmenistan": "土库曼斯坦", "Kyrgyzstan": "吉尔吉斯斯坦", "Tajikistan": "塔吉克斯坦",
    "Australia": "澳大利亚", "New Zealand": "新西兰",
    # 非洲
    "South Africa": "南非", "Egypt": "埃及", "Morocco": "摩洛哥",
    "Algeria": "阿尔及利亚", "Tunisia": "突尼斯", "Nigeria": "尼日利亚",
    "Kenya": "肯尼亚",
    # 非洲争议地区（中国大陆外交标准：不承认单方面独立的主权声索）
    "Somaliland": "索马里",
    "Western Sahara": "西撒哈拉",
    # 补充（HLTV 数据中出现的特殊值）
    "Unknown": "未知",
}


def region_from_code(code: str):
    """根据 ISO 3166-1 alpha-2 国家代码返回 region。"""
    if not code:
        return None
    code = code.strip().upper()
    if code in EUROPE_CODES:
        return "Europe"
    if code in AMERICAS_CODES:
        return "Americas"
    if code in ASIA_CODES:
        return "Asia"
    if code in AFRICA_CODES:
        # 非洲一律划为 Other
        return "Other"
    return None


def region_from_name(name: str):
    """根据国家英文名称返回 region。"""
    if not name:
        return None
    name = name.strip()
    return COUNTRY_NAME_REGION.get(name)


def determine_region(record: dict) -> str:
    """确定一条选手记录的 region 字段。"""
    code = record.get("countryCode", "")
    country = record.get("country", "")

    if code:
        region = region_from_code(code)
        if region is not None:
            return region
        # code 存在但不在已知集合中，继续尝试 name 兜底
    if country:
        region = region_from_name(country)
        if region is not None:
            return region
    return "Other"


def translate_country(country_en: str) -> str:
    """将国家英文名翻译为中文，查不到时返回原文。"""
    if not country_en:
        return ""
    return COUNTRY_EN_TO_CN.get(country_en.strip(), country_en)


# 需要从记录中删除的字段（这些指标在原始数据中均为 0，不携带有效信息）
DROP_FIELDS = (
    "roundSwing",
    "dpr",
    "kast",
    "multiKill",
    "adr",
    "kpr",
    "firepower",
)


def drop_unused_fields(record: dict) -> dict:
    """从记录中删除 DROP_FIELDS 指定的字段，返回同一字典对象。"""
    for key in DROP_FIELDS:
        record.pop(key, None)
    return record


def clean(input_path: str, output_path: str) -> dict:
    """读取 input_path（每行一个 JSON），为每条添加 region 字段后写入 output_path。

    返回简单的统计信息。
    """
    stats = {"total": 0, "Europe": 0, "Americas": 0, "Asia": 0, "Other": 0}
    warnings_list = []

    with open(input_path, "r", encoding="utf-8") as fin, \
            open(output_path, "w", encoding="utf-8") as fout:
        for lineno, raw in enumerate(fin, start=1):
            raw = raw.strip()
            if not raw:
                continue
            try:
                record = json.loads(raw)
            except json.JSONDecodeError as e:
                warnings.warn(f"[第 {lineno} 行] JSON 解析失败: {e}; 原始数据: {raw}",
                              stacklevel=2)
                continue

            region = determine_region(record)
            record["region"] = region

            # 将国家英文名翻译为中文存储
            if record.get("country"):
                record["country"] = translate_country(record["country"])

            # 删除无数据的统计指标字段
            drop_unused_fields(record)

            # 统计 & 警告
            stats["total"] += 1
            if region in stats:
                stats[region] += 1
            if region == "Other":
                warnings_list.append((lineno, record))

            # 保持字段顺序：原字段 + region 追加在末尾
            fout.write(json.dumps(record, ensure_ascii=False, separators=(",", ":")))
            fout.write("\n")

    # 控制台输出警告
    for lineno, rec in warnings_list:
        print(f"[警告] 第 {lineno} 行 region = Other: "
              f"country='{rec.get('country')}', "
              f"countryCode='{rec.get('countryCode')}'", file=sys.stderr)

    return stats


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    # 默认从 playerbase.json 读，输出 playerbase_clean.json
    input_path = os.path.join(here, "playerbase.json")
    output_path = os.path.join(here, "playerbase_clean.json")

    # 也允许命令行参数覆盖
    if len(sys.argv) >= 2:
        input_path = sys.argv[1]
    if len(sys.argv) >= 3:
        output_path = sys.argv[2]

    print(f"读取: {input_path}")
    print(f"写入: {output_path}")

    stats = clean(input_path, output_path)

    print("\n清洗完成，统计：")
    for k, v in stats.items():
        print(f"  {k}: {v}")


if __name__ == "__main__":
    main()
