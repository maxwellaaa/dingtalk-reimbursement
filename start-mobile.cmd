@echo off
chcp 65001 >nul
cd /d "%~dp0"
title DingTalk Reimburse - Mobile Start
echo.
echo  Starting: backend + frontend + cpolar
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\mobile-tunnel\start-dingtalk-mobile.ps1"
echo.
pause
