#!/usr/bin/env bash
# Launches Chromium full-screen on the PiDash display. Called by the kiosk service (cage / x11)
# or by the desktop autostart entry. Usage: kiosk.sh cage|x11|desktop
set -u
MODE="${1:-desktop}"

# shellcheck disable=SC1091
[ -f /etc/pidash/pidash.env ] && . /etc/pidash/pidash.env
PORT="${PORT:-8080}"
URL="${KIOSK_URL:-http://localhost:${PORT}/}"

BROWSER="$(command -v chromium-browser || command -v chromium || true)"
[ -n "$BROWSER" ] || { echo "kiosk: chromium not found" >&2; exit 1; }

# Wait for the server (it starts in parallel at boot).
for _ in $(seq 1 120); do
  curl -fs "http://localhost:${PORT}/api/health" >/dev/null 2>&1 && break
  sleep 1
done

PROFILE="${XDG_CONFIG_HOME:-$HOME/.config}/pidash-kiosk"
mkdir -p "$PROFILE"
# Avoid the "Chromium didn't shut down correctly" bubble after a power cut.
sed -i 's/"exited_cleanly":false/"exited_cleanly":true/; s/"exit_type":"Crashed"/"exit_type":"Normal"/' \
  "$PROFILE/Default/Preferences" "$PROFILE/Local State" 2>/dev/null || true

FLAGS=(
  --kiosk
  --user-data-dir="$PROFILE"
  --noerrdialogs --disable-infobars --no-first-run --no-default-browser-check
  --disable-session-crashed-bubble --disable-features=Translate
  --overscroll-history-navigation=0 --check-for-update-interval=31536000
  --password-store=basic --disable-pinch
)

# Small Pis (Zero 2 W, 1 GB models): trade some polish for stability.
MEM_KB="$(awk '/MemTotal/ {print $2}' /proc/meminfo 2>/dev/null || echo 0)"
if [ "${MEM_KB:-0}" -lt 1200000 ]; then
  FLAGS+=(--enable-low-end-device-mode --disable-smooth-scrolling)
fi

# shellcheck disable=SC2206
[ -n "${KIOSK_EXTRA_FLAGS:-}" ] && FLAGS+=(${KIOSK_EXTRA_FLAGS})

case "$MODE" in
  cage)
    FLAGS+=(--ozone-platform=wayland)
    ;;
  x11)
    xset s off -dpms s noblank 2>/dev/null || true   # never blank the screen
    openbox >/dev/null 2>&1 &
    ;;
  desktop)
    if command -v xset >/dev/null && [ -n "${DISPLAY:-}" ]; then xset s off -dpms s noblank 2>/dev/null || true; fi
    ;;
esac

exec "$BROWSER" "${FLAGS[@]}" "$URL"
