@echo off
rem 双击启动 Claude Tools（Windows）。缺 node_modules 会自动安装（需已装 Node.js）。
cd /d "%~dp0"
set "ELECTRON_RUN_AS_NODE="
if not exist node_modules (
  echo First run: installing dependencies ^(needs Node.js^)...
  call npm install || ( echo npm install failed. Install Node.js first. & pause & exit /b 1 )
)
call node ".\node_modules\electron\cli.js" .
