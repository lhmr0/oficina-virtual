# Instala el agente de campo para que arranque solo al iniciar sesión en esta PC (tarea programada, ventana oculta).
# Requisito: worker.json junto a worker.js con {"url": "https://ua.csjla.pe", "token": "...", "roots": ["C:\Users\TU_USUARIO"]}
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not (Test-Path "$dir\worker.json")) { Write-Error "Falta $dir\worker.json"; exit 1 }
$node = (Get-Command node).Source
$cmd = "Set-Location '$dir'; while (`$true) { & '$node' --no-warnings worker.js *>> '$dir\worker.log'; Start-Sleep 5 }"
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -WindowStyle Hidden -Command `"$cmd`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit 0 -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName 'OficinaVirtual-Agente' -Action $action -Trigger $trigger -Settings $settings -Description 'Agente de campo de la Oficina Virtual' -Force | Out-Null
Start-ScheduledTask -TaskName 'OficinaVirtual-Agente'
Write-Host "Agente instalado y en marcha. Log: $dir\worker.log  ·  Desinstalar: Unregister-ScheduledTask OficinaVirtual-Agente"
