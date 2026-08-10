#!/usr/bin/env bash
# 一键生成「次日候选池」报告（默认锚定 = 最近一个已收盘交易日）
# 用法:
#   ./run_today.sh
#   ./run_today.sh --date 2026-07-27
#   ./run_today.sh --limit 20
# 输出: trading/reports/stock_list_<日期>.html
set -e
NODE="${WESTOCK_NODE:-$HOME/.workbuddy/binaries/node/versions/22.22.2/node.exe}"
SCRIPT="$(cd "$(dirname "$0")" && pwd)/gen_candidates.js"
if [ ! -x "$NODE" ] && [ ! -f "$NODE" ]; then
  echo "[错误] 未找到 node: $NODE" >&2
  echo "请确认 WorkBuddy 管理的 node 路径，或用 WESTOCK_NODE 环境变量覆盖。" >&2
  exit 1
fi
"$NODE" "$SCRIPT" "$@"
