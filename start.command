#!/usr/bin/env bash
# NOCTURNE Hold'em — double-click launcher for macOS.
set -e
cd "$(dirname "$0")"
PORT=8787
if command -v lsof >/dev/null 2>&1 && lsof -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; then
  PORT=8788
fi
if ! command -v node >/dev/null 2>&1; then
  echo "未找到 Node.js，将启动单人静态模式。"
  echo "联机房间需要 Node.js 20+。"
  ( sleep 0.8; open "http://127.0.0.1:8765" ) &
  exec python3 -m http.server 8765 --bind 127.0.0.1
fi
( sleep 0.9; open "http://127.0.0.1:$PORT" ) &
echo "NOCTURNE · 德州扑克"
echo "本地地址: http://127.0.0.1:$PORT"
echo "单人牌桌与联机房间均已启用。"
echo "按 Ctrl+C 停止服务。"
PORT="$PORT" exec node server.js
