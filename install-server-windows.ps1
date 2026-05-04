# =============================================================
#  NetWatch Server – Windows Autostart Installer
#  Richtet den NetWatch-Server als unsichtbaren Hintergrunddienst
#  (Task Scheduler / SYSTEM) ein.
#
#  Als Administrator ausführen:
#    powershell -ExecutionPolicy Bypass -File install-server-windows.ps1
# =============================================================

$ErrorActionPreference = "Stop"

function Write-Ok   { param($m) Write-Host "[OK]    $m" -ForegroundColor Green }
function Write-Info { param($m) Write-Host "[INFO]  $m" -ForegroundColor Cyan }
function Write-Err  { param($m) Write-Host "[FEHLER] $m" -ForegroundColor Red; exit 1 }

Write-Host ""
Write-Host "+----------------------------------------------+" -ForegroundColor Cyan
Write-Host "|   NetWatch Server - Autostart Installer      |" -ForegroundColor Cyan
Write-Host "+----------------------------------------------+" -ForegroundColor Cyan
Write-Host ""

# ── Admin-Check ───────────────────────────────────────────────
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) { Write-Err "Bitte als Administrator ausfuehren (Rechtsklick -> Als Administrator)" }

# ── Node.js prüfen ────────────────────────────────────────────
$nodePath = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
if (-not $nodePath) { Write-Err "Node.js nicht gefunden. Bitte unter https://nodejs.org installieren." }
Write-Ok "Node.js gefunden: $nodePath"

# ── Installationsverzeichnis prüfen ──────────────────────────
$installDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not (Test-Path "$installDir\server.js")) { Write-Err "server.js nicht gefunden in $installDir" }
Write-Info "Server-Verzeichnis: $installDir"

# ── Bestehenden Task entfernen ────────────────────────────────
Unregister-ScheduledTask -TaskName "NetWatch-Server" -Confirm:$false -ErrorAction SilentlyContinue

# ── Task anlegen ──────────────────────────────────────────────
Write-Info "Lege Task Scheduler Aufgabe an..."

$action    = New-ScheduledTaskAction -Execute $nodePath -Argument "server.js" -WorkingDirectory $installDir
$trigger   = New-ScheduledTaskTrigger -AtStartup
$settings  = New-ScheduledTaskSettingsSet `
                 -ExecutionTimeLimit (New-TimeSpan -Hours 0) `
                 -RestartCount 10 `
                 -RestartInterval (New-TimeSpan -Minutes 1) `
                 -StartWhenAvailable
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -RunLevel Highest -LogonType ServiceAccount

Register-ScheduledTask -TaskName "NetWatch-Server" -Action $action -Trigger $trigger `
    -Settings $settings -Principal $principal -Description "NetWatch Dashboard Server" | Out-Null

Write-Ok "Task 'NetWatch-Server' angelegt (startet beim Boot, kein Fenster, SYSTEM)"

# ── Sofort starten ────────────────────────────────────────────
Write-Info "Starte Server..."
Start-ScheduledTask -TaskName "NetWatch-Server"
Start-Sleep -Seconds 5

$state = (Get-ScheduledTask -TaskName "NetWatch-Server").State
if ($state -eq "Running") {
    Write-Ok "Server läuft!"
} else {
    Write-Host "[WARN]  Server-Status: $state" -ForegroundColor Yellow
    Write-Host "        Prüfe: Get-ScheduledTask -TaskName NetWatch-Server" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "[OK] Fertig!" -ForegroundColor Green
Write-Host ""
Write-Host "  Dashboard:    http://localhost:3000"
Write-Host "  Status:       Get-ScheduledTask -TaskName NetWatch-Server"
Write-Host "  Neustart:     Restart-ScheduledTask -TaskName NetWatch-Server"
Write-Host "  Entfernen:    Unregister-ScheduledTask -TaskName NetWatch-Server -Confirm:`$false"
Write-Host ""
