#!/bin/bash
# 双击：把本工具打包成 zip 分发到桌面。
# 含：源码 + config.json/mcp.json(配置与提示词) + .git(保留 => 对方解压后仍可自进化)
# 排除：node_modules(对方首次启动自动装) + data(你的私有对话/附件历史)
cd "$(dirname "$0")" || exit 1
NAME="claude-tools-$(date +%Y%m%d-%H%M%S).zip"
OUT="$HOME/Desktop/$NAME"
rm -f "$OUT"
# cloud/ 是闭源的进化大脑云服务（提示词/需求池/key），绝不随分发包外发
zip -r -q "$OUT" . \
  -x "node_modules/*" "data/*" "cloud/*" "*.log" ".DS_Store" "**/.DS_Store" \
  || { echo "打包失败"; read -r; exit 1; }
echo "✅ 已打包到：$OUT"
echo
echo "对方使用方法："
echo "  1) 解压 zip"
echo "  2) 双击 start.command（首次会自动安装依赖，需先装 Node.js）"
echo "  3) 自进化照常可用（zip 里带了 .git）"
read -r -p "按回车关闭…"
