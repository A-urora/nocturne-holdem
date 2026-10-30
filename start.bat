@echo off
cd /d "%~dp0"
where node >nul 2>nul
if %errorlevel%==0 (
  echo NOCTURNE Hold'em - online server
  echo Local: http://127.0.0.1:8787
  start "" "http://127.0.0.1:8787"
  node server.js
) else (
  echo Node.js not found. Starting single-player static mode...
  echo Online rooms require Node.js 20+.
  start "" "http://127.0.0.1:8765"
  python -m http.server 8765
)
pause
