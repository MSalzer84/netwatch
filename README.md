# NetWatch — Setup Anleitung

Netzwerk-Monitoring für privaten Gebrauch und Firmennetzwerke.
Kein Konto nötig, keine Cloud — alle Daten bleiben im eigenen Netzwerk.

---

## Voraussetzungen

- Node.js (LTS) von nodejs.org
- PowerShell 5.1+ (auf Windows bereits vorhanden)
- Python 3 (auf Mac/Linux bereits vorhanden)

---

## Schritt 1 — Server einrichten

### 1.1 Projektordner anlegen

```
C:\NetWatch\
├── server.js
├── package.json
└── agents\
    ├── agent.ps1
    ├── install-windows.ps1
    └── linux-agent.py
```

### 1.2 Abhängigkeiten installieren

Terminal im NetWatch-Ordner öffnen:

```bash
npm install
```

### 1.3 Push-Alerts einrichten (optional)

In `server.js` die CONFIG am Anfang anpassen:

```js
NTFY_TOPIC: "mein-catscan-alerts"
```

Die kostenlose App **ntfy** am Smartphone installieren und diesen Topic abonnieren.
Bei kritischen Ereignissen kommt dann eine Push-Meldung aufs Handy.

### 1.4 Server starten

```bash
node server.js
```

Erfolgreiche Ausgabe:

```
API (Agenten)  → http://localhost:3000
WebSocket      → ws://localhost:3001
Dashboard      → http://localhost:3000/netwatch-v5.html
```

### 1.5 Dashboard öffnen

Im Browser aufrufen — ersetze die IP durch die deines Servers:

```
http://DEINE-SERVER-IP:3000/netwatch-v5.html
```

Der Server ist jetzt bereit. Im nächsten Schritt werden die Agenten
auf den zu überwachenden Geräten installiert.

---

## Schritt 2 — Agent installieren

Der Agent läuft im Hintergrund und sendet alle 30–60 Sekunden
Messdaten an den NetWatch-Server.

### Windows

1. `agent.ps1` und `install-windows.ps1` auf den Zielrechner kopieren
2. In `agent.ps1` die Server-Adresse anpassen:

```powershell
BackendUrl = "http://DEINE-SERVER-IP:3000/api/data"
```

3. PowerShell als Administrator öffnen und ausführen:

```powershell
Set-ExecutionPolicy RemoteSigned -Scope CurrentUser
powershell -File agent.ps1
```

Der Agent erscheint danach automatisch im Dashboard.

#### Als Windows-Dienst installieren (dauerhaft)

```powershell
powershell -File install-windows.ps1
```

Startet automatisch mit Windows, kein manueller Neustart nötig.

---

### Linux & Mac

`linux-agent.py` auf den Zielrechner kopieren und die Server-Adresse
in der Datei anpassen (Zeile `SERVER_URL`), dann:

```bash
python3 linux-agent.py
```

#### One-Liner (ohne Datei herunterladen)

```bash
curl -s http://DEINE-SERVER-IP:3000/agents/linux-agent.py | python3 - --server http://DEINE-SERVER-IP:3000
```

#### Dauerhaft (systemd)

```bash
curl -s http://DEINE-SERVER-IP:3000/agents/linux-agent.py -o /opt/catscan-agent.py
python3 /opt/catscan-agent.py --server http://DEINE-SERVER-IP:3000
```

---

## Schritt 3 — SNMP für Drucker, USVs, APs (optional)

Geräte ohne Agent werden per SNMP abgefragt. Im zweiten Terminal:

```bash
node agents/snmp-poller.js
```

Am Gerät SNMP aktivieren und Community `public` setzen.
Windows Firewall: UDP Port 161 freigeben.

---

## Häufige Fehler

**"Cannot find module ..."**
→ `npm install` nochmal ausführen

**"Access denied" bei PowerShell**
→ `Set-ExecutionPolicy RemoteSigned -Scope CurrentUser`

**Agent sendet, Dashboard zeigt nichts**
→ Prüfen ob `server.js` läuft und der Agent die richtige IP hat

**SNMP antwortet nicht**
→ SNMP am Gerät aktivieren und Community "public" setzen
→ Firewall: UDP Port 161 freigeben
