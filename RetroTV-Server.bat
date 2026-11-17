@echo off
chcp 65001 >nul
title RetroTV - LAN Server
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
set RETROTV_HOST=0.0.0.0
echo.
echo  Starting RetroTV in LAN mode...
echo  Keep this window open while phones and TVs use RetroTV.
echo  Windows may ask for firewall permission: allow it on private networks.
echo.
start "" /b cmd /c "timeout /t 2 >nul & start http://127.0.0.1:7777"
set RETROTV_LAUNCHER=1
:retrotv
node server.js
if errorlevel 75 goto retrotv
echo.
echo RetroTV has stopped.
pause
