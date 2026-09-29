# Instala el agente de campo para que arranque solo al iniciar sesión y al arrancar Windows, y se autorrecupere si se detiene
# (tarea programada, ventana oculta, log en UTF-8).
# Requisito: worker.json junto a worker.js con {"url": "https://ua.csjla.pe", "token": "...", "roots": ["C:\Users\TU_USUARIO"]}
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not (Test-Path "$dir\worker.json")) { Write-Error "Falta $dir\worker.json"; exit 1 }
$node = (Get-Command node).Source
# log en UTF-8: el `*>>` de PowerShell 5.1 escribía UTF-16 y dejaba el archivo ilegible
$cmd = "Set-Location '$dir'; while (`$true) { & '$node' --no-warnings worker.js 2>&1 | Out-File -LiteralPath '$dir\worker.log' -Append -Encoding utf8; Start-Sleep 5 }"
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -WindowStyle Hidden -Command `"$cmd`""
# se autorrecupera: al iniciar sesión reintenta cada 5 min (una terminación 0x40010004 no dispara
# RestartCount, así que la repetición hace de vigilante sin duplicar instancias).
# El trigger de arranque de Windows (-AtStartup) necesita el script ejecutado como administrador.
$tLogon = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$tLogon.Repetition = (New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 5) -RepetitionDuration ([TimeSpan]::FromDays(3650))).Repetition
$tStartup = New-ScheduledTaskTrigger -AtStartup
$tStartup.Repetition = (New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 5) -RepetitionDuration ([TimeSpan]::FromDays(3650))).Repetition
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 0) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)
try { Register-ScheduledTask -TaskName 'OficinaVirtual-Agente' -Action $action -Trigger @($tLogon, $tStartup) -Settings $settings -Description 'Agente de campo de la Oficina Virtual' -Force -ErrorAction Stop | Out-Null }
catch {
  Write-Warning "Sin privilegios para el arranque automatico de Windows; se registra solo al inicio de sesion. Ejecuta como administrador para incluirlo."
  Register-ScheduledTask -TaskName 'OficinaVirtual-Agente' -Action $action -Trigger $tLogon -Settings $settings -Description 'Agente de campo de la Oficina Virtual' -Force | Out-Null
}
Start-ScheduledTask -TaskName 'OficinaVirtual-Agente'
Write-Host "Agente instalado y en marcha (se autorrecupera). Log: $dir\worker.log  ·  Desinstalar: Unregister-ScheduledTask OficinaVirtual-Agente"
