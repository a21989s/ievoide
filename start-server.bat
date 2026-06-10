@echo off
rem 双击：启动手机/远程端服务器（Windows）。手机连本机后即可遥控引擎。
cd /d "%~dp0"
set "ELECTRON_RUN_AS_NODE="
if not exist node_modules ( call npm install )
call node server.mjs
pause
