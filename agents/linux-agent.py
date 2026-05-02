#!/usr/bin/env python3
"""
NetWatch Linux Agent v1.0
Sendet System-Metriken an den NetWatch-Server.

Schnellstart:
  pip3 install psutil requests
  python3 linux-agent.py --server http://192.168.1.100:3000

Als systemd-Dienst:
  sudo python3 linux-agent.py --install --server http://192.168.1.100:3000
"""

import os
import sys
import time
import socket
import platform
import subprocess
import argparse
import logging
import json
import signal
import shutil

# ── Abhängigkeiten prüfen ──────────────────────────────────────
try:
    import psutil
except ImportError:
    print("[FEHLER] psutil fehlt — bitte installieren: pip3 install psutil requests")
    sys.exit(1)
try:
    import requests
except ImportError:
    print("[FEHLER] requests fehlt — bitte installieren: pip3 install psutil requests")
    sys.exit(1)

# ── Konstanten ─────────────────────────────────────────────────
VERSION          = "1.0"
DEFAULT_INTERVAL = 60
DEFAULT_TIMEOUT  = 10
SYSTEMD_UNIT     = "/etc/systemd/system/netwatch-agent.service"
INSTALL_PATH     = "/opt/netwatch/linux-agent.py"

# ── Logging ────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("netwatch")

# ──────────────────────────────────────────────────────────────
# SYSTEM-INFORMATIONEN
# ──────────────────────────────────────────────────────────────

def get_hostname():
    return socket.gethostname().split(".")[0].upper()

def get_ip():
    """Liefert die primäre IP-Adresse (die Route nach außen nimmt)."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(1)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "unbekannt"

def get_mac():
    """Liefert die MAC-Adresse des primären Netzwerk-Interfaces."""
    try:
        primary_ip = get_ip()
        for _, addrs in psutil.net_if_addrs().items():
            ipv4s = [a.address for a in addrs if a.family == socket.AF_INET]
            if primary_ip in ipv4s:
                for a in addrs:
                    if a.family == psutil.AF_LINK:
                        mac = a.address.upper().replace('-', ':')
                        if mac and mac != '00:00:00:00:00:00':
                            return mac
    except Exception:
        pass
    return None

def get_os_info():
    """Liest /etc/os-release für Distro-Name und Version."""
    try:
        info = {}
        with open("/etc/os-release") as f:
            for line in f:
                k, _, v = line.strip().partition("=")
                info[k] = v.strip('"')
        return info.get("PRETTY_NAME") or f"{info.get('NAME','')} {info.get('VERSION_ID','')}".strip()
    except Exception:
        return f"{platform.system()} {platform.release()}"

def get_uptime():
    """Uptime als lesbarer String: '3d 4h', '2h 15m', '45m'."""
    seconds = time.time() - psutil.boot_time()
    d = int(seconds // 86400)
    h = int((seconds % 86400) // 3600)
    m = int((seconds % 3600) // 60)
    if d > 0: return f"{d}d {h}h"
    if h > 0: return f"{h}h {m}m"
    return f"{m}m"

# ──────────────────────────────────────────────────────────────
# METRIKEN
# ──────────────────────────────────────────────────────────────

def get_cpu():
    """CPU-Auslastung in % (1-Sekunden-Messung)."""
    return round(psutil.cpu_percent(interval=1), 1)

def get_mem():
    """RAM-Auslastung in %."""
    return round(psutil.virtual_memory().percent, 1)

def get_disk(path="/"):
    """Disk-Auslastung für angegebenen Mount-Punkt in %."""
    try:
        return round(psutil.disk_usage(path).percent, 1)
    except Exception:
        return 0.0

def get_load_pct():
    """Load-Average (1min) normiert auf CPU-Anzahl, als % zurück."""
    try:
        load1 = os.getloadavg()[0]
        cpus  = psutil.cpu_count(logical=True) or 1
        return round(load1 / cpus * 100, 1)
    except Exception:
        return None

def get_temperature():
    """
    Liest CPU-Temperatur aus Kernel-Sensoren.
    Unterstützt: Intel (coretemp), AMD (k10temp), Raspberry Pi (cpu_thermal),
                 ACPI (acpitz), Banana Pi / Orange Pi (SoC-Sensoren).
    """
    try:
        temps = psutil.sensors_temperatures()
        if not temps:
            return None
        # Priorisierte Sensor-Schlüssel
        for key in ("coretemp", "k10temp", "cpu_thermal", "cpu-thermal",
                    "soc_thermal", "acpitz", "nct6775", "it8728"):
            if key in temps:
                readings = [t.current for t in temps[key] if 0 < t.current < 120]
                if readings:
                    return round(sum(readings) / len(readings), 1)
        # Fallback: erster verfügbarer Sensor
        for entries in temps.values():
            vals = [t.current for t in entries if 0 < t.current < 120]
            if vals:
                return round(sum(vals) / len(vals), 1)
    except Exception:
        pass
    return None

def get_smart_health():
    """SMART-Status aller Festplatten via smartctl (falls installiert)."""
    if not shutil.which("smartctl"):
        return []
    disks = []
    try:
        r = subprocess.run(["smartctl", "--scan"], capture_output=True, text=True, timeout=5)
        for line in r.stdout.splitlines():
            dev = line.split()[0] if line else None
            if not dev:
                continue
            try:
                s = subprocess.run(
                    ["smartctl", "-H", "-A", dev],
                    capture_output=True, text=True, timeout=5
                )
                health = "PASSED" if "PASSED" in s.stdout else ("FAILED" if "FAILED" in s.stdout else "UNKNOWN")
                # Reallocated sectors + temperature from SMART attributes
                realloc, temp_smart = None, None
                for attr_line in s.stdout.splitlines():
                    parts = attr_line.split()
                    if len(parts) >= 10:
                        if parts[0] == "5":   # Reallocated_Sector_Ct
                            try: realloc = int(parts[9])
                            except: pass
                        if parts[0] == "190" or parts[0] == "194":  # Airflow/HDD Temp
                            try: temp_smart = int(parts[9])
                            except: pass
                disks.append({
                    "device":  dev,
                    "healthy": health == "PASSED",
                    "reason":  health,
                    "reallocated_sectors": realloc,
                    "temp_c":  temp_smart,
                })
            except Exception:
                pass
    except Exception:
        pass
    return disks

def get_battery_info():
    """Akku-Informationen (Laptops / USV mit APC-daemon)."""
    try:
        bat = psutil.sensors_battery()
        if bat:
            return {
                "charge_pct":  round(bat.percent, 1),
                "status":      "charging" if bat.power_plugged else "discharging",
                "runtime_min": int(bat.secsleft / 60) if bat.secsleft and bat.secsleft != psutil.POWER_TIME_UNLIMITED else None,
            }
    except Exception:
        pass
    return None

def get_network_io():
    """Netzwerk-Durchsatz (Bytes gesamt seit Boot)."""
    try:
        io = psutil.net_io_counters()
        return {"bytes_sent": io.bytes_sent, "bytes_recv": io.bytes_recv,
                "packets_sent": io.packets_sent, "packets_recv": io.packets_recv}
    except Exception:
        return {}

def calc_bandwidth_kbps(prev_io, curr_io, elapsed_sec):
    """Berechnet Bandbreite in kbps aus Delta der Byte-Zähler."""
    if not prev_io or elapsed_sec <= 0:
        return None, None
    try:
        d_recv = curr_io.get("bytes_recv", 0) - prev_io.get("bytes_recv", 0)
        d_sent = curr_io.get("bytes_sent", 0) - prev_io.get("bytes_sent", 0)
        # Zähler-Überlauf abfangen
        if d_recv < 0: d_recv = 0
        if d_sent < 0: d_sent = 0
        in_kbps  = round(d_recv * 8 / elapsed_sec / 1000)
        out_kbps = round(d_sent * 8 / elapsed_sec / 1000)
        return in_kbps, out_kbps
    except Exception:
        return None, None

def get_open_ports(common_only=True):
    """Gibt lauschende TCP-Ports zurück."""
    try:
        ports = set()
        for conn in psutil.net_connections(kind="tcp"):
            if conn.status == "LISTEN" and conn.laddr:
                ports.add(conn.laddr.port)
        if common_only:
            known = {22,80,443,3306,5432,6379,8080,8443,9000,27017}
            ports = ports & known | {p for p in ports if p < 1024}
        return sorted(ports)[:20]
    except Exception:
        return []

# ──────────────────────────────────────────────────────────────
# DOCKER
# ──────────────────────────────────────────────────────────────

def get_docker_containers():
    """
    Liest laufende Docker-Container aus.
    Gibt Liste von Dicts zurück: name, state, image, cpu_pct, mem_mb.
    """
    if not shutil.which("docker"):
        return []
    try:
        # Container-Liste
        r = subprocess.run(
            ["docker", "ps", "-a", "--format",
             "{{.Names}}\t{{.Status}}\t{{.Image}}\t{{.ID}}"],
            capture_output=True, text=True, timeout=5
        )
        if r.returncode != 0:
            return []

        containers = []
        for line in r.stdout.strip().splitlines():
            if not line:
                continue
            parts = line.split("\t")
            if len(parts) < 4:
                continue
            name, status, image, cid = parts
            running = status.lower().startswith("up")

            # CPU/RAM für laufende Container via docker stats
            cpu_pct, mem_mb = 0.0, 0.0
            if running:
                try:
                    s = subprocess.run(
                        ["docker", "stats", "--no-stream", "--format",
                         "{{.CPUPerc}}\t{{.MemUsage}}", cid],
                        capture_output=True, text=True, timeout=5
                    )
                    if s.returncode == 0:
                        parts2 = s.stdout.strip().split("\t")
                        if len(parts2) >= 2:
                            cpu_pct = float(parts2[0].replace("%","").strip() or 0)
                            mem_str = parts2[1].split("/")[0].strip()
                            if "GiB" in mem_str:
                                mem_mb = float(mem_str.replace("GiB","").strip()) * 1024
                            elif "MiB" in mem_str:
                                mem_mb = float(mem_str.replace("MiB","").strip())
                            elif "kB" in mem_str:
                                mem_mb = float(mem_str.replace("kB","").strip()) / 1024
                except Exception:
                    pass

            containers.append({
                "name":   name,
                "state":  "running" if running else "stopped",
                "cpu":    round(cpu_pct, 1),
                "mem_gb": round(mem_mb / 1024, 2),
                "image":  image,
            })
        return containers
    except Exception:
        return []

# ──────────────────────────────────────────────────────────────
# SYSTEMD-DIENSTE
# ──────────────────────────────────────────────────────────────

def get_service_status(services):
    """Prüft Status von systemd-Diensten."""
    result = {}
    if not shutil.which("systemctl"):
        return result
    for svc in services:
        try:
            r = subprocess.run(
                ["systemctl", "is-active", svc],
                capture_output=True, text=True, timeout=3
            )
            result[svc] = r.stdout.strip()  # "active" | "inactive" | "failed"
        except Exception:
            result[svc] = "unknown"
    return result

# ──────────────────────────────────────────────────────────────
# PAYLOAD ZUSAMMENSTELLEN
# ──────────────────────────────────────────────────────────────

def collect(args, bw_in_kbps=None, bw_out_kbps=None):
    """Sammelt alle Metriken und baut den NetWatch-Payload."""
    cpu    = get_cpu()
    mem    = get_mem()
    disk   = get_disk(args.disk_path)
    temp   = get_temperature()
    load   = get_load_pct()
    uptime = get_uptime()
    ports  = get_open_ports()
    smart  = get_smart_health()
    batt   = get_battery_info()

    tags = list(args.tags) if args.tags else []

    # Automatische Tags
    if temp is not None:
        tags.append(f"Temp:{temp}°C")
    if ports:
        tags += [f":{p}" for p in ports[:5]]  # erste 5 Ports als Tags

    payload = {
        "hostname": args.hostname or get_hostname(),
        "ip":       args.ip       or get_ip(),
        "mac":      get_mac(),
        "os":       get_os_info(),
        "type":     args.type,
        "path_l1":  args.site,
        "path_l2":  args.network,
        "path_l3":  args.group,
        "cpu":      cpu,
        "mem":      mem,
        "disk":     disk,
        "uptime":   uptime,
        "ping":     None,
        "tags":     list(dict.fromkeys(tags)),  # Duplikate entfernen, Reihenfolge beibehalten
        "extra": {
            "temperature":   temp,
            "load_avg_pct":  load,
            "cpu_count":     psutil.cpu_count(logical=True),
            "cpu_physical":  psutil.cpu_count(logical=False),
            "mem_total_gb":  round(psutil.virtual_memory().total / 1e9, 1),
            "disk_total_gb": round(psutil.disk_usage(args.disk_path).total / 1e9, 1),
            "open_ports":    ports,
            "smart_disks":   smart,
            "battery":       batt,
            "bw_in_kbps":    bw_in_kbps,
            "bw_out_kbps":   bw_out_kbps,
            "agent_version": VERSION,
        },
    }

    # Docker-Container
    if args.docker:
        containers = get_docker_containers()
        if containers:
            payload["vms"] = [
                {"name": c["name"], "state": c["state"],
                 "cpu": c["cpu"],   "mem_gb": c["mem_gb"]}
                for c in containers
            ]
            log.debug(f"Docker: {len(containers)} Container gefunden")

    # Systemd-Dienste als Tags
    if args.services:
        svc_status = get_service_status(args.services)
        for svc, state in svc_status.items():
            clr = "✓" if state == "active" else "✗"
            payload["tags"].append(f"{clr}{svc}")

    return payload

# ──────────────────────────────────────────────────────────────
# SENDEN
# ──────────────────────────────────────────────────────────────

_retry_delay = 5   # Sekunden bis zum nächsten Retry

def send(payload, server, timeout):
    global _retry_delay
    url = f"{server.rstrip('/')}/api/data"
    try:
        r = requests.post(url, json=payload, timeout=timeout)
        r.raise_for_status()
        _retry_delay = 5  # zurücksetzen bei Erfolg
        return True
    except requests.exceptions.ConnectionError:
        log.warning(f"Keine Verbindung zu {server} — nächster Versuch in {_retry_delay}s")
    except requests.exceptions.Timeout:
        log.warning(f"Timeout ({timeout}s) — Server zu langsam?")
    except requests.exceptions.HTTPError as e:
        log.warning(f"HTTP {e.response.status_code}: {e.response.text[:200]}")
    except Exception as e:
        log.error(f"Unbekannter Fehler: {e}")
    _retry_delay = min(_retry_delay * 2, 300)  # exponentieller Backoff, max 5min
    return False

# ──────────────────────────────────────────────────────────────
# SYSTEMD-INSTALLATION
# ──────────────────────────────────────────────────────────────

SYSTEMD_TEMPLATE = """\
[Unit]
Description=NetWatch Linux Agent
Documentation=https://github.com/netwatch
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
ExecStart=/usr/bin/python3 {install_path} {agent_args}
Restart=always
RestartSec=30
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
"""

def install_service(args):
    if os.geteuid() != 0:
        print("[FEHLER] Installation muss als root ausgeführt werden (sudo)")
        sys.exit(1)

    # Agent-Script kopieren
    os.makedirs(os.path.dirname(INSTALL_PATH), exist_ok=True)
    shutil.copy2(os.path.abspath(__file__), INSTALL_PATH)
    os.chmod(INSTALL_PATH, 0o755)
    print(f"[OK] Agent nach {INSTALL_PATH} kopiert")

    # Argumente für den Dienst zusammenstellen (ohne --install)
    agent_args_parts = [
        f"--server {args.server}",
        f"--interval {args.interval}",
        f"--type {args.type}",
        f"--site \"{args.site}\"",
        f"--network \"{args.network}\"",
        f"--group \"{args.group}\"",
        f"--disk-path {args.disk_path}",
    ]
    if args.hostname:   agent_args_parts.append(f"--hostname {args.hostname}")
    if args.ip:         agent_args_parts.append(f"--ip {args.ip}")
    if args.docker:     agent_args_parts.append("--docker")
    if args.tags:       agent_args_parts.append(f"--tags {' '.join(args.tags)}")
    if args.services:   agent_args_parts.append(f"--services {' '.join(args.services)}")

    # systemd Unit schreiben
    unit = SYSTEMD_TEMPLATE.format(
        install_path=INSTALL_PATH,
        agent_args=" ".join(agent_args_parts),
    )
    with open(SYSTEMD_UNIT, "w") as f:
        f.write(unit)
    print(f"[OK] systemd Unit nach {SYSTEMD_UNIT} geschrieben")

    # Dienst aktivieren und starten
    for cmd in [
        ["systemctl", "daemon-reload"],
        ["systemctl", "enable", "netwatch-agent"],
        ["systemctl", "start",  "netwatch-agent"],
    ]:
        r = subprocess.run(cmd, capture_output=True, text=True)
        if r.returncode == 0:
            print(f"[OK] {' '.join(cmd)}")
        else:
            print(f"[WARN] {' '.join(cmd)}: {r.stderr.strip()}")

    print()
    print("═" * 50)
    print("  NetWatch Agent installiert und gestartet!")
    print(f"  Server:   {args.server}")
    print(f"  Hostname: {args.hostname or get_hostname()}")
    print()
    print("  Status:   sudo systemctl status netwatch-agent")
    print("  Logs:     sudo journalctl -u netwatch-agent -f")
    print("  Stop:     sudo systemctl stop netwatch-agent")
    print("═" * 50)

# ──────────────────────────────────────────────────────────────
# MAIN
# ──────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description=f"NetWatch Linux Agent v{VERSION}",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    # Verbindung
    parser.add_argument("--server",    default="http://localhost:3000",
                        help="NetWatch-Server URL")
    parser.add_argument("--interval",  default=DEFAULT_INTERVAL, type=int,
                        help="Sendeintervall in Sekunden")
    parser.add_argument("--timeout",   default=DEFAULT_TIMEOUT,  type=int,
                        help="HTTP-Timeout in Sekunden")
    # Identifikation
    parser.add_argument("--hostname",  default=None,
                        help="Hostname überschreiben (Standard: Systemhostname)")
    parser.add_argument("--ip",        default=None,
                        help="IP-Adresse überschreiben (Standard: automatisch)")
    parser.add_argument("--type",      default="server",
                        choices=["server","router","nas","client","ap","switch","usv","printer"],
                        help="Gerätetyp")
    # Pfad-Hierarchie (wie im Dashboard)
    parser.add_argument("--site",      default="Standort",  help="Standort (Ebene 1)")
    parser.add_argument("--network",   default="Netzwerk",  help="Netzwerk (Ebene 2)")
    parser.add_argument("--group",     default="Linux",     help="Gruppe (Ebene 3)")
    # Metriken
    parser.add_argument("--disk-path", default="/",         help="Zu überwachender Pfad für Disk-Auslastung")
    parser.add_argument("--docker",    action="store_true", help="Docker-Container als VMs melden")
    parser.add_argument("--services",  nargs="*", default=[],
                        help="systemd-Dienste überwachen (z.B. nginx mysql docker)")
    parser.add_argument("--tags",      nargs="*", default=[],
                        help="Zusätzliche manuelle Tags")
    # Betrieb
    parser.add_argument("--once",      action="store_true", help="Nur einmal senden, dann beenden")
    parser.add_argument("--verbose",   action="store_true", help="Ausführliche Debug-Ausgabe")
    parser.add_argument("--install",   action="store_true", help="Als systemd-Dienst installieren (benötigt root)")

    args = parser.parse_args()

    if args.verbose:
        log.setLevel(logging.DEBUG)

    if args.install:
        install_service(args)
        return

    # Graceful Shutdown
    def handle_signal(sig, frame):
        log.info("Signal empfangen — Agent wird beendet.")
        sys.exit(0)
    signal.signal(signal.SIGTERM, handle_signal)
    signal.signal(signal.SIGINT,  handle_signal)

    hostname = args.hostname or get_hostname()
    log.info(f"NetWatch Linux Agent v{VERSION} — {hostname} → {args.server}")
    log.info(f"Intervall: {args.interval}s | Docker: {'ja' if args.docker else 'nein'}")

    # Bandbreiten-Tracking: vorherige Zähler + Zeitstempel
    _prev_net_io = None
    _prev_net_ts = None

    while True:
        try:
            # Bandbreite: Delta zum letzten Poll berechnen
            curr_io = get_network_io()
            curr_ts = time.time()
            bw_in, bw_out = None, None
            if _prev_net_io and _prev_net_ts:
                elapsed = curr_ts - _prev_net_ts
                bw_in, bw_out = calc_bandwidth_kbps(_prev_net_io, curr_io, elapsed)
            _prev_net_io = curr_io
            _prev_net_ts = curr_ts

            payload = collect(args, bw_in_kbps=bw_in, bw_out_kbps=bw_out)
            ok = send(payload, args.server, args.timeout)
            if ok:
                bw_str = f"  BW↓{bw_in}kbps ↑{bw_out}kbps" if bw_in is not None else ""
                log.info(
                    f"✓ CPU:{payload['cpu']}%  "
                    f"RAM:{payload['mem']}%  "
                    f"Disk:{payload['disk']}%  "
                    f"Uptime:{payload['uptime']}"
                    + (f"  Temp:{payload['extra']['temperature']}°C"
                       if payload['extra']['temperature'] else "")
                    + bw_str
                )
        except KeyboardInterrupt:
            log.info("Abgebrochen.")
            break
        except Exception as e:
            log.error(f"Unerwarteter Fehler: {e}", exc_info=args.verbose)

        if args.once:
            break
        time.sleep(args.interval)

if __name__ == "__main__":
    main()
