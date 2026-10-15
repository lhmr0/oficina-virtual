@echo off
cd /d "%~dp0"
set OFICINA_BIND=0.0.0.0
start "" http://127.0.0.1:4242/#/mando
node --no-warnings server.js
