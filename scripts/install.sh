#!/usr/bin/env bash
# PiDash installer - Raspberry Pi OS / Debian / Ubuntu / DietPi.
# Works on every Raspberry Pi (Zero/1 ARMv6, 2/3/Zero 2 ARMv7, 3/4/5/400/CM4 64-bit) and x86_64 PCs.
#
#   sudo ./scripts/install.sh [--port 8080] [--kiosk auto|cage|x11|desktop|none]
#
# Re-running it upgrades the app in place and keeps your settings.
set -euo pipefail

APP_DIR=/opt/pidash
HOME_DIR=/var/lib/pidash
DATA_DIR=$HOME_DIR/data
ENV_DIR=/etc/pidash
ENV_FILE=$ENV_DIR/pidash.env
SVC_USER=pidash
NODE_VERSION=20.18.1
PORT=""
KIOSK=auto
REPLACE_DESKTOP=0

say()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33mWARN:\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }

usage() {
  cat <<'EOF'
Usage: sudo ./scripts/install.sh [options]

  --port N            Web port (default 8080; ports below 1024 are allowed)
  --kiosk MODE        How to show the dashboard on the Pi's own screen:
                        auto     (default) desktop autostart if a desktop is installed, else cage
                        cage     Lightweight Wayland kiosk on boot (best for Raspberry Pi OS Lite)
                        x11      X11 + openbox kiosk on boot (fallback if cage does not work)
                        desktop  Add a Chromium autostart entry to an existing desktop session
                        none     Server only - open http://<pi>:PORT/ from any browser/TV/tablet
  --no-kiosk          Same as --kiosk none
  --replace-desktop   Allow cage/x11 mode to disable an installed display manager (lightdm, gdm...)
  --node-version V    Node.js version to download if the system has none >= 18 (default 20.18.1)
  -h, --help
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --port) PORT="${2:?--port needs a value}"; shift 2 ;;
    --kiosk) KIOSK="${2:?--kiosk needs a value}"; shift 2 ;;
    --no-kiosk) KIOSK=none; shift ;;
    --replace-desktop) REPLACE_DESKTOP=1; shift ;;
    --node-version) NODE_VERSION="${2:?}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) usage; die "unknown option: $1" ;;
  esac
done

case "$KIOSK" in auto|cage|x11|desktop|none) ;; *) die "--kiosk must be auto, cage, x11, desktop or none" ;; esac
if [ -n "$PORT" ]; then
  case "$PORT" in ''|*[!0-9]*) die "--port must be a number" ;; esac
  if [ "$PORT" -lt 1 ] || [ "$PORT" -gt 65535 ]; then die "--port must be 1-65535"; fi
fi

[ "$(id -u)" -eq 0 ] || die "Run as root:  sudo $0 $*"
command -v apt-get >/dev/null || die "This installer needs an apt-based OS (Raspberry Pi OS, Debian, Ubuntu, DietPi). On anything else use Docker - see README."
command -v systemctl >/dev/null || die "systemd is required."

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [ ! -f "$SRC_DIR/package.json" ] || [ ! -d "$SRC_DIR/server" ]; then die "Run this from a PiDash checkout (package.json not found in $SRC_DIR)."; fi

export DEBIAN_FRONTEND=noninteractive

# ---------------------------------------------------------------- packages
say "Installing base packages"
apt-get update -qq
apt-get install -y -qq curl ca-certificates xz-utils avahi-daemon fonts-noto-color-emoji fonts-liberation >/dev/null

# -------------------------------------------------------------------- node
node_ok() {
  local bin="$1" major
  [ -x "$bin" ] || return 1
  major="$("$bin" -p 'process.versions.node.split(".")[0]' 2>/dev/null)" || return 1
  [ "${major:-0}" -ge 18 ]
}

install_node() {
  local arch base file tmp
  case "$(dpkg --print-architecture)" in
    amd64) arch=x64;   base=https://nodejs.org/dist ;;
    arm64) arch=arm64; base=https://nodejs.org/dist ;;
    armhf)
      if grep -qi 'ARMv6' /proc/cpuinfo; then
        arch=armv6l; base=https://unofficial-builds.nodejs.org/download/release   # Pi Zero / Pi 1
      else
        arch=armv7l; base=https://nodejs.org/dist
      fi ;;
    *) die "Unsupported CPU architecture: $(dpkg --print-architecture)" ;;
  esac
  file="node-v${NODE_VERSION}-linux-${arch}.tar.xz"
  tmp="$(mktemp -d)"
  say "Downloading Node.js ${NODE_VERSION} (${arch})"
  curl -fsSL "$base/v${NODE_VERSION}/$file" -o "$tmp/$file"
  curl -fsSL "$base/v${NODE_VERSION}/SHASUMS256.txt" -o "$tmp/SHASUMS256.txt"
  (cd "$tmp" && grep " ${file}\$" SHASUMS256.txt | sha256sum -c - >/dev/null) || die "Node.js checksum verification failed"
  rm -rf "/opt/node-v${NODE_VERSION}-linux-${arch}"
  tar -xJf "$tmp/$file" -C /opt
  ln -sfn "/opt/node-v${NODE_VERSION}-linux-${arch}" /opt/node
  rm -rf "$tmp"
}

NODE_BIN=""
if command -v node >/dev/null && node_ok "$(command -v node)"; then
  NODE_BIN="$(command -v node)"
else
  node_ok /opt/node/bin/node || install_node
  NODE_BIN=/opt/node/bin/node
fi
node_ok "$NODE_BIN" || die "Node.js >= 18 is not usable on this system."
NODE_DIR="$(dirname "$(readlink -f "$NODE_BIN")")"
say "Using Node.js $("$NODE_BIN" -v) at $NODE_BIN"

# --------------------------------------------------------------- user, app
if ! id "$SVC_USER" >/dev/null 2>&1; then
  say "Creating system user '$SVC_USER'"
  useradd --system --home-dir "$HOME_DIR" --create-home --shell /usr/sbin/nologin "$SVC_USER"
fi
for g in video render input audio; do
  getent group "$g" >/dev/null && usermod -aG "$g" "$SVC_USER"
done

say "Installing app to $APP_DIR"
mkdir -p "$APP_DIR"
rm -rf "${APP_DIR:?}/server" "${APP_DIR:?}/public" "${APP_DIR:?}/widgets" "${APP_DIR:?}/scripts"
tar -C "$SRC_DIR" --exclude=./.git --exclude=./node_modules --exclude=./data --exclude=./test -cf - . | tar -C "$APP_DIR" -xf -
(
  cd "$APP_DIR"
  export PATH="$NODE_DIR:$PATH"
  if [ -f package-lock.json ]; then npm ci --omit=dev --no-audit --no-fund --loglevel=error
  else npm install --omit=dev --no-audit --no-fund --loglevel=error; fi
)
# Record which commit this is, so the admin page can tell when GitHub has something newer.
rm -f "$APP_DIR/.version"
if command -v git >/dev/null && SHA="$(git -C "$SRC_DIR" rev-parse HEAD 2>/dev/null)" && [[ $SHA =~ ^[0-9a-f]{40}$ ]]; then
  printf '{"sha":"%s","installedAt":"%s"}\n' "$SHA" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$APP_DIR/.version"
fi
chown -R root:root "$APP_DIR"
chmod 755 "$APP_DIR/scripts/"*.sh

mkdir -p "$DATA_DIR/widgets" "$DATA_DIR/backgrounds" "$ENV_DIR"
chown -R "$SVC_USER:$SVC_USER" "$HOME_DIR"
chmod 700 "$DATA_DIR"

# Settings file is only created once so upgrades never clobber it.
if [ ! -f "$ENV_FILE" ]; then
  cat > "$ENV_FILE" <<EOF
# PiDash environment. Restart with: sudo systemctl restart pidash
PORT=${PORT:-8080}
HOST=0.0.0.0
DATA_DIR=$DATA_DIR
PIDASH_INSTALL=systemd
# KIOSK_URL=http://localhost:8080/
# KIOSK_EXTRA_FLAGS=--force-device-scale-factor=1.25
EOF
elif [ -n "$PORT" ]; then
  sed -i "s/^PORT=.*/PORT=$PORT/" "$ENV_FILE"
fi
# Installs made before one-click updates existed don't have this line.
grep -q '^PIDASH_INSTALL=' "$ENV_FILE" || echo 'PIDASH_INSTALL=systemd' >> "$ENV_FILE"
chmod 644 "$ENV_FILE"
PORT="$(sed -n 's/^PORT=//p' "$ENV_FILE" | head -n1)"

# ---------------------------------------------------------- server service
cat > /etc/systemd/system/pidash.service <<EOF
[Unit]
Description=PiDash dashboard server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$SVC_USER
Group=$SVC_USER
WorkingDirectory=$APP_DIR
EnvironmentFile=$ENV_FILE
ExecStart=$NODE_BIN server/index.js
Restart=always
RestartSec=3
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=$HOME_DIR
AmbientCapabilities=CAP_NET_BIND_SERVICE
CapabilityBoundingSet=CAP_NET_BIND_SERVICE

[Install]
WantedBy=multi-user.target
EOF

# ------------------------------------------------- one-click update helper
# The web server is sandboxed and cannot change its own code. For the admin "Update" button it drops a request file;
# this root-owned helper (outside the app folder) notices it and does the install. See scripts/update.sh.
mkdir -p /usr/local/lib/pidash
install -m 755 "$APP_DIR/scripts/update.sh" /usr/local/lib/pidash/update.sh
cat > "$ENV_DIR/update.conf" <<EOF
REPO=Torresmi9294/pidash
BRANCH=main
APP_DIR=$APP_DIR
NODE_DIR=$NODE_DIR
ENV_FILE=$ENV_FILE
REQUEST_FILE=$HOME_DIR/update.request
STATE_DIR=/run/pidash-update
HELPER_DST=/usr/local/lib/pidash/update.sh
EOF
chmod 644 "$ENV_DIR/update.conf"
rm -f "$HOME_DIR/update.request"
cat > /etc/systemd/system/pidash-update.path <<EOF
[Unit]
Description=Watch for a PiDash update request from the admin page

[Path]
PathExists=$HOME_DIR/update.request
Unit=pidash-update.service

[Install]
WantedBy=multi-user.target
EOF
cat > /etc/systemd/system/pidash-update.service <<'EOF'
[Unit]
Description=Install a PiDash update (requested from the admin page)

[Service]
Type=oneshot
ExecStart=/usr/local/lib/pidash/update.sh
EOF

# ------------------------------------------------------------------- kiosk
has_display_manager() {
  systemctl is-enabled display-manager.service >/dev/null 2>&1
}

install_browser() {
  if command -v chromium >/dev/null || command -v chromium-browser >/dev/null; then return; fi
  say "Installing Chromium"
  apt-get install -y -qq chromium >/dev/null 2>&1 || apt-get install -y -qq chromium-browser >/dev/null
}

disable_kiosk_services() {
  systemctl disable --now pidash-kiosk.service >/dev/null 2>&1 || true
  rm -f /etc/systemd/system/pidash-kiosk.service /etc/xdg/autostart/pidash-kiosk.desktop
}

if [ "$KIOSK" = auto ]; then
  if has_display_manager; then KIOSK=desktop; else KIOSK=cage; fi
fi

if [ "$KIOSK" != none ] && [ "$KIOSK" != desktop ] && has_display_manager && [ "$REPLACE_DESKTOP" -ne 1 ]; then
  warn "A desktop login manager is enabled; '$KIOSK' mode would replace it. Using 'desktop' autostart instead."
  warn "(Re-run with --replace-desktop to force $KIOSK mode.)"
  KIOSK=desktop
fi

disable_kiosk_services
case "$KIOSK" in
  none)
    say "Skipping kiosk setup (server only)" ;;

  desktop)
    install_browser
    say "Adding Chromium kiosk autostart for desktop sessions"
    mkdir -p /etc/xdg/autostart
    cat > /etc/xdg/autostart/pidash-kiosk.desktop <<EOF
[Desktop Entry]
Type=Application
Name=PiDash kiosk
Exec=$APP_DIR/scripts/kiosk.sh desktop
X-GNOME-Autostart-enabled=true
EOF
    ;;

  cage|x11)
    install_browser
    if [ "$KIOSK" = cage ]; then
      say "Installing cage (Wayland kiosk compositor)"
      if ! apt-get install -y -qq cage >/dev/null 2>&1; then
        warn "cage is not available on this OS; falling back to x11 mode."
        KIOSK=x11
      fi
    fi
    if [ "$KIOSK" = x11 ]; then
      say "Installing X11 + openbox"
      apt-get install -y -qq xserver-xorg xinit x11-xserver-utils openbox xserver-xorg-legacy >/dev/null
      printf 'allowed_users=anybody\nneeds_root_rights=yes\n' > /etc/X11/Xwrapper.config
      KIOSK_EXEC="$(command -v xinit) $APP_DIR/scripts/kiosk.sh x11 -- :0 vt1 -nolisten tcp"
    else
      KIOSK_EXEC="$(command -v cage) -d -- $APP_DIR/scripts/kiosk.sh cage"
      cat > /etc/pam.d/cage <<'EOF'
auth    required pam_unix.so nullok
account required pam_unix.so
session required pam_unix.so
session required pam_systemd.so
EOF
    fi
    if has_display_manager; then
      warn "Disabling the existing display manager (--replace-desktop)"
      systemctl disable display-manager.service >/dev/null 2>&1 || true
    fi
    cat > /etc/systemd/system/pidash-kiosk.service <<EOF
[Unit]
Description=PiDash kiosk ($KIOSK)
After=systemd-user-sessions.service plymouth-quit-wait.service pidash.service dbus.socket systemd-logind.service getty@tty1.service
Wants=pidash.service dbus.socket systemd-logind.service
Conflicts=getty@tty1.service
ConditionPathExists=/dev/tty0

[Service]
Type=simple
User=$SVC_USER
ExecStart=$KIOSK_EXEC
Restart=always
RestartSec=5
PAMName=$( [ "$KIOSK" = cage ] && echo cage || echo login )
UtmpIdentifier=tty1
UtmpMode=user
TTYPath=/dev/tty1
TTYReset=yes
TTYVHangup=yes
TTYVTDisallocate=yes
StandardInput=tty-fail
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=graphical.target
EOF
    systemctl set-default graphical.target >/dev/null 2>&1 || true
    ;;
esac

# --------------------------------------------------------------- start up
systemctl daemon-reload
systemctl enable pidash.service >/dev/null 2>&1
systemctl enable --now pidash-update.path >/dev/null 2>&1
systemctl restart pidash.service
[ -f /etc/systemd/system/pidash-kiosk.service ] && systemctl enable pidash-kiosk.service >/dev/null 2>&1

say "Waiting for the server"
ok=0
for _ in $(seq 1 30); do
  if curl -fs "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then ok=1; break; fi
  sleep 1
done
[ "$ok" -eq 1 ] || { journalctl -u pidash -n 30 --no-pager || true; die "Server did not start - see the log above."; }

HOST_NAME="$(hostname)"
IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
cat <<EOF

  PiDash is running.

    Display : http://${HOST_NAME}.local:${PORT}/     (or http://${IP:-<pi-ip>}:${PORT}/)
    Admin   : http://${HOST_NAME}.local:${PORT}/admin/   <- set up widgets, API keys, Google here

    Kiosk mode : ${KIOSK}
EOF
case "$KIOSK" in
  cage|x11) echo "    Reboot to start the full-screen display:  sudo reboot" ;;
  desktop)  echo "    The dashboard opens full-screen the next time the desktop starts (log out/in or reboot)." ;;
  none)     echo "    Open the Display URL in any full-screen browser." ;;
esac
cat <<EOF

    Logs    : journalctl -u pidash -f
    Upgrade : Admin > Updates > Update now   (or: git pull && sudo ./scripts/install.sh)
    Remove  : sudo ./scripts/uninstall.sh

  Tip: set an admin password under Admin > Security.
EOF
