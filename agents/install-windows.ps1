# =============================================================
#  NetWatch Windows Agent – Installer
#  Als Administrator ausführen:
#    iwr http://NETWATCH-SERVER:3000/install-windows.ps1 | iex
#  oder mit Optionen:
#    $env:NW_SERVER="http://192.168.1.100:3000"
#    $env:NW_SITE="Wien HQ"
#    $env:NW_NETWORK="Bueronetz"
#    $env:NW_GROUP="Windows-PCs"
#    iwr http://NETWATCH-SERVER:3000/install-windows.ps1 | iex
# =============================================================
param(
    [string]$Server   = $env:NW_SERVER,
    [string]$Site     = ($env:NW_SITE    -or "Standort"),
    [string]$Network  = ($env:NW_NETWORK -or "Netzwerk"),
    [string]$Group    = ($env:NW_GROUP   -or "Windows"),
    [string]$Type     = ($env:NW_TYPE    -or "client"),
    [int]   $Interval = [int]($env:NW_INTERVAL -or 60)
)

$ErrorActionPreference = "Stop"

function Write-Ok   { param($m) Write-Host "[OK]    $m" -ForegroundColor Green }
function Write-Info { param($m) Write-Host "[INFO]  $m" -ForegroundColor Cyan }
function Write-Warn { param($m) Write-Host "[WARN]  $m" -ForegroundColor Yellow }
function Write-Err  { param($m) Write-Host "[FEHLER] $m" -ForegroundColor Red; exit 1 }

Write-Host ""
Write-Host "+----------------------------------------------+" -ForegroundColor Cyan
Write-Host "|    NetWatch Windows Agent - Installer        |" -ForegroundColor Cyan
Write-Host "+----------------------------------------------+" -ForegroundColor Cyan
Write-Host ""

# ── Admin-Check ───────────────────────────────────────────────
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) { Write-Err "Bitte als Administrator ausfuehren (Rechtsklick -> Als Administrator)" }

# ── Server-URL ermitteln ──────────────────────────────────────
if (-not $Server) {
    $Server = Read-Host "NetWatch Server-URL (z.B. http://192.168.1.100:3000)"
}
if (-not $Server) { Write-Err "Keine Server-URL angegeben" }
$Server = $Server.TrimEnd("/")
Write-Info "Server: $Server"

# ── Installationsverzeichnis ──────────────────────────────────
$InstDir = "C:\NetWatch"
New-Item -ItemType Directory -Force -Path $InstDir | Out-Null
Write-Info "Installationsverzeichnis: $InstDir"

# ── Agent herunterladen ───────────────────────────────────────
Write-Info "Lade agent.ps1 herunter..."
try {
    Invoke-WebRequest -Uri "$Server/agents/agent.ps1" -OutFile "$InstDir\agent.ps1" -UseBasicParsing
    Write-Ok "Agent nach $InstDir\agent.ps1 heruntergeladen"
} catch {
    Write-Err "Download fehlgeschlagen: $_`nIst der NetWatch-Server erreichbar?"
}

# ── Task Scheduler Aufgabe anlegen ────────────────────────────
Write-Info "Lege Task Scheduler Aufgabe an..."

$taskName = "NetWatchAgent"
$taskArgs  = "-NonInteractive -ExecutionPolicy Bypass -File `"$InstDir\agent.ps1`""
$taskArgs += " -Server `"$Server`" -Interval $Interval"
$taskArgs += " -Site `"$Site`" -Network `"$Network`" -Group `"$Group`" -Type $Type"
$taskArgs += " -LogFile `"$InstDir\agent.log`""

# Alte Aufgabe entfernen falls vorhanden
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue

$action  = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $taskArgs
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings= New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Hours 0) `
               -RestartCount 10 -RestartInterval (New-TimeSpan -Minutes 1) `
               -StartWhenAvailable
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -RunLevel Highest -LogonType ServiceAccount

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger `
    -Settings $settings -Principal $principal -Description "NetWatch Monitoring Agent" | Out-Null

Write-Ok "Task Scheduler Aufgabe '$taskName' angelegt (startet beim Boot als SYSTEM)"

# ── Sofort starten ────────────────────────────────────────────
Write-Info "Starte Agent..."
Start-ScheduledTask -TaskName $taskName
Start-Sleep -Seconds 3

$state = (Get-ScheduledTask -TaskName $taskName).State
if ($state -eq "Running") {
    Write-Ok "Agent läuft!"
} else {
    Write-Warn "Agent-Status: $state - prüfe Logs: $InstDir\agent.log"
}

# ── Abschluss ─────────────────────────────────────────────────
Write-Host ""
Write-Host "[OK] Installation abgeschlossen!" -ForegroundColor Green
Write-Host ""
Write-Host "  Agent-Script:  $InstDir\agent.ps1"
Write-Host "  Log-Datei:     $InstDir\agent.log"
Write-Host "  Task-Status:   Get-ScheduledTask NetWatchAgent"
Write-Host "  Neustart:      Start-ScheduledTask NetWatchAgent"
Write-Host "  Entfernen:     Unregister-ScheduledTask NetWatchAgent -Confirm:`$false"
Write-Host ""
Write-Host "  Das Gerät erscheint in Kürze im NetWatch Dashboard."
Write-Host ""
