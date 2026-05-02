# =============================================================
#  NetWatch Windows Agent v2.0
#  Sendet System-Metriken an den NetWatch-Server.
#
#  Schnellstart (interaktiv):
#    powershell -ExecutionPolicy Bypass -File agent.ps1 -Server http://192.168.1.100:3000
#
#  One-Liner Install (als Administrator):
#    iwr http://NETWATCH-SERVER:3000/install-windows.ps1 | iex
#
#  Parameter:
#    -Server      NetWatch-Server URL (Pflicht)
#    -Interval    Sendeintervall in Sekunden (Standard: 60)
#    -Site        Standort / Ebene 1 (Standard: Standort)
#    -Network     Netzwerk / Ebene 2 (Standard: Netzwerk)
#    -Group       Gruppe / Ebene 3 (Standard: Windows)
#    -Type        Gerätetyp: client|server|nas|switch|ap|usv|printer (Standard: client)
#    -Hostname    Hostname überschreiben
#    -HyperV      Hyper-V VMs mitschicken
#    -Services    Dienste überwachen, kommagetrennt (z.B. "Spooler,W32Time")
#    -LogFile     Pfad zur Logdatei (Standard: kein Log)
#    -Once        Einmalig senden, dann beenden
#    -Verbose     Ausführliche Ausgabe
# =============================================================
[CmdletBinding()]
param(
    [string]$Server   = "http://localhost:3000",
    [int]   $Interval = 60,
    [string]$Site     = "Standort",
    [string]$Network  = "Netzwerk",
    [string]$Group    = "Windows",
    [string]$Type     = "client",
    [string]$Hostname = "",
    [switch]$HyperV,
    [string]$Services = "",
    [string]$LogFile  = "",
    [switch]$Once,
    [switch]$VerboseLog
)

$VERSION = "2.0"
$ErrorActionPreference = "SilentlyContinue"

# ── Logging ──────────────────────────────────────────────────
function Write-Log {
    param([string]$Msg, [string]$Level = "INFO")
    $ts   = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $line = "[$ts] [$Level] $Msg"
    Write-Host $line
    if ($LogFile) { Add-Content -Path $LogFile -Value $line -ErrorAction SilentlyContinue }
}

# ── System-Informationen ──────────────────────────────────────
function Get-LocalIP {
    try {
        $sock = [System.Net.Sockets.UdpClient]::new()
        $sock.Connect("8.8.8.8", 80)
        $ip = ($sock.Client.LocalEndPoint).Address.ToString()
        $sock.Close()
        return $ip
    } catch {
        return (Get-NetIPAddress -AddressFamily IPv4 |
            Where-Object { $_.PrefixOrigin -ne 'WellKnown' } |
            Select-Object -First 1).IPAddress
    }
}

function Get-PrimaryMac {
    try {
        $ip = Get-LocalIP
        $idx = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -eq $ip } | Select-Object -First 1).InterfaceIndex
        if ($idx) {
            return (Get-NetAdapter | Where-Object { $_.InterfaceIndex -eq $idx } | Select-Object -First 1).MacAddress.Replace('-',':').ToUpper()
        }
    } catch {}
    return $null
}

function Get-OsInfo {
    $os = Get-CimInstance Win32_OperatingSystem
    return ($os.Caption -replace "Microsoft ", "") + " (Build $($os.BuildNumber))"
}

function Get-UptimeStr {
    $os  = Get-CimInstance Win32_OperatingSystem
    $u   = (Get-Date) - $os.LastBootUpTime
    if ($u.Days -gt 0)  { return "$($u.Days)d $($u.Hours)h" }
    if ($u.Hours -gt 0) { return "$($u.Hours)h $($u.Minutes)m" }
    return "$($u.Minutes)m"
}

# ── Metriken ─────────────────────────────────────────────────
function Get-CpuUsage {
    $c = Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average
    return [math]::Round($c.Average, 1)
}

function Get-MemUsage {
    $os   = Get-CimInstance Win32_OperatingSystem
    $used = $os.TotalVisibleMemorySize - $os.FreePhysicalMemory
    return [math]::Round($used / $os.TotalVisibleMemorySize * 100, 1)
}

function Get-MemTotalGB {
    $comp = Get-CimInstance Win32_ComputerSystem
    return [math]::Round($comp.TotalPhysicalMemory / 1GB, 1)
}

function Get-DiskUsage {
    $disk = Get-CimInstance Win32_LogicalDisk |
        Where-Object { $_.DriveType -eq 3 -and $_.Size -gt 0 } |
        Sort-Object Size -Descending | Select-Object -First 1
    if ($disk) { return [math]::Round(($disk.Size - $disk.FreeSpace) / $disk.Size * 100, 1) }
    return 0.0
}

function Get-DiskTotalGB {
    $disk = Get-CimInstance Win32_LogicalDisk |
        Where-Object { $_.DriveType -eq 3 -and $_.Size -gt 0 } |
        Sort-Object Size -Descending | Select-Object -First 1
    if ($disk) { return [math]::Round($disk.Size / 1GB, 1) }
    return 0.0
}

function Get-CpuTemp {
    # MSAcpi_ThermalZoneTemperature (Kelvin × 10 → Celsius)
    try {
        $t = Get-CimInstance -Namespace "root/wmi" -ClassName MSAcpi_ThermalZoneTemperature |
             Select-Object -First 1
        if ($t) { return [math]::Round(($t.CurrentTemperature / 10) - 273.15, 1) }
    } catch {}
    return $null
}

function Get-SmartHealth {
    # SMART-Status über WMI
    $disks = @()
    try {
        Get-CimInstance -Namespace "root/wmi" -ClassName MSStorageDriver_FailurePredictStatus |
        ForEach-Object {
            $disks += @{
                healthy = -not $_.PredictFailure
                reason  = if ($_.PredictFailure) { "Failure predicted" } else { "OK" }
            }
        }
    } catch {}
    # Fallback: Win32_DiskDrive Status
    if (-not $disks.Count) {
        Get-CimInstance Win32_DiskDrive | ForEach-Object {
            $disks += @{ healthy = ($_.Status -eq "OK"); reason = $_.Status }
        }
    }
    return $disks
}

function Get-BatteryInfo {
    try {
        $bat = Get-CimInstance Win32_Battery | Select-Object -First 1
        if ($bat) {
            return @{
                charge_pct    = $bat.EstimatedChargeRemaining
                status        = switch ($bat.BatteryStatus) {
                    1 { "discharging" }; 2 { "AC + charging" }; 3 { "fully charged" }
                    4 { "low" }; 5 { "critical" }; 7 { "AC power" }; default { "unknown" }
                }
                runtime_min   = $bat.EstimatedRunTime
            }
        }
    } catch {}
    return $null
}

function Get-OpenPorts {
    try {
        $known = @(22,80,443,3306,3389,5432,6379,8080,8443,27017)
        $ports = (Get-NetTCPConnection -State Listen).LocalPort | Sort-Object -Unique
        return @($ports | Where-Object { $_ -in $known -or $_ -lt 1024 } | Select-Object -First 20)
    } catch { return @() }
}

function Get-LoadAvgPct {
    try {
        $c = Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average
        return [math]::Round($c.Average, 1)
    } catch { return $null }
}

function Get-ServiceStatus {
    param([string[]]$Names)
    $result = @()
    foreach ($n in $Names) {
        $s = Get-Service -Name $n.Trim()
        if ($s) { $result += "$( if($s.Status -eq 'Running'){'[OK]'}else{'[ERR]'} )$($s.DisplayName)" }
    }
    return $result
}

function Get-HyperVData {
    try {
        return @(Get-VM | Select-Object @(
            @{N='name'; E={$_.Name}},
            @{N='state';E={$_.State.ToString().ToLower()}},
            @{N='cpu';  E={$_.CPUUsage}},
            @{N='mem_gb';E={[math]::Round($_.MemoryAssigned/1GB,2)}}
        ))
    } catch { return @() }
}

function Get-AutoTags {
    $tags = @()
    $os   = Get-CimInstance Win32_OperatingSystem
    if ($os.Caption -match "Server 2025") { $tags += "WS2025" }
    elseif ($os.Caption -match "Server 2022") { $tags += "WS2022" }
    elseif ($os.Caption -match "Server 2019") { $tags += "WS2019" }
    elseif ($os.Caption -match "Server 2016") { $tags += "WS2016" }
    elseif ($os.Caption -match "Windows 11")  { $tags += "Win11" }
    elseif ($os.Caption -match "Windows 10")  { $tags += "Win10" }
    $comp = Get-CimInstance Win32_ComputerSystem
    if ($comp.PartOfDomain) { $tags += "Domain:$($comp.Domain.Split('.')[0])" }
    $ramGB = [math]::Round($comp.TotalPhysicalMemory / 1GB)
    $tags += "${ramGB}GB-RAM"
    # CPU-Kerne
    $cores = (Get-CimInstance Win32_Processor | Measure-Object -Property NumberOfCores -Sum).Sum
    $tags += "${cores}Cores"
    return $tags
}

# ── Daten sammeln & senden ────────────────────────────────────
function Collect-And-Send {
    $hn    = if ($Hostname) { $Hostname } else { $env:COMPUTERNAME }
    $ip    = Get-LocalIP
    $cpu   = Get-CpuUsage
    $mem   = Get-MemUsage
    $disk  = Get-DiskUsage
    $up    = Get-UptimeStr
    $temp  = Get-CpuTemp
    $ports = Get-OpenPorts
    $smart = Get-SmartHealth
    $batt  = Get-BatteryInfo
    $tags  = Get-AutoTags

    # Service-Tags
    if ($Services) {
        $svcNames = $Services -split ","
        $tags += Get-ServiceStatus $svcNames
    }

    $extra = @{
        temperature   = $temp
        cpu_count     = (Get-CimInstance Win32_Processor).NumberOfLogicalProcessors
        cpu_physical  = (Get-CimInstance Win32_Processor | Measure-Object -Property NumberOfCores -Sum).Sum
        mem_total_gb  = Get-MemTotalGB
        disk_total_gb = Get-DiskTotalGB
        open_ports    = $ports
        agent_version = "win-$VERSION"
        smart_disks   = $smart
        battery       = $batt
        load_avg_pct  = Get-LoadAvgPct
    }

    $payload = @{
        hostname = $hn
        ip       = $ip
        mac      = Get-PrimaryMac
        os       = Get-OsInfo
        type     = $Type
        path_l1  = $Site
        path_l2  = $Network
        path_l3  = $Group
        cpu      = $cpu
        mem      = $mem
        disk     = $disk
        ping     = $null
        uptime   = $up
        tags     = $tags
        extra    = $extra
    }

    if ($HyperV) { $payload.vms = Get-HyperVData }

    $json = $payload | ConvertTo-Json -Depth 6 -Compress
    $url  = "$($Server.TrimEnd('/'))/api/data"

    try {
        $resp = Invoke-RestMethod -Uri $url -Method POST -Body $json `
                    -ContentType "application/json" -TimeoutSec 10
        Write-Log "[OK] CPU:${cpu}%  RAM:${mem}%  Disk:${disk}%  Up:${up}$(if($temp){`"  Temp:${temp} C`"}else{''})"
        if ($VerboseLog) { Write-Log "Server: $($resp | ConvertTo-Json -Compress)" }
    } catch {
        Write-Log "FEHLER beim Senden: $($_.Exception.Message)" -Level "WARN"
    }
}

# ── Hauptschleife ─────────────────────────────────────────────
$hn = if ($Hostname) { $Hostname } else { $env:COMPUTERNAME }
Write-Log "NetWatch Windows Agent v$VERSION -- $hn -> $Server"
Write-Log "Intervall: ${Interval}s | Typ: $Type | Site: $Site"

while ($true) {
    Collect-And-Send
    if ($Once) { break }
    Start-Sleep -Seconds $Interval
}
