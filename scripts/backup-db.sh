#!/bin/bash
# /opt/scripts/backup-player.sh
# 每天凌晨 4 点备份 player 表，保留最近 7 天

BACKUP_DIR=/backups
DB_NAME=cs_match_pro
USER=root
PASS=你的密码
HOST=localhost

mkdir -p $BACKUP_DIR

# 只备份 player 表
mysqldump -h $HOST -u $USER -p$PASS \
  --single-transaction \
  --quick \
  $DB_NAME player \
  | gzip > $BACKUP_DIR/player_$(date +%Y%m%d_%H%M).sql.gz

# 只备份 player 表结构 + 数据的完整备份
mysqldump -h $HOST -u $USER -p$PASS \
  --single-transaction \
  --routines --triggers \
  $DB_NAME \
  | gzip > $BACKUP_DIR/full_$(date +%Y%m%d_%H%M).sql.gz

# 删除 7 天前的备份
find $BACKUP_DIR -name "*.sql.gz" -mtime +7 -delete

echo "备份完成: $(date)"
