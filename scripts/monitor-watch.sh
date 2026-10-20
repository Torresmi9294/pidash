#!/usr/bin/env bash
# Switches the monitor itself off and on to follow the sleep schedule (Admin > Schedule > "Also switch the monitor off").
# Started by kiosk.sh next to the browser. Usage: monitor-watch.sh cage|x11|desktop [parent-pid]
#
# It asks the PiDash server whether the display should be asleep (GET /api/sleep) and, if the monitor option is on,
# powers the screen off with whatever this session supports: wlr-randr (Wayland: cage, labwc, wayfire), xset/DPMS (X11),
# and vcgencmd for older Pi firmware. If the server cannot be reached the monitor is left on.
set -u
MODE="${1:-desktop}"
PARENT="${2:-0}"

# shellcheck disable=SC1091,SC1090
[ -f "${PIDASH_ENV:-/etc/pidash/pidash.env}" ] && . "${PIDASH_ENV:-/etc/pidash/pidash.env}"
PORT="${PORT:-8080}"
API="${PIDASH_SLEEP_URL:-http://127.0.0.1:${PORT}/api/sleep}"
INTERVAL="${MONITOR_INTERVAL:-20}"

power() { # on | off
  local want="$1" out
  if [ -n "${WAYLAND_DISPLAY:-}" ] && command -v wlr-randr >/dev/null 2>&1; then
    for out in $(wlr-randr 2>/dev/null | awk '/^[^ ]/ {print $1}'); do
      wlr-randr --output "$out" "--$want" >/dev/null 2>&1 || true
    done
  elif [ -n "${DISPLAY:-}" ] && command -v xset >/dev/null 2>&1; then
    if [ "$want" = off ]; then
      xset +dpms 2>/dev/null || true
      xset dpms force off 2>/dev/null || true
    else
      xset dpms force on 2>/dev/null || true
      xset -dpms s reset 2>/dev/null || true
    fi
  fi
  if command -v vcgencmd >/dev/null 2>&1; then
    if [ "$want" = off ]; then vcgencmd display_power 0 >/dev/null 2>&1 || true; else vcgencmd display_power 1 >/dev/null 2>&1 || true; fi
  fi
  echo "monitor-watch($MODE): monitor $want"
}

state=unknown
while :; do
  if [ "$PARENT" -gt 0 ] && ! kill -0 "$PARENT" 2>/dev/null; then break; fi # the browser is gone: stop watching
  json="$(curl -fs --max-time 5 "$API" 2>/dev/null || true)"
  want=on
  case "$json" in
    *'"asleep":true'*'"monitorOff":true'*) want=off ;;
  esac
  if [ "$want" != "$state" ]; then
    power "$want"
    state="$want"
  fi
  [ "${MONITOR_ONCE:-0}" = 1 ] && break
  sleep "$INTERVAL"
done
# Never leave the screen off when this stops.
if [ "$state" = off ] && [ "${MONITOR_ONCE:-0}" != 1 ]; then power on; fi
