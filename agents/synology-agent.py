#!/usr/bin/env python3
"""NetWatch Agent fuer Synology NAS — nur Python-Standardbibliothek, keine Abhaengigkeiten."""
import argparse, json, os, socket, time, urllib.request, urllib.error

VERSION = "syn-1.0"

def get_hostname():
    return socket.gethostname().split(".")[0].upper()

def get_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "unbekannt"

def get_mac():
    try:
        primary_ip = get_ip()
        with open("/proc/net/arp") as f:
            for line in f.readlines()[1:]:
                parts = line.split()
                if len(parts) >= 4 and parts[0] == primary_ip:
                    return parts[3].upper()
        # Fallback: erstes aktives Interface
        for iface in os.listdir("/sys/class/net/"):
            try:
                with open(f"/sys/class/net/{iface}/address") as f:
                    mac = f.read().strip().upper()
                with open(f"/sys/class/net/{iface}/operstate") as f:
                    state = f.read().strip()
                if state == "up" and mac != "00:00:00:00:00:00":
                    return mac
            except Exception:
                continue
    except Exception:
        pass
    return None

def get_cpu():
    try:
        def read_stat():
            with open("/proc/stat") as f:
                line = f.readline()
            vals = list(map(int, line.split()[1:]))
            idle = vals[3]
            total = sum(vals)
            return idle, total
        i1, t1 = read_stat()
        time.sleep(0.5)
        i2, t2 = read_stat()
        dt = t2 - t1
        if dt == 0:
            return 0
        return round((1 - (i2 - i1) / dt) * 100, 1)
    except Exception:
        return 0

def get_mem():
    try:
        info = {}
        with open("/proc/meminfo") as f:
            for line in f:
                k, v = line.split(":")
                info[k.strip()] = int(v.split()[0])
        total = info.get("MemTotal", 0)
        avail = info.get("MemAvailable", info.get("MemFree", 0))
        if total == 0:
            return 0
        return round((total - avail) / total * 100, 1)
    except Exception:
        return 0

def get_mem_total_gb():
    try:
        with open("/proc/meminfo") as f:
            for line in f:
                if line.startswith("MemTotal"):
                    return round(int(line.split()[1]) / 1024 / 1024, 1)
    except Exception:
        pass
    return 0

def get_disk(path="/"):
    try:
        st = os.statvfs(path)
        total = st.f_blocks * st.f_frsize
        free  = st.f_bfree  * st.f_frsize
        if total == 0:
            return 0, 0
        used_pct = round((total - free) / total * 100, 1)
        total_gb  = round(total / 1e9, 1)
        return used_pct, total_gb
    except Exception:
        return 0, 0

def get_uptime():
    try:
        with open("/proc/uptime") as f:
            secs = float(f.read().split()[0])
        d = int(secs // 86400)
        h = int((secs % 86400) // 3600)
        m = int((secs % 3600) // 60)
        if d > 0:
            return f"{d}d {h}h"
        if h > 0:
            return f"{h}h {m}m"
        return f"{m}m"
    except Exception:
        return ""

def get_temp():
    # 1. hwmon (CPU-Temperatur)
    try:
        import glob
        for path in sorted(glob.glob("/sys/class/hwmon/hwmon*/temp*_input")):
            with open(path) as f:
                val = int(f.read().strip())
            if val > 0:
                return round(val / 1000, 1)
    except Exception:
        pass
    # 2. thermal_zone
    try:
        for path in sorted(glob.glob("/sys/class/thermal/thermal_zone*/temp")):
            with open(path) as f:
                val = int(f.read().strip())
            if val > 0:
                return round(val / 1000, 1)
    except Exception:
        pass
    return None

def get_load():
    try:
        with open("/proc/loadavg") as f:
            load1 = float(f.read().split()[0])
        cpu_count = os.cpu_count() or 1
        return round(load1 / cpu_count * 100, 1)
    except Exception:
        return 0

def collect(args):
    cpu       = get_cpu()
    mem       = get_mem()
    disk_pct, disk_total = get_disk(args.disk_path)
    temp      = get_temp()
    return {
        "hostname": args.hostname or get_hostname(),
        "ip":       get_ip(),
        "mac":      get_mac(),
        "os":       "Synology DSM",
        "type":     args.type,
        "path_l1":  args.site,
        "path_l2":  args.network,
        "path_l3":  args.group,
        "cpu":      cpu,
        "mem":      mem,
        "disk":     disk_pct,
        "uptime":   get_uptime(),
        "ping":     None,
        "tags":     ["Synology", "NAS"],
        "extra": {
            "temperature":   temp,
            "load_avg_pct":  get_load(),
            "mem_total_gb":  get_mem_total_gb(),
            "disk_total_gb": disk_total,
            "agent_version": VERSION,
        },
    }

def send(payload, server):
    url  = f"{server.rstrip('/')}/api/data"
    data = json.dumps(payload).encode()
    req  = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            resp = json.loads(r.read())
            return resp
    except urllib.error.URLError as e:
        print(f"[FEHLER] Verbindung fehlgeschlagen: {e.reason}")
        return None

def main():
    p = argparse.ArgumentParser(description="NetWatch Synology Agent")
    p.add_argument("--server",    default="http://localhost:3000")
    p.add_argument("--interval",  type=int, default=60)
    p.add_argument("--once",      action="store_true")
    p.add_argument("--hostname",  default="")
    p.add_argument("--type",      default="nas")
    p.add_argument("--site",      default="Standort")
    p.add_argument("--network",   default="Netzwerk")
    p.add_argument("--group",     default="NAS")
    p.add_argument("--disk-path", default="/volume1")
    args = p.parse_args()

    print(f"[NetWatch] Synology Agent {VERSION} — {args.hostname or get_hostname()} -> {args.server}")

    while True:
        payload = collect(args)
        resp    = send(payload, args.server)
        if resp:
            temp_str = f"  Temp:{payload['extra']['temperature']}°C" if payload['extra']['temperature'] else ""
            print(f"[OK] CPU:{payload['cpu']}%  RAM:{payload['mem']}%  Disk:{payload['disk']}%  Up:{payload['uptime']}{temp_str}")
        if args.once:
            break
        time.sleep(args.interval)

if __name__ == "__main__":
    main()
