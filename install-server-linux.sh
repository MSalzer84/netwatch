#!/usr/bin/env bash
# =============================================================
#  NetWatch Server – Linux Autostart Installer
#  Richtet den NetWatch-Server als systemd-Dienst ein.
#
#  Nutzung (im NetWatch-Verzeichnis):
#    sudo bash install-server-linux.sh
# =============================================================
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

info()  { echo -e "${CYAN}[INFO]${NC}  $*"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error() { echo -e "${RED}[FEHLER]${NC} $*" >&2; exit 1; }

echo -e "${BOLD}"
echo "╔═══════════════════════════════════════════╗"
echo "║   NetWatch Server – Autostart Installer   ║"
echo "╚═══════════════════════════════════════════╝"
echo -e "${NC}"

# ── Root prüfen ──────────────────────────────────────────────
[[ $EUID -ne 0 ]] && error "Bitte als root ausführen: sudo bash install-server-linux.sh"

# ── Installationsverzeichnis ermitteln ───────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[[ -f "$SCRIPT_DIR/server.js" ]] || error "server.js nicht gefunden in $SCRIPT_DIR"
info "Server-Verzeichnis: $SCRIPT_DIR"

# ── Node.js prüfen ───────────────────────────────────────────
NODE=""
for n in node nodejs; do
  if command -v "$n" &>/dev/null; then
    VER=$("$n" -e 'process.exit(parseInt(process.version.slice(1)) < 16 ? 1 : 0)' 2>/dev/null && echo ok || echo old)
    if [[ "$VER" == "ok" ]]; then NODE="$n"; break; fi
  fi
done

if [[ -z "$NODE" ]]; then
  info "Node.js nicht gefunden – installiere via NodeSource..."
  if command -v apt-get &>/dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_lts.x | bash - &>/dev/null
    apt-get install -y nodejs &>/dev/null
    NODE="node"
  elif command -v dnf &>/dev/null; then
    dnf install -y nodejs &>/dev/null
    NODE="node"
  else
    error "Bitte Node.js 16+ manuell installieren: https://nodejs.org"
  fi
fi
ok "Node.js: $($NODE --version)"

# ── npm-Abhängigkeiten installieren ──────────────────────────
if [[ ! -d "$SCRIPT_DIR/node_modules" ]]; then
  info "Installiere npm-Abhängigkeiten..."
  cd "$SCRIPT_DIR" && npm install --omit=dev --silent
  ok "npm install abgeschlossen"
fi

# ── Systemd-Unit schreiben ────────────────────────────────────
info "Schreibe systemd-Unit..."
NODE_PATH=$(command -v "$NODE")

cat > /etc/systemd/system/netwatch-server.service <<EOF
[Unit]
Description=NetWatch Dashboard Server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${SCRIPT_DIR}
ExecStart=${NODE_PATH} server.js
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=netwatch-server
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

ok "systemd-Unit geschrieben: /etc/systemd/system/netwatch-server.service"

# ── Service aktivieren & starten ─────────────────────────────
info "Aktiviere und starte netwatch-server..."
systemctl daemon-reload
systemctl enable netwatch-server --quiet
systemctl restart netwatch-server

sleep 3

if systemctl is-active --quiet netwatch-server; then
  ok "netwatch-server läuft!"
else
  warn "netwatch-server konnte nicht gestartet werden"
  echo "Logs: journalctl -u netwatch-server -n 30"
  exit 1
fi

# ── Abschluss ─────────────────────────────────────────────────
# Lokale IP ermitteln
LOCAL_IP=$(ip route get 1.1.1.1 2>/dev/null | awk '{print $7; exit}' || hostname -I | awk '{print $1}')

echo ""
echo -e "${BOLD}${GREEN}✓ Installation abgeschlossen!${NC}"
echo ""
echo "  Dashboard:    http://${LOCAL_IP}:3000"
echo "  Status:       systemctl status netwatch-server"
echo "  Live-Logs:    journalctl -u netwatch-server -f"
echo "  Neustart:     systemctl restart netwatch-server"
echo "  Entfernen:    systemctl disable --now netwatch-server"
echo ""
