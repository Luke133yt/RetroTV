#!/bin/bash
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Download it from https://nodejs.org (LTS) and run this file again."
  open "https://nodejs.org" 2>/dev/null || xdg-open "https://nodejs.org" 2>/dev/null
  read -p "Press Enter to close"; exit 1
fi
export RETROTV_HOST=0.0.0.0
echo "Starting RetroTV in LAN mode. Keep this window open."
( sleep 2; open "http://127.0.0.1:7777" 2>/dev/null || xdg-open "http://127.0.0.1:7777" 2>/dev/null ) &
export RETROTV_LAUNCHER=1
while :; do
  node server.js
  [ $? -eq 75 ] || break
done
read -p "RetroTV has stopped. Press Enter to close"
