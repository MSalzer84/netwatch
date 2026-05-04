#!/usr/bin/env bash
# =============================================================
#  NetWatch – Proxmox LXC Installer
#  Erstellt automatisch einen LXC-Container und installiert
#  NetWatch darin. Auf dem Proxmox-Host als root ausführen:
#
#    bash <(curl -sSL https://raw.githubusercontent.com/MSalzer84/netwatch/main/proxmox-install.sh)
# =============================================================
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

info()  { echo -e "${CYAN}[INFO]${NC}  $*"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error() { echo -e "${RED}[FEHLER]${NC} $*" >&2; exit 1; }

echo -e "${BOLD}"
echo "╔═══════════════════════════════════════════════════╗"
echo "║     NetWatch – Proxmox LXC Installer              ║"
echo "╚═══════════════════════════════════════════════════╝"
echo -e "${NC}"

# ── Proxmox prüfen ────────────────────────────────────────────
command -v pct  &>/dev/null || error "Dieses Script muss auf einem Proxmox-Host ausgeführt werden."
[[ $EUID -ne 0 ]]           && error "Bitte als root ausführen."

# ── Konfiguration ─────────────────────────────────────────────
CT_ID=$(pvesh get /cluster/nextid 2>/dev/null || echo 200)
CT_NAME="netwatch"
CT_RAM=512
CT_CPU=1
CT_DISK=4
CT_BRIDGE="vmbr0"
NETWATCH_PORT=3000

# Storage ermitteln (local-lvm bevorzugt, sonst local)
if pvesm status | grep -q "^local-lvm"; then
  STORAGE="local-lvm"
else
  STORAGE="local"
fi

CT_PASS="netwatch"

echo -e "  Container-ID : ${BOLD}${CT_ID}${NC}"
echo -e "  Name         : ${BOLD}${CT_NAME}${NC}"
echo -e "  RAM          : ${BOLD}${CT_RAM} MB${NC}"
echo -e "  Disk         : ${BOLD}${CT_DISK} GB${NC} (${STORAGE})"
echo -e "  Bridge       : ${BOLD}${CT_BRIDGE}${NC}"
echo -e "  Root-Passwort: ${BOLD}${CT_PASS}${NC}"
echo -e "  Dashboard    : ${BOLD}http://<CT-IP>:${NETWATCH_PORT}/netwatch-v3.html${NC}"
echo ""

read -rp "Fortfahren? [j/N] " confirm
[[ "${confirm,,}" == "j" ]] || { echo "Abgebrochen."; exit 0; }
echo ""

# ── Template suchen / herunterladen ───────────────────────────
info "Suche Debian 12 Template..."

TEMPLATE_PATH=""
# Schau ob schon eines lokal vorhanden
EXISTING=$(find /var/lib/vz/template/cache -name "debian-12-standard*" 2>/dev/null | sort -V | tail -1)
if [[ -n "$EXISTING" ]]; then
  TEMPLATE_PATH="$EXISTING"
  ok "Template gefunden: $(basename "$TEMPLATE_PATH")"
else
  info "Template nicht lokal — lade via pveam herunter..."
  pveam update &>/dev/null || true
  TMPL_NAME=$(pveam available --section system 2>/dev/null | awk '/debian-12-standard/ {print $2}' | sort -V | tail -1)
  [[ -z "$TMPL_NAME" ]] && error "Kein Debian-12-Template verfügbar. Bitte manuell via 'pveam update' laden."
  pveam download local "$TMPL_NAME" | tail -1
  TEMPLATE_PATH="/var/lib/vz/template/cache/${TMPL_NAME}"
  ok "Template heruntergeladen: $TMPL_NAME"
fi

# ── Container erstellen ───────────────────────────────────────
info "Erstelle LXC-Container ${CT_ID} (${CT_NAME})..."

pct create "$CT_ID" "$TEMPLATE_PATH" \
  --hostname   "$CT_NAME" \
  --memory     "$CT_RAM" \
  --cores      "$CT_CPU" \
  --rootfs     "${STORAGE}:${CT_DISK}" \
  --net0       "name=eth0,bridge=${CT_BRIDGE},ip=dhcp" \
  --ostype     debian \
  --unprivileged 1 \
  --features   nesting=1 \
  --password   "$CT_PASS" \
  --start      0 \
  --onboot     1

ok "Container ${CT_ID} erstellt"

# ── Container starten ─────────────────────────────────────────
info "Starte Container..."
pct start "$CT_ID"
sleep 5

# Auf Netzwerk warten
info "Warte auf Netzwerk..."
for i in {1..20}; do
  IP=$(pct exec "$CT_ID" -- hostname -I 2>/dev/null | awk '{print $1}')
  [[ -n "$IP" ]] && break
  sleep 2
done
[[ -z "$IP" ]] && error "Container hat keine IP bekommen. Bridge '${CT_BRIDGE}' und DHCP prüfen."
ok "Container-IP: ${IP}"

# ── NetWatch im Container installieren ───────────────────────
info "Installiere Node.js und NetWatch im Container..."

pct exec "$CT_ID" -- bash -c "
  set -e
  export DEBIAN_FRONTEND=noninteractive
  export LC_ALL=C.UTF-8
  export LANG=C.UTF-8

  # System aktualisieren
  apt-get update -qq
  apt-get upgrade -y -qq

  # Node.js 22 LTS via NodeSource
  apt-get install -y -qq curl git
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - &>/dev/null
  apt-get install -y -qq nodejs

  # NetWatch klonen
  git clone --depth 1 https://github.com/MSalzer84/netwatch.git /opt/netwatch &>/dev/null
  cd /opt/netwatch
  npm install --omit=dev --silent

  # systemd-Service einrichten
  cat > /etc/systemd/system/netwatch-server.service <<'EOF'
[Unit]
Description=NetWatch Dashboard Server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/opt/netwatch
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=netwatch-server
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

  systemctl daemon-reload
  systemctl enable netwatch-server --quiet
  systemctl start  netwatch-server
  sleep 3
  systemctl is-active netwatch-server
"

# ── Abschluss ─────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${GREEN}╔═══════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}${GREEN}║        NetWatch erfolgreich installiert!          ║${NC}"
echo -e "${BOLD}${GREEN}╚═══════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  Dashboard  →  ${BOLD}http://${IP}:${NETWATCH_PORT}/netwatch-v3.html${NC}"
echo ""
echo -e "  Zugangsdaten Container (root):"
echo -e "    Benutzer : ${BOLD}root${NC}"
echo -e "    Passwort : ${BOLD}${CT_PASS}${NC}"
echo ""
echo "  Container verwalten (auf dem Proxmox-Host):"
echo "    pct enter ${CT_ID}                         # Shell im Container (ohne Passwort)"
echo "    pct stop  ${CT_ID} / pct start ${CT_ID}   # Stoppen / Starten"
echo ""
echo "  Logs anzeigen (im Container):"
echo "    journalctl -u netwatch-server -f"
echo ""
echo "  NetWatch aktualisieren (im Container):"
echo "    cd /opt/netwatch && git pull && systemctl restart netwatch-server"
echo ""
