@echo off
setlocal
cd /d "%~dp0"
title Oficina Virtual - Agente de campo

if not exist "worker.js" (
  echo No encuentro worker.js en "%~dp0".
  pause
  exit /b 1
)
if not exist "worker.json" (
  echo No encuentro worker.json en "%~dp0".
  echo Configura primero la maquina desde Configuracion ^> Maquinas.
  pause
  exit /b 1
)
where node >nul 2>&1
if errorlevel 1 (
  echo No encuentro Node.js en PATH.
  pause
  exit /b 1
)
powershell -NoProfile -Command "$t = Get-ScheduledTask -TaskName 'OficinaVirtual-Agente' -ErrorAction SilentlyContinue; if ($t -and $t.State -eq 'Running') { exit 10 }"
if errorlevel 10 (
  echo El agente ya esta ejecutandose como tarea programada.
  echo No hace falta iniciar otra copia.
  pause
  exit /b 0
)

echo Manteniendo conectado el agente de campo.
echo Cierra esta ventana para detenerlo.
echo.

:reiniciar
echo [%date% %time%] Iniciando worker.js...
node --no-warnings worker.js
set "codigo=%errorlevel%"
echo.
echo [%date% %time%] worker.js termino con codigo %codigo%.
echo Se reiniciara en 5 segundos. Cierra esta ventana para salir.
timeout /t 5 /nobreak >nul
goto reiniciar
