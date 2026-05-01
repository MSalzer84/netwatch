# NetWatch Monitoring

Ein selbst entwickeltes Netzwerk-Monitoring-System — skalierbar für Heimnetzwerke wie für Firmeninfrastrukturen. Rechner, Server, Drucker, USVs, Access Points und Hypervisoren aus verschiedenen Netzen und Standorten werden in einem übersichtlichen Live-Dashboard zusammengefasst — ähnlich wie Zabbix, und ohne Lizenzkosten, vollständig unter eigener Kontrolle.

---

## Features

- **Live-Dashboard** — WebSocket-basiert, kein Reload nötig
- **Flexibler Geräte-Baum** — frei benennbar nach Standort, Netzwerk, Gruppe
- **Sensoren pro Gerät** — CPU, RAM, Disk, Ping, Paketverlust, Bandbreite, Temperatur, Batterie, SSL-Zertifikat
- **Warn- & Kritisch-Schwellwerte** — individuell pro Sensor einstellbar
- **Push-Benachrichtigungen** — über ntfy.sh, kostenlos, keine App-Registrierung nötig
- **Auto-Discovery** — IP-Bereich scannen, Geräte automatisch erkennen (Hostname, MAC, Hersteller)
- **SNMP-Poller** — Drucker, USVs, Switches ohne Agent überwachen
- **Hypervisor-Integration** — Proxmox und Hyper-V direkt über API, VMs und Container werden automatisch erkannt
- **Kiosk-Modus** — Vollbild-Ansicht mit großen Statuskacheln für Wandmonitore
- **Windows Agent** (PowerShell) und **Linux/Mac Agent** (Python 3)

---

## Voraussetzungen

- [Node.js](https://nodejs.org) ab Version 18
- Windows, Linux oder Raspberry Pi

---

## Installation

### Mit git (empfohlen)

```bash
git clone https://github.com/MSalzer84/netwatch.git
cd netwatch
npm install
node server.js
```

### Als ZIP herunterladen

1. Auf GitHub den grünen Button **Code → Download ZIP** klicken
2. ZIP nach **`C:\`** entpacken — es entsteht der Ordner `C:\netwatch-main`
3. Ordner umbenennen: `netwatch-main` → `netwatch`
4. Terminal im Ordner `C:\netwatch` öffnen und ausführen:

```powershell
cd C:\netwatch
npm install
node server.js
```

> **Wichtig:** Der Ordner muss `netwatch` heißen (nicht `netwatch-main`), damit alle Pfade in den Befehlen und Scripts korrekt funktionieren.

---

Das Dashboard ist danach erreichbar unter:

```
http://<DEINE-IP>:3000/netwatch-v3.html
```

Die eigene IP herausfinden:
- **Windows:** `ipconfig`
- **Linux/Mac:** `ip a`

---

## Agent installieren

### Windows
```powershell
powershell -ExecutionPolicy Bypass -File agents/agent.ps1 -Server http://<SERVER-IP>:3000
```

Oder als geplante Aufgabe (startet automatisch mit Windows):
```powershell
schtasks /create /tn "NetWatch" /tr "powershell -ExecutionPolicy Bypass -WindowStyle Hidden -File C:\netwatch\agents\agent.ps1 -Server http://<SERVER-IP>:3000" /sc onstart /ru SYSTEM /f
```

### Linux / Mac
```bash
python3 agents/linux-agent.py --server http://<SERVER-IP>:3000
```

Dauerhaft mit pm2:
```bash
npm install -g pm2
pm2 start agents/linux-agent.py --name netwatch-agent --interpreter python3 -- --server http://<SERVER-IP>:3000
pm2 save && pm2 startup
```

---

## Server dauerhaft laufen lassen

**Windows** (als Administrator):
```powershell
schtasks /create /tn "NetWatch" /tr "node C:\netwatch\server.js" /sc onstart /ru SYSTEM /f
```

**Linux/Mac** mit pm2:
```bash
npm install -g pm2
pm2 start server.js --name netwatch
pm2 save && pm2 startup
```

---

## Ports

| Port | Verwendung |
|------|-----------|
| 3000 | API & Dashboard |
| 3001 | WebSocket Live-Updates |

---

## Autor

MSalzer — [github.com/MSalzer84](https://github.com/MSalzer84)
