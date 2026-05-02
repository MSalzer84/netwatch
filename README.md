# NetWatch Monitoring

**Projektseite:** [dev.msalzer.dscloud.me/netwatch.html](https://dev.msalzer.dscloud.me/netwatch.html) · **GitHub:** [MSalzer84/netwatch](https://github.com/MSalzer84/netwatch)

> ⚠️ **Testphase** — Alle Features sind umgesetzt und funktionieren. Vereinzelte Bugs werden laufend gefixt.

Selbst entwickeltes Netzwerk-Monitoring — skalierbar vom Heimnetz bis zur Firmeninfrastruktur. Rechner, Server, NAS, Drucker, USVs, Access Points und Hypervisoren werden in einem Live-Dashboard zusammengefasst. Ähnlich wie Zabbix, aber ohne Lizenzkosten und vollständig unter eigener Kontrolle.

---

## Inhaltsverzeichnis

- [Features](#features)
- [Schnellstart](#schnellstart)
- [Server dauerhaft einrichten ⭐](#server-dauerhaft-einrichten-)
- [Datenbank & Verlässlichkeit](#datenbank--verlässlichkeit)
- [Agents installieren](#agents-installieren)
- [Hypervisor-Integration](#hypervisor-integration)
- [Schwellwerte](#schwellwerte)
- [Ports](#ports)

---

## Features

| Feature | Beschreibung |
|---|---|
| **Live-Dashboard** | WebSocket-basiert, kein Reload nötig |
| **Geräte-Baum** | Frei benennbar nach Standort, Netzwerk, Gruppe |
| **Sensoren** | CPU, RAM, Disk, Ping, Temperatur, Bandbreite, Batterie, SSL-Zertifikat |
| **Schwellwerte** | Warn & Kritisch individuell pro Sensor einstellbar |
| **Push-Benachrichtigungen** | Über ntfy.sh — kostenlos, keine App-Registrierung nötig |
| **Auto-Discovery** | IP-Bereich scannen, Geräte automatisch erkennen (Hostname, MAC, Hersteller) |
| **Massen-Import** | Nach dem Scan mehrere Geräte mit Checkboxen auswählen und gemeinsam anlegen |
| **SNMP-Poller** | Drucker, USVs, Switches ohne Agent überwachen |
| **Hypervisor-Integration** | Proxmox, Hyper-V, VMware, XCP-ng, Docker — VMs & Container automatisch erkennen |
| **Kiosk-Modus** | Vollbild mit Echtzeit-Alarmen (Flash, Ton, Browser-Benachrichtigung, ACK-Button) |

---

## Schnellstart

### 1 — Node.js installieren

**Windows** (PowerShell als Administrator):
```powershell
winget install OpenJS.NodeJS
```
> Nach der Installation das Terminal **schließen und neu öffnen** — erst dann ist `node` verfügbar.

Alternativ manuell von [nodejs.org](https://nodejs.org) (LTS-Version).

**Linux / Mac:**
```bash
# Debian/Ubuntu
sudo apt install nodejs npm

# Mac
brew install node
```

---

### 2 — NetWatch herunterladen

**Per git (empfohlen):**
```powershell
cd C:\
git clone https://github.com/MSalzer84/netwatch.git
```

**Als ZIP:**
1. Auf GitHub **Code → Download ZIP** klicken
2. ZIP nach `C:\` entpacken
3. Ordner umbenennen: `netwatch-main` → `netwatch`

> **Wichtig:** Der Ordner muss `netwatch` heißen — sonst stimmen alle Pfade nicht.

---

### 3 — Abhängigkeiten installieren

```powershell
cd C:\netwatch
npm install
```

> Falls npm blockiert wird (`Ausführung von Skripts deaktiviert`):
> ```powershell
> Set-ExecutionPolicy RemoteSigned -Scope CurrentUser
> ```
> Danach `npm install` erneut ausführen.

---

### 4 — Server starten (Test)

```powershell
node server.js
```

Erfolgreiche Ausgabe:
```
API (Agenten)  -> http://localhost:3000
WebSocket      -> ws://localhost:3001
Dashboard      -> http://localhost:3000/netwatch-v3.html
```

Dashboard im Browser öffnen — IP des Servers einsetzen:
```
http://<DEINE-IP>:3000/netwatch-v3.html
```

Eigene IP: **Windows** → `ipconfig` · **Linux/Mac** → `ip a`

> Dieser manuelle Start dient nur zum Testen. Für den Dauerbetrieb → nächster Abschnitt.

---

## Server dauerhaft einrichten ⭐

> **Das ist der wichtigste Schritt.** Ohne Autostart muss der Server nach jedem Neustart manuell gestartet werden — Geräte erscheinen offline und die Daten sind nicht abrufbar.

### Windows — Autostart-Script (empfohlen)

Das mitgelieferte Script richtet alles automatisch ein:

1. **Rechtsklick** auf `C:\netwatch\install-autostart.ps1`
2. **„Als Administrator ausführen"** wählen
3. Fertig — der Server startet ab sofort bei jedem Windows-Start automatisch

Das Script:
- Registriert den Server als Windows-Aufgabe (läuft als SYSTEM, kein Login nötig)
- Startet den Server sofort
- Startet ihn bei Absturz automatisch neu (bis zu 5 Versuche)

**Manuell prüfen ob der Task läuft:**
```powershell
Get-ScheduledTask -TaskName "NetWatch-Server" | Select-Object State
```

**Task entfernen (falls nötig):**
```powershell
Unregister-ScheduledTask -TaskName "NetWatch-Server" -Confirm:$false
```

---

### Linux / Mac — pm2

```bash
npm install -g pm2
pm2 start C:/netwatch/server.js --name netwatch
pm2 save
pm2 startup
```

Den angezeigten Befehl kopieren und ausführen — danach startet pm2 automatisch mit dem System.

**Status prüfen:**
```bash
pm2 status
pm2 logs netwatch
```

---

## Datenbank & Verlässlichkeit

### Wo werden die Daten gespeichert?

Alle Gerätedaten, Konfigurationen und Metriken werden in einer **SQLite-Datenbank** gespeichert:

```
C:\netwatch\netwatch.db
```

Die Datenbank bleibt bei Neustarts, Updates und Abstürzen vollständig erhalten — **solange die Datei nicht gelöscht wird**.

### Was passiert bei einem Neustart?

| Szenario | Ergebnis |
|---|---|
| Windows neu gestartet, Autostart eingerichtet | ✅ Server startet automatisch, alle Daten vorhanden |
| Windows neu gestartet, kein Autostart | ❌ Server läuft nicht → Dashboard zeigt keine Daten |
| `node server.js` abgestürzt, pm2/Task aktiv | ✅ Wird automatisch neu gestartet |
| `netwatch.db` versehentlich gelöscht | ❌ Alle Daten verloren — Backup empfohlen |

### Datenbank sichern

Einfache Sicherung — `netwatch.db` kopieren, während der Server läuft:

```powershell
Copy-Item C:\netwatch\netwatch.db C:\netwatch\backup\netwatch_$(Get-Date -Format 'yyyyMMdd').db
```

> SQLite ist eine einzelne Datei — sie kann jederzeit kopiert werden, auch wenn der Server läuft.

---

## Agents installieren

Agents laufen auf den überwachten Geräten und senden Metriken (CPU, RAM, Disk, Temperatur …) an den Server.

### Windows-Agent

**Einmalig testen:**
```powershell
powershell -ExecutionPolicy Bypass -File C:\netwatch\agents\agent.ps1 -Server http://<SERVER-IP>:3000
```

**Dauerhaft als geplante Aufgabe (Administrator):**
```powershell
schtasks /create /tn "NetWatch-Agent" /tr "powershell -ExecutionPolicy Bypass -WindowStyle Hidden -File C:\netwatch\agents\agent.ps1 -Server http://<SERVER-IP>:3000" /sc onstart /ru SYSTEM /f
```

**Hyper-V Agent** (erkennt VMs automatisch):
```
http://<SERVER-IP>:3000/download/install-hyperv-agent.bat
```
Datei herunterladen und als Administrator ausführen — fragt nach Standort/Gruppe und richtet alles ein.

---

### Linux / Mac Agent

**Einmalig testen:**
```bash
python3 agents/linux-agent.py --server http://<SERVER-IP>:3000
```

**Dauerhaft mit pm2:**
```bash
npm install -g pm2
pm2 start agents/linux-agent.py --name netwatch-agent --interpreter python3 -- --server http://<SERVER-IP>:3000
pm2 save && pm2 startup
```

---

### Synology NAS Agent

Kein pip, keine Installation nötig — verwendet nur die Python-Standardbibliothek.

**Voraussetzung:** SSH aktivieren — DSM → Systemsteuerung → Terminal & SNMP → SSH-Dienst aktivieren

**Schritt 1 — Agent herunterladen** (per SSH auf der NAS):
```bash
curl -o ~/synology-agent.py http://<SERVER-IP>:3000/agents/synology-agent.py
```

**Schritt 2 — Testen:**
```bash
python3 ~/synology-agent.py --server http://<SERVER-IP>:3000 --once
```

Erfolgreiche Ausgabe:
```
[OK] CPU:0.5%  RAM:14.6%  Disk:4.4%  Up:33d 18h  Temp:44.4°C
```

**Schritt 3 — Dauerhaft einrichten:**

DSM → Systemsteuerung → Aufgabenplaner → Erstellen → Ausgelöste Aufgabe → Benutzerdefiniertes Script

| Feld | Wert |
|------|------|
| Aufgabenname | NetWatch Agent |
| Benutzer | (dein DSM-Benutzer) |
| Ereignis | Booten |
| Script | `python3 ~/synology-agent.py --server http://<SERVER-IP>:3000` |

Rechtsklick auf die Aufgabe → **Ausführen** — Agent startet sofort und sendet alle 60 Sekunden.

> **Anderes Subnetz:** Auf dem Router/Firewall (z.B. OPNsense) eine Regel erstellen, die TCP-Traffic vom NAS-Subnetz zu `<SERVER-IP>:3000` erlaubt.

---

## Hypervisor-Integration

Gerät im Dashboard anklicken → **Hypervisor / VMs** → Typ wählen → Zugangsdaten eintragen → Speichern.

| Hypervisor | Typ | Zugangsdaten | URL |
|---|---|---|---|
| Proxmox VE | `proxmox` | API-Token (`user@pam!tokenid=uuid`) | `https://IP:8006` |
| Proxmox Backup Server | `pbs` | API-Token | `https://IP:8007` |
| Hyper-V | `hyperv` | — (via Agent) | — |
| VMware ESXi / vCenter | `vmware` | `benutzer:passwort` | `https://VCENTER-IP` |
| XCP-ng / XenServer | `xcpng` | `benutzer:passwort` | `https://XCP-HOST` |
| oVirt / RHEV | `ovirt` | `admin@internal:passwort` | `https://OVIRT-ENGINE` |
| Nutanix Prism | `nutanix` | `benutzer:passwort` | `https://IP:9440` |
| Docker Remote API | `docker` | — | `http://IP:2375` |

**Proxmox API-Token:** Datacenter → API Tokens → Add → „Privilege Separation" deaktivieren.

**VMware:** Erfordert vSphere 6.5+ mit REST API. Benutzer braucht mindestens Read-Only auf dem vCenter.

**Docker:** Remote API aktivieren in `/etc/docker/daemon.json`:
```json
{"hosts": ["tcp://0.0.0.0:2375", "unix:///var/run/docker.sock"]}
```
> Port 2375 ist unverschlüsselt — nur im lokalen Netz oder per Firewall absichern.

---

## Schwellwerte

Standardwerte für alle Geräte. Ping-Werte sind im Dashboard unter **Einstellungen → Latenz** anpassbar.

| Sensor | Einheit | Warnung | Kritisch |
|--------|---------|---------|----------|
| CPU | % | ≥ 75 % | ≥ 90 % |
| RAM | % | ≥ 80 % | ≥ 90 % |
| Disk | % | ≥ 80 % | ≥ 90 % |
| Ping | ms | ≥ 50 ms | ≥ 150 ms |
| Temperatur | °C | ≥ 75 °C | ≥ 85 °C |

> Temperatur wird nur angezeigt wenn der Agent sie liefert (Linux, Synology, Windows mit WMI).

---

## Ports

| Port | Verwendung |
|------|-----------|
| 3000 | API & Dashboard (HTTP) |
| 3001 | WebSocket Live-Updates |

---

## Autor

MSalzer — [github.com/MSalzer84](https://github.com/MSalzer84)
