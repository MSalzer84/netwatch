# NetWatch Monitoring

**Projektseite:** [dev.msalzer.dscloud.me/netwatch.html](https://dev.msalzer.dscloud.me/netwatch.html) · **GitHub:** [MSalzer84/netwatch](https://github.com/MSalzer84/netwatch)

> ⚠️ **Testphase** — Alle Features sind umgesetzt und funktionieren. Vereinzelte Bugs werden laufend gefixt.

Selbst entwickeltes Netzwerk-Monitoring — skalierbar vom Heimnetz bis zur Firmeninfrastruktur. Rechner, Server, NAS, Drucker, USVs, Access Points und Hypervisoren werden in einem Live-Dashboard zusammengefasst. Ähnlich wie Zabbix, aber ohne Lizenzkosten und vollständig unter eigener Kontrolle.

---

## Inhaltsverzeichnis

- [Features](#features)
- [Schnellstart](#schnellstart)
- [Server dauerhaft einrichten ⭐](#server-dauerhaft-einrichten-)
  - [Windows — Autostart-Script](#windows--autostart-script-empfohlen)
  - [Linux — systemd](#linux--systemd)
  - [Docker — Synology / Proxmox / jeder Linux-Host](#docker--synology--proxmox--jeder-linux-host-)
  - [Linux / Mac — pm2](#linux--mac--pm2)
- [Datenbank & Verlässlichkeit](#datenbank--verlässlichkeit)
- [Agents installieren](#agents-installieren)
  - [Windows Agent](#windows-agent)
  - [Linux / Mac Agent](#linux--mac-agent)
  - [Synology NAS Agent](#synology-nas-agent)
- [Proxmox vollständig einrichten](#proxmox-vollständig-einrichten)
- [Hyper-V vollständig einrichten](#hyper-v-vollständig-einrichten)
- [OPNsense einrichten](#opnsense-einrichten)
- [FritzBox einrichten](#fritzbox-einrichten)
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

### Linux — systemd

Das mitgelieferte Script richtet den Server als systemd-Dienst ein (kein Login nötig, startet beim Boot):

```bash
cd /opt/netwatch   # oder das Verzeichnis wo NetWatch liegt
sudo bash install-server-linux.sh
```

**Status prüfen:**
```bash
systemctl status netwatch-server
journalctl -u netwatch-server -f
```

---

### Docker — Synology / Proxmox / jeder Linux-Host ⭐

Die einfachste Methode wenn Docker verfügbar ist. Läuft auf Synology NAS (Container Manager), Proxmox (VM/LXC mit Docker) und jedem anderen Linux-System.

**Voraussetzung:** Docker + Docker Compose installiert.

```bash
git clone https://github.com/MSalzer84/netwatch.git
cd netwatch
docker compose up -d
```

Dashboard ist sofort erreichbar unter:
```
http://<HOST-IP>:3000/netwatch-v3.html
```

Die SQLite-Datenbank wird in einem **Docker-Volume** (`netwatch-data`) gespeichert und bleibt bei Updates erhalten.

**Nützliche Befehle:**
```bash
docker compose logs -f          # Live-Logs
docker compose restart          # Neustart
docker compose pull && docker compose up -d  # Update
docker compose down             # Stoppen
```

#### Synology NAS (Container Manager)

1. SSH auf die Synology öffnen oder **Container Manager → Projekt** aufrufen
2. Neues Projekt anlegen → Compose-Inhalt aus `docker-compose.yml` einfügen
3. **Starten** klicken — fertig

> **Hinweis:** `network_mode: host` ist nötig damit NetWatch andere LAN-Geräte per Ping und SNMP erreichen kann. Synology Container Manager unterstützt dies.

#### Proxmox — Vollautomatischer LXC-Installer ⭐

Ein einziger Befehl auf dem Proxmox-Host (als root) erstellt einen fertigen LXC-Container mit NetWatch:

```bash
bash <(curl -sSL https://raw.githubusercontent.com/MSalzer84/netwatch/main/proxmox-install.sh)
```

Das Script erledigt alles automatisch:
- Lädt das Debian 12 Template herunter (falls nicht vorhanden)
- Erstellt einen LXC-Container (512 MB RAM, 4 GB Disk, 1 CPU)
- Installiert Node.js und NetWatch
- Richtet den systemd-Dienst ein (Autostart, Neustart bei Absturz)
- Zeigt am Ende die Dashboard-URL mit der IP des Containers

Am Ende erscheint:
```
Dashboard → http://<CT-IP>:3000/netwatch-v3.html
```

**Container verwalten (auf dem Proxmox-Host):**
```bash
pct enter <CT-ID>          # Shell im Container öffnen
pct stop  <CT-ID>          # Container stoppen
pct start <CT-ID>          # Container starten
```

**NetWatch aktualisieren (im Container):**
```bash
cd /opt/netwatch && git pull && systemctl restart netwatch-server
```

> Für die VM/Container-Übersicht in NetWatch zusätzlich den Proxmox API-Token einrichten — siehe [Proxmox vollständig einrichten](#proxmox-vollständig-einrichten).

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

## Proxmox vollständig einrichten

Proxmox läuft auf Debian Linux. Es gibt **zwei unabhängige Teile**:

| Teil | Was es bringt |
|---|---|
| **A — Agent auf dem Host** | CPU, RAM, Disk, Temperatur des Proxmox-Nodes im Dashboard |
| **B — VM-Integration** | Alle VMs und Container im Dashboard sichtbar, mit Status |

Beide Teile ergänzen sich — am besten beides einrichten.

---

### Teil A — Agent auf dem Proxmox-Host

Per SSH auf den Proxmox-Server verbinden, dann:

**Schritt 1 — Agent herunterladen:**
```bash
curl -o /opt/netwatch-agent.py http://<SERVER-IP>:3000/agents/linux-agent.py
```

**Schritt 2 — Einmalig testen:**
```bash
python3 /opt/netwatch-agent.py --server http://<SERVER-IP>:3000 --once
```

Erfolgreiche Ausgabe:
```
[OK] CPU:2.1%  RAM:34.5%  Disk:18.2%  Up:5d 3h
```

**Schritt 3 — Systemd-Service erstellen (läuft dauerhaft):**

```bash
cat > /etc/systemd/system/netwatch-agent.service << 'EOF'
[Unit]
Description=NetWatch Agent
After=network.target

[Service]
ExecStart=python3 /opt/netwatch-agent.py --server http://<SERVER-IP>:3000 --type server --site Standort --network Netzwerk --group Proxmox
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF
```

> `--site`, `--network`, `--group` anpassen — so erscheint der Node im Geräte-Baum.

```bash
systemctl daemon-reload
systemctl enable netwatch-agent
systemctl start netwatch-agent
```

**Status prüfen:**
```bash
systemctl status netwatch-agent
```

---

### Teil B — VM-Integration (API-Token)

Damit NetWatch alle VMs und Container des Proxmox-Nodes sieht.

**Schritt 1 — API-Token in Proxmox erstellen:**

1. Proxmox Web-GUI öffnen: `https://<PROXMOX-IP>:8006`
2. **Datacenter → API Tokens → Add**
3. Felder ausfüllen:

| Feld | Wert |
|------|------|
| User | `root@pam` |
| Token ID | `netwatch` |
| Privilege Separation | **deaktivieren** ← wichtig |

4. **Add** klicken → Token-Secret erscheint (nur einmal sichtbar!) → kopieren

Der vollständige Token sieht so aus:
```
root@pam!netwatch=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

**Schritt 2 — Token im NetWatch-Dashboard eintragen:**

1. Im Dashboard auf den Proxmox-Node klicken
2. Rechts: **Hypervisor / VMs** aufklappen
3. Felder ausfüllen:

| Feld | Wert |
|------|------|
| Typ | `Proxmox VE` |
| URL | `https://<PROXMOX-IP>:8006` |
| Token | `root@pam!netwatch=<token-secret>` |

4. **Speichern** — VMs erscheinen nach wenigen Sekunden

> **Selbstsigniertes Zertifikat:** Proxmox verwendet standardmäßig ein selbstsigniertes TLS-Zertifikat. NetWatch akzeptiert dies automatisch.

---

## Hyper-V vollständig einrichten

Der Hyper-V Agent läuft direkt auf dem Windows-Host und liefert sowohl die Host-Metriken (CPU, RAM, Disk) als auch alle VMs mit Status, CPU und RAM — **kein API-Token nötig**.

### Voraussetzungen

- Windows Server oder Windows 10/11 mit aktivierter **Hyper-V Rolle**
- NetWatch-Server läuft und ist vom Hyper-V-Host aus erreichbar
- Installation muss als **Administrator** durchgeführt werden

---

### Schritt 1 — Installer herunterladen

Im Browser des Hyper-V-Hosts aufrufen:

```
http://<SERVER-IP>:3000/download/install-hyperv-agent.bat
```

Die Datei wird automatisch heruntergeladen.

> Alternativ direkt im Browser öffnen — Windows fragt ob die Datei gespeichert oder ausgeführt werden soll.

---

### Schritt 2 — Installer als Administrator ausführen

**Rechtsklick** auf `install-hyperv-agent.bat` → **„Als Administrator ausführen"**

Das Script fragt dann interaktiv nach drei Angaben:

| Eingabe | Beispiel | Beschreibung |
|---------|---------|--------------|
| Standort | `Wien HQ` | Ebene 1 im Geräte-Baum |
| Netzwerk | `Servernetz` | Ebene 2 im Geräte-Baum |
| Gruppe | `Hyper-V` | Ebene 3 im Geräte-Baum |

Felder leer lassen → Standardwerte werden verwendet.

---

### Schritt 3 — Was passiert automatisch

Das Script erledigt alles selbst:

1. Lädt `agent.ps1` vom NetWatch-Server herunter → speichert nach `C:\ProgramData\NetWatch\agent.ps1`
2. Erstellt eine geplante Aufgabe **„NetWatch-HyperV-Agent"** — startet automatisch beim Windows-Start als SYSTEM
3. Startet den Agent sofort

Erfolgreiche Ausgabe am Ende:
```
==========================================
Hyper-V Agent laeuft!
Host + VMs erscheinen in Kuerze im Dashboard.
==========================================
```

---

### Schritt 4 — Dashboard prüfen

Nach ca. 60 Sekunden erscheint der Hyper-V-Host im Dashboard. Wenn du ihn aufklappst, siehst du unter den Sensor-Zeilen alle VMs mit Status (Running / Off) und Ressourcenverbrauch.

---

### Fehlerbehebung

**VMs erscheinen nicht:**

Prüfen ob die Hyper-V PowerShell-Module verfügbar sind:
```powershell
Get-Command Get-VM
```
Falls nicht gefunden — Hyper-V Tools nachinstallieren:
```powershell
# Windows Server
Install-WindowsFeature -Name Hyper-V-PowerShell

# Windows 10/11
Enable-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V-Management-PowerShell
```

**Task prüfen:**
```powershell
Get-ScheduledTask -TaskName "NetWatch-HyperV-Agent" | Select-Object State
```

**Task neu starten:**
```powershell
Start-ScheduledTask -TaskName "NetWatch-HyperV-Agent"
```

**Task entfernen (falls nötig):**
```powershell
Unregister-ScheduledTask -TaskName "NetWatch-HyperV-Agent" -Confirm:$false
```

---

## OPNsense einrichten

OPNsense (FreeBSD-basiert) hat keinen NetWatch-Agent — die Metriken kommen über **SNMP**. Sobald SNMP aktiviert und der Community-String im Dashboard eingetragen ist, werden CPU, RAM und Disk automatisch abgefragt.

### Schritt 1 — SNMP Plugin installieren

In neueren OPNsense-Versionen (23.x+) ist SNMP kein eingebauter Dienst — das Plugin muss einmalig installiert werden:

1. OPNsense → **System → Firmware → Erweiterungen**
2. Häkchen bei **„Community-Plugins anzeigen"** setzen (sonst ist `os-net-snmp` nicht sichtbar)
3. Suchfeld: `snmp` eingeben
4. **`os-net-snmp`** → `+` klicken → installieren → warten
5. Seite neu laden

Danach ist **Dienste → Net-SNMP** in der Sidebar sichtbar.

### Schritt 2 — SNMP konfigurieren

1. **Dienste → Net-SNMP**
2. **Aktiviere den SNMP Dienst** — Häkchen setzen
3. **SNMP-Community** — eigenes Wort eintragen, z. B. `Netwatch` (nicht `public`)
4. **SNMP-Standort** — optional, z. B. `Heimnetz`
5. **IP-Adressen (eingehend)** — leer lassen (empfohlen). Eine bestimmte IP einzutragen kann durch Routing/NAT oder Hyper-V Netzwerkadapter dazu führen dass SNMP nicht antwortet, weil die Quell-IP abweicht.
6. Speichern

> **Achtung:** Der Community-String ist case-sensitiv. Was du hier einträgst, musst du exakt gleich im NetWatch-Dashboard eintragen.

### Schritt 3 — Gerät im Dashboard einrichten

1. Smart Discovery starten — OPNsense wird automatisch erkannt (Typ: `router`, OS: `OPNsense`)
2. Gerät in die Geräteliste übernehmen
3. Gerät anklicken → **Bearbeiten**
4. **Typ** auf `Firewall` setzen
5. **SNMP Community** eintragen (denselben String wie in Schritt 1)
6. Speichern

NetWatch fragt jetzt automatisch alle 60 Sekunden CPU, RAM und Disk über SNMP ab — keine weiteren Einstellungen nötig.

### Schritt 4 — Zusätzliche Sensoren (optional)

Über **Sensor hinzufügen → SNMP-Wert** können weitere Metriken ergänzt werden:

OPNsense verwendet standardmäßig **bsnmpd** — damit funktionieren die HOST-RESOURCES OIDs. Die UCD-SNMP OIDs (1.3.6.1.4.1.2021.x) funktionieren **nicht** ohne zusätzliches Plugin.

| Sensor | OID | Einheit |
|--------|-----|---------|
| CPU (Auslastung) | `1.3.6.1.2.1.25.3.3.1.2.1` | % |
| Uptime | `1.3.6.1.2.1.1.3.0` | — |
| Firewall-States | `1.3.6.1.4.1.12325.1.200.1.3.1.0` | — |
| Temperatur | siehe unten | °C |

#### Temperatur-Sensor einrichten (via SNMP-Extend)

OPNsense stellt die CPU-Temperatur nicht über Standard-SNMP-OIDs bereit. Die Lösung ist ein kleines Shell-Script das per SNMP-Extend abgefragt wird:

**Einmalig per SSH auf OPNsense ausführen:**

```sh
# 1. Script erstellen (liest CPU-Temperatur via sysctl)
python3 -c "open('/usr/local/bin/nw_temp.sh','w').write(chr(35)+chr(33)+'/bin/sh\n/sbin/sysctl -n dev.cpu.0.temperature | /usr/bin/sed s/C//\n')"
chmod +x /usr/local/bin/nw_temp.sh

# 2. Script in das SNMP-Template eintragen (dauerhaft, überlebt Updates)
echo "content = open('/usr/local/opnsense/service/templates/OPNsense/Netsnmp/snmpd.conf').read()" > /tmp/fix.py
echo "tag = '{' + '% endif %}'" >> /tmp/fix.py
echo "last = content.rfind(tag)" >> /tmp/fix.py
echo "insert = 'extend    nw_temp   /usr/local/bin/nw_temp.sh\n\n'" >> /tmp/fix.py
echo "content = content[:last] + insert + content[last:]" >> /tmp/fix.py
echo "open('/usr/local/opnsense/service/templates/OPNsense/Netsnmp/snmpd.conf', 'w').write(content)" >> /tmp/fix.py
python3 /tmp/fix.py

# 3. Config neu generieren und snmpd neu starten
configctl template reload OPNsense/Netsnmp && service snmpd restart
```

**Im NetWatch-Dashboard:**

Sensor hinzufügen → SNMP → Preset **„OPNsense → Temperatur"** auswählen → Speichern.

> **Nur auf echter Hardware:** Der Temperatursensor funktioniert **nicht** wenn OPNsense in einer virtuellen Maschine (z. B. Proxmox, Hyper-V, VirtualBox) läuft — VMs stellen `dev.cpu.0.temperature` nicht bereit. Das Script gibt dann nichts aus und der Sensor bleibt offline.

> **Hinweis:** OPNsense verwendet als Standard-Shell `csh/tcsh` — `#!/bin/sh` kann nicht direkt mit `echo` geschrieben werden (csh interpretiert `!` als History-Expansion). Deshalb wird `python3` mit `chr(33)` verwendet.

> **SSH nach dem Einrichten wieder deaktivieren:** System → Verwaltung → Secure Shell → SSH-Dienst deaktivieren. SSH wird nur für die Einrichtung benötigt und sollte danach aus Sicherheitsgründen deaktiviert bleiben.

### Fehlerbehebung

**SNMP nicht sichtbar in der Sidebar:**
- Plugin fehlt → System → Firmware → Plugins → `os-net-snmp` installieren
- Nach Installation Seite neu laden — dann erscheint „Dienste → Net-SNMP"

**SNMP antwortet nicht:**
- Dienste → Net-SNMP → prüfen ob Dienst aktiv (grüner Haken)
- Firewall-Regel prüfen: UDP Port 161 vom NetWatch-Server zum OPNsense-LAN erlaubt?
- Community String exakt gleich schreiben (Groß-/Kleinschreibung beachten)
- Bind Interface: nur LAN wählen, nicht WAN

**CPU zeigt immer 0 %:**
- OID `1.3.6.1.2.1.25.3.3.1.2.1` (hrProcessorLoad) probieren
- Preset im Sensor-Dialog: „OPNsense → CPU" auswählen

---

## FritzBox einrichten

Die AVM FritzBox unterstützt **kein SNMP** und hat keine offene JSON-API — daher sind CPU, RAM und Disk-Sensoren im NetWatch-Dashboard nicht verfügbar. Was funktioniert:

| Funktion | Verfügbar |
|----------|-----------|
| Ping / Erreichbarkeit | ✅ |
| Status (online/offline) | ✅ |
| CPU-Auslastung | ❌ |
| RAM-Auslastung | ❌ |
| Disk-Auslastung | ❌ |

### Gerät manuell hinzufügen

1. Im Dashboard auf **+** (Gerät hinzufügen) klicken
2. **Hostname:** `FRITZ-BOX` (oder beliebig)
3. **IP:** `192.168.178.1` (Standard-IP der FritzBox)
4. **Typ:** `Router` oder `Firewall`
5. **Standort / Gruppe** nach Wunsch
6. Speichern

Das Gerät erscheint in der Sensor-Tabelle mit Ping-Status (grün/rot). Damit ist zumindest die Erreichbarkeit überwacht.

### Smart Discovery

Die Smart Discovery erkennt die FritzBox automatisch per Ping und Port-Scan (Port 80, 443). Sie erscheint als neues Gerät zum Übernehmen — Typ dann auf `Firewall` ändern.

> **Hinweis:** Wer auf einem anderen Gerät im Netz ein kleines Skript hosten will, das die FritzBox via TR-064-API abfragt und als JSON zurückgibt, kann das über **HTTP-Pull** anbinden. Das ist aber ein eigenes Projekt und nichts für den normalen Betrieb.

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
