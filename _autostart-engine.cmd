@echo off
rem 引擎自启循环：崩溃后3秒自动重启
:loop
cd /d "C:\code\dev tool"
"C:\Program Files\nodejs\node.exe" server.mjs
timeout /t 3 /nobreak >nul
goto loop
