// ═══════════════════════════════════════════════════════════
//  NetWatch - SNMP Poller
//  Für Geräte ohne Agent: Drucker, USVs, APs, Switches
//  Starten: node snmp-poller.js
//  Benötigt: npm install net-snmp node-fetch
// ═══════════════════════════════════════════════════════════

const snmp  = require('net-snmp');

// ── Konfiguration ────────────────────────────────────────────
const CONFIG = {
  BACKEND_URL: 'http://localhost:3000/api/data',
  INTERVAL_MS: 60_000,   // alle 60 Sekunden pollen
  TIMEOUT_MS:  5_000,    // SNMP Timeout pro Gerät
};

// ── Geräteliste ───────────────────────────────────────────────
// Hier trägst du alle Geräte ein die du per SNMP überwachen willst
// Community: meistens "public" (nur lesen)
const DEVICES = [
  // ── Drucker ─────────────────────────────────────────────
  {
    ip:        '192.168.1.95',
    hostname:  'PRN-HP-01',
    community: 'public',
    type:      'printer',
    path_l1:   'Wien HQ',
    path_l2:   'Büronetz',
    path_l3:   'Drucker',
    tags:      ['HP', 'A4'],
    profile:   'printer',
  },
  {
    ip:        '192.168.1.96',
    hostname:  'PRN-KYOCERA',
    community: 'public',
    type:      'printer',
    path_l1:   'Wien HQ',
    path_l2:   'Büronetz',
    path_l3:   'Drucker',
    tags:      ['Kyocera', 'A3'],
    profile:   'printer',
  },
  // ── USV (APC) ────────────────────────────────────────────
  {
    ip:        '192.168.1.90',
    hostname:  'USV-RACK-01',
    community: 'public',
    type:      'usv',
    path_l1:   'Wien HQ',
    path_l2:   'Büronetz',
    path_l3:   'USV',
    tags:      ['APC'],
    profile:   'usv_apc',
  },
  // ── Access Point ─────────────────────────────────────────
  {
    ip:        '192.168.1.80',
    hostname:  'AP-BUERO-01',
    community: 'public',
    type:      'ap',
    path_l1:   'Wien HQ',
    path_l2:   'Büronetz',
    path_l3:   'WLAN',
    tags:      ['UniFi', 'WiFi6'],
    profile:   'generic',
  },
  // ── Switch ───────────────────────────────────────────────
  {
    ip:        '10.10.0.100',
    hostname:  'SW-PROD-01',
    community: 'public',
    type:      'switch',
    path_l1:   'Wien HQ',
    path_l2:   'Produktion',
    path_l3:   'Switch',
    tags:      ['Cisco', 'L3'],
    profile:   'switch',
  },
];

// ── SNMP OID Profile ─────────────────────────────────────────
// OID = Object Identifier — die "Adresse" eines Wertes im Gerät
const PROFILES = {
  // Allgemeine OIDs (funktionieren bei fast allen SNMP-Geräten)
  generic: {
    sysUpTime:   '1.3.6.1.2.1.1.3.0',    // Uptime in Hunderstelsekunden
    sysName:     '1.3.6.1.2.1.1.5.0',    // Gerätename
    ifOperStatus:'1.3.6.1.2.1.2.2.1.8.1',// Port 1 Status (1=up, 2=down)
  },
  // HP / Kyocera / Brother Drucker
  printer: {
    sysUpTime:       '1.3.6.1.2.1.1.3.0',
    tonerBlack:      '1.3.6.1.2.1.43.11.1.1.9.1.1',  // Toner Schwarz aktuell
    tonerBlackMax:   '1.3.6.1.2.1.43.11.1.1.8.1.1',  // Toner Schwarz max
    pageCount:       '1.3.6.1.2.1.43.10.2.1.4.1.1',  // Gedruckte Seiten gesamt
    printerStatus:   '1.3.6.1.2.1.25.3.5.1.1.1',     // 3=idle, 4=printing, 5=warmup
  },
  // APC USV
  usv_apc: {
    sysUpTime:       '1.3.6.1.2.1.1.3.0',
    batteryCapacity: '1.3.6.1.4.1.318.1.1.1.2.2.1.0', // Batterie % (APC)
    batteryTemp:     '1.3.6.1.4.1.318.1.1.1.2.2.2.0', // Temperatur °C
    inputVoltage:    '1.3.6.1.4.1.318.1.1.1.3.2.1.0', // Eingangsspannung V
    outputLoad:      '1.3.6.1.4.1.318.1.1.1.4.2.3.0', // Last %
    minutesRemaining:'1.3.6.1.4.1.318.1.1.1.2.2.3.0', // Laufzeit bei Ausfall
  },
  // Cisco / HP Switch
  switch: {
    sysUpTime:       '1.3.6.1.2.1.1.3.0',
    cpuLoad:         '1.3.6.1.4.1.9.2.1.56.0',       // CPU % (Cisco)
    memUsed:         '1.3.6.1.4.1.9.2.1.8.0',        // RAM genutzt (Cisco)
  },
};

// ── SNMP abfragen ─────────────────────────────────────────────
function snmpGet(ip, community, oids) {
  return new Promise((resolve) => {
    const session = snmp.createSession(ip, community, {
      timeout: CONFIG.TIMEOUT_MS,
      retries: 1,
    });

    session.get(Object.values(oids), (err, varbinds) => {
      session.close();

      if (err) {
        resolve(null); // Gerät nicht erreichbar
        return;
      }

      const result = {};
      const keys = Object.keys(oids);

      varbinds.forEach((vb, i) => {
        if (snmp.isVarbindError(vb)) {
          result[keys[i]] = null;
        } else {
          result[keys[i]] = vb.value;
        }
      });

      resolve(result);
    });
  });
}

// ── Gerät-Profil auswerten ────────────────────────────────────
function buildPayload(device, raw) {
  const now    = Date.now();
  const uptime = raw?.sysUpTime
    ? formatUptime(raw.sysUpTime / 100)  // Hunderstelsekunden → Sekunden
    : '—';

  let cpu = 0, mem = 0, status = 'ok';
  const extraTags = [...device.tags];

  // Profil-spezifische Auswertung
  if (device.profile === 'printer' && raw) {
    const tonerPct = raw.tonerBlackMax > 0
      ? Math.round(raw.tonerBlack / raw.tonerBlackMax * 100)
      : null;
    if (tonerPct !== null) {
      if (tonerPct < 10) { extraTags.push('Toner<10%'); status = 'warn'; }
      else if (tonerPct < 25) { extraTags.push('Toner<25%'); }
    }
    if (raw.pageCount) extraTags.push(`${raw.pageCount}Seiten`);
  }

  if (device.profile === 'usv_apc' && raw) {
    const batPct = raw.batteryCapacity ?? 100;
    mem = batPct; // RAM-Feld für Batterie % missbrauchen (wird im Dashboard als "Bat%" angezeigt)
    if (batPct < 30)  { status = 'crit'; extraTags.push('Bat<30%'); }
    else if (batPct < 60) { status = 'warn'; extraTags.push(`Bat${batPct}%`); }
    if (raw.minutesRemaining) extraTags.push(`${raw.minutesRemaining}min`);
    if (raw.outputLoad) cpu = raw.outputLoad;
  }

  if (device.profile === 'switch' && raw) {
    if (raw.cpuLoad !== null) cpu = raw.cpuLoad;
    if (cpu > 80) status = 'warn';
    if (cpu > 95) status = 'crit';
  }

  return {
    hostname: device.hostname,
    ip:       device.ip,
    os:       snmpProfileToOs(device.profile),
    type:     device.type,
    path_l1:  device.path_l1,
    path_l2:  device.path_l2,
    path_l3:  device.path_l3,
    cpu, mem,
    disk:     0,
    ping:     null,
    uptime,
    tags:     [...new Set(extraTags)],
    status,
  };
}

function snmpProfileToOs(profile) {
  const map = {
    printer:  'SNMP Drucker',
    usv_apc:  'APC SNMP',
    switch:   'Cisco IOS',
    generic:  'SNMP Gerät',
  };
  return map[profile] || 'SNMP';
}

function formatUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  return `${d}d ${h}h`;
}

// ── Daten an Backend senden ───────────────────────────────────
async function sendToBackend(payload) {
  try {
    const res = await fetch(CONFIG.BACKEND_URL, {
      method:  'POST',
      body:    JSON.stringify(payload),
      headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return true;
  } catch (err) {
    console.error(`[FEHLER] ${payload.hostname}: ${err.message}`);
    return false;
  }
}

// ── Alle Geräte einmal pollen ─────────────────────────────────
async function pollAll() {
  console.log(`[${new Date().toLocaleTimeString()}] Polling ${DEVICES.length} Geräte...`);

  const promises = DEVICES.map(async (device) => {
    const profile = PROFILES[device.profile] || PROFILES.generic;
    const raw     = await snmpGet(device.ip, device.community, profile);

    if (raw === null) {
      // Gerät nicht erreichbar → als offline melden
      await sendToBackend({
        hostname: device.hostname,
        ip:       device.ip,
        os:       snmpProfileToOs(device.profile),
        type:     device.type,
        path_l1:  device.path_l1,
        path_l2:  device.path_l2,
        path_l3:  device.path_l3,
        status:   'off',
        cpu: 0, mem: 0, disk: 0, ping: null,
        uptime: '—',
        tags: device.tags,
      });
      console.log(`  [OFF]  ${device.hostname} (${device.ip}) — nicht erreichbar`);
      return;
    }

    const payload = buildPayload(device, raw);
    await sendToBackend(payload);
    console.log(`  [OK]   ${device.hostname} — Status: ${payload.status} | CPU: ${payload.cpu}%`);
  });

  await Promise.all(promises);
}

// ── Start ─────────────────────────────────────────────────────
console.log('NetWatch SNMP Poller gestartet');
console.log(`${DEVICES.length} Geräte konfiguriert`);
console.log(`Intervall: ${CONFIG.INTERVAL_MS / 1000}s\n`);

pollAll(); // Sofort beim Start
setInterval(pollAll, CONFIG.INTERVAL_MS);
