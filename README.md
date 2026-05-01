# NetWatch — Setup Anleitung

## Voraussetzungen
- Node.js (LTS) von nodejs.org
- Visual Studio Code
- PowerShell 5.1 oder höher (auf Windows bereits vorhanden)

---

## Schritt 1 — Projektordner anlegen

```
C:\NetWatch\
├── server.js
├── package.json
├── netwatch-v3.html
└── agents\
    ├── agent.ps1
    └── snmp-poller.js
```

---

## Schritt 2 — Node.js Pakete installieren

Terminal in VS Code öffnen (Strg+Ö) und eingeben:

```bash
cd C:\NetWatch
npm install
```

---

## Schritt 3 — server.js anpassen

In server.js die CONFIG am Anfang anpassen:
- NTFY_TOPIC: Einen Namen wählen z.B. "meinefirma-alerts"
  (dann die ntfy App am Handy installieren und diesen Topic abonnieren)

---

## Schritt 4 — Backend starten

```bash
node server.js
```

Ausgabe sollte sein:
  API (Agenten)  → http://localhost:3000
  WebSocket      → ws://localhost:3001

---

## Schritt 5 — Agent auf einem Test-PC ausführen

agent.ps1 öffnen und BackendUrl anpassen:
```powershell
BackendUrl = "http://DEINE-SERVER-IP:3000/api/data"
```

Dann im PowerShell (als Administrator):
```powershell
Set-ExecutionPolicy RemoteSigned -Scope CurrentUser
powershell -File C:\NetWatch\agents\agent.ps1
```

---

## Schritt 6 — Dashboard öffnen

Im Browser aufrufen:
```
http://localhost:3000/netwatch-v3.html
```

Oder die HTML-Datei direkt öffnen — dann aber in netwatch-v3.html
die WebSocket-Verbindung aktivieren (siehe Kommentar im HTML).

---

## Schritt 7 — Agent als Windows Dienst installieren

PowerShell als Administrator:

```powershell
$params = @{
    Name           = "NetWatchAgent"
    DisplayName    = "NetWatch Monitoring Agent"
    Description    = "Sendet Systemmetriken an das NetWatch Backend"
    BinaryPathName = "powershell.exe -NonInteractive -ExecutionPolicy Bypass -File C:\NetWatch\agents\agent.ps1"
    StartupType    = "Automatic"
}
New-Service @params
Start-Service NetWatchAgent
```

---

## SNMP Poller (für Drucker, USVs, APs)

In agents\snmp-poller.js die DEVICES-Liste befüllen,
dann in einem zweiten Terminal:

```bash
node agents/snmp-poller.js
```

---

## Häufige Fehler

**"Cannot find module 'better-sqlite3'"**
→ npm install nochmal ausführen

**"Access denied" bei PowerShell**
→ Set-ExecutionPolicy RemoteSigned -Scope CurrentUser

**Dashboard zeigt keine Daten**
→ Prüfen ob server.js läuft und der Agent die richtige IP hat

**SNMP antwortet nicht**
→ Am Gerät SNMP aktivieren und Community "public" setzen
→ Windows Firewall: UDP Port 161 freigeben
