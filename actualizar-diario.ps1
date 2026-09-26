<#
.SYNOPSIS
  Script de mantenimiento y actualización diaria de la Oficina Virtual en Windows.
  1. Actualiza los 4 CLIs de agentes: Claude Code, Codex, Antigravity y CommandCode.
  2. Actualiza todos los modelos y esfuerzos de cada uno de los modelos por los 4 agentes.

.DESCRIPTION
  Ejecuta secuencialmente la actualización de los 4 ejecutables CLI instalados en la PC,
  y posteriormente ejecuta el sincronizador nativo en Node.js para actualizar la base de datos
  SQLite (oficina.db) con la lista completa de modelos y niveles de razonamiento (esfuerzo).

.PARAMETER InstalarTarea
  Registra la tarea programada de Windows para que este script se ejecute automáticamente todos los días.

.PARAMETER DesinstalarTarea
  Elimina la tarea programada de Windows.

.PARAMETER Hora
  Hora diaria para la tarea programada en formato HH:mm (por defecto: 03:00).

.EXAMPLE
  .\actualizar-diario.ps1
  Ejecuta la actualización completa de inmediato.

.EXAMPLE
  .\actualizar-diario.ps1 -InstalarTarea -Hora "04:00"
  Programa la tarea diaria a las 4:00 AM.
#>

param(
  [switch]$InstalarTarea,
  [switch]$DesinstalarTarea,
  [string]$Hora = "03:00"
)

$ErrorActionPreference = "Continue"
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$logFile = Join-Path $dir "actualizar.log"
$taskName = "OficinaVirtual-ActualizarDiario"

function Write-Log {
  param([string]$Message, [string]$Level = "INFO")
  $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  $prefix = "[$timestamp] [$Level]"
  $formatted = "$prefix $Message"
  
  if ($Level -eq "ERROR") {
    Write-Host $formatted -ForegroundColor Red
  } elseif ($Level -eq "WARN") {
    Write-Host $formatted -ForegroundColor Yellow
  } elseif ($Level -eq "SUCCESS") {
    Write-Host $formatted -ForegroundColor Green
  } else {
    Write-Host $formatted
  }
  
  try {
    Add-Content -Path $logFile -Value $formatted -Encoding UTF8 -ErrorAction SilentlyContinue
  } catch {}
}

# --- Modo Desinstalación de Tarea Programada ---
if ($DesinstalarTarea) {
  Write-Log "Desinstalando tarea programada '$taskName'..."
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
  Write-Log "Tarea programada '$taskName' desinstalada exitosamente." "SUCCESS"
  exit 0
}

# --- Modo Instalación de Tarea Programada ---
if ($InstalarTarea) {
  Write-Log "Registrando tarea programada diaria '$taskName' a las $Hora..."
  $scriptPath = $MyInvocation.MyCommand.Definition
  $action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$scriptPath`""
  $trigger = New-ScheduledTaskTrigger -Daily -At $Hora
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 2)
  Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Description "Actualizacion diaria de los 4 CLIs y modelos de Oficina Virtual" -Force | Out-Null
  Write-Log "Tarea programada registrada exitosamente. Se ejecutara diariamente a las $Hora." "SUCCESS"
  Write-Log "  Para probarla ahora: Start-ScheduledTask '$taskName'"
  Write-Log "  Para desinstalarla:  .\actualizar-diario.ps1 -DesinstalarTarea"
  exit 0
}

# --- Ejecución Principal ---
Write-Log "=========================================================="
Write-Log "INICIANDO ACTUALIZACION DIARIA DE OFICINA VIRTUAL"
Write-Log "Directorio de trabajo: $dir"
Write-Log "Log de salida: $logFile"

# ---------------------------------------------------------
# 1. ACTUALIZAR LOS 4 CLIS
# ---------------------------------------------------------
Write-Log "--- Paso 1: Actualizando los 4 CLIs en esta PC ---"

# 1.1 Claude Code
Write-Log "[1/4] Actualizando Claude Code CLI..."
if (Get-Command claude -ErrorAction SilentlyContinue) {
  try {
    $outClaude = & claude update 2>&1 | Out-String
    Write-Log "Claude Code:`n$($outClaude.Trim())" "SUCCESS"
  } catch {
    Write-Log "Error al ejecutar 'claude update': $_" "WARN"
  }
} else {
  Write-Log "Comando 'claude' no encontrado en PATH." "WARN"
}

# 1.2 Codex CLI
Write-Log "[2/4] Actualizando Codex CLI..."
if (Get-Command codex -ErrorAction SilentlyContinue) {
  try {
    $outCodex = & codex update 2>&1 | Out-String
    Write-Log "Codex CLI:`n$($outCodex.Trim())" "SUCCESS"
  } catch {
    Write-Log "Error al ejecutar 'codex update': $_" "WARN"
  }
} else {
  Write-Log "Comando 'codex' no encontrado en PATH." "WARN"
}

# 1.3 Antigravity CLI
Write-Log "[3/4] Actualizando Antigravity CLI (agy)..."
if (Get-Command agy -ErrorAction SilentlyContinue) {
  try {
    $outAgy = & agy update 2>&1 | Out-String
    Write-Log "Antigravity (agy):`n$($outAgy.Trim())" "SUCCESS"
  } catch {
    Write-Log "Error al ejecutar 'agy update': $_" "WARN"
  }
} else {
  Write-Log "Comando 'agy' no encontrado en PATH." "WARN"
}

# 1.4 CommandCode
Write-Log "[4/4] Actualizando CommandCode CLI (npm global)..."
$foundCmd = Get-Command npm.cmd, npm -ErrorAction SilentlyContinue | Select-Object -First 1
$npmCmd = if ($foundCmd) { $foundCmd.Source } else { $null }
if ($npmCmd) {
  try {
    $outCmd = & $npmCmd install -g command-code@latest 2>&1 | Out-String
    Write-Log "CommandCode (npm):`n$($outCmd.Trim())" "SUCCESS"
  } catch {
    Write-Log "Error al ejecutar '$npmCmd install -g command-code@latest': $_" "WARN"
  }
} else {
  Write-Log "Comando 'npm' no encontrado en PATH." "WARN"
}

# ---------------------------------------------------------
# 2. ACTUALIZAR MODELOS Y ESFUERZOS EN LA BASE DE DATOS
# ---------------------------------------------------------
Write-Log "--- Paso 2: Sincronizando modelos y esfuerzos de los 4 agentes ---"

$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
  Write-Log "Node.js no encontrado en PATH. No se puede sincronizar la base de datos." "ERROR"
  exit 1
}
$node = $nodeCmd.Source

$modelScript = Join-Path $dir "actualizar-modelos.js"
if (-not (Test-Path $modelScript)) {
  $resolved = Resolve-Path "actualizar-modelos.js" -ErrorAction SilentlyContinue
  if ($resolved) { $modelScript = $resolved.Path }
}

if ($modelScript -and (Test-Path $modelScript)) {
  try {
    Write-Log "Ejecutando script de sincronizacion: $modelScript"
    $outSync = & $node --no-warnings $modelScript 2>&1 | Out-String
    Write-Log "$($outSync.Trim())" "SUCCESS"
  } catch {
    Write-Log "Error al ejecutar '$modelScript': $_" "ERROR"
  }
} else {
  Write-Log "No se encontro el script 'actualizar-modelos.js'." "ERROR"
}

Write-Log "ACTUALIZACION DIARIA DE OFICINA VIRTUAL FINALIZADA" "SUCCESS"
Write-Log "=========================================================="
