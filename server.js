// ═══════════════════════════════════════════════════════════
//  NetWatch - Backend Server
//  Starten: node server.js
//  Port API:       3000  (Agenten senden Daten hierher)
//  Port WebSocket: 3001  (Dashboard empfängt Live-Updates)
// ═══════════════════════════════════════════════════════════

const express   = require('express');
const WebSocket = require('ws');
const sqlite3   = require('sqlite3').verbose();
const { open }  = require('sqlite');
const path      = require('path');
const { exec }  = require('child_process');
const os        = require('os');
const net       = require('net');
const snmpLib   = require('net-snmp');
const dgram   = require('dgram');
const dnsLib  = require('dns').promises;
const http    = require('http');
const https   = require('https');
const tls     = require('tls');
let mdnsLib = null;
try { mdnsLib = require('multicast-dns'); } catch {}

// ── Konfiguration ────────────────────────────────────────────
const CONFIG = {
  API_PORT:       3000,
  WS_PORT:        3001,
  DB_FILE:        'netwatch.db',
  ALERT_CPU:      90,
  WARN_CPU:       75,
  ALERT_MEM:      90,
  WARN_MEM:       80,
  ALERT_DISK:     90,
  WARN_DISK:      80,
  ALERT_PING:     100,
  OFFLINE_SEC:    180,
  NTFY_TOPIC:     '',
  NTFY_URL:       'https://ntfy.sh',
};

let db;

// ── Monitor-Intervalle (dynamisch änderbar) ──────────────────
const MONITOR_DEFAULTS = { ping_interval: 60, sensor_interval: 60 };
let monitorSettings = { ...MONITOR_DEFAULTS };
const monitorTimers = {};
const bwPrev = {}; // deviceId → {in: bytes, out: bytes, ts: ms} für Bandbreiten-Delta

function startMonitorTimers() {
  Object.values(monitorTimers).forEach(t => clearInterval(t));
  const pingMs   = monitorSettings.ping_interval   * 1000;
  const sensorMs = monitorSettings.sensor_interval * 1000;
  monitorTimers.offline   = setInterval(checkOffline,            pingMs);
  monitorTimers.ping      = setInterval(pingMonitor,             pingMs);
  monitorTimers.sensor    = setInterval(pollCustomSensors,       sensorMs);
  monitorTimers.mac       = setInterval(updateAllMacs,           Math.max(pingMs, 60_000));
  monitorTimers.snmpMet    = setInterval(pollAllSnmpMetrics,      sensorMs);
  monitorTimers.httpPull   = setInterval(pollAllDeviceHttpMetrics, sensorMs);
  monitorTimers.hypervisor = setInterval(pollAllHypervisors,       Math.max(sensorMs, 60_000));
  console.log(`[Monitor] Ping alle ${monitorSettings.ping_interval}s · Sensoren alle ${monitorSettings.sensor_interval}s`);
}

// ── OUI-Tabelle (MAC-Prefix → Hersteller) ────────────────────
// Format: '001132': [vendor, type, icon]
const OUI = {
  // NAS
  '001132':['Synology',     'nas',    '💾'], '00089B':['QNAP',         'nas',    '💾'],
  '245EBE':['QNAP',         'nas',    '💾'],
  // Einplatinen-Computer
  'B827EB':['Raspberry Pi', 'server', '🍓'], 'DCA632':['Raspberry Pi', 'server', '🍓'],
  'E45F01':['Raspberry Pi', 'server', '🍓'],
  // Virtualisierung
  '005056':['VMware',       'server', '🖥'], '000C29':['VMware',       'server', '🖥'],
  '000569':['VMware',       'server', '🖥'],
  // USV
  '00C0B7':['APC',          'usv',    '🔋'],
  // Ubiquiti / UniFi
  '0027D1':['Ubiquiti',     'ap',     '📡'], '24A43C':['Ubiquiti',     'ap',     '📡'],
  '687251':['Ubiquiti',     'ap',     '📡'], '788A20':['Ubiquiti',     'ap',     '📡'],
  'B4FBE4':['Ubiquiti',     'ap',     '📡'], 'DC9FDB':['Ubiquiti',     'ap',     '📡'],
  'F09FC2':['Ubiquiti',     'ap',     '📡'], '44D9E7':['Ubiquiti',     'ap',     '📡'],
  '245A4C':['Ubiquiti',     'ap',     '📡'], '18E829':['Ubiquiti',     'ap',     '📡'],
  // AVM Fritz!Box
  '00040E':['AVM Fritz',    'router', '🌐'], '3CA62F':['AVM Fritz',    'router', '🌐'],
  '646E69':['AVM Fritz',    'router', '🌐'], 'B8BEF4':['AVM Fritz',    'router', '🌐'],
  'C486E9':['AVM Fritz',    'router', '🌐'], 'DC396F':['AVM Fritz',    'router', '🌐'],
  'E05BC2':['AVM Fritz',    'router', '🌐'], 'E4F042':['AVM Fritz',    'router', '🌐'],
  '546751':['AVM Fritz',    'router', '🌐'], 'AC162D':['AVM Fritz',    'router', '🌐'],
  '989BCB':['AVM Fritz',    'router', '🌐'],
  // MikroTik
  '000C42':['MikroTik',     'router', '🌐'], '2CC81B':['MikroTik',     'router', '🌐'],
  '4C5E0C':['MikroTik',     'router', '🌐'], 'B869F4':['MikroTik',     'router', '🌐'],
  'CC2DE0':['MikroTik',     'router', '🌐'], 'D4CA6D':['MikroTik',     'router', '🌐'],
  'DC2C6E':['MikroTik',     'router', '🌐'],
  // Cisco
  '00000C':['Cisco',        'switch', '🔀'], '000142':['Cisco',        'switch', '🔀'],
  '00196A':['Cisco',        'switch', '🔀'], '000BD0':['Cisco',        'switch', '🔀'],
  // Netgear
  '00095B':['Netgear',      'switch', '🔀'], '00146C':['Netgear',      'switch', '🔀'],
  '28C68E':['Netgear',      'switch', '🔀'], '30469A':['Netgear',      'switch', '🔀'],
  '9CD36D':['Netgear',      'switch', '🔀'], 'C03F0E':['Netgear',      'switch', '🔀'],
  // TP-Link
  '14CC20':['TP-Link',      'router', '🌐'], '50FA84':['TP-Link',      'router', '🌐'],
  '6C5AB5':['TP-Link',      'router', '🌐'], 'EC086B':['TP-Link',      'router', '🌐'],
  'B0487A':['TP-Link',      'router', '🌐'], 'F4EC38':['TP-Link',      'router', '🌐'],
  // ASUS
  '000C6E':['ASUS',         'router', '🌐'], '04D4C4':['ASUS',         'router', '🌐'],
  '10BF48':['ASUS',         'router', '🌐'], '1C872C':['ASUS',         'router', '🌐'],
  '2C56DC':['ASUS',         'router', '🌐'], '3C970E':['ASUS',         'router', '🌐'],
  '6045CB':['ASUS',         'router', '🌐'], '74D02B':['ASUS',         'router', '🌐'],
  'AC220B':['ASUS',         'router', '🌐'],
  // HP
  '0001E6':['HP',           'server', '🖥'], '3CD92B':['HP',           'server', '🖥'],
  '000D9D':['HP Drucker',   'printer','🖨'], '001771':['HP Drucker',   'printer','🖨'],
  '3863BB':['HP Drucker',   'printer','🖨'], '705A0F':['HP Drucker',   'printer','🖨'],
  // Kyocera
  '002007':['Kyocera',      'printer','🖨'], '000EB5':['Kyocera',      'printer','🖨'],
  // Brother
  '008092':['Brother',      'printer','🖨'], '001BA9':['Brother',      'printer','🖨'],
  // Dell
  '001422':['Dell',         'server', '🖥'], '1C4024':['Dell',         'server', '🖥'],
  'B8CA3A':['Dell',         'server', '🖥'], '18DBF2':['Dell',         'server', '🖥'],
};

function ouiLookup(mac) {
  if (!mac) return null;
  const key = mac.replace(/[:\-]/g, '').toUpperCase().slice(0, 6);
  return OUI[key] || null;
}

async function arpScan() {
  return new Promise((resolve) => {
    exec('arp -a', { timeout: 5000 }, (err, stdout) => {
      if (err || !stdout) { resolve([]); return; }
      const results = [], seen = new Set();
      for (const line of stdout.split('\n')) {
        const m = line.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\s+([0-9a-fA-F]{2}[:\-][0-9a-fA-F]{2}[:\-][0-9a-fA-F]{2}[:\-][0-9a-fA-F]{2}[:\-][0-9a-fA-F]{2}[:\-][0-9a-fA-F]{2})/);
        if (!m) continue;
        const ip  = m[1];
        const mac = m[2].toUpperCase().replace(/-/g, ':');
        if (mac === 'FF:FF:FF:FF:FF:FF' || seen.has(ip)) continue;
        seen.add(ip);
        const oui = ouiLookup(mac);
        results.push({ ip, mac, vendor: oui?.[0] || 'Unbekannt', suggestedType: oui?.[1] || 'server', icon: oui?.[2] || '❓' });
      }
      resolve(results);
    });
  });
}

// ── HTTP-Fingerprint-Signaturen ──────────────────────────────
const HTTP_SIGNATURES = [
  { re: /proxmox virtual environment|proxmox ve/i,        name: 'Proxmox VE',          type: 'server',  os: 'Proxmox VE' },
  { re: /opnsense/i,                                       name: 'OPNsense',            type: 'router',  os: 'OPNsense' },
  { re: /pfsense/i,                                        name: 'pfSense',             type: 'router',  os: 'pfSense' },
  { re: /synology diskstation|diskstation manager|dsm/i,   name: 'Synology DiskStation',type: 'nas',     os: 'Synology DSM' },
  { re: /fritz!box|fritzbox/i,                             name: 'FRITZ!Box',           type: 'router',  os: 'AVM FRITZ!OS' },
  { re: /unifi network|ubiquiti|unifi controller/i,        name: 'UniFi Network',       type: 'ap',      os: 'UniFi OS' },
  { re: /idrac/i,                                          name: 'iDRAC',               type: 'server',  os: 'Dell iDRAC' },
  { re: /hp integrated lights-out|ilo/i,                   name: 'HP iLO',              type: 'server',  os: 'HP iLO' },
  { re: /truenas/i,                                        name: 'TrueNAS',             type: 'nas',     os: 'TrueNAS' },
  { re: /freenas/i,                                        name: 'FreeNAS',             type: 'nas',     os: 'FreeNAS' },
  { re: /home assistant/i,                                 name: 'Home Assistant',      type: 'server',  os: 'Home Assistant OS' },
  { re: /node-red/i,                                       name: 'Node-RED',            type: 'server',  os: 'Node-RED' },
  { re: /grafana/i,                                        name: 'Grafana',             type: 'server',  os: 'Linux' },
  { re: /portainer/i,                                      name: 'Portainer',           type: 'server',  os: 'Linux' },
  { re: /nextcloud/i,                                      name: 'Nextcloud',           type: 'nas',     os: 'Linux' },
  { re: /veeam/i,                                          name: 'Veeam',               type: 'server',  os: 'Windows' },
  { re: /jellyfin/i,                                       name: 'Jellyfin',            type: 'server',  os: 'Linux' },
  { re: /plex/i,                                           name: 'Plex',                type: 'server',  os: 'Linux' },
  { re: /mikrotik|routeros/i,                              name: 'MikroTik RouterOS',   type: 'router',  os: 'RouterOS' },
  { re: /openwrt/i,                                        name: 'OpenWrt',             type: 'router',  os: 'OpenWrt' },
  { re: /dd-wrt/i,                                         name: 'DD-WRT',              type: 'router',  os: 'DD-WRT' },
  { re: /hp laserjet|hp.*printer|hewlett.packard/i,        name: 'HP LaserJet',         type: 'printer', os: 'HP Printer' },
  { re: /kyocera/i,                                        name: 'Kyocera',             type: 'printer', os: 'Kyocera' },
  { re: /brother/i,                                        name: 'Brother',             type: 'printer', os: 'Brother' },
  { re: /supermicro|ipmi/i,                                name: 'Supermicro IPMI',     type: 'server',  os: 'IPMI' },
  { re: /openmediavault/i,                                 name: 'OpenMediaVault',      type: 'nas',     os: 'OpenMediaVault' },
  { re: /casaos/i,                                         name: 'CasaOS',              type: 'server',  os: 'CasaOS' },
  { re: /pi-hole/i,                                        name: 'Pi-hole',             type: 'server',  os: 'Linux' },
  { re: /adguard/i,                                        name: 'AdGuard Home',        type: 'server',  os: 'Linux' },
  { re: /cockpit/i,                                        name: 'Cockpit',             type: 'server',  os: 'Linux' },
];

// ── SNMP-Signaturen (sysDescr-Matching) ─────────────────────
const SNMP_SIGNATURES = [
  { re: /opnsense/i,                         os: 'OPNsense',       type: 'router'  },
  { re: /pfsense/i,                          os: 'pfSense',        type: 'router'  },
  { re: /routeros|mikrotik/i,                os: 'RouterOS',       type: 'router'  },
  { re: /cisco ios(?!.*asa|.*nx)/i,          os: 'Cisco IOS',      type: 'switch'  },
  { re: /cisco adaptive security|cisco asa/i,os: 'Cisco ASA',      type: 'router'  },
  { re: /cisco nx-os|cisco nexus/i,          os: 'Cisco NX-OS',    type: 'switch'  },
  { re: /apc|american power conversion/i,    os: 'APC',            type: 'usv'     },
  { re: /synology/i,                         os: 'Synology DSM',   type: 'nas'     },
  { re: /qnap/i,                             os: 'QNAP QTS',       type: 'nas'     },
  { re: /truenas|freenas/i,                  os: 'TrueNAS',        type: 'nas'     },
  { re: /proxmox/i,                          os: 'Proxmox VE',     type: 'server'  },
  { re: /hp laserjet|jetdirect/i,            os: 'HP Printer',     type: 'printer' },
  { re: /kyocera/i,                          os: 'Kyocera',        type: 'printer' },
  { re: /brother/i,                          os: 'Brother',        type: 'printer' },
  { re: /linux/i,                            os: 'Linux',          type: 'server'  },
  { re: /windows/i,                          os: 'Windows',        type: 'server'  },
  { re: /freebsd/i,                          os: 'FreeBSD',        type: 'server'  },
  { re: /darwin/i,                           os: 'macOS',          type: 'client'  },
];

// ── httpFetch ────────────────────────────────────────────────
function httpFetch(url, timeoutMs = 2500) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (val) => { if (!done) { done = true; resolve(val); } };
    const isHttps = url.startsWith('https');
    const lib = isHttps ? https : http;
    const timer = setTimeout(() => finish(null), timeoutMs);
    try {
      const req = lib.get(url, { rejectUnauthorized: false, timeout: timeoutMs }, (res) => {
        const chunks = [];
        let size = 0;
        res.on('data', (chunk) => {
          size += chunk.length;
          if (size <= 8192) chunks.push(chunk);
          else res.destroy();
        });
        res.on('end', () => {
          clearTimeout(timer);
          finish({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8', 0, 8192) });
        });
        res.on('error', () => { clearTimeout(timer); finish(null); });
      });
      req.on('error', () => { clearTimeout(timer); finish(null); });
      req.on('timeout', () => { req.destroy(); clearTimeout(timer); finish(null); });
    } catch { clearTimeout(timer); finish(null); }
  });
}

// ── httpFingerprint ──────────────────────────────────────────
async function httpFingerprint(ip) {
  const ports = [80, 443, 8080, 8443, 8006, 5000, 5001, 1880, 9000, 9090, 3000, 8123, 8181, 81];
  const results = await Promise.all(ports.map(async (port) => {
    const isHttps = [443, 8443, 5001, 8006].includes(port);
    const url = `${isHttps ? 'https' : 'http'}://${ip}:${port}/`;
    const resp = await httpFetch(url, 2500);
    if (!resp) return null;
    const titleMatch = resp.body.match(/<title[^>]*>([^<]{0,120})<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : '';
    const server = resp.headers['server'] || '';
    const combined = title + ' ' + server + ' ' + resp.body.slice(0, 2000);
    let matched = null;
    for (const sig of HTTP_SIGNATURES) {
      if (sig.re.test(combined)) { matched = sig; break; }
    }
    return { port, url, status: resp.status, title, server, matched };
  }));
  return results.filter(Boolean);
}

// ── sshBanner ────────────────────────────────────────────────
function sshBanner(ip, timeoutMs = 2000) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (val) => { if (!done) { done = true; resolve(val); } };
    const sock = new net.Socket();
    const timer = setTimeout(() => { sock.destroy(); finish(null); }, timeoutMs);
    sock.connect(22, ip, () => {});
    sock.once('data', (buf) => {
      clearTimeout(timer);
      const banner = buf.toString('utf8').split('\n')[0].trim();
      sock.destroy();
      finish(banner || null);
    });
    sock.on('error', () => { clearTimeout(timer); finish(null); });
    sock.on('timeout', () => { sock.destroy(); clearTimeout(timer); finish(null); });
  });
}

// ── snmpProbe ────────────────────────────────────────────────
function snmpProbe(ip) {
  const communities = ['public', 'private'];
  const oids = {
    sysDescr:    '1.3.6.1.2.1.1.1.0',
    sysName:     '1.3.6.1.2.1.1.5.0',
    sysLocation: '1.3.6.1.2.1.1.6.0',
    sysContact:  '1.3.6.1.2.1.1.4.0',
  };

  const tryOne = (community) => new Promise((resolve) => {
    const session = snmpLib.createSession(ip, community, { timeout: 2000, retries: 0 });
    session.get(Object.values(oids), (err, varbinds) => {
      session.close();
      if (err || !varbinds || !varbinds.length) return resolve(null);
      const result = { community };
      const keys = Object.keys(oids);
      varbinds.forEach((vb, i) => {
        if (!snmpLib.isVarbindError(vb)) {
          result[keys[i]] = Buffer.isBuffer(vb.value) ? vb.value.toString('utf8') : String(vb.value);
        }
      });
      if (!result.sysDescr) return resolve(null);
      resolve(result);
    });
  });

  return (async () => {
    for (const c of communities) {
      try { const r = await tryOne(c); if (r) return r; } catch {}
    }
    return null;
  })();
}

// ── reverseDns ───────────────────────────────────────────────
async function reverseDns(ip) {
  try {
    const names = await dnsLib.reverse(ip);
    return names && names.length ? names[0] : null;
  } catch { return null; }
}

// ── ssdpDiscover ─────────────────────────────────────────────
function ssdpDiscover(timeoutMs = 4000) {
  return new Promise((resolve) => {
    const devices = new Map(); // ip -> device
    let sock;
    let timer;
    const finish = () => {
      try { sock && sock.close(); } catch {}
      clearTimeout(timer);
      resolve([...devices.values()]);
    };
    try {
      sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      sock.on('error', () => finish());
      sock.bind(0, () => {
        const msearch = Buffer.from(
          'M-SEARCH * HTTP/1.1\r\n' +
          'HOST: 239.255.255.250:1900\r\n' +
          'MAN: "ssdp:discover"\r\n' +
          'MX: 3\r\n' +
          'ST: ssdp:all\r\n\r\n'
        );
        sock.send(msearch, 0, msearch.length, 1900, '239.255.255.250');
      });
      sock.on('message', async (msg, rinfo) => {
        const ip = rinfo.address;
        if (devices.has(ip)) return;
        const text = msg.toString();
        const locationMatch = text.match(/LOCATION:\s*(\S+)/i);
        const serverMatch   = text.match(/SERVER:\s*(.+)/i);
        const stMatch       = text.match(/\bST:\s*(.+)/i);
        const dev = { ip, server: serverMatch ? serverMatch[1].trim() : '', st: stMatch ? stMatch[1].trim() : '' };
        devices.set(ip, dev);
        if (locationMatch) {
          const loc = locationMatch[1].trim();
          try {
            const resp = await httpFetch(loc, 2000);
            if (resp && resp.body) {
              const xml = resp.body;
              const getTag = (tag) => { const m = xml.match(new RegExp(`<${tag}[^>]*>([^<]*)<\/${tag}>`, 'i')); return m ? m[1].trim() : ''; };
              dev.friendlyName     = getTag('friendlyName');
              dev.manufacturer     = getTag('manufacturer');
              dev.modelName        = getTag('modelName');
              dev.modelNumber      = getTag('modelNumber');
              dev.serialNumber     = getTag('serialNumber');
              dev.presentationURL  = getTag('presentationURL');
              dev.deviceType       = getTag('deviceType');
            }
          } catch {}
        }
      });
      timer = setTimeout(finish, timeoutMs);
    } catch { resolve([]); }
  });
}

// ── mdnsDiscover ─────────────────────────────────────────────
function mdnsDiscover(timeoutMs = 5000) {
  if (!mdnsLib) return Promise.resolve([]);
  return new Promise((resolve) => {
    const byIp = new Map(); // ip -> {hostname, services:[], info:{}}
    let mdns;
    let timer;
    const finish = () => {
      try { mdns && mdns.destroy(); } catch {}
      clearTimeout(timer);
      resolve([...byIp.values()]);
    };
    try {
      mdns = mdnsLib();
      const services = [
        '_http._tcp.local', '_https._tcp.local', '_ssh._tcp.local',
        '_ftp._tcp.local', '_smb._tcp.local', '_ipp._tcp.local',
        '_printer._tcp.local', '_pdl-datastream._tcp.local',
        '_hap._tcp.local', '_googlecast._tcp.local',
        '_unifi._tcp.local', '_device-info._tcp.local',
        '_workstation._tcp.local', '_afpovertcp._tcp.local',
      ];
      mdns.on('response', (response) => {
        const aRecords   = response.answers.filter(r => r.type === 'A');
        const ptrRecords = response.answers.filter(r => r.type === 'PTR');
        const txtRecords = response.answers.filter(r => r.type === 'TXT');
        for (const a of aRecords) {
          const ip = a.data;
          if (!byIp.has(ip)) byIp.set(ip, { ip, hostname: a.name, services: [], info: {} });
          byIp.get(ip).hostname = a.name;
        }
        for (const ptr of ptrRecords) {
          for (const a of aRecords) {
            const ip = a.data;
            const dev = byIp.get(ip);
            if (dev && !dev.services.includes(ptr.name)) dev.services.push(ptr.name);
          }
        }
        for (const txt of txtRecords) {
          for (const a of aRecords) {
            const ip = a.data;
            const dev = byIp.get(ip);
            if (dev && Array.isArray(txt.data)) {
              for (const buf of txt.data) {
                const s = Buffer.isBuffer(buf) ? buf.toString('utf8') : String(buf);
                const eqIdx = s.indexOf('=');
                if (eqIdx > 0) dev.info[s.slice(0, eqIdx)] = s.slice(eqIdx + 1);
              }
            }
          }
        }
      });
      services.forEach(svc => {
        try { mdns.query({ questions: [{ name: svc, type: 'PTR' }] }); } catch {}
      });
      timer = setTimeout(finish, timeoutMs);
    } catch { resolve([]); }
  });
}

// ── Datenbank initialisieren ─────────────────────────────────
async function initDatabase() {
  db = await open({
    filename: CONFIG.DB_FILE,
    driver:   sqlite3.Database,
  });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS devices (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      hostname    TEXT UNIQUE NOT NULL,
      ip          TEXT,
      os          TEXT,
      type        TEXT DEFAULT 'client',
      path_l1     TEXT DEFAULT 'Unbekannt',
      path_l2     TEXT DEFAULT 'Netzwerk',
      path_l3     TEXT DEFAULT 'Allgemein',
      tags        TEXT DEFAULT '[]',
      first_seen  INTEGER,
      last_seen   INTEGER,
      status      TEXT DEFAULT 'unknown'
    );

    CREATE TABLE IF NOT EXISTS metrics (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id INTEGER NOT NULL,
      ts        INTEGER NOT NULL,
      cpu       REAL DEFAULT 0,
      mem       REAL DEFAULT 0,
      disk      REAL DEFAULT 0,
      ping      REAL,
      uptime    TEXT,
      FOREIGN KEY(device_id) REFERENCES devices(id)
    );

    CREATE TABLE IF NOT EXISTS alerts (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id INTEGER NOT NULL,
      ts        INTEGER NOT NULL,
      severity  TEXT NOT NULL,
      type      TEXT NOT NULL,
      message   TEXT NOT NULL,
      acked     INTEGER DEFAULT 0,
      FOREIGN KEY(device_id) REFERENCES devices(id)
    );

    CREATE TABLE IF NOT EXISTS vms (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id INTEGER NOT NULL,
      ts        INTEGER NOT NULL,
      vm_name   TEXT,
      vm_state  TEXT,
      vm_cpu    REAL DEFAULT 0,
      vm_mem_gb REAL DEFAULT 0,
      FOREIGN KEY(device_id) REFERENCES devices(id)
    );

    CREATE TABLE IF NOT EXISTS custom_sensors (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id   INTEGER NOT NULL,
      name        TEXT NOT NULL,
      type        TEXT NOT NULL,
      target      TEXT NOT NULL,
      last_ms     REAL,
      last_status TEXT DEFAULT 'unknown',
      last_ts     INTEGER,
      FOREIGN KEY(device_id) REFERENCES devices(id)
    );

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_metrics_device_ts ON metrics(device_id, ts);
    CREATE INDEX IF NOT EXISTS idx_alerts_device     ON alerts(device_id, acked);
    CREATE INDEX IF NOT EXISTS idx_devices_lastseen  ON devices(last_seen);
  `);

  // ── Migrations: neue Spalten hinzufügen ────────────────────
  try { await db.run('ALTER TABLE devices ADD COLUMN mac TEXT'); } catch {}
  try { await db.run('ALTER TABLE devices ADD COLUMN continuous_since INTEGER'); } catch {}
  try { await db.run('ALTER TABLE devices ADD COLUMN extra_info TEXT'); } catch {}
  try { await db.run('ALTER TABLE devices ADD COLUMN pull_url TEXT'); } catch {}
  try { await db.run('ALTER TABLE devices ADD COLUMN snmp_community TEXT'); } catch {}
  try { await db.run('ALTER TABLE devices ADD COLUMN hypervisor_type TEXT'); } catch {}
  try { await db.run('ALTER TABLE devices ADD COLUMN hypervisor_url TEXT'); } catch {}
  try { await db.run('ALTER TABLE devices ADD COLUMN hypervisor_token TEXT'); } catch {}
  try { await db.run('ALTER TABLE vms ADD COLUMN vm_disk_gb REAL DEFAULT 0'); } catch {}
  try { await db.run('ALTER TABLE vms ADD COLUMN vm_type TEXT DEFAULT \'vm\''); } catch {}
  try { await db.run('ALTER TABLE vms ADD COLUMN vm_id INTEGER'); } catch {}
  try { await db.run('ALTER TABLE devices ADD COLUMN blocked INTEGER DEFAULT 0'); } catch {}
  await db.run(`CREATE TABLE IF NOT EXISTS blocked_hosts (hostname TEXT PRIMARY KEY)`);

  console.log('[DB] Datenbank initialisiert');
}

// ── Express API ──────────────────────────────────────────────
const app = express();
app.use(express.json({ limit: '1mb' }));

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.static(path.dirname(__filename)));

// ── POST /api/data ───────────────────────────────────────────
app.post('/api/data', async (req, res) => {
  try {
    const d   = req.body;
    const now = Date.now();

    if (!d.hostname) return res.status(400).json({ error: 'hostname fehlt' });

    // Gerät wurde explizit gelöscht — Agent-Pushes dauerhaft ignorieren
    const blocked = await db.get('SELECT 1 FROM blocked_hosts WHERE hostname = ?', [d.hostname]);
    if (blocked) return res.json({ ok: true, ignored: true });

    const status = calcStatus(d);

    const extraInfo = d.extra ? JSON.stringify(d.extra) : null;

    await db.run(`
      INSERT INTO devices (hostname, ip, os, type, path_l1, path_l2, path_l3, tags, first_seen, last_seen, status, extra_info)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(hostname) DO UPDATE SET
        ip         = excluded.ip,
        os         = excluded.os,
        last_seen  = excluded.last_seen,
        status     = excluded.status,
        extra_info = COALESCE(excluded.extra_info, extra_info)
    `, [
      d.hostname,
      d.ip       || 'unbekannt',
      d.os       || 'unbekannt',
      d.type     || 'client',
      d.path_l1  || 'Standort',
      d.path_l2  || 'Netzwerk',
      d.path_l3  || 'Allgemein',
      JSON.stringify(d.tags || []),
      now, now, status, extraInfo,
    ]);

    const device = await db.get(`SELECT * FROM devices WHERE hostname = ?`, [d.hostname]);

    await db.run(`
      INSERT INTO metrics (device_id, ts, cpu, mem, disk, ping, uptime)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [
      device.id, now,
      d.cpu  || 0, d.mem  || 0, d.disk || 0,
      d.ping ?? null, d.uptime || null,
    ]);

    if (Array.isArray(d.vms) && d.vms.length > 0) {
      for (const vm of d.vms) {
        await db.run(`
          INSERT INTO vms (device_id, ts, vm_name, vm_state, vm_cpu, vm_mem_gb)
          VALUES (?, ?, ?, ?, ?, ?)
        `, [device.id, now, vm.name || '', vm.state || 'Unknown', vm.cpu || 0, vm.mem_gb || 0]);
      }
      broadcast({ type: 'vms_update', hostname: d.hostname, vms: d.vms });
    }

    if (d.mac) {
      await db.run('UPDATE devices SET mac = ? WHERE id = ?', [d.mac, device.id]);
      device.mac = d.mac;
    }

    await checkAlerts(device, d, now);
    broadcastUpdate(device, d, status);

    res.json({ ok: true, status, device_id: device.id });

  } catch (err) {
    console.error('[POST /api/data]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/devices ─────────────────────────────────────────
app.get('/api/devices', async (req, res) => {
  try {
    const devices = await db.all(`SELECT * FROM devices ORDER BY hostname`);
    const result  = [];

    for (const dev of devices) {
      const m = await db.get(`
        SELECT * FROM metrics WHERE device_id = ? ORDER BY ts DESC LIMIT 1
      `, [dev.id]);

      let extra = null;
      try { extra = dev.extra_info ? JSON.parse(dev.extra_info) : null; } catch {}
      result.push({
        ...dev,
        tags:    JSON.parse(dev.tags || '[]'),
        cpu:     m?.cpu  || 0,
        mem:     m?.mem  || 0,
        disk:    m?.disk || 0,
        ping:    m?.ping || null,
        uptime:  m?.uptime || '—',
        extra,
        status:  (Date.now() - dev.last_seen > CONFIG.OFFLINE_SEC * 1000)
                 ? 'off' : dev.status,
      });
    }

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/device/:hostname/history ────────────────────────
app.get('/api/device/:hostname/history', async (req, res) => {
  try {
    const dev = await db.get(`SELECT * FROM devices WHERE hostname = ?`, [req.params.hostname]);
    if (!dev) return res.status(404).json({ error: 'Gerät nicht gefunden' });

    const metrics = await db.all(`
      SELECT cpu, mem, ping, ts FROM metrics
      WHERE device_id = ? ORDER BY ts DESC LIMIT 20
    `, [dev.id]);

    const vms = await db.all(`
      SELECT * FROM vms WHERE device_id = ?
      AND ts = (SELECT MAX(ts) FROM vms WHERE device_id = ?)
    `, [dev.id, dev.id]);

    res.json({ metrics: metrics.reverse(), vms });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/devices/:hostname/alerts ────────────────────────
app.get('/api/devices/:hostname/alerts', async (req, res) => {
  try {
    const dev = await db.get('SELECT id FROM devices WHERE hostname = ?', [req.params.hostname]);
    if (!dev) return res.status(404).json({ error: 'Gerät nicht gefunden' });
    const alerts = await db.all(
      'SELECT * FROM alerts WHERE device_id = ? ORDER BY ts DESC LIMIT 30',
      [dev.id]
    );
    res.json(alerts);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/traceroute/:ip ───────────────────────────────────
app.get('/api/traceroute/:ip', async (req, res) => {
  const ip = req.params.ip;
  if (!/^[\d.]+$/.test(ip)) return res.status(400).json({ error: 'Ungültige IP' });
  const cmd = process.platform === 'win32'
    ? `tracert -d -w 1000 -h 20 ${ip}`
    : `traceroute -n -w 1 -m 20 ${ip}`;
  try {
    const stdout = await new Promise((resolve) =>
      exec(cmd, { timeout: 35_000 }, (err, out) => resolve(out || ''))
    );
    const hops = [];
    for (const line of stdout.split('\n')) {
      // Windows:  "  1     1 ms     1 ms     1 ms  192.168.1.1"
      // Linux:    "  1  192.168.1.1  1.234 ms ..."
      const wm = line.match(/^\s*(\d+)\s+((?:(?:\d+)\s*ms|\*)\s+(?:(?:\d+)\s*ms|\*)\s+(?:(?:\d+)\s*ms|\*))\s+(\S+)/);
      const lm = line.match(/^\s*(\d+)\s+(\S+)\s+([\d.]+)\s*ms/);
      if (wm) {
        const nums = [...wm[2].matchAll(/(\d+)\s*ms/g)].map(m => parseInt(m[1]));
        const avg  = nums.length ? Math.round(nums.reduce((a,b)=>a+b,0)/nums.length) : null;
        hops.push({ hop: +wm[1], host: wm[3], ms: avg, timeout: nums.length === 0 });
      } else if (lm) {
        hops.push({ hop: +lm[1], host: lm[2], ms: Math.round(parseFloat(lm[3])), timeout: false });
      }
    }
    res.json({ ip, hops });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/snmp-walk/:ip ────────────────────────────────────
app.get('/api/snmp-walk/:ip', (req, res) => {
  const ip        = req.params.ip;
  const community = req.query.community || 'public';
  const rootOid   = req.query.oid || '1.3.6.1.2.1.1';
  if (!/^[\d.]+$/.test(ip)) return res.status(400).json({ error: 'Ungültige IP' });
  const results = [];
  const session = snmpLib.createSession(ip, community, { timeout: 5000, retries: 1 });
  session.subtree(rootOid, 50, (varbinds) => {
    for (const vb of varbinds) {
      if (!snmpLib.isVarbindError(vb)) {
        const v = Buffer.isBuffer(vb.value)
          ? vb.value.toString('utf8').replace(/\0/g, '').trim()
          : String(vb.value);
        results.push({ oid: vb.oid, value: v.slice(0, 300) });
      }
    }
  }, (err) => {
    session.close();
    if (err && !results.length) return res.status(500).json({ error: err.message });
    res.json({ ip, community, oid: rootOid, results });
  });
});

// ── GET /api/alerts ──────────────────────────────────────────
app.get('/api/alerts', async (req, res) => {
  try {
    const alerts = await db.all(`
      SELECT a.*, d.hostname FROM alerts a
      JOIN devices d ON d.id = a.device_id
      WHERE a.acked = 0 ORDER BY a.ts DESC LIMIT 50
    `);
    res.json(alerts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/alerts/:id/ack ─────────────────────────────────
app.post('/api/alerts/:id/ack', async (req, res) => {
  try {
    await db.run(`UPDATE alerts SET acked = 1 WHERE id = ?`, [parseInt(req.params.id)]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/devices ────────────────────────────────────────
app.post('/api/devices', async (req, res) => {
  try {
    const d   = req.body;
    const now = Date.now();
    if (!d.hostname) return res.status(400).json({ error: 'hostname fehlt' });
    const hn = String(d.hostname).toUpperCase();

    // Aus Blockliste entfernen (User fügt Gerät bewusst wieder hinzu)
    await db.run('DELETE FROM blocked_hosts WHERE hostname = ?', [hn]);

    await db.run(`
      INSERT INTO devices (hostname, ip, os, type, path_l1, path_l2, path_l3, tags, first_seen, last_seen, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unknown')
      ON CONFLICT(hostname) DO NOTHING
    `, [
      hn,
      d.ip      || '',
      d.os      || '',
      d.type    || 'client',
      d.path_l1 || 'Unbekannt',
      d.path_l2 || 'Netzwerk',
      d.path_l3 || 'Allgemein',
      JSON.stringify(Array.isArray(d.tags) ? d.tags : []),
      now, now,
    ]);

    const device = await db.get(`SELECT * FROM devices WHERE hostname = ?`, [hn]);
    res.json({ ok: true, device });

    // Sofort im Hintergrund pingen wenn IP bekannt
    if (d.ip && d.ip !== 'unbekannt') {
      pingHostMs(d.ip).then(async ms => {
        if (ms === null) return;
        const st = ms >= CONFIG.ALERT_PING ? 'warn' : 'ok';
        await db.run(`UPDATE devices SET last_seen = ?, status = ? WHERE id = ?`, [Date.now(), st, device.id]);
        await db.run(`INSERT INTO metrics (device_id, ts, cpu, mem, disk, ping) VALUES (?, ?, 0, 0, 0, ?)`,
          [device.id, Date.now(), ms]);
        broadcastUpdate({ ...device, status: st }, { cpu: 0, mem: 0, disk: 0, ping: ms, uptime: '—' }, st);
      }).catch(() => {});
    }
  } catch (err) {
    console.error('[POST /api/devices]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /api/devices/:hostname ───────────────────────────────
app.put('/api/devices/:hostname', async (req, res) => {
  try {
    const hn  = req.params.hostname;
    const d   = req.body;
    const dev = await db.get(`SELECT * FROM devices WHERE hostname = ?`, [hn]);
    if (!dev) return res.status(404).json({ error: 'Gerät nicht gefunden' });

    const newHn = (d.new_hostname || '').trim().toUpperCase();
    if (newHn && newHn !== hn) {
      const clash = await db.get('SELECT id FROM devices WHERE hostname = ?', [newHn]);
      if (clash) return res.status(409).json({ error: `Hostname "${newHn}" bereits vergeben` });
      await db.run('UPDATE devices SET hostname = ? WHERE hostname = ?', [newHn, hn]);
      await db.run('UPDATE blocked_hosts SET hostname = ? WHERE hostname = ?', [newHn, hn]);
      await db.run('INSERT OR IGNORE INTO blocked_hosts (hostname) VALUES (?)', [hn]);
    }

    const finalHn = (newHn && newHn !== hn) ? newHn : hn;
    await db.run(`
      UPDATE devices SET
        ip      = ?,
        os      = ?,
        type    = ?,
        path_l1 = ?,
        path_l2 = ?,
        path_l3 = ?,
        tags    = ?
      WHERE hostname = ?
    `, [
      d.ip      ?? dev.ip,
      d.os      ?? dev.os,
      d.type    ?? dev.type,
      d.path_l1 ?? dev.path_l1,
      d.path_l2 ?? dev.path_l2,
      d.path_l3 ?? dev.path_l3,
      JSON.stringify(Array.isArray(d.tags) ? d.tags : JSON.parse(dev.tags || '[]')),
      finalHn,
    ]);

    const updated = await db.get(`SELECT * FROM devices WHERE hostname = ?`, [finalHn]);
    if (newHn && newHn !== hn) broadcast({ type: 'device_deleted', hostname: hn });
    broadcast({ type: 'device_updated', device: { ...updated, tags: JSON.parse(updated.tags || '[]') } });
    res.json({ ok: true, hostname: finalHn });
  } catch (err) {
    console.error('[PUT /api/devices]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/devices/:hostname ────────────────────────────
app.delete('/api/devices/:hostname', async (req, res) => {
  try {
    const hn  = req.params.hostname;
    const dev = await db.get(`SELECT * FROM devices WHERE hostname = ?`, [hn]);
    if (!dev) return res.status(404).json({ error: 'Gerät nicht gefunden' });

    await db.run(`INSERT OR IGNORE INTO blocked_hosts (hostname) VALUES (?)`, [hn]);
    await db.run(`DELETE FROM custom_sensors WHERE device_id = ?`, [dev.id]);
    await db.run(`DELETE FROM metrics WHERE device_id = ?`, [dev.id]);
    await db.run(`DELETE FROM alerts  WHERE device_id = ?`, [dev.id]);
    await db.run(`DELETE FROM vms     WHERE device_id = ?`, [dev.id]);
    await db.run(`DELETE FROM devices WHERE id = ?`,        [dev.id]);

    broadcast({ type: 'device_deleted', hostname: hn });
    res.json({ ok: true });
  } catch (err) {
    console.error('[DELETE /api/devices]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Ping-Hilfsfunktionen ─────────────────────────────────────
function pingHostMs(ip) {
  return new Promise((resolve) => {
    const isWin = process.platform === 'win32';
    const cmd   = isWin
      ? `ping -n 1 -w 1000 ${ip}`
      : `ping -c 1 -W 1 ${ip}`;
    exec(cmd, (err, stdout) => {
      if (isWin) {
        const m = stdout.match(/[Zz]eit[<=](\d+(?:\.\d+)?)ms|time[<=](\d+(?:\.\d+)?)ms/i)
               || stdout.match(/(\d+)ms/);
        resolve(m ? Math.round(parseFloat(m[1] || m[2])) : null);
      } else {
        if (err) return resolve(null);
        const m = stdout.match(/time=(\d+\.?\d*)\s*ms/);
        resolve(m ? Math.round(parseFloat(m[1])) : null);
      }
    });
  });
}

function pingHost(ip) {
  return pingHostMs(ip).then(ms => ({ ip, alive: ms !== null }));
}

// ── GET /api/ping/:ip ────────────────────────────────────────
app.get('/api/ping/:ip', async (req, res) => {
  try {
    const ms = await pingHostMs(req.params.ip);
    res.json({ ip: req.params.ip, alive: ms !== null, ms });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/arp ─────────────────────────────────────────────
app.get('/api/arp', async (req, res) => {
  try {
    const known  = await db.all('SELECT hostname, ip FROM devices WHERE ip IS NOT NULL');
    const byIp   = Object.fromEntries(known.map(d => [d.ip, d.hostname]));
    const hosts  = await arpScan();
    hosts.forEach(h => { h.known = !!byIp[h.ip]; h.hostname = byIp[h.ip] || null; });
    res.json({ hosts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/discover ────────────────────────────────────────
app.get('/api/discover', async (req, res) => {
  try {
    const [arpHosts, ssdpDevs, mdnsDevs] = await Promise.all([
      arpScan(),
      ssdpDiscover(4000),
      mdnsDiscover(4500),
    ]);

    // Merge by IP
    const merged = new Map(); // ip -> device

    for (const h of arpHosts) {
      merged.set(h.ip, {
        ip: h.ip, mac: h.mac, vendor: h.vendor,
        suggestedType: h.suggestedType, icon: h.icon,
        methods: ['arp'],
      });
    }

    for (const s of ssdpDevs) {
      const existing = merged.get(s.ip) || { ip: s.ip, methods: [] };
      if (!existing.methods.includes('ssdp')) existing.methods.push('ssdp');
      existing.friendlyName   = existing.friendlyName || s.friendlyName;
      existing.manufacturer   = existing.manufacturer || s.manufacturer;
      existing.modelName      = existing.modelName    || s.modelName;
      existing.modelNumber    = existing.modelNumber  || s.modelNumber;
      existing.ssdpServer     = s.server;
      existing.deviceType     = s.deviceType;
      merged.set(s.ip, existing);
    }

    for (const m of mdnsDevs) {
      const existing = merged.get(m.ip) || { ip: m.ip, methods: [] };
      if (!existing.methods.includes('mdns')) existing.methods.push('mdns');
      existing.mdnsHostname = existing.mdnsHostname || m.hostname;
      existing.mdnsServices = m.services;
      existing.mdnsInfo     = m.info;
      if (m.info && m.info.model) existing.model = m.info.model;
      if (m.info && m.info.md)    existing.modelName = existing.modelName || m.info.md;
      merged.set(m.ip, existing);
    }

    // Check DB for known devices
    const known = await db.all('SELECT hostname, ip FROM devices WHERE ip IS NOT NULL');
    const byIp  = Object.fromEntries(known.map(d => [d.ip, d.hostname]));

    const devices = [...merged.values()].map(d => ({
      ...d,
      known:    !!byIp[d.ip],
      hostname: byIp[d.ip] || null,
    }));

    // Sort numerically by IP
    devices.sort((a, b) => {
      const ap = a.ip.split('.').map(Number);
      const bp = b.ip.split('.').map(Number);
      for (let i = 0; i < 4; i++) if (ap[i] !== bp[i]) return ap[i] - bp[i];
      return 0;
    });

    res.json({ devices });
  } catch (err) {
    console.error('[GET /api/discover]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/enrich ─────────────────────────────────────────
app.post('/api/enrich', async (req, res) => {
  try {
    const { ip } = req.body;
    if (!ip) return res.status(400).json({ error: 'ip fehlt' });

    const [httpResults, sshResult, snmpResult, dnsResult] = await Promise.all([
      httpFingerprint(ip),
      sshBanner(ip),
      snmpProbe(ip),
      reverseDns(ip),
    ]);

    // Determine suggested OS / type / name
    let suggestedOs   = null;
    let suggestedType = null;
    let suggestedName = null;

    // 1. HTTP matches
    const httpMatch = httpResults.find(r => r.matched);
    if (httpMatch) {
      suggestedOs   = httpMatch.matched.os;
      suggestedType = httpMatch.matched.type;
      suggestedName = httpMatch.matched.name;
    }

    // 2. SNMP sysDescr
    if (snmpResult && snmpResult.sysDescr) {
      for (const sig of SNMP_SIGNATURES) {
        if (sig.re.test(snmpResult.sysDescr)) {
          if (!suggestedOs)   suggestedOs   = sig.os;
          if (!suggestedType) suggestedType = sig.type;
          if (!suggestedName) suggestedName = snmpResult.sysName || null;
          break;
        }
      }
    }

    // 3. SSH banner hints
    if (sshResult) {
      const sshOs = sshResult.toLowerCase().includes('windows') ? 'Windows'
                  : sshResult.toLowerCase().includes('freebsd') ? 'FreeBSD'
                  : sshResult.toLowerCase().includes('ubuntu')  ? 'Ubuntu Linux'
                  : sshResult.toLowerCase().includes('debian')  ? 'Debian Linux'
                  : sshResult.toLowerCase().includes('openssh') ? 'Linux'
                  : null;
      if (!suggestedOs && sshOs) suggestedOs = sshOs;
      if (!suggestedType) suggestedType = 'server';
    }

    // Build services list from HTTP
    const services = httpResults
      .filter(r => r.status && r.status < 500)
      .map(r => ({
        port:    r.port,
        url:     r.url,
        status:  r.status,
        title:   r.title,
        server:  r.server,
        matched: r.matched ? { name: r.matched.name, type: r.matched.type, os: r.matched.os } : null,
      }));

    res.json({
      ip,
      dns:           dnsResult,
      http:          services,
      ssh:           sshResult ? { banner: sshResult, os: suggestedOs } : null,
      snmp:          snmpResult,
      suggestedOs,
      suggestedType,
      suggestedName,
      services,
    });
  } catch (err) {
    console.error('[POST /api/enrich]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/scan ───────────────────────────────────────────

app.post('/api/scan', async (req, res) => {
  try {
    const { subnet } = req.body;
    if (!subnet || !/^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(subnet))
      return res.status(400).json({ error: 'Subnetz-Format ungültig (Beispiel: 192.168.1)' });

    const ips   = Array.from({ length: 254 }, (_, i) => `${subnet}.${i + 1}`);
    const alive = [];
    const BATCH = 30;

    for (let i = 0; i < ips.length; i += BATCH) {
      const results = await Promise.all(ips.slice(i, i + BATCH).map(pingHost));
      alive.push(...results.filter(r => r.alive).map(r => r.ip));
    }

    const known = await db.all('SELECT hostname, ip FROM devices');
    const byIp  = Object.fromEntries(known.map(d => [d.ip, d.hostname]));
    const arpData = await arpScan();
    const byArp   = Object.fromEntries(arpData.map(a => [a.ip, a]));

    const hosts = alive.map(ip => {
      const arp = byArp[ip];
      return {
        ip,
        known:         ip in byIp,
        hostname:      byIp[ip] || null,
        mac:           arp?.mac           || null,
        vendor:        arp?.vendor        || null,
        suggestedType: arp?.suggestedType || 'server',
        icon:          arp?.icon          || '❓',
      };
    });

    res.json({ found: hosts.length, hosts });
  } catch (err) {
    console.error('[POST /api/scan]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/networks ────────────────────────────────────────
app.get('/api/networks', (req, res) => {
  const ifaces  = os.networkInterfaces();
  const subnets = [];
  for (const [name, addrs] of Object.entries(ifaces)) {
    for (const addr of addrs) {
      if (addr.family !== 'IPv4' || addr.internal) continue;
      const subnet = addr.address.split('.').slice(0, 3).join('.');
      subnets.push({ iface: name, ip: addr.address, subnet, netmask: addr.netmask });
    }
  }
  res.json(subnets);
});

// ── Custom Sensors CRUD ───────────────────────────────────────
app.get('/api/devices/:hostname/sensors', async (req, res) => {
  try {
    const dev = await db.get(`SELECT id FROM devices WHERE hostname = ?`, [req.params.hostname]);
    if (!dev) return res.status(404).json({ error: 'Gerät nicht gefunden' });
    const sensors = await db.all(`SELECT * FROM custom_sensors WHERE device_id = ?`, [dev.id]);
    res.json(sensors);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/devices/:hostname/sensors', async (req, res) => {
  try {
    const dev = await db.get(`SELECT id FROM devices WHERE hostname = ?`, [req.params.hostname]);
    if (!dev) return res.status(404).json({ error: 'Gerät nicht gefunden' });
    const { name, type, target } = req.body;
    if (!name || !type || !target) return res.status(400).json({ error: 'name, type und target erforderlich' });
    const r = await db.run(
      `INSERT INTO custom_sensors (device_id, name, type, target) VALUES (?, ?, ?, ?)`,
      [dev.id, name, type, target]
    );
    const sensor = await db.get(`SELECT cs.*, d.hostname FROM custom_sensors cs JOIN devices d ON d.id=cs.device_id WHERE cs.id = ?`, [r.lastID]);
    res.json(sensor);
    // Sofort prüfen ohne den Request zu blockieren
    setImmediate(async () => {
      if (sensor) {
        await pollSingleSensor(sensor).catch(() => {});
        broadcast({ type: 'sensors_changed', hostname: req.params.hostname });
      }
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/sensors/:id', async (req, res) => {
  try {
    const s = await db.get(`SELECT cs.*, d.hostname FROM custom_sensors cs JOIN devices d ON d.id=cs.device_id WHERE cs.id=?`, [req.params.id]);
    if (!s) return res.status(404).json({ error: 'Sensor nicht gefunden' });
    await db.run(`DELETE FROM custom_sensors WHERE id = ?`, [req.params.id]);
    broadcast({ type: 'sensors_changed', hostname: s.hostname });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Hilfsfunktionen ──────────────────────────────────────────
function calcStatus(d) {
  if (d.cpu  >= CONFIG.ALERT_CPU)  return 'crit';
  if (d.mem  >= CONFIG.ALERT_MEM)  return 'crit';
  if (d.disk >= CONFIG.ALERT_DISK) return 'crit';
  if (d.cpu  >= CONFIG.WARN_CPU)   return 'warn';
  if (d.mem  >= CONFIG.WARN_MEM)   return 'warn';
  if (d.disk >= CONFIG.WARN_DISK)  return 'warn';
  if (d.ping >= CONFIG.ALERT_PING) return 'warn';
  return 'ok';
}

async function checkAlerts(device, d, now) {
  const checks = [
    { cond: d.cpu  >= CONFIG.ALERT_CPU,  sev: 'crit', type: 'cpu',  msg: `CPU ${d.cpu}% — kritisch überlastet` },
    { cond: d.cpu  >= CONFIG.WARN_CPU,   sev: 'warn', type: 'cpu',  msg: `CPU ${d.cpu}% — Warnschwelle überschritten` },
    { cond: d.mem  >= CONFIG.ALERT_MEM,  sev: 'crit', type: 'mem',  msg: `RAM ${d.mem}% — kritisch, Swap aktiv` },
    { cond: d.mem  >= CONFIG.WARN_MEM,   sev: 'warn', type: 'mem',  msg: `RAM ${d.mem}% — Warnschwelle` },
    { cond: d.disk >= CONFIG.ALERT_DISK, sev: 'crit', type: 'disk', msg: `Disk ${d.disk}% — Laufwerk fast voll` },
    { cond: d.ping >= CONFIG.ALERT_PING, sev: 'warn', type: 'ping', msg: `Ping ${d.ping}ms — erhöhte Latenz` },
  ];

  for (const c of checks) {
    if (!c.cond) continue;
    const existing = await db.get(`
      SELECT id FROM alerts
      WHERE device_id = ? AND type = ? AND acked = 0 AND ts > ?
    `, [device.id, c.type, now - 300_000]);

    if (!existing) {
      await db.run(`
        INSERT INTO alerts (device_id, ts, severity, type, message)
        VALUES (?, ?, ?, ?, ?)
      `, [device.id, now, c.sev, c.type, c.msg]);

      if (CONFIG.NTFY_TOPIC) sendPush(device.hostname, c.sev, c.msg);
      console.log(`[ALERT] ${c.sev.toUpperCase()} — ${device.hostname}: ${c.msg}`);
    }
  }
}

async function sendPush(hostname, severity, message) {
  if (!CONFIG.NTFY_TOPIC) return;
  try {
    await fetch(`${CONFIG.NTFY_URL}/${CONFIG.NTFY_TOPIC}`, {
      method:  'POST',
      body:    `${hostname}: ${message}`,
      headers: {
        'Title':    `NetWatch ${severity === 'crit' ? 'KRITISCH' : 'Warnung'}`,
        'Priority': severity === 'crit' ? 'urgent' : 'default',
      },
    });
  } catch (err) {
    console.error('[Push]', err.message);
  }
}

// ── WebSocket Server ─────────────────────────────────────────
const wss = new WebSocket.Server({ port: CONFIG.WS_PORT });

wss.on('connection', async (ws, req) => {
  console.log(`[WS] Dashboard verbunden von ${req.socket.remoteAddress}`);

  try {
    const devices = await db.all(`SELECT * FROM devices ORDER BY hostname`);
    const enriched = [];
    for (const dev of devices) {
      const m = await db.get(`SELECT * FROM metrics WHERE device_id = ? ORDER BY ts DESC LIMIT 1`, [dev.id]);
      enriched.push({
        ...dev,
        tags: JSON.parse(dev.tags || '[]'),
        cpu: m?.cpu||0, mem: m?.mem||0, disk: m?.disk||0,
        ping: m?.ping, uptime: m?.uptime||'—'
      });
    }
    const alerts = await db.all(`
      SELECT a.*, d.hostname FROM alerts a
      JOIN devices d ON d.id = a.device_id
      WHERE a.acked = 0 ORDER BY a.ts DESC LIMIT 50
    `);
    ws.send(JSON.stringify({ type: 'init', devices: enriched, alerts }));
  } catch (err) {
    console.error('[WS init]', err.message);
  }

  ws.on('message', async (raw) => {
    try {
      const msg = JSON.parse(raw);
      if (msg.type === 'ack' && msg.id) {
        await db.run(`UPDATE alerts SET acked = 1 WHERE id = ?`, [msg.id]);
        broadcast({ type: 'alert_acked', id: msg.id });
      }
    } catch {}
  });

  ws.on('close', () => console.log('[WS] Dashboard getrennt'));
});

function formatUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function broadcastUpdate(device, data, status) {
  let extra = null;
  try { extra = device.extra_info ? JSON.parse(device.extra_info) : (data.extra || null); } catch {}
  broadcast({
    type:     'update',
    hostname: device.hostname,
    ip:       device.ip,
    mac:      device.mac || null,
    status,
    cpu:      data.cpu  || 0,
    mem:      data.mem  || 0,
    disk:     data.disk || 0,
    ping:     data.ping ?? null,
    uptime:   data.uptime || '—',
    extra,
    ts:       Date.now(),
  });
}

function broadcast(data) {
  const msg = typeof data === 'string' ? data : JSON.stringify(data);
  wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(msg); });
}

// ── Offline-Check alle 60 Sekunden ──────────────────────────
async function checkOffline() {
  try {
    const threshold = Date.now() - CONFIG.OFFLINE_SEC * 1000;
    const offline = await db.all(`
      SELECT * FROM devices WHERE last_seen < ? AND status != 'off'
    `, [threshold]);

    for (const dev of offline) {
      await db.run(`UPDATE devices SET status = 'off', continuous_since = NULL WHERE id = ?`, [dev.id]);
      await db.run(`
        INSERT INTO alerts (device_id, ts, severity, type, message)
        VALUES (?, ?, 'crit', 'offline', ?)
      `, [dev.id, Date.now(), `Gerät antwortet nicht mehr — kein Signal seit über ${CONFIG.OFFLINE_SEC}s`]);
      broadcast({ type: 'offline', hostname: dev.hostname });
      console.log(`[OFFLINE] ${dev.hostname} als offline markiert`);
    }
  } catch (err) {
    console.error('[Offline-Check]', err.message);
  }
}

// ── Custom-Sensor-Checks ─────────────────────────────────────
function checkPort(ip, port, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    let done = false;
    const finish = (ok) => { if (!done) { done = true; sock.destroy(); resolve(ok); } };
    sock.setTimeout(timeoutMs);
    sock.on('connect', () => finish(true));
    sock.on('timeout', () => finish(false));
    sock.on('error',   () => finish(false));
    sock.connect(port, ip);
  });
}

async function checkHttp(url, timeoutMs = 5000) {
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctrl.signal, redirect: 'follow' });
    clearTimeout(timer);
    return { ok: r.status < 500, code: r.status };
  } catch {
    clearTimeout(timer);
    return { ok: false, code: 0 };
  }
}

// Prüft SSL-Zertifikat und gibt verbleibende Tage zurück
function checkSslExpiry(host, port = 443, timeoutMs = 6000) {
  return new Promise((resolve) => {
    const sock = tls.connect({ host, port, rejectUnauthorized: false, timeout: timeoutMs }, () => {
      try {
        const cert = sock.getPeerCertificate();
        sock.destroy();
        if (!cert || !cert.valid_to) { resolve(null); return; }
        const expiry = new Date(cert.valid_to);
        const days   = Math.floor((expiry - Date.now()) / 86_400_000);
        resolve({ days, cn: cert.subject?.CN || host });
      } catch { sock.destroy(); resolve(null); }
    });
    sock.on('error', () => { sock.destroy(); resolve(null); });
    sock.setTimeout(timeoutMs, () => { sock.destroy(); resolve(null); });
  });
}

// Pingt n-mal und liefert Durchschnitt + Paketverlust %
async function pingMultiple(ip, count = 3) {
  const times  = await Promise.all(Array.from({ length: count }, () => pingHostMs(ip)));
  const valid  = times.filter(t => t !== null);
  const loss   = Math.round((count - valid.length) / count * 100);
  const avg    = valid.length ? Math.round(valid.reduce((a, b) => a + b, 0) / valid.length) : null;
  return { avg_ms: avg, loss_pct: loss };
}

function snmpGetValue(ip, community, oid, timeoutMs = 4000) {
  return new Promise((resolve) => {
    const session = snmpLib.createSession(ip, community, { timeout: timeoutMs, retries: 1 });
    session.get([oid], (err, varbinds) => {
      session.close();
      if (err || !varbinds || !varbinds.length || snmpLib.isVarbindError(varbinds[0])) {
        resolve(null);
        return;
      }
      const v = varbinds[0].value;
      if (Buffer.isBuffer(v)) { resolve(null); return; }
      resolve(Number(v));
    });
  });
}

async function pollSingleSensor(s) {
  let status = 'off', ms = null;
  const t0 = Date.now();

  if (s.type === 'port') {
    const lastColon = s.target.lastIndexOf(':');
    const ip   = s.target.slice(0, lastColon);
    const port = parseInt(s.target.slice(lastColon + 1));
    const alive = await checkPort(ip, port);
    ms     = alive ? Date.now() - t0 : null;
    status = alive ? 'ok' : 'off';
  } else if (s.type === 'http') {
    const res = await checkHttp(s.target);
    ms     = res.ok ? Date.now() - t0 : null;
    status = res.ok ? 'ok' : res.code >= 400 && res.code < 500 ? 'warn' : 'off';
  } else if (s.type === 'snmp') {
    try {
      const cfg = JSON.parse(s.target);
      const raw = await snmpGetValue(cfg.ip, cfg.community || 'public', cfg.oid);
      if (raw !== null) {
        const val = cfg.divisor ? raw / cfg.divisor : raw;
        ms = Math.round(val * 10) / 10;
        if (cfg.warn != null && cfg.crit != null) {
          status = cfg.invert
            ? (val <= cfg.crit ? 'crit' : val <= cfg.warn ? 'warn' : 'ok')
            : (val >= cfg.crit ? 'crit' : val >= cfg.warn ? 'warn' : 'ok');
        } else {
          status = 'ok';
        }
      }
    } catch { status = 'off'; }
  } else if (s.type === 'ssl') {
    try {
      const cfg  = JSON.parse(s.target);
      const res  = await checkSslExpiry(cfg.host, cfg.port || 443);
      if (res !== null) {
        ms     = res.days; // Wert = verbleibende Tage
        const warnD = cfg.warn ?? 30;
        const critD = cfg.crit ?? 7;
        status = ms <= critD ? 'crit' : ms <= warnD ? 'warn' : 'ok';
      }
    } catch { status = 'off'; }
  }

  const prev = await db.get('SELECT last_status, device_id FROM custom_sensors WHERE id = ?', [s.id]);
  await db.run(
    `UPDATE custom_sensors SET last_ms = ?, last_status = ?, last_ts = ? WHERE id = ?`,
    [ms, status, Date.now(), s.id]
  );

  // Alarm in DB schreiben wenn Sensor auf crit/warn wechselt
  const prevStatus = prev?.last_status || 'ok';
  const worsened = (status === 'crit' && prevStatus !== 'crit') ||
                   (status === 'warn' && prevStatus === 'ok') ||
                   (status === 'off'  && prevStatus === 'ok');
  if (worsened && prev?.device_id) {
    const sev = status === 'crit' ? 'crit' : 'warn';
    const valStr = ms !== null ? ` (${ms}${s.unit || ''})` : '';
    await db.run(
      `INSERT INTO alerts (device_id, ts, severity, type, message) VALUES (?, ?, ?, 'sensor', ?)`,
      [prev.device_id, Date.now(), sev, `Sensor "${s.name}"${valStr} — ${status === 'off' ? 'nicht erreichbar' : status === 'crit' ? 'kritisch' : 'Warnschwelle'}`]
    );
  }

  broadcast({ type: 'sensor_update', hostname: s.hostname, sensorId: s.id, name: s.name, status, ms });
  return { status, ms };
}

// ── Gerätespezifische Metriken via SNMP ──────────────────────
// Fragt CPU%, RAM%, Disk%, Temperatur per Standard-SNMP-OIDs ab.
// Unterstützt: Net-SNMP (Linux/NAS), Windows SNMP, Cisco.
async function snmpGetDeviceMetrics(device) {
  const ip = device.ip;
  if (!ip || ip === 'unbekannt' || ip === '?') return null;
  const community = device.snmp_community || 'public';
  const t = 3000;

  let cpu = null, mem = null, disk = null, temp = null;

  // CPU: Net-SNMP/UCD (Linux, Synology, QNAP) → laLoadFloat 1-min
  try {
    const v = await snmpGetValue(ip, community, '1.3.6.1.4.1.2021.10.1.3.1', t);
    if (v !== null) cpu = Math.min(100, Math.max(0, Math.round(parseFloat(String(v)))));
  } catch {}
  // CPU: Windows SNMP service
  if (cpu === null) {
    try {
      const v = await snmpGetValue(ip, community, '1.3.6.1.2.1.25.3.3.1.2.1', t);
      if (v !== null) cpu = Math.min(100, Math.max(0, Math.round(Number(v))));
    } catch {}
  }
  // CPU: Cisco
  if (cpu === null) {
    try {
      const v = await snmpGetValue(ip, community, '1.3.6.1.4.1.9.2.1.56.0', t);
      if (v !== null) cpu = Math.min(100, Math.max(0, Math.round(Number(v))));
    } catch {}
  }

  // RAM: Net-SNMP memTotalReal / memAvailReal (kB)
  try {
    const total = await snmpGetValue(ip, community, '1.3.6.1.4.1.2021.4.5.0', t);
    const free  = await snmpGetValue(ip, community, '1.3.6.1.4.1.2021.4.6.0', t);
    if (total && free && total > 0) mem = Math.min(100, Math.max(0, Math.round((1 - free / total) * 100)));
  } catch {}

  // Disk: UCD-SNMP percent used
  try {
    const v = await snmpGetValue(ip, community, '1.3.6.1.4.1.2021.9.1.9.1', t);
    if (v !== null) disk = Math.min(100, Math.max(0, Math.round(Number(v))));
  } catch {}

  // Temperature: LM-Sensors (milliCelsius)
  try {
    const v = await snmpGetValue(ip, community, '1.3.6.1.4.1.2021.13.16.2.1.3.1', t);
    if (v !== null && v > 0) temp = Math.round(v / 1000);
  } catch {}

  if (cpu === null && mem === null && disk === null) return null;
  return { cpu, mem, disk, temp };
}

async function pollAllSnmpMetrics() {
  try {
    // Nur Geräte ohne frische Agent-Daten (letzter Agent-Push < 3 Min.)
    const agentThresh = Date.now() - 180_000;
    const targets = await db.all(`
      SELECT d.* FROM devices d
      LEFT JOIN metrics m ON m.device_id = d.id AND m.cpu > 0 AND m.ts > ?
      WHERE m.id IS NULL
        AND d.ip IS NOT NULL
        AND d.ip NOT IN ('unbekannt','?','')
        AND d.status != 'off'
    `, [agentThresh]);

    for (const dev of targets) {
      try {
        const met = await snmpGetDeviceMetrics(dev);
        if (!met) continue;
        const { cpu, mem, disk, temp } = met;
        const now = Date.now();

        // Bandbreite via SNMP ifInOctets/ifOutOctets (Interface 1)
        const community = dev.snmp_community || 'public';
        const [bwInRaw, bwOutRaw] = await Promise.all([
          snmpGetValue(dev.ip, community, '1.3.6.1.2.1.2.2.1.10.1', 2000), // ifInOctets.1
          snmpGetValue(dev.ip, community, '1.3.6.1.2.1.2.2.1.16.1', 2000), // ifOutOctets.1
        ]);
        let bw_in_kbps = null, bw_out_kbps = null;
        const prevBw = bwPrev[dev.id];
        if (prevBw && (now - prevBw.ts) < 300_000) {
          const dt = (now - prevBw.ts) / 1000;
          if (bwInRaw !== null && prevBw.in !== null) {
            let d = bwInRaw >= prevBw.in ? bwInRaw - prevBw.in : bwInRaw + (4294967296 - prevBw.in);
            bw_in_kbps = Math.round(d * 8 / dt / 1000);
          }
          if (bwOutRaw !== null && prevBw.out !== null) {
            let d = bwOutRaw >= prevBw.out ? bwOutRaw - prevBw.out : bwOutRaw + (4294967296 - prevBw.out);
            bw_out_kbps = Math.round(d * 8 / dt / 1000);
          }
        }
        if (bwInRaw !== null || bwOutRaw !== null) {
          bwPrev[dev.id] = { in: bwInRaw, out: bwOutRaw, ts: now };
        }

        const latest = await db.get('SELECT * FROM metrics WHERE device_id = ? ORDER BY ts DESC LIMIT 1', [dev.id]);
        await db.run(
          'INSERT INTO metrics (device_id, ts, cpu, mem, disk, ping, uptime) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [dev.id, now, cpu ?? 0, mem ?? 0, disk ?? latest?.disk ?? 0, latest?.ping ?? null, latest?.uptime ?? '—']
        );
        let ei = {}; try { ei = JSON.parse(dev.extra_info || '{}'); } catch {}
        if (temp != null) ei.temperature = temp;
        if (bw_in_kbps !== null)  ei.bw_in_kbps  = bw_in_kbps;
        if (bw_out_kbps !== null) ei.bw_out_kbps = bw_out_kbps;
        const eiStr = JSON.stringify(ei);
        await db.run('UPDATE devices SET extra_info = ? WHERE id = ?', [eiStr, dev.id]);
        dev.extra_info = eiStr;
        const st = calcStatus({ cpu: cpu ?? 0, mem: mem ?? 0, disk: disk ?? 0 });
        await db.run('UPDATE devices SET status = ? WHERE id = ?', [st, dev.id]);
        broadcastUpdate({ ...dev, status: st }, { cpu: cpu ?? 0, mem: mem ?? 0, disk: disk ?? 0, ping: latest?.ping, uptime: latest?.uptime, extra: ei }, st);
        await checkAlerts(dev, { cpu: cpu ?? 0, mem: mem ?? 0, disk: disk ?? 0, ping: latest?.ping ?? 0 }, now);
        const bwLog = bw_in_kbps !== null ? ` BW↓${bw_in_kbps}kbps ↑${bw_out_kbps}kbps` : '';
        console.log(`[SNMP-Met] ${dev.hostname}: CPU=${cpu}% MEM=${mem}% DISK=${disk}%${temp != null ? ' TEMP=' + temp + '°C' : ''}${bwLog}`);
      } catch { /* Gerät antwortet nicht per SNMP – kein Fehler */ }
    }
  } catch (err) {
    console.error('[SNMPMetrics]', err.message);
  }
}

// ── Gerätespezifische Metriken via HTTP-Pull ─────────────────
// Fragt eine konfigurierte URL ab und parst das JSON-Response.
// Unterstützt: NetWatch-Agenten-Format, Proxmox, Synology,
// und jede beliebige API, die cpu/mem/disk/temperature zurückgibt.
async function fetchJsonMetrics(url, timeoutMs = 5000) {
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!resp.ok) return null;
    const raw = await resp.json();

    // Flatten: data.cpu || data.stats.cpu || data.system.cpu_percent etc.
    const flat = {};
    const flatten = (obj, pfx = '') => {
      if (!obj || typeof obj !== 'object') return;
      for (const [k, v] of Object.entries(obj)) {
        flat[(pfx + k).toLowerCase()] = v;
        if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, pfx + k.toLowerCase() + '_');
      }
    };
    flatten(raw);

    const pick = (...keys) => { for (const k of keys) { const v = flat[k]; if (v !== undefined && v !== null) return Number(v); } return null; };

    // Proxmox: cpu ist 0..1 (float), in % umrechnen
    let cpu  = pick('cpu','cpu_percent','cpuusage','cpu_usage','cpu_load','cpuload','loadavg');
    if (cpu !== null && cpu <= 1.05) cpu = Math.round(cpu * 100); // 0..1 → %
    else if (cpu !== null) cpu = Math.round(cpu);

    const mem  = pick('mem','memory','mem_percent','memory_percent','ram','ram_percent','memused');
    const disk = pick('disk','disk_percent','storage','disk_usage','hdd','hdd_percent');
    const temp = pick('temperature','temp','cpu_temp','temperature_c','temp_c','cputemp','thermal');

    return { cpu, mem, disk, temp };
  } catch {
    clearTimeout(timer);
    return null;
  }
}

async function pollAllDeviceHttpMetrics() {
  try {
    const devices = await db.all(`SELECT * FROM devices WHERE pull_url IS NOT NULL AND pull_url != ''`);
    for (const dev of devices) {
      try {
        const met = await fetchJsonMetrics(dev.pull_url);
        if (!met || (met.cpu === null && met.mem === null)) continue;
        const now    = Date.now();
        const latest = await db.get('SELECT * FROM metrics WHERE device_id = ? ORDER BY ts DESC LIMIT 1', [dev.id]);
        const cpu  = met.cpu  ?? latest?.cpu  ?? 0;
        const mem  = met.mem  ?? latest?.mem  ?? 0;
        const disk = met.disk ?? latest?.disk ?? 0;
        await db.run(
          'INSERT INTO metrics (device_id, ts, cpu, mem, disk, ping, uptime) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [dev.id, now, cpu, mem, disk, latest?.ping ?? null, latest?.uptime ?? '—']
        );
        const extra = met.temp != null ? { temperature: met.temp } : null;
        if (extra) {
          let ei = {}; try { ei = JSON.parse(dev.extra_info || '{}'); } catch {}
          ei.temperature = met.temp;
          await db.run('UPDATE devices SET extra_info = ? WHERE id = ?', [JSON.stringify(ei), dev.id]);
          dev.extra_info = JSON.stringify(ei);
        }
        const st = calcStatus({ cpu, mem, disk });
        await db.run('UPDATE devices SET status = ?, last_seen = ? WHERE id = ?', [st, now, dev.id]);
        broadcastUpdate({ ...dev, status: st }, { cpu, mem, disk, ping: latest?.ping, uptime: latest?.uptime, extra }, st);
        console.log(`[HTTP-Pull] ${dev.hostname} (${dev.pull_url}): CPU=${cpu}% MEM=${mem}%${met.temp != null ? ' TEMP=' + met.temp + '°C' : ''}`);
      } catch (err) {
        console.log(`[HTTP-Pull] ${dev.hostname}: ${err.message}`);
      }
    }
  } catch (err) {
    console.error('[HTTP-Pull]', err.message);
  }
}

// ── Hypervisor VM-Discovery ──────────────────────────────────
function httpsGetJson(url, headers = {}, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const u    = new URL(url);
    const opts = {
      hostname: u.hostname,
      port:     parseInt(u.port) || 443,
      path:     u.pathname + u.search,
      method:   'GET',
      headers:  { 'Accept': 'application/json', ...headers },
      rejectUnauthorized: false,
      timeout: timeoutMs,
    };
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve(null); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('HTTPS timeout')); });
    req.end();
  });
}

function httpsPostJson(url, body, headers = {}, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const payload = body != null ? JSON.stringify(body) : '';
    const opts = {
      hostname: u.hostname, port: parseInt(u.port) || 443,
      path: u.pathname + u.search, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), 'Accept': 'application/json', ...headers },
      rejectUnauthorized: false, timeout: timeoutMs,
    };
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('HTTPS timeout')); });
    if (payload) req.write(payload);
    req.end();
  });
}

function httpsPostRaw(url, body, contentType = 'text/xml', headers = {}, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = {
      hostname: u.hostname, port: parseInt(u.port) || 443,
      path: u.pathname + u.search, method: 'POST',
      headers: { 'Content-Type': contentType, 'Content-Length': Buffer.byteLength(body), ...headers },
      rejectUnauthorized: false, timeout: timeoutMs,
    };
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('HTTPS timeout')); });
    req.write(body);
    req.end();
  });
}

function httpPostRaw(url, body, contentType = 'text/xml', headers = {}, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = {
      hostname: u.hostname, port: parseInt(u.port) || 80,
      path: u.pathname + u.search, method: 'POST',
      headers: { 'Content-Type': contentType, 'Content-Length': Buffer.byteLength(body), ...headers },
      timeout: timeoutMs,
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('HTTP timeout')); });
    req.write(body);
    req.end();
  });
}

function httpGetJson(url, headers = {}, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = {
      hostname: u.hostname, port: parseInt(u.port) || 80,
      path: u.pathname + u.search, method: 'GET',
      headers: { 'Accept': 'application/json', ...headers },
      timeout: timeoutMs,
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve(null); } });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('HTTP timeout')); });
    req.end();
  });
}

async function fetchProxmoxVms(baseUrl, token) {
  const h = { 'Authorization': `PVEAPIToken=${token}` };
  const nodes = await httpsGetJson(`${baseUrl}/api2/json/nodes`, h);
  if (!nodes?.data?.length) return { vms: [], host: null };
  const node = nodes.data[0].node;

  const [qemu, lxc, nodeStatus] = await Promise.all([
    httpsGetJson(`${baseUrl}/api2/json/nodes/${node}/qemu`,   h).catch(() => null),
    httpsGetJson(`${baseUrl}/api2/json/nodes/${node}/lxc`,    h).catch(() => null),
    httpsGetJson(`${baseUrl}/api2/json/nodes/${node}/status`, h).catch(() => null),
  ]);

  // Host-Metriken (CPU%, RAM%, Disk%)
  let host = null;
  const ns = nodeStatus?.data;
  if (ns) {
    host = {
      cpu:  ns.cpu  != null ? Math.round(ns.cpu * 100) : null,
      mem:  ns.memory?.total ? Math.round(ns.memory.used / ns.memory.total * 100) : null,
      disk: ns.rootfs?.total ? Math.round(ns.rootfs.used / ns.rootfs.total * 100) : null,
      mem_total_gb: ns.memory?.total ? Math.round(ns.memory.total / 1073741824 * 10) / 10 : null,
    };
  }

  const vms = [];
  for (const vm of qemu?.data || []) {
    // CPU: Proxmox gibt Anteil aller Host-CPUs → auf VM-CPUs normieren
    const cpuPct = vm.cpu != null && vm.maxcpu
      ? Math.round(vm.cpu / vm.maxcpu * 100 * 10) / 10
      : vm.cpu != null ? Math.round(vm.cpu * 100 * 10) / 10 : 0;
    vms.push({
      name:    vm.name    || `VM-${vm.vmid}`,
      state:   vm.status  || 'unknown',
      cpu:     cpuPct,
      mem_gb:  vm.mem     != null ? Math.round(vm.mem  / 1073741824 * 10) / 10 : 0,
      disk_gb: vm.disk    != null ? Math.round(vm.disk / 1073741824 * 10) / 10 : 0,
      type:    'qemu',
      vm_id:   vm.vmid,
    });
  }
  for (const ct of lxc?.data || []) {
    const cpuPct = ct.cpu != null && ct.maxcpu
      ? Math.round(ct.cpu / ct.maxcpu * 100 * 10) / 10
      : ct.cpu != null ? Math.round(ct.cpu * 100 * 10) / 10 : 0;
    vms.push({
      name:    ct.name    || `CT-${ct.vmid}`,
      state:   ct.status  || 'unknown',
      cpu:     cpuPct,
      mem_gb:  ct.mem     != null ? Math.round(ct.mem  / 1073741824 * 10) / 10 : 0,
      disk_gb: ct.disk    != null ? Math.round(ct.disk / 1073741824 * 10) / 10 : 0,
      type:    'lxc',
      vm_id:   ct.vmid,
    });
  }
  return { vms, host };
}

async function fetchPbsVms(baseUrl, token) {
  const h = { 'Authorization': `PVEAPIToken=${token}` };
  const nodes = await httpsGetJson(`${baseUrl}/api2/json/nodes`, h);
  if (!nodes?.data?.length) return { vms: [], host: null };
  const node = nodes.data[0].node;
  const [nodeStatus, datastores] = await Promise.all([
    httpsGetJson(`${baseUrl}/api2/json/nodes/${node}/status`, h).catch(() => null),
    httpsGetJson(`${baseUrl}/api2/json/nodes/${node}/datastore`, h).catch(() => null),
  ]);
  let host = null;
  const ns = nodeStatus?.data;
  if (ns) host = {
    cpu:  ns.cpu  != null ? Math.round(ns.cpu * 100) : null,
    mem:  ns.memory?.total ? Math.round(ns.memory.used / ns.memory.total * 100) : null,
    disk: ns.rootfs?.total ? Math.round(ns.rootfs.used / ns.rootfs.total * 100) : null,
    mem_total_gb: ns.memory?.total ? Math.round(ns.memory.total / 1073741824 * 10) / 10 : null,
  };
  const vms = (datastores?.data || []).map(ds => ({
    name: ds.store || 'datastore', state: 'running', cpu: 0, mem_gb: 0,
    disk_gb: ds.total != null ? Math.round(ds.total / 1073741824 * 10) / 10 : 0,
    type: 'datastore', vm_id: null,
  }));
  return { vms, host };
}

async function fetchVmwareVms(baseUrl, credentials) {
  const colonIdx = (credentials || ':').indexOf(':');
  const user = credentials.substring(0, colonIdx);
  const pass = credentials.substring(colonIdx + 1);
  const basic = Buffer.from(`${user}:${pass}`).toString('base64');

  let sessionId = null;
  try {
    // vSphere 7.0+ REST API
    const r = await httpsPostJson(`${baseUrl}/api/session`, null, { 'Authorization': `Basic ${basic}` });
    sessionId = typeof r.body === 'string' ? r.body.trim() : null;
  } catch {}
  if (!sessionId) {
    // vSphere 6.x fallback
    const r = await httpsPostJson(`${baseUrl}/rest/com/vmware/cis/session`, null, { 'Authorization': `Basic ${basic}` });
    sessionId = typeof r.body?.value === 'string' ? r.body.value : null;
  }
  if (!sessionId) throw new Error('VMware: Authentifizierung fehlgeschlagen');

  const h = { 'vmware-api-session-id': sessionId };
  let vmList = await httpsGetJson(`${baseUrl}/api/vcenter/vm`, h).catch(() => null);
  if (!vmList) {
    const r = await httpsGetJson(`${baseUrl}/rest/vcenter/vm`, h).catch(() => null);
    vmList = r?.value || null;
  }
  const vms = (vmList || []).map(vm => ({
    name: vm.name || vm.vm || 'VM',
    state: vm.power_state === 'POWERED_ON' ? 'running' : vm.power_state === 'SUSPENDED' ? 'paused' : 'stopped',
    cpu: 0, mem_gb: vm.memory_size_MiB != null ? Math.round(vm.memory_size_MiB / 1024 * 10) / 10 : 0,
    disk_gb: 0, type: 'vm', vm_id: vm.vm || null,
  }));
  return { vms, host: null };
}

function xcpRpcXml(method, params) {
  const p = params.map(v =>
    `<param><value><string>${String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</string></value></param>`
  ).join('');
  return `<?xml version="1.0"?><methodCall><methodName>${method}</methodName><params>${p}</params></methodCall>`;
}
function xcpStr(block, field) {
  const m = new RegExp(`<name>${field}<\\/name>\\s*<value><string>([^<]*)<\\/string>`).exec(block);
  return m ? m[1] : null;
}
function xcpBool(block, field) {
  const m = new RegExp(`<name>${field}<\\/name>\\s*<value><boolean>([01])<\\/boolean>`).exec(block);
  return m ? m[1] === '1' : null;
}

async function fetchXcpngVms(baseUrl, credentials) {
  const colonIdx = (credentials || 'root:').indexOf(':');
  const user = credentials.substring(0, colonIdx) || 'root';
  const pass = credentials.substring(colonIdx + 1);
  const rpcUrl = `${baseUrl}/RPC2`;
  const postRaw = baseUrl.startsWith('https') ? httpsPostRaw : httpPostRaw;

  const loginResp = await postRaw(rpcUrl, xcpRpcXml('session.login_with_password', [user, pass, '1.3', 'NetWatch']));
  const sessionMatch = /OpaqueRef:([^<"]+)/.exec(loginResp);
  if (!sessionMatch) throw new Error('XCP-ng: Login fehlgeschlagen');
  const sessionRef = `OpaqueRef:${sessionMatch[1]}`;

  const vmResp = await postRaw(rpcUrl, xcpRpcXml('VM.get_all_records', [sessionRef]), 'text/xml', {}, 20000);
  postRaw(rpcUrl, xcpRpcXml('session.logout', [sessionRef])).catch(() => {});

  const vms = [];
  const vmBlockRe = /<member>\s*<name>OpaqueRef:[^<]+<\/name>\s*<value>\s*<struct>([\s\S]*?)<\/struct>\s*<\/value>\s*<\/member>/g;
  let m;
  while ((m = vmBlockRe.exec(vmResp)) !== null) {
    const blk = m[1];
    if (xcpBool(blk, 'is_a_template') || xcpBool(blk, 'is_control_domain')) continue;
    const powerState = xcpStr(blk, 'power_state') || 'Halted';
    const memMax = parseInt(xcpStr(blk, 'memory_dynamic_max') || '0');
    vms.push({
      name: xcpStr(blk, 'name_label') || 'VM',
      state: powerState === 'Running' ? 'running' : powerState === 'Paused' ? 'paused' : 'stopped',
      cpu: 0, mem_gb: memMax > 0 ? Math.round(memMax / 1073741824 * 10) / 10 : 0,
      disk_gb: 0, type: 'vm', vm_id: null,
    });
  }
  return { vms, host: null };
}

async function fetchOvirtVms(baseUrl, credentials) {
  const h = {
    'Authorization': `Basic ${Buffer.from(credentials || ':').toString('base64')}`,
    'Accept': 'application/json',
  };
  const data = await httpsGetJson(`${baseUrl}/ovirt-engine/api/vms`, h);
  const rawList = data?.vm || data?.vms?.vm || data?.vms || [];
  const vmList = Array.isArray(rawList) ? rawList : [rawList];
  const vms = vmList.filter(Boolean).map(vm => ({
    name: vm.name || 'VM',
    state: vm.status?.state === 'up' ? 'running' : vm.status?.state === 'paused' ? 'paused' : 'stopped',
    cpu: 0, mem_gb: vm.memory != null ? Math.round(vm.memory / 1073741824 * 10) / 10 : 0,
    disk_gb: 0, type: 'vm', vm_id: vm.id || null,
  }));
  return { vms, host: null };
}

async function fetchNutanixVms(baseUrl, credentials) {
  const h = { 'Authorization': `Basic ${Buffer.from(credentials || ':').toString('base64')}` };
  const data = await httpsGetJson(`${baseUrl}/api/nutanix/v2.0/vms/`, h);
  const vms = (data?.entities || []).map(vm => ({
    name: vm.name || 'VM',
    state: (vm.power_state || '').toLowerCase() === 'on' ? 'running' : 'stopped',
    cpu: 0, mem_gb: vm.memory_mb != null ? Math.round(vm.memory_mb / 1024 * 10) / 10 : 0,
    disk_gb: 0, type: 'vm', vm_id: vm.uuid || null,
  }));
  let host = null;
  try {
    const cluster = await httpsGetJson(`${baseUrl}/api/nutanix/v2.0/cluster/`, h);
    if (cluster) host = { cpu: null, mem: null, disk: null, mem_total_gb: null };
  } catch {}
  return { vms, host };
}

async function fetchDockerVms(baseUrl) {
  const [containers, info] = await Promise.all([
    httpGetJson(`${baseUrl}/containers/json?all=true`).catch(() => null),
    httpGetJson(`${baseUrl}/info`).catch(() => null),
  ]);
  let host = null;
  if (info) host = {
    cpu: null, mem: null, disk: null,
    mem_total_gb: info.MemTotal ? Math.round(info.MemTotal / 1073741824 * 10) / 10 : null,
  };
  const vms = (containers || []).map(c => ({
    name: (c.Names?.[0] || c.Id?.substring(0, 12) || 'container').replace(/^\//, ''),
    state: c.State === 'running' ? 'running' : c.State === 'paused' ? 'paused' : 'stopped',
    cpu: 0, mem_gb: 0, disk_gb: 0, type: 'container', vm_id: c.Id?.substring(0, 12) || null,
  }));
  return { vms, host };
}

async function pollHypervisorVms(dev) {
  if (!dev.hypervisor_type || !dev.hypervisor_url) return;
  try {
    let vms = [], host = null;
    const type  = dev.hypervisor_type;
    const url   = dev.hypervisor_url;
    const token = dev.hypervisor_token || '';
    let result;
    if      (type === 'proxmox') result = await fetchProxmoxVms(url, token);
    else if (type === 'pbs')     result = await fetchPbsVms(url, token);
    else if (type === 'vmware')  result = await fetchVmwareVms(url, token);
    else if (type === 'xcpng')   result = await fetchXcpngVms(url, token);
    else if (type === 'ovirt')   result = await fetchOvirtVms(url, token);
    else if (type === 'nutanix') result = await fetchNutanixVms(url, token);
    else if (type === 'docker')  result = await fetchDockerVms(url);
    if (result) { vms = result.vms; host = result.host; }
    const now = Date.now();

    // Host-Metriken (CPU/RAM/Disk des Hypervisor-Hosts) in metrics speichern
    if (host && (host.cpu !== null || host.mem !== null)) {
      const cpu  = host.cpu  ?? 0;
      const mem  = host.mem  ?? 0;
      const disk = host.disk ?? 0;
      const latest = await db.get('SELECT ping, uptime FROM metrics WHERE device_id = ? ORDER BY ts DESC LIMIT 1', [dev.id]);
      await db.run(
        'INSERT INTO metrics (device_id, ts, cpu, mem, disk, ping, uptime) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [dev.id, now, cpu, mem, disk, latest?.ping ?? null, latest?.uptime ?? '—']
      );
      // RAM-Gesamt in extra_info
      let ei = {}; try { ei = JSON.parse(dev.extra_info || '{}'); } catch {}
      if (host.mem_total_gb) ei.mem_total_gb = host.mem_total_gb;
      const eiStr = JSON.stringify(ei);
      await db.run('UPDATE devices SET extra_info = ?, last_seen = ?, status = ? WHERE id = ?',
        [eiStr, now, calcStatus({ cpu, mem, disk }), dev.id]);
      dev.extra_info = eiStr;
      const st = calcStatus({ cpu, mem, disk });
      broadcastUpdate({ ...dev, status: st }, { cpu, mem, disk, ping: latest?.ping, uptime: latest?.uptime }, st);
      console.log(`[Hypervisor] ${dev.hostname} Host: CPU=${cpu}% RAM=${mem}% Disk=${disk}%`);
    }

    if (!vms.length) return;
    await db.run('DELETE FROM vms WHERE device_id = ?', [dev.id]);
    for (const vm of vms) {
      await db.run(
        'INSERT INTO vms (device_id, ts, vm_name, vm_state, vm_cpu, vm_mem_gb, vm_disk_gb, vm_type, vm_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [dev.id, now, vm.name, vm.state, vm.cpu, vm.mem_gb, vm.disk_gb, vm.type, vm.vm_id]
      );
    }
    broadcast({ type: 'vms_update', hostname: dev.hostname, vms });
    console.log(`[Hypervisor] ${dev.hostname}: ${vms.length} VMs/Container`);
  } catch (err) {
    console.log(`[Hypervisor] ${dev.hostname}: ${err.message}`);
  }
}

async function pollAllHypervisors() {
  try {
    const devs = await db.all(`SELECT * FROM devices WHERE hypervisor_type IS NOT NULL AND hypervisor_type != ''`);
    for (const dev of devs) {
      await pollHypervisorVms(dev).catch(() => {});
    }
  } catch (err) {
    console.error('[Hypervisors]', err.message);
  }
}

async function pollCustomSensors() {
  try {
    const sensors = await db.all(`SELECT cs.*, d.hostname FROM custom_sensors cs JOIN devices d ON d.id = cs.device_id`);
    await Promise.all(sensors.map(s => pollSingleSensor(s).catch(() => {})));
  } catch (err) {
    console.error('[SensorPoll]', err.message);
  }
}

// ── MAC-Update für ALLE Geräte (inkl. Agent-Geräte) ─────────
async function updateAllMacs() {
  try {
    const hosts = await arpScan();
    if (!hosts.length) return;
    const byIp = Object.fromEntries(hosts.map(h => [h.ip, h]));
    const devs = await db.all(`SELECT id, hostname, ip, mac FROM devices WHERE ip IS NOT NULL AND ip NOT IN ('unbekannt','?','')`);
    for (const dev of devs) {
      const arp = byIp[dev.ip];
      if (arp?.mac && arp.mac !== dev.mac) {
        await db.run('UPDATE devices SET mac = ? WHERE id = ?', [arp.mac, dev.id]);
        broadcast({ type: 'mac_update', hostname: dev.hostname, mac: arp.mac });
        console.log(`[MAC] ${dev.hostname} → ${arp.mac}`);
      }
    }
  } catch (err) {
    console.error('[MAC-Update]', err.message);
  }
}

// ── PRTG/Zabbix-Style Auto-Provisioning ─────────────────────
// Wenn ein Gerät erstmals erreichbar ist, werden automatisch Sensoren
// angelegt — ähnlich wie PRTG Auto-Discovery oder Zabbix Auto-Registration.
async function autoProvisionSensors(device) {
  try {
    const ip = device.ip;
    if (!ip || ip === 'unbekannt' || ip === '?') return;

    // Bereits Sensoren? → nichts tun
    const existing = await db.get(`SELECT COUNT(*) as cnt FROM custom_sensors WHERE device_id = ?`, [device.id]);
    if (existing.cnt > 0) return;

    const created = [];

    // ── 1. Paralleler Port-Check: SSH, HTTP, HTTPS, RDP, SNMP ──
    const portChecks = await Promise.all([
      checkPort(ip, 22,   1500).then(ok => ({ port: 22,   proto: 'tcp', ok })),
      checkPort(ip, 80,   1500).then(ok => ({ port: 80,   proto: 'http', ok })),
      checkPort(ip, 443,  1500).then(ok => ({ port: 443,  proto: 'https', ok })),
      checkPort(ip, 3389, 1500).then(ok => ({ port: 3389, proto: 'tcp', ok })),
      checkPort(ip, 8080, 1500).then(ok => ({ port: 8080, proto: 'http', ok })),
      checkPort(ip, 8443, 1500).then(ok => ({ port: 8443, proto: 'https', ok })),
    ]);

    for (const p of portChecks.filter(p => p.ok)) {
      if (p.proto === 'http' || p.proto === 'https') {
        const url = `${p.proto}://${ip}:${p.port}`;
        await db.run(`INSERT INTO custom_sensors (device_id, name, type, target) VALUES (?,?,?,?)`,
          [device.id, `HTTP :${p.port}`, 'http', url]);
        created.push(`HTTP:${p.port}`);
      } else {
        const names = { 22: 'SSH', 3389: 'RDP' };
        await db.run(`INSERT INTO custom_sensors (device_id, name, type, target) VALUES (?,?,?,?)`,
          [device.id, names[p.port] || `TCP:${p.port}`, 'port', `${ip}:${p.port}`]);
        created.push(`Port:${p.port}`);
      }
    }

    // ── 2. SNMP Auto-Probe (community: public) ──────────────────
    const snmpResult = await snmpProbe(ip).catch(() => null);
    if (snmpResult && snmpResult.sysDescr) {
      const desc    = snmpResult.sysDescr;
      const community = 'public';

      // Uptime — immer verfügbar wenn SNMP antwortet
      await db.run(`INSERT INTO custom_sensors (device_id, name, type, target) VALUES (?,?,?,?)`,
        [device.id, 'Uptime', 'snmp', JSON.stringify({ ip, community, oid:'1.3.6.1.2.1.1.3.0', unit:'s', warn:null, crit:null })]);
      created.push('SNMP:Uptime');

      // CPU — Net-SNMP (Linux/FreeBSD) oder Cisco
      if (/linux|ubuntu|debian|centos|freebsd|synology|qnap/i.test(desc)) {
        await db.run(`INSERT INTO custom_sensors (device_id, name, type, target) VALUES (?,?,?,?)`,
          [device.id, 'CPU Load', 'snmp', JSON.stringify({ ip, community, oid:'1.3.6.1.4.1.2021.10.1.3.1', unit:'%', warn:80, crit:95 })]);
        await db.run(`INSERT INTO custom_sensors (device_id, name, type, target) VALUES (?,?,?,?)`,
          [device.id, 'RAM frei', 'snmp', JSON.stringify({ ip, community, oid:'1.3.6.1.4.1.2021.4.6.0', divisor:1024, unit:'MB', warn:null, crit:null })]);
        created.push('SNMP:CPU', 'SNMP:RAM');
      } else if (/cisco/i.test(desc)) {
        await db.run(`INSERT INTO custom_sensors (device_id, name, type, target) VALUES (?,?,?,?)`,
          [device.id, 'CPU Load', 'snmp', JSON.stringify({ ip, community, oid:'1.3.6.1.4.1.9.2.1.56.0', unit:'%', warn:80, crit:95 })]);
        created.push('SNMP:CPU');
      } else if (/windows/i.test(desc)) {
        await db.run(`INSERT INTO custom_sensors (device_id, name, type, target) VALUES (?,?,?,?)`,
          [device.id, 'CPU Load', 'snmp', JSON.stringify({ ip, community, oid:'1.3.6.1.2.1.25.3.3.1.2.1', unit:'%', warn:80, crit:95 })]);
        created.push('SNMP:CPU');
      }

      // Printer Toner
      if (device.type === 'printer' || /jetdirect|printer|kyocera|brother/i.test(desc)) {
        await db.run(`INSERT INTO custom_sensors (device_id, name, type, target) VALUES (?,?,?,?)`,
          [device.id, 'Toner Schwarz', 'snmp', JSON.stringify({ ip, community, oid:'1.3.6.1.2.1.43.11.1.1.9.1.1', unit:'%', warn:25, crit:10, invert:true })]);
        created.push('SNMP:Toner');
      }

      // APC USV Batterie
      if (device.type === 'usv' || /apc|ups/i.test(desc)) {
        await db.run(`INSERT INTO custom_sensors (device_id, name, type, target) VALUES (?,?,?,?)`,
          [device.id, 'Batterie %', 'snmp', JSON.stringify({ ip, community, oid:'1.3.6.1.4.1.318.1.1.1.2.2.1.0', unit:'%', warn:60, crit:30, invert:true })]);
        created.push('SNMP:Batterie');
      }
    }

    if (created.length) {
      console.log(`[AutoProvision] ${device.hostname}: ${created.join(', ')}`);
      // Alle neuen Sensoren sofort pollen
      const newSensors = await db.all(
        `SELECT cs.*, d.hostname FROM custom_sensors cs JOIN devices d ON d.id=cs.device_id WHERE cs.device_id=?`,
        [device.id]
      );
      await Promise.all(newSensors.map(s => pollSingleSensor(s).catch(() => {})));
      broadcast({ type: 'sensors_changed', hostname: device.hostname });
    }
  } catch (err) {
    console.error('[AutoProvision]', err.message);
  }
}

// ── POST /api/devices/:hostname/autoprovision ────────────────
// Manuell auslösbar aus dem Dashboard für jedes Gerät
app.post('/api/devices/:hostname/autoprovision', async (req, res) => {
  try {
    const dev = await db.get(`SELECT * FROM devices WHERE hostname = ?`, [req.params.hostname]);
    if (!dev) return res.status(404).json({ error: 'Gerät nicht gefunden' });
    // Bestehende Sensoren löschen (force=true)
    if (req.body?.force) {
      await db.run('DELETE FROM custom_sensors WHERE device_id = ?', [dev.id]);
    }
    res.json({ ok: true, message: 'Auto-Provisioning gestartet' });
    setImmediate(() => autoProvisionSensors(dev).catch(() => {}));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Ping-Monitor für agentlose Geräte ───────────────────────
async function pingMonitor() {
  try {
    // ARP-Tabelle einmal pro Zyklus lesen (für MAC-Adressen)
    const arpData = await arpScan();
    const arpByIp = Object.fromEntries(arpData.map(a => [a.ip, a]));

    const agentThreshold = Date.now() - 150_000;
    const stale = await db.all(`
      SELECT d.* FROM devices d
      LEFT JOIN metrics m ON m.device_id = d.id
        AND m.cpu > 0
        AND m.ts  > ?
      WHERE m.id IS NULL
        AND d.ip IS NOT NULL
        AND d.ip NOT IN ('unbekannt','?','')
    `, [agentThreshold]);

    const pingedDevs = []; // Geräte die erfolgreich gepingt wurden (für Post-Ping ARP)

    for (const dev of stale) {
      // 3 Pings → Durchschnitt + Paketverlust %
      const { avg_ms: ms, loss_pct } = await pingMultiple(dev.ip, 3);
      const now = Date.now();

      // MAC aus Pre-Ping ARP-Cache aktualisieren
      const arp = arpByIp[dev.ip];
      if (arp?.mac && arp.mac !== dev.mac) {
        await db.run('UPDATE devices SET mac = ? WHERE id = ?', [arp.mac, dev.id]);
        dev.mac = arp.mac;
      }

      if (ms !== null) {
        pingedDevs.push(dev);
        // Uptime: continuous_since tracken
        const wasOffline = !dev.continuous_since;
        let contSince = dev.continuous_since;
        if (!contSince) {
          contSince = now;
          await db.run('UPDATE devices SET continuous_since = ? WHERE id = ?', [now, dev.id]);
          setImmediate(() => autoProvisionSensors(dev).catch(() => {}));
        }
        const uptimeSec = Math.floor((now - contSince) / 1000);
        const uptimeStr = formatUptime(uptimeSec);

        // Paketverlust in extra_info speichern
        let ei = {}; try { ei = JSON.parse(dev.extra_info || '{}'); } catch {}
        ei.packet_loss = loss_pct;
        const eiStr = JSON.stringify(ei);
        await db.run('UPDATE devices SET extra_info = ? WHERE id = ?', [eiStr, dev.id]);
        dev.extra_info = eiStr;

        const st = ms >= CONFIG.ALERT_PING ? 'warn' : 'ok';
        const prevSt = dev.status || 'ok';
        await db.run('UPDATE devices SET last_seen = ?, status = ? WHERE id = ?', [now, st, dev.id]);

        // Latenz-Alarm einmalig schreiben wenn Schwelle überschritten
        if (st === 'warn' && prevSt !== 'warn' && prevSt !== 'off') {
          const noRecent = !(await db.get(
            `SELECT id FROM alerts WHERE device_id = ? AND type = 'ping' AND acked = 0 AND ts > ?`,
            [dev.id, now - 300_000]
          ));
          if (noRecent) await db.run(
            `INSERT INTO alerts (device_id, ts, severity, type, message) VALUES (?, ?, 'warn', 'ping', ?)`,
            [dev.id, now, `Ping ${ms}ms — erhöhte Latenz (Schwelle: ${CONFIG.ALERT_PING}ms)`]
          );
        }
        if (loss_pct >= 50) {
          const noRecent = !(await db.get(
            `SELECT id FROM alerts WHERE device_id = ? AND type = 'loss' AND acked = 0 AND ts > ?`,
            [dev.id, now - 300_000]
          ));
          if (noRecent) await db.run(
            `INSERT INTO alerts (device_id, ts, severity, type, message) VALUES (?, ?, 'crit', 'loss', ?)`,
            [dev.id, now, `Paketverlust ${loss_pct}% — kritisch`]
          );
        }
        const prevMet = await db.get('SELECT cpu, mem, disk FROM metrics WHERE device_id = ? AND (cpu > 0 OR mem > 0) ORDER BY ts DESC LIMIT 1', [dev.id]);
        await db.run(
          'INSERT INTO metrics (device_id, ts, cpu, mem, disk, ping, uptime) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [dev.id, now, prevMet?.cpu ?? 0, prevMet?.mem ?? 0, prevMet?.disk ?? 0, ms, uptimeStr]
        );
        broadcastUpdate({ ...dev, status: st }, { cpu: prevMet?.cpu ?? 0, mem: prevMet?.mem ?? 0, disk: prevMet?.disk ?? 0, ping: ms, uptime: uptimeStr, extra: ei }, st);
        console.log(`[PING] ${dev.hostname} (${dev.ip}) — ${ms}ms loss=${loss_pct}% | up ${uptimeStr}`);
      }
    }

    // Post-Ping ARP-Refresh: Ping füllt den OS-ARP-Cache, jetzt MACs für neu erreichbare Geräte holen
    const missingMac = pingedDevs.filter(d => !d.mac);
    if (missingMac.length > 0) {
      const freshArp = await arpScan();
      const freshByIp = Object.fromEntries(freshArp.map(a => [a.ip, a]));
      for (const dev of missingMac) {
        const entry = freshByIp[dev.ip];
        if (entry?.mac) {
          await db.run('UPDATE devices SET mac = ? WHERE id = ?', [entry.mac, dev.id]);
          broadcast({ type: 'mac_update', hostname: dev.hostname, mac: entry.mac });
          console.log(`[MAC-Post-Ping] ${dev.hostname} (${dev.ip}) → ${entry.mac}`);
        }
      }
    }
  } catch (err) {
    console.error('[PingMonitor]', err.message);
  }
}

// ── Agent-Download-Routen ────────────────────────────────────
// Ermöglicht: curl -sSL http://server:3000/install-linux.sh | sudo bash
app.get('/agents/linux-agent.py', (req, res) => {
  res.sendFile(path.join(__dirname, 'agents', 'linux-agent.py'));
});

// ── Pull-Config pro Gerät ────────────────────────────────────
app.get('/api/devices/:hostname/pull-config', async (req, res) => {
  try {
    const dev = await db.get('SELECT pull_url, snmp_community FROM devices WHERE hostname = ?', [req.params.hostname]);
    if (!dev) return res.status(404).json({ error: 'Gerät nicht gefunden' });
    res.json({ pull_url: dev.pull_url || '', snmp_community: dev.snmp_community || '' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/devices/:hostname/pull-config', async (req, res) => {
  try {
    const { pull_url, snmp_community } = req.body;
    await db.run(
      'UPDATE devices SET pull_url = ?, snmp_community = ? WHERE hostname = ?',
      [pull_url || null, snmp_community || null, req.params.hostname]
    );
    res.json({ ok: true });
    // Sofort eine erste Abfrage starten
    const dev = await db.get('SELECT * FROM devices WHERE hostname = ?', [req.params.hostname]);
    if (dev) {
      if (pull_url) setImmediate(() => pollAllDeviceHttpMetrics().catch(() => {}));
      else if (snmp_community) setImmediate(() => pollAllSnmpMetrics().catch(() => {}));
    }
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Hypervisor-Config pro Gerät ──────────────────────────────
app.get('/api/devices/:hostname/hypervisor-config', async (req, res) => {
  try {
    const dev = await db.get('SELECT hypervisor_type, hypervisor_url, hypervisor_token FROM devices WHERE hostname = ?', [req.params.hostname]);
    if (!dev) return res.status(404).json({ error: 'Gerät nicht gefunden' });
    res.json({ type: dev.hypervisor_type || '', url: dev.hypervisor_url || '', token: dev.hypervisor_token || '' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/devices/:hostname/hypervisor-config', async (req, res) => {
  try {
    const { type, url, token } = req.body;
    await db.run(
      'UPDATE devices SET hypervisor_type = ?, hypervisor_url = ?, hypervisor_token = ? WHERE hostname = ?',
      [type || null, url || null, token || null, req.params.hostname]
    );
    res.json({ ok: true });
    const dev = await db.get('SELECT * FROM devices WHERE hostname = ?', [req.params.hostname]);
    if (dev && type) setImmediate(() => pollHypervisorVms(dev).catch(() => {}));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/devices/:hostname/vms', async (req, res) => {
  try {
    const dev = await db.get('SELECT id FROM devices WHERE hostname = ?', [req.params.hostname]);
    if (!dev) return res.status(404).json({ error: 'Gerät nicht gefunden' });
    const vms = await db.all(
      'SELECT vm_name, vm_state, vm_cpu, vm_mem_gb, vm_disk_gb, vm_type, vm_id FROM vms WHERE device_id = ? AND ts = (SELECT MAX(ts) FROM vms WHERE device_id = ?) ORDER BY vm_name',
      [dev.id, dev.id]
    );
    res.json(vms);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Settings API ─────────────────────────────────────────────
app.get('/api/settings', async (req, res) => {
  const rows = await db.all('SELECT key, value FROM settings');
  const s = { ...MONITOR_DEFAULTS };
  rows.forEach(r => { s[r.key] = Number(r.value) || s[r.key]; });
  res.json(s);
});

app.put('/api/settings', async (req, res) => {
  const allowed = Object.keys(MONITOR_DEFAULTS);
  for (const [k, v] of Object.entries(req.body)) {
    if (!allowed.includes(k)) continue;
    const val = parseInt(v);
    if (!val || val < 5) continue;
    await db.run('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', [k, String(val)]);
    monitorSettings[k] = val;
  }
  startMonitorTimers();
  broadcast({ type: 'settings', settings: monitorSettings });
  res.json({ ok: true, settings: monitorSettings });
});

app.get('/install-linux.sh', (req, res) => {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.sendFile(path.join(__dirname, 'agents', 'install-linux.sh'));
});

app.get('/agents/agent.ps1', (req, res) => {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.sendFile(path.join(__dirname, 'agents', 'agent.ps1'));
});

app.get('/install-windows.ps1', (req, res) => {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.sendFile(path.join(__dirname, 'agents', 'install-windows.ps1'));
});

app.get('/agents/snmp-poller.js', (req, res) => {
  res.sendFile(path.join(__dirname, 'agents', 'snmp-poller.js'));
});

app.get('/netwatch', (req, res) => {
  res.sendFile(path.join(__dirname, 'netwatch-v5.html'));
});

app.get('/download/install-agent.bat', (req, res) => {
  const host = req.headers.host || `localhost:${CONFIG.API_PORT}`;
  const serverUrl = `http://${host}`;
  const lines = [
    '@echo off',
    'setlocal',
    'echo.',
    'echo  ==========================================',
    'echo     NetWatch Agent - Installation',
    'echo  ==========================================',
    'echo.',
    'net session >nul 2>&1',
    'if %errorLevel% neq 0 (',
    '    echo  [FEHLER] Bitte als Administrator ausfuehren!',
    '    echo  Rechtsklick auf die Datei - Als Administrator ausfuehren',
    '    pause',
    '    exit /b 1',
    ')',
    `set SERVER=${serverUrl}`,
    'set INSTALLDIR=%ProgramData%\\NetWatch',
    'set AGENTFILE=%INSTALLDIR%\\agent.ps1',
    'set TASKNAME=NetWatch-Agent',
    'echo  Server: %SERVER%',
    'echo  Zielordner: %INSTALLDIR%',
    'echo.',
    'if not exist "%INSTALLDIR%" mkdir "%INSTALLDIR%"',
    'echo  [1/3] Lade Agent herunter...',
    'powershell -Command "Invoke-WebRequest -Uri \'%SERVER%/agents/agent.ps1\' -OutFile \'%AGENTFILE%\' -UseBasicParsing"',
    'if not exist "%AGENTFILE%" (',
    '    echo  [FEHLER] Download fehlgeschlagen. Server und Netzwerk pruefen.',
    '    pause',
    '    exit /b 1',
    ')',
    'echo     OK',
    'echo  [2/3] Richte geplante Aufgabe ein...',
    'schtasks /delete /tn "%TASKNAME%" /f >nul 2>&1',
    'schtasks /create /tn "%TASKNAME%" /tr "powershell -ExecutionPolicy Bypass -WindowStyle Hidden -File \\"%AGENTFILE%\\" -Server %SERVER% -Interval 60" /sc onstart /ru SYSTEM /f >nul',
    'if %errorLevel% neq 0 (',
    '    echo  [FEHLER] Geplante Aufgabe konnte nicht erstellt werden.',
    '    pause',
    '    exit /b 1',
    ')',
    'echo     OK',
    'echo  [3/3] Starte Agent...',
    'schtasks /run /tn "%TASKNAME%" >nul',
    'echo     OK',
    'echo.',
    'echo  ==========================================',
    'echo  Agent laeuft! Geraet erscheint in Kuerze',
    `echo  im Dashboard: ${serverUrl}/netwatch-v3.html`,
    'echo  ==========================================',
    'echo.',
    'pause',
  ];
  const bat = lines.join('\r\n') + '\r\n';
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', 'attachment; filename="install-agent.bat"');
  res.send(bat);
});

app.get('/download/install-hyperv-agent.bat', (req, res) => {
  const host = req.headers.host || `localhost:${CONFIG.API_PORT}`;
  const serverUrl = `http://${host}`;
  const lines = [
    '@echo off',
    'setlocal',
    'echo.',
    'echo  ==========================================',
    'echo     NetWatch Hyper-V Agent - Installation',
    'echo  ==========================================',
    'echo.',
    '',
    ':: Als Administrator pruefen',
    'net session >nul 2>&1',
    'if %errorLevel% neq 0 (',
    '    echo  [FEHLER] Bitte als Administrator ausfuehren!',
    '    echo  Rechtsklick auf die Datei - Als Administrator ausfuehren',
    '    pause',
    '    exit /b 1',
    ')',
    '',
    ':: Hyper-V pruefen (vmms = Hyper-V Virtual Machine Management Service)',
    'sc query vmms >nul 2>&1',
    'if %errorLevel% neq 0 (',
    '    echo  [FEHLER] Hyper-V ist auf diesem System nicht aktiviert.',
    '    echo  Windows 10/11 Pro: Systemsteuerung - Windows-Features - Hyper-V aktivieren',
    '    pause',
    '    exit /b 1',
    ')',
    '',
    `set SERVER=${serverUrl}`,
    'set INSTALLDIR=%ProgramData%\\NetWatch',
    'set AGENTFILE=%INSTALLDIR%\\agent.ps1',
    'set TASKNAME=NetWatch-HyperV-Agent',
    '',
    'echo  Server: %SERVER%',
    'echo  Zielordner: %INSTALLDIR%',
    'echo.',
    '',
    ':: Standort / Gruppe abfragen',
    'set /p SITE=Standort (z.B. Wien HQ): ',
    'if "%SITE%"=="" set SITE=Standort',
    'set /p NETWORK=Netzwerk (z.B. Servernetz): ',
    'if "%NETWORK%"=="" set NETWORK=Netzwerk',
    'set /p GROUP=Gruppe (z.B. Hyper-V): ',
    'if "%GROUP%"=="" set GROUP=Hyper-V',
    '',
    ':: Ordner erstellen',
    'if not exist "%INSTALLDIR%" mkdir "%INSTALLDIR%"',
    '',
    ':: Agent herunterladen',
    'echo.',
    'echo  [1/3] Lade Agent herunter...',
    'powershell -Command "Invoke-WebRequest -Uri \'%SERVER%/agents/agent.ps1\' -OutFile \'%AGENTFILE%\' -UseBasicParsing"',
    'if not exist "%AGENTFILE%" (',
    '    echo  [FEHLER] Download fehlgeschlagen. Server und Netzwerk pruefen.',
    '    pause',
    '    exit /b 1',
    ')',
    'echo       OK',
    '',
    ':: Geplante Aufgabe einrichten',
    'echo  [2/3] Richte geplante Aufgabe ein...',
    'schtasks /delete /tn "%TASKNAME%" /f >nul 2>&1',
    'schtasks /create /tn "%TASKNAME%" /tr "powershell -ExecutionPolicy Bypass -WindowStyle Hidden -File \\"%AGENTFILE%\\" -Server %SERVER% -HyperV -Type server -Site \\"%SITE%\\" -Network \\"%NETWORK%\\" -Group \\"%GROUP%\\" -Interval 60" /sc onstart /ru SYSTEM /f >nul',
    'if %errorLevel% neq 0 (',
    '    echo  [FEHLER] Geplante Aufgabe konnte nicht erstellt werden.',
    '    pause',
    '    exit /b 1',
    ')',
    'echo       OK',
    '',
    ':: Sofort starten',
    'echo  [3/3] Starte Agent...',
    'schtasks /run /tn "%TASKNAME%" >nul',
    'echo       OK',
    '',
    'echo.',
    'echo  ==========================================',
    'echo  Hyper-V Agent laeuft!',
    'echo  Host + VMs erscheinen in Kuerze im Dashboard:',
    `echo  ${serverUrl}/netwatch-v3.html`,
    'echo  ==========================================',
    'echo.',
    'pause',
  ];
  const bat = lines.join('\r\n') + '\r\n';
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', 'attachment; filename="install-hyperv-agent.bat"');
  res.send(bat);
});

// ── Start ────────────────────────────────────────────────────
async function start() {
  await initDatabase();

  app.listen(CONFIG.API_PORT, () => {
    console.log(`
╔═══════════════════════════════════════════════════════════╗
║                  NetWatch Backend v1.0                    ║
╠═══════════════════════════════════════════════════════════╣
║  API (Agenten)   → http://localhost:${CONFIG.API_PORT}                 ║
║  WebSocket       → ws://localhost:${CONFIG.WS_PORT}                   ║
║  Dashboard       → http://localhost:${CONFIG.API_PORT}/netwatch-v3.html        ║
║  Datenbank       → ${CONFIG.DB_FILE}                         ║
╠═══════════════════════════════════════════════════════════╣
║  Linux-Agent installieren (auf dem Zielgerät):            ║
║  curl -sSL http://<DIESE-IP>:${CONFIG.API_PORT}/install-linux.sh | sudo bash  ║
╚═══════════════════════════════════════════════════════════╝
    `);
  });

  // Gespeicherte Monitor-Intervalle laden
  const settingRows = await db.all('SELECT key, value FROM settings');
  settingRows.forEach(r => { if (r.key in MONITOR_DEFAULTS) monitorSettings[r.key] = parseInt(r.value) || MONITOR_DEFAULTS[r.key]; });

  startMonitorTimers();
  pingMonitor();
  pollCustomSensors();
  pollAllSnmpMetrics();
  pollAllDeviceHttpMetrics();
  pollAllHypervisors();
  updateAllMacs();
}

start().catch(err => {
  console.error('[FATAL]', err);
  process.exit(1);
});
