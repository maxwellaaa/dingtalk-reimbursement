@echo off
chcp 65001 >nul
cd /d "%~dp0"
title DingTalk Reimburse - Mobile Start
call "%~dp0start-mobile.cmd"
