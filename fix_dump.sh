#!/bin/bash
# 修复 Railway 导出的 SQL 文件：
# 1. MySQL 9.4 → 8.0 兼容（修复 \" 转义问题）
# 2. 确保 UTF-8 编码

INPUT="$1"
OUTPUT="$2"

if [ -z "$INPUT" ] || [ -z "$OUTPUT" ]; then
  echo "用法: bash fix_dump.sh 输入.sql 输出.sql"
  exit 1
fi

echo "正在处理..."

# 第一步：确保输入是 UTF-8
ENCODING=$(file "$INPUT" | grep -o 'UTF-8\|UTF-8 Unicode\|ISO-8859\|ASCII')
echo "输入编码: $ENCODING"

# 如果是 UTF-16 则转 UTF-8
if file "$INPUT" | grep -qi "utf-16\|unicode"; then
  echo "检测到 UTF-16，转换为 UTF-8..."
  iconv -f UTF-16 -t UTF-8 "$INPUT" > /tmp/cs_utf8.sql
  INPUT="/tmp/cs_utf8.sql"
fi

# 第二步：处理 MySQL 9 → 8 兼容性
# 在 match_players 的 raw_data JSON 中，MySQL 9 mysqldump 会导出 \"
# MySQL 8.0 对 JSON 数据中多余的 \\ 转义解析更严格
# 修复方案：将 INSERT INTO match_players 中的 \" 替换为 "
# （在单引号括起的 SQL 字符串中，" 不需要转义）
echo "修复 JSON 转义..."

awk '
BEGIN { in_match_players = 0 }
/^INSERT INTO `match_players`/ { in_match_players = 1 }
{
  if (in_match_players) {
    # 在 match_players INSERT 中，将 \" 替换为 "
    gsub(/\\"/, "\"", $0)
  }
  print
}
/^INSERT INTO/ && !/match_players/ { in_match_players = 0 }
/^$/ && in_match_players { in_match_players = 0 }
' "$INPUT" > "$OUTPUT"

# 第三步：修复 DEFINER（可选，兼容不同 MySQL 用户）
sed -i 's/DEFINER=`root`@`%`/DEFINER=`root`@`localhost`/g' "$OUTPUT"

# 第四步：在文件末尾增加安全的 SQL_MODE
echo "" >> "$OUTPUT"
echo "SET @@SESSION.SQL_MODE = '';" >> "$OUTPUT"

echo "完成！输出文件: $OUTPUT"
echo "大小: $(ls -lh "$OUTPUT" | awk '{print $5}')"
