@echo off
setlocal
cd /d "%~dp0"
title Oficina Virtual - Actualizacion Diaria de CLIs y Modelos
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0actualizar-diario.ps1" %*
