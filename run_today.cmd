@echo off
:: 一键生成「次日候选池」报告（默认锚定 = 最近一个已收盘交易日）
:: 用法:
::   run_today.cmd                生成当天报告
::   run_today.cmd --date 2026-07-27   回填历史
::   run_today.cmd --limit 20     调整候选上限
:: 输出: trading/reports/stock_list_<日期>.html
setlocal
set "NODE=%WESTOCK_NODE%"
if "%NODE%"=="" set "NODE=C:\Users\Admin\.workbuddy\binaries\node\versions\22.22.2\node.exe"
set "SCRIPT=%~dp0gen_candidates.js"
if not exist "%NODE%" (
  echo [错误] 未找到 node: %NODE%
  echo 请确认 WorkBuddy 管理的 node 路径，或用 WESTOCK_NODE 环境变量覆盖。
  exit /b 1
)
"%NODE%" "%SCRIPT%" %*
endlocal
