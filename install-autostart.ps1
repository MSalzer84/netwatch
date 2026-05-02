# NetWatch Server — Autostart einrichten
# Einmalig als Administrator ausfuehren:
#   Rechtsklick auf diese Datei -> "Als Administrator ausfuehren"

$taskName  = "NetWatch-Server"
$nodeExe   = "C:\Program Files\nodejs\node.exe"
$scriptDir = "C:\netwatch"
$scriptJs  = "server.js"

# Pruefen ob als Admin
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "FEHLER: Bitte als Administrator ausfuehren." -ForegroundColor Red
    Write-Host "Rechtsklick auf das Script -> 'Als Administrator ausfuehren'" -ForegroundColor Yellow
    pause
    exit 1
}

# node.exe suchen falls nicht am Standardpfad
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

# Alten Task entfernen falls vorhanden
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue

# Task erstellen
$action   = New-ScheduledTaskAction -Execute $nodeExe -Argument $scriptJs -WorkingDirectory $scriptDir
$trigger  = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Hours 0)
$principal= New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null

Write-Host "Autostart eingerichtet!" -ForegroundColor Green

# Sofort starten
Write-Host "Starte Server..." -ForegroundColor Cyan
Start-ScheduledTask -TaskName $taskName
Start-Sleep -Seconds 2

$state = (Get-ScheduledTask -TaskName $taskName).State
Write-Host "Task-Status: $state" -ForegroundColor $(if ($state -eq 'Running') { 'Green' } else { 'Yellow' })
Write-Host ""
Write-Host "Fertig! Der NetWatch-Server startet ab jetzt automatisch mit Windows." -ForegroundColor Green
Write-Host "Dashboard: http://localhost:3000/netwatch-v3.html" -ForegroundColor Cyan
Write-Host ""
pause
