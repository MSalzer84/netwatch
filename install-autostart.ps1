# NetWatch Server - Autostart einrichten
# Einmalig als Administrator ausfuehren:
#   Rechtsklick auf diese Datei -> "Als Administrator ausfuehren"

$taskName  = "NetWatch-Server"
$scriptDir = "C:\netwatch"
$batPath   = "$scriptDir\start-server.bat"

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

Write-Host "Richte NetWatch Autostart ein..." -ForegroundColor Cyan
Write-Host "  Node:   $nodeExe"
Write-Host "  Ordner: $scriptDir"

# Batch-Wrapper erstellen - stellt sicher dass Verzeichnis und PATH stimmen
$line1 = "@echo off"
$line2 = "cd /d " + $scriptDir
$line3 = "`"" + $nodeExe + "`" server.js"
$batContent = $line1 + "`r`n" + $line2 + "`r`n" + $line3 + "`r`n"
[System.IO.File]::WriteAllText($batPath, $batContent, [System.Text.Encoding]::ASCII)
Write-Host "  Wrapper: $batPath" -ForegroundColor Gray

# Alten Task entfernen
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue

# Task erstellen
$batArg    = '/c "' + $batPath + '"'
$action    = New-ScheduledTaskAction -Execute "cmd.exe" -Argument $batArg
$trigger   = New-ScheduledTaskTrigger -AtStartup
$settings  = New-ScheduledTaskSettingsSet -RestartCount 10 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Hours 0) -StartWhenAvailable $true
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null

Write-Host "Autostart eingerichtet!" -ForegroundColor Green

# Sofort starten
Write-Host "Starte Server..." -ForegroundColor Cyan
Start-ScheduledTask -TaskName $taskName
Start-Sleep -Seconds 4

# Pruefen ob Server antwortet
$ok = $false
try {
    $r = Invoke-WebRequest "http://localhost:3000/api/devices" -TimeoutSec 5 -UseBasicParsing
    $ok = $r.StatusCode -eq 200
} catch {}

if ($ok) {
    Write-Host "Server antwortet - laeuft!" -ForegroundColor Green
} else {
    $state = (Get-ScheduledTask -TaskName $taskName).State
    Write-Host "Task-Status: $state" -ForegroundColor Yellow
    Write-Host "Server noch nicht erreichbar - bitte 10 Sekunden warten und Dashboard neu laden." -ForegroundColor Yellow
}

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
Write-Host "Fertig! Der NetWatch-Server startet ab jetzt automatisch mit Windows." -ForegroundColor Green
Write-Host ""
Write-Host "Zugriff von diesem PC:    http://localhost:3000/netwatch-v3.html" -ForegroundColor Cyan
Write-Host "Zugriff aus dem Netzwerk: $urlNet" -ForegroundColor Cyan
Write-Host ""
Write-Host "Agents einrichten mit:    --server $urlAgent" -ForegroundColor Yellow
Write-Host ""
pause
