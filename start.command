#!/bin/bash
# 双击即可启动 Claude Tools。缺 node_modules 会自动安装；并去掉会导致不弹窗的 ELECTRON_RUN_AS_NODE。
cd "$(dirname "$0")" || exit 1
if [ ! -d node_modules ]; then
  echo "首次运行，正在安装依赖（需要 Node.js）…"
  npm install --cache /tmp/npm-cache || { echo "依赖安装失败，请先安装 Node.js"; read -r; exit 1; }
fi
# 用真实 cli.js 启动（不依赖 .bin/electron 符号链接，便携解压后也能跑）
exec env -u ELECTRON_RUN_AS_NODE node ./node_modules/electron/cli.js .
