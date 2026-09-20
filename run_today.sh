#!/usr/bin/env bash
# 一键生成「次日候选池」报告（默认锚定 = 最近一个已收盘交易日）
# 用法:
#   ./run_today.sh
#   ./run_today.sh --date 2026-07-27
#   ./run_today.sh --limit 20
# 输出: reports/stock_list_<日期>.html
# 数据源: 腾讯公开行情接口（无需任何第三方 CLI），候选池见 candidates.json
set -e
# CANDIDATE_NODE 为当前变量名；WESTOCK_NODE 为旧名，保留兼容
NODE="${CANDIDATE_NODE:-${WESTOCK_NODE:-$HOME/.workbuddy/binaries/node/versions/22.22.2/node.exe}}"
SCRIPT="$(cd "$(dirname "$0")" && pwd)/gen_candidates.js"
if [ ! -x "$NODE" ] && [ ! -f "$NODE" ]; then
  # 回退到 PATH 上的 node
  if command -v node >/dev/null 2>&1; then
    NODE="$(command -v node)"
  else
    echo "[错误] 未找到 node: $NODE" >&2
    echo "请安装 Node >=18，或用 CANDIDATE_NODE 环境变量指定路径。" >&2
    exit 1
  fi
fi
"$NODE" "$SCRIPT" "$@"
# 自动同步入库：--both = 远程 D1 与本地 db/local.db 一起写。
# 两端同时前进，避免「线上新、本地旧」（此前默认只写远程，本地库会一直停在旧数据）。
# 凭据来自系统环境变量或 db/.env（后者由 db/d1client.js 经 dotenv 自动加载）。
# 未配置远程凭据时只写本地；入库失败时 write_live.js 自行跳过并退出 0，不会阻断报告生成。
echo "[db] 同步入库（远程 + 本地）..."
"$NODE" "$(cd "$(dirname "$0")" && pwd)/db/write_live.js" --both || echo "[warn] 入库失败或跳过，详见日志"
