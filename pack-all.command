#!/bin/bash
# 双击：全量打包（含 node_modules + data + .git），解压即用、零安装（同系统）。适合作者随身带。
cd "$(dirname "$0")" || exit 1
OUT="$HOME/Desktop/claude-tools-portable-$(date +%Y%m%d-%H%M%S).zip"
echo "打包中（含 node_modules，体积较大，请稍候）…"
zip -r -y -q "$OUT" . -x "*.log" "claude-tools-*.zip" || { echo "打包失败"; read -r; exit 1; }
echo "✅ 已打包到：$OUT"
du -h "$OUT" | awk '{print "大小:", $1}'
echo "用法：拷到另一台同系统机器，解压后双击 start.command 即可直接用（无需安装）。"
read -r -p "按回车关闭…"
