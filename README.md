# NetWatch Monitoring

**Projektseite:** [dev.msalzer.dscloud.me/netwatch.html](https://dev.msalzer.dscloud.me/netwatch.html)

> ⚠️ **Testphase** — Alle Features sind umgesetzt und funktionieren. Vereinzelte Bugs werden laufend gefixt. Feedback und Fehlerberichte willkommen.

Ein selbst entwickeltes Netzwerk-Monitoring-System — skalierbar für Heimnetzwerke wie für Firmeninfrastrukturen. Rechner, Server, Drucker, USVs, Access Points und Hypervisoren aus verschiedenen Netzen und Standorten werden in einem übersichtlichen Live-Dashboard zusammengefasst — ähnlich wie Zabbix, und ohne Lizenzkosten, vollständig unter eigener Kontrolle.

---

## Features

- **Live-Dashboard** — WebSocket-basiert, kein Reload nötig
- **Flexibler Geräte-Baum** — frei benennbar nach Standort, Netzwerk, Gruppe
- **Sensoren pro Gerät** — CPU, RAM, Disk, Ping, Paketverlust, Bandbreite, Temperatur, Batterie, SSL-Zertifikat
- **Warn- & Kritisch-Schwellwerte** — individuell pro Sensor einstellbar
- **Push-Benachrichtigungen** — über ntfy.sh, kostenlos, keine App-Registrierung nötig
- **Auto-Discovery** — IP-Bereich scannen, Geräte automatisch erkennen (Hostname, MAC, Hersteller)
- **Massen-Import** — nach dem Scan mehrere Geräte gleichzeitig auswählen und mit einem Klick speichern
- **SNMP-Poller** — Drucker, USVs, Switches ohne Agent überwachen
- **Hypervisor-Integration** — Proxmox und Hyper-V, VMs und Container automatisch erkennen
- **Kiosk-Modus** — Vollbild-Ansicht mit Echtzeit-Alarmen (Flash, Ton, Browser-Benachrichtigung, ACK-Button)
- **Windows Agent** (PowerShell), **Linux/Mac Agent** (Python 3), **Hyper-V Agent** (separater Installer)

---

## Warn- & Kritisch-Schwellwerte

Die Standardwerte gelten für alle Geräte. Ping-Schwellwerte sind im Dashboard unter **Einstellungen → Latenz** anpassbar.

| Sensor | Einheit | Warnung | Kritisch |
|--------|---------|---------|----------|
| CPU | % | ≥ 75 % | ≥ 90 % |
| RAM | % | ≥ 80 % | ≥ 90 % |
| Disk | % | ≥ 80 % | ≥ 90 % |
| Ping | ms | ≥ 50 ms | ≥ 150 ms |
| Temperatur | °C | ≥ 75 °C | ≥ 85 °C |

> Temperatur wird nur angezeigt, wenn der Agent sie liefert (Linux, Synology, Windows mit WMI-Unterstützung).

---

## Neu

- **Bulk-Import nach Scan** — Checkboxen pro Gerät, gemeinsame Felder (Standort, Netzwerk, Gruppe, Typ) für alle auf einmal setzen
- **Kiosk-Alarme** — Vollbild-Flash, Alarmton, persistenter Banner mit Bestätigen-Button, native Browser-Benachrichtigung (auch bei minimiertem Fenster); konfigurierbar welche Ereignisse auslösen (Offline / Kritisch / Warnung)
- **Hyper-V Installer** — `http://<SERVER-IP>:3000/download/install-hyperv-agent.bat` — fragt nach Standort/Gruppe, richtet Agent mit VM-Erkennung als Windows-Dienst ein
- **Dashboard von allen Geräten im selben Netz erreichbar** — URL verwendet automatisch die IP des Servers statt localhost; einfach `http://<SERVER-IP>:3000/netwatch-v3.html` von jedem PC/Tablet im lokalen Netz aufrufen
- **Erweiterte Hypervisor-Integration** — VMware ESXi/vCenter, XCP-ng/XenServer, oVirt/RHEV, Nutanix Prism, Docker Remote API, Proxmox Backup Server

---

## Hypervisor-Integration

Gerät im Dashboard öffnen → **Hypervisor / VMs** → Typ wählen → Zugangsdaten eintragen → Speichern.

| Hypervisor | Typ | Zugangsdaten | URL-Format |
|---|---|---|---|
| Proxmox VE | `proxmox` | API-Token (`user@pam!tokenid=uuid`) | `https://IP:8006` |
| Proxmox Backup Server | `pbs` | API-Token (`user@pam!tokenid=uuid`) | `https://IP:8007` |
| Hyper-V | `hyperv` | — (via Agent) | — |
| VMware ESXi / vCenter | `vmware` | `benutzer:passwort` | `https://VCENTER-IP` |
| XCP-ng / XenServer | `xcpng` | `benutzer:passwort` | `https://XCP-HOST` |
| oVirt / RHEV | `ovirt` | `admin@internal:passwort` | `https://OVIRT-ENGINE` |
| Nutanix Prism | `nutanix` | `benutzer:passwort` | `https://IP:9440` |
| Docker Remote API | `docker` | — (kein Auth) | `http://IP:2375` |

**Proxmox API-Token erstellen:** Datacenter → API Tokens → Add → Token-ID vergeben, „Privilege Separation" deaktivieren.

**VMware:** Erfordert vSphere 6.5+ mit aktivierter REST API. Der Benutzer braucht mindestens Read-Only Rolle auf dem vCenter.

**Docker:** Die Remote API muss auf dem Docker-Host aktiviert sein. Beispiel in `/etc/docker/daemon.json`:
```json
{"hosts": ["tcp://0.0.0.0:2375", "unix:///var/run/docker.sock"]}
```
> Achtung: Port 2375 ohne TLS — nur im lokalen Netz verwenden oder per Firewall absichern.

---

## Server einrichten

### Schritt 1 — Node.js installieren

**Windows** — PowerShell als Administrator öffnen und ausführen:
```powershell
winget install OpenJS.NodeJS
```
> winget fragt beim ersten Start nach Zustimmung zu den Nutzungsbedingungen — mit **J** bestätigen.

Alternativ manuell von [nodejs.org](https://nodejs.org) herunterladen (LTS-Version).

**Linux/Mac:**
```bash
# Debian/Ubuntu
sudo apt install nodejs npm

# Mac
brew install node
```

> **Wichtig Windows:** Nach der Installation das Terminal-Fenster **schließen und neu öffnen** — erst dann ist `node` verfügbar.

---

### Schritt 2 — NetWatch herunterladen

**Option A — per git (empfohlen):**
```powershell
cd C:\
git clone https://github.com/MSalzer84/netwatch.git
```

**Option B — als ZIP:**
1. Auf GitHub den grünen Button **Code → Download ZIP** klicken
2. ZIP nach `C:\` entpacken — es entsteht der Ordner `C:\netwatch-main`
3. Ordner umbenennen: `netwatch-main` → `netwatch`

> **Wichtig:** Der Ordner muss `netwatch` heißen (nicht `netwatch-main`), damit alle Pfade korrekt funktionieren.

---

### Schritt 3 — Abhängigkeiten installieren

Terminal im Ordner `C:\netwatch` öffnen:
```powershell
cd C:\netwatch
npm install
```

> **Falls npm blockiert wird** (`Ausführung von Skripts deaktiviert`): Einmalig ausführen und mit **J** bestätigen:
> ```powershell
> Set-ExecutionPolicy RemoteSigned -Scope CurrentUser
> ```
> Danach `npm install` erneut ausführen.

---

### Schritt 4 — Server starten

```powershell
node server.js
```

Erfolgreiche Ausgabe:
```
API (Agenten)  -> http://localhost:3000
WebSocket      -> ws://localhost:3001
Dashboard      -> http://localhost:3000/netwatch-v3.html
```

---

### Schritt 5 — Dashboard öffnen

Im Browser aufrufen — ersetze die IP durch die deines Servers:
```
http://<DEINE-IP>:3000/netwatch-v3.html
```

Eigene IP herausfinden:
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

### Synology NAS

Kein pip, keine Installation — der Synology-Agent verwendet nur die Python-Standardbibliothek.

**Voraussetzung:** SSH aktivieren — DSM → Systemsteuerung → Terminal & SNMP → SSH-Dienst aktivieren

**Schritt 1 — Agent herunterladen** (per SSH auf der NAS):
```bash
curl -o ~/synology-agent.py http://<SERVER-IP>:3000/agents/synology-agent.py
```

**Schritt 2 — Testen:**
```bash
python3 ~/synology-agent.py --server http://<SERVER-IP>:3000 --once
```

Erfolgreiche Ausgabe: `[OK] CPU:0.5%  RAM:14.6%  Disk:4.4%  Up:33d 18h`

**Schritt 3 — Dauerhaft einrichten:**

DSM → Systemsteuerung → Aufgabenplaner → Erstellen → Ausgelöste Aufgabe → Benutzerdefiniertes Script

| Feld | Wert |
|------|------|
| Aufgabenname | NetWatch Agent |
| Benutzer | (dein DSM-Benutzer) |
| Ereignis | Booten |
| Script | `python3 ~/synology-agent.py --server http://<SERVER-IP>:3000` |

Rechtsklick auf die Aufgabe → **Ausführen** — Agent startet sofort und sendet alle 60 Sekunden.

> **Hinweis:** Befindet sich die NAS in einem anderen Subnetz als der NetWatch-Server, muss auf dem Router/Firewall (z.B. OPNsense) eine Regel vorhanden sein, die TCP-Traffic vom NAS-Subnetz zu `<SERVER-IP>:3000` erlaubt.

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
