@echo off
chcp 65001 >nul
cd /d "%~dp0"
title DingTalk Reimburse - Mobile Stop
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\mobile-tunnel\stop-dingtalk-mobile.ps1" -RestoreFrontendUrl
echo.
pause
