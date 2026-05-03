#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
#  NetWatch Linux Agent – Installer
#  Nutzung:
#    curl -sSL http://NETWATCH-SERVER:3000/install-linux.sh | sudo bash
#  oder mit Optionen:
#    curl -sSL http://NETWATCH-SERVER:3000/install-linux.sh | sudo bash -s -- \
#      --server http://192.168.1.100:3000 \
#      --interval 60 \
#      --site "Wien HQ" \
#      --network "Servernetz"
# ═══════════════════════════════════════════════════════════════
set -euo pipefail

# ── Farben ───────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

info()  { echo -e "${CYAN}[INFO]${NC}  $*"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error() { echo -e "${RED}[FEHLER]${NC} $*" >&2; exit 1; }

echo -e "${BOLD}"
echo "╔═══════════════════════════════════════════╗"
echo "║     NetWatch Linux Agent – Installer      ║"
echo "╚═══════════════════════════════════════════╝"
echo -e "${NC}"

# ── Root prüfen ─────────────────────────────────────────────────
[[ $EUID -ne 0 ]] && error "Bitte als root ausführen (sudo bash)"

# ── Standard-Argumente ──────────────────────────────────────────
SERVER_URL=""
INTERVAL=60
SITE=""
NETWORK=""
GROUP=""
EXTRA_ARGS=()

# ── Argumente parsen ────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --server)   SERVER_URL="$2"; shift 2 ;;
    --interval) INTERVAL="$2";   shift 2 ;;
    --site)     SITE="$2";       shift 2 ;;
    --network)  NETWORK="$2";    shift 2 ;;
    --group)    GROUP="$2";      shift 2 ;;
    --docker)   EXTRA_ARGS+=("--docker");   shift ;;
    --tags)     EXTRA_ARGS+=("--tags" "$2"); shift 2 ;;
    *)          warn "Unbekanntes Argument: $1"; shift ;;
  esac
done

# ── Server-URL aus dem Skript-Download ableiten (wenn nicht übergeben) ──
if [[ -z "$SERVER_URL" ]]; then
  # Wenn via curl | bash aufgerufen, kann $0 nicht helfen.
  # Nutzer muss --server angeben oder wir fragen interaktiv.
  if [[ -t 0 ]]; then
    echo -n "NetWatch Server-URL (z.B. http://192.168.1.100:3000): "
    read -r SERVER_URL
  else
    error "Bitte --server http://IP:3000 angeben, z.B.:\n  curl ... | sudo bash -s -- --server http://192.168.1.100:3000"
  fi
fi

[[ -z "$SERVER_URL" ]] && error "Keine Server-URL angegeben"
SERVER_URL="${SERVER_URL%/}"  # trailing slash entfernen

info "Server-URL: $SERVER_URL"

# ── Python prüfen ────────────────────────────────────────────────
PYTHON=""
for py in python3 python; do
  if command -v "$py" &>/dev/null; then
    VER=$("$py" -c 'import sys; print(sys.version_info.major)' 2>/dev/null || echo 0)
    if [[ "$VER" -ge 3 ]]; then
      PYTHON="$py"
      break
    fi
  fi
done
[[ -z "$PYTHON" ]] && error "Python 3 nicht gefunden. Bitte installieren: apt install python3"
ok "Python gefunden: $PYTHON ($($PYTHON --version 2>&1))"

# ── pip prüfen / installieren ────────────────────────────────────
if ! $PYTHON -m pip --version &>/dev/null; then
  info "pip nicht gefunden — versuche zu installieren..."
  if command -v apt-get &>/dev/null; then
    apt-get install -y python3-pip &>/dev/null && ok "pip via apt installiert"
  elif command -v dnf &>/dev/null; then
    dnf install -y python3-pip &>/dev/null && ok "pip via dnf installiert"
  elif command -v yum &>/dev/null; then
    yum install -y python3-pip &>/dev/null && ok "pip via yum installiert"
  else
    $PYTHON -m ensurepip --upgrade &>/dev/null || error "pip konnte nicht installiert werden"
  fi
fi

# ── Abhängigkeiten installieren ──────────────────────────────────
info "Installiere Python-Abhängigkeiten..."
# Erst via apt versuchen (Debian/Ubuntu/Proxmox), dann pip
PKGS_INSTALLED=false
if command -v apt-get &>/dev/null; then
  apt-get install -y python3-psutil python3-requests &>/dev/null && PKGS_INSTALLED=true && ok "psutil & requests via apt installiert"
fi
if [[ "$PKGS_INSTALLED" == false ]]; then
  # pip mit --break-system-packages für Debian 12+ (PEP 668)
  $PYTHON -m pip install --quiet --upgrade psutil requests 2>/dev/null \
    || $PYTHON -m pip install --quiet --upgrade --break-system-packages psutil requests \
    || error "Abhängigkeiten konnten nicht installiert werden"
  ok "psutil & requests installiert"
fi

# ── Zielverzeichnis anlegen ──────────────────────────────────────
INSTALL_DIR="/opt/netwatch"
mkdir -p "$INSTALL_DIR"
info "Installationsverzeichnis: $INSTALL_DIR"

# ── Agent herunterladen ──────────────────────────────────────────
info "Lade linux-agent.py herunter..."
if command -v curl &>/dev/null; then
  curl -sSfL "${SERVER_URL}/agents/linux-agent.py" -o "${INSTALL_DIR}/linux-agent.py" \
    || error "Download fehlgeschlagen. Ist der NetWatch-Server erreichbar?"
elif command -v wget &>/dev/null; then
  wget -qO "${INSTALL_DIR}/linux-agent.py" "${SERVER_URL}/agents/linux-agent.py" \
    || error "Download fehlgeschlagen. Ist der NetWatch-Server erreichbar?"
else
  error "Weder curl noch wget gefunden"
fi
chmod +x "${INSTALL_DIR}/linux-agent.py"
ok "Agent heruntergeladen nach ${INSTALL_DIR}/linux-agent.py"

# ── Systemd-Service schreiben ────────────────────────────────────
info "Schreibe systemd-Unit..."

EXEC_ARGS="--server ${SERVER_URL} --interval ${INTERVAL}"
[[ -n "$SITE" ]]    && EXEC_ARGS+=" --site '${SITE}'"
[[ -n "$NETWORK" ]] && EXEC_ARGS+=" --network '${NETWORK}'"
[[ -n "$GROUP" ]]   && EXEC_ARGS+=" --group '${GROUP}'"
for arg in "${EXTRA_ARGS[@]:-}"; do
  EXEC_ARGS+=" $arg"
done

cat > /etc/systemd/system/netwatch-agent.service <<EOF
[Unit]
Description=NetWatch Linux Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=${PYTHON} ${INSTALL_DIR}/linux-agent.py ${EXEC_ARGS}
Restart=on-failure
RestartSec=30
StandardOutput=journal
StandardError=journal
SyslogIdentifier=netwatch-agent

[Install]
WantedBy=multi-user.target
EOF

ok "systemd-Unit geschrieben: /etc/systemd/system/netwatch-agent.service"

# ── Service aktivieren & starten ─────────────────────────────────
info "Aktiviere und starte netwatch-agent..."
systemctl daemon-reload
systemctl enable netwatch-agent --quiet
systemctl restart netwatch-agent

sleep 2

if systemctl is-active --quiet netwatch-agent; then
  ok "netwatch-agent läuft!"
else
  warn "netwatch-agent konnte nicht gestartet werden"
  echo "Logs anzeigen: journalctl -u netwatch-agent -n 30"
fi

# ── Abschluss ────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${GREEN}✓ Installation abgeschlossen!${NC}"
echo ""
echo "  Service-Status:  systemctl status netwatch-agent"
echo "  Live-Logs:       journalctl -u netwatch-agent -f"
echo "  Agent-Daten:     ${INSTALL_DIR}/linux-agent.py"
echo ""
echo "  Das Gerät erscheint in Kürze im NetWatch Dashboard."
echo ""
