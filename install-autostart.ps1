# NetWatch Server + Agent - Autostart einrichten
# Einmalig als Administrator ausfuehren:
#   Rechtsklick auf diese Datei -> "Als Administrator ausfuehren"

$serverTaskName = "NetWatch-Server"
$agentTaskName  = "NetWatch-Agent"
$scriptDir      = "C:\netwatch"
$batServer      = "$scriptDir\start-server.bat"
$batAgent       = "$scriptDir\start-agent.bat"

# Pruefen ob als Admin
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "FEHLER: Bitte als Administrator ausfuehren." -ForegroundColor Red
    Write-Host "Rechtsklick auf das Script -> Als Administrator ausfuehren" -ForegroundColor Yellow
    pause
    exit 1
}

# node.exe suchen
$nodeExe = "C:\Program Files\nodejs\node.exe"
if (-not (Test-Path $nodeExe)) {
    $found = Get-Command node -ErrorAction SilentlyContinue
    if ($found) { $nodeExe = $found.Source }
    else {
        Write-Host "FEHLER: node.exe nicht gefunden. Bitte Node.js installieren." -ForegroundColor Red
        pause
        exit 1
    }
}

# powershell.exe suchen
$psExe = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
if (-not (Test-Path $psExe)) { $psExe = "powershell.exe" }

Write-Host "Richte NetWatch Autostart ein..." -ForegroundColor Cyan
Write-Host "  Node:   $nodeExe"
Write-Host "  PS:     $psExe"
Write-Host "  Ordner: $scriptDir"

# --- start-server.bat ---
$s1 = "@echo off"
$s2 = "cd /d " + $scriptDir
$s3 = "`"" + $nodeExe + "`" server.js"
$serverBatContent = $s1 + "`r`n" + $s2 + "`r`n" + $s3 + "`r`n"
[System.IO.File]::WriteAllText($batServer, $serverBatContent, [System.Text.Encoding]::ASCII)
Write-Host "  Server-Wrapper: $batServer" -ForegroundColor Gray

# --- start-agent.bat ---
# Pruefe ob Hyper-V vorhanden
$hyperVFlag = ""
$hvService = Get-Service -Name vmms -ErrorAction SilentlyContinue
if ($hvService) { $hyperVFlag = " -HyperV" }

$a1 = "@echo off"
$a2 = "cd /d " + $scriptDir
$a3 = "`"" + $psExe + "`" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"" + $scriptDir + "\agents\agent.ps1`" -Server http://localhost:3000 -Type server" + $hyperVFlag
$agentBatContent = $a1 + "`r`n" + $a2 + "`r`n" + $a3 + "`r`n"
[System.IO.File]::WriteAllText($batAgent, $agentBatContent, [System.Text.Encoding]::ASCII)
Write-Host "  Agent-Wrapper:  $batAgent" -ForegroundColor Gray

# Alte Tasks entfernen
Unregister-ScheduledTask -TaskName $serverTaskName -Confirm:$false -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName $agentTaskName  -Confirm:$false -ErrorAction SilentlyContinue

$settings   = New-ScheduledTaskSettingsSet -RestartCount 10 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Hours 0) -StartWhenAvailable
$principal  = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
$trigger    = New-ScheduledTaskTrigger -AtStartup

# Server-Task
$serverArg    = '/c "' + $batServer + '"'
$serverAction = New-ScheduledTaskAction -Execute "cmd.exe" -Argument $serverArg
Register-ScheduledTask -TaskName $serverTaskName -Action $serverAction -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
Write-Host "  Task '$serverTaskName' angelegt." -ForegroundColor Gray

# Agent-Task (startet 15 Sekunden nach Boot, damit der Server zuerst hochkommt)
$agentTrigger       = New-ScheduledTaskTrigger -AtStartup
$agentTrigger.Delay = "PT15S"
$agentArg           = '/c "' + $batAgent + '"'
$agentAction        = New-ScheduledTaskAction -Execute "cmd.exe" -Argument $agentArg
$agentSettings      = New-ScheduledTaskSettingsSet -RestartCount 10 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Hours 0) -StartWhenAvailable
Register-ScheduledTask -TaskName $agentTaskName -Action $agentAction -Trigger $agentTrigger -Settings $agentSettings -Principal $principal -Force | Out-Null
Write-Host "  Task '$agentTaskName' angelegt (15s Verzoegerung)." -ForegroundColor Gray

Write-Host ""
Write-Host "Autostart eingerichtet!" -ForegroundColor Green

# Sofort starten
Write-Host "Starte Server..." -ForegroundColor Cyan
Start-ScheduledTask -TaskName $serverTaskName
Start-Sleep -Seconds 5

Write-Host "Starte Agent..." -ForegroundColor Cyan
Start-ScheduledTask -TaskName $agentTaskName
Start-Sleep -Seconds 8

# Pruefen ob Server antwortet
$ok = $false
try {
    $r = Invoke-WebRequest "http://localhost:3000/api/devices" -TimeoutSec 5 -UseBasicParsing
    $ok = $r.StatusCode -eq 200
} catch {}

if ($ok) {
    Write-Host "Server antwortet - laeuft!" -ForegroundColor Green
} else {
    $state = (Get-ScheduledTask -TaskName $serverTaskName).State
    Write-Host "Server-Task Status: $state" -ForegroundColor Yellow
    Write-Host "Server noch nicht erreichbar - bitte 10 Sekunden warten und Dashboard neu laden." -ForegroundColor Yellow
}

# Agent-Status pruefen
$agentState = (Get-ScheduledTask -TaskName $agentTaskName).State
Write-Host "Agent-Task Status:  $agentState" -ForegroundColor Yellow

# Eigene Netzwerk-IP ermitteln
$localIp = "localhost"
try {
    $sock = [System.Net.Sockets.UdpClient]::new()
    $sock.Connect("8.8.8.8", 80)
    $localIp = $sock.Client.LocalEndPoint.Address.ToString()
    $sock.Close()
} catch {}

$urlNet   = "http://" + $localIp + ":3000/netwatch-v3.html"
$urlAgent = "http://" + $localIp + ":3000"

Write-Host ""
Write-Host "Fertig! Server und Agent starten ab jetzt automatisch mit Windows." -ForegroundColor Green
Write-Host ""
Write-Host "Zugriff von diesem PC:    http://localhost:3000/netwatch-v3.html" -ForegroundColor Cyan
Write-Host "Zugriff aus dem Netzwerk: $urlNet" -ForegroundColor Cyan
Write-Host ""
Write-Host "Agents einrichten mit:    --server $urlAgent" -ForegroundColor Yellow
Write-Host ""
pause
