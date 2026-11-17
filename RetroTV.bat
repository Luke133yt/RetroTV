@echo off
chcp 65001 >nul
title RetroTV
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Node.js is not installed. Download it from https://nodejs.org ^(LTS version^), install it and run this file again.
  echo.
  start https://nodejs.org
  pause
  exit /b 1
)
echo Starting RetroTV...
start "" /b cmd /c "timeout /t 2 >nul & start http://127.0.0.1:7777"
set RETROTV_LAUNCHER=1
:retrotv
node server.js
if errorlevel 75 goto retrotv
echo.
echo RetroTV has stopped.
pause
