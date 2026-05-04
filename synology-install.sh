#!/usr/bin/env bash
# =============================================================
#  NetWatch – Synology NAS Installer
#  Installiert NetWatch als Docker-Container auf einer Synology NAS.
#
#  Voraussetzung: Container Manager in der Package Center installiert.
#
#  Per SSH auf der Synology ausführen (als admin/root):
#    bash <(curl -sSL https://raw.githubusercontent.com/MSalzer84/netwatch/main/synology-install.sh)
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
echo "║     NetWatch – Synology Installer                 ║"
echo "╚═══════════════════════════════════════════════════╝"
echo -e "${NC}"

# ── Synology & Docker prüfen ──────────────────────────────────
[[ $EUID -ne 0 ]] && error "Bitte als root ausführen: sudo bash synology-install.sh"
command -v docker &>/dev/null || error "Docker nicht gefunden.\nBitte 'Container Manager' im Package Center installieren."

DOCKER_VER=$(docker --version | grep -oP '[\d.]+' | head -1)
ok "Docker $DOCKER_VER gefunden"

# ── Installationsverzeichnis ──────────────────────────────────
# Synology: /volume1 ist die Standard-Volume
VOLUME="/volume1"
[[ ! -d "$VOLUME" ]] && VOLUME="/"

INSTALL_DIR="${VOLUME}/docker/netwatch"
DATA_DIR="${INSTALL_DIR}/data"

info "Installationsverzeichnis: $INSTALL_DIR"
mkdir -p "$INSTALL_DIR" "$DATA_DIR"

# ── Lokale IP ermitteln ───────────────────────────────────────
LOCAL_IP=$(ip route get 1.1.1.1 2>/dev/null | awk '{print $7; exit}' || hostname -I | awk '{print $1}')

# ── docker-compose.yml schreiben ──────────────────────────────
info "Schreibe docker-compose.yml..."
cat > "${INSTALL_DIR}/docker-compose.yml" <<EOF
services:
  netwatch:
    image: node:lts-alpine
    container_name: netwatch
    restart: unless-stopped
    working_dir: /app
    command: node server.js
    network_mode: host
    volumes:
      - ${INSTALL_DIR}/app:/app
      - ${DATA_DIR}:/app/data
    environment:
      - NODE_ENV=production
      - DB_PATH=/app/data/netwatch.db
EOF
ok "docker-compose.yml geschrieben"

# ── NetWatch herunterladen ────────────────────────────────────
APP_DIR="${INSTALL_DIR}/app"
if [[ -d "$APP_DIR/.git" ]]; then
  info "NetWatch bereits vorhanden — aktualisiere..."
  git -C "$APP_DIR" pull --quiet
  ok "NetWatch aktualisiert"
else
  info "Lade NetWatch herunter..."
  # git bevorzugen, sonst curl+tar
  if command -v git &>/dev/null; then
    git clone --depth 1 https://github.com/MSalzer84/netwatch.git "$APP_DIR" &>/dev/null
  else
    mkdir -p "$APP_DIR"
    curl -sSL https://github.com/MSalzer84/netwatch/archive/refs/heads/main.tar.gz \
      | tar -xz -C "$APP_DIR" --strip-components=1
  fi
  ok "NetWatch heruntergeladen"
fi

# ── npm-Abhängigkeiten installieren ──────────────────────────
info "Installiere npm-Abhängigkeiten (im Container)..."
docker run --rm \
  -v "${APP_DIR}:/app" \
  -w /app \
  node:lts-alpine \
  sh -c "npm install --omit=dev --silent" 2>/dev/null
ok "npm install abgeschlossen"

# ── Container starten ─────────────────────────────────────────
info "Starte NetWatch Container..."
cd "$INSTALL_DIR"

# Alten Container entfernen falls vorhanden
docker rm -f netwatch 2>/dev/null || true

docker compose up -d
sleep 4

if docker ps --filter "name=netwatch" --filter "status=running" | grep -q netwatch; then
  ok "NetWatch läuft!"
else
  warn "Container ist nicht gestartet — Logs:"
  docker logs netwatch 2>&1 | tail -20
  exit 1
fi

# ── Autostart sicherstellen ───────────────────────────────────
# Synology startet Docker-Container mit restart:unless-stopped automatisch.
# Zusätzlich: Upstart-/systemd-Trigger für nach NAS-Reboot (DSM 7)
if command -v synoservice &>/dev/null; then
  # Container Manager Dienst ist aktiv → restart:unless-stopped reicht
  ok "Synology Container Manager: Autostart aktiv (restart: unless-stopped)"
fi

# ── Abschluss ─────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${GREEN}╔═══════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}${GREEN}║        NetWatch erfolgreich installiert!          ║${NC}"
echo -e "${BOLD}${GREEN}╚═══════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  Dashboard  →  ${BOLD}http://${LOCAL_IP}:3000/netwatch-v3.html${NC}"
echo ""
echo "  Nützliche Befehle (per SSH auf der Synology):"
echo "    docker logs -f netwatch                    # Live-Logs"
echo "    docker restart netwatch                    # Neustart"
echo "    cd ${INSTALL_DIR} && docker compose down  # Stoppen"
echo ""
echo "  NetWatch aktualisieren:"
echo "    cd ${INSTALL_DIR} && git -C app pull && docker restart netwatch"
echo ""
