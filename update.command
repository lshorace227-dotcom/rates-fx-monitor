#!/bin/bash
# 双击运行：更新本地手动维护的利率数据（LPR / Shibor / HIBOR 3M·12M）。
cd "$(dirname "$0")" || exit 1
node update-data.mjs
echo
read -n 1 -s -r -p "按任意键关闭窗口…"
echo
