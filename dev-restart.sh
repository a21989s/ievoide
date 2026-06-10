#!/usr/bin/env bash
# 重启本项目的 Electron 应用（消灭最高频的人工干预动作）。
# 用法: bash dev-restart.sh  或  npm run restart
# 日志: /tmp/electron-tools.log   PID: /tmp/electron-tools.pid
set -euo pipefail

PROJ="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG=/tmp/electron-tools.log
PIDFILE=/tmp/electron-tools.pid

# 杀掉上一实例（按项目路径精确匹配，避免误杀其他 electron）
pkill -f "${PROJ}/node_modules/electron" 2>/dev/null || true
sleep 1

cd "$PROJ"
# 脱离当前 shell 后台运行，shell 退出也不被回收
nohup env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron . \
  > "$LOG" 2>&1 &
echo $! > "$PIDFILE"
echo "electron restarted (pid $(cat "$PIDFILE")), log -> $LOG"
