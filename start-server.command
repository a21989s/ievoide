#!/bin/bash
# 双击：启动手机/远程端服务器（Mac）。手机连本机后即可遥控引擎。
cd "$(dirname "$0")" || exit 1
[ -d node_modules ] || npm install --cache /tmp/npm-cache
exec env -u ELECTRON_RUN_AS_NODE node server.mjs
