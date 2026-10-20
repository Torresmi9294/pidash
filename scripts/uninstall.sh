#!/usr/bin/env bash
# Removes PiDash. Your settings in /var/lib/pidash are kept unless you pass --purge.
set -euo pipefail

PURGE=0
[ "${1:-}" = "--purge" ] && PURGE=1
[ "$(id -u)" -eq 0 ] || { echo "Run as root: sudo $0" >&2; exit 1; }

systemctl disable --now pidash-update.path pidash-kiosk.service pidash.service 2>/dev/null || true
rm -f /etc/systemd/system/pidash.service /etc/systemd/system/pidash-kiosk.service \
      /etc/systemd/system/pidash-update.path /etc/systemd/system/pidash-update.service \
      /etc/xdg/autostart/pidash-kiosk.desktop /etc/pam.d/cage
systemctl daemon-reload
rm -rf /opt/pidash /opt/pidash.old /opt/pidash.new /opt/pidash.failed /usr/local/lib/pidash /run/pidash-update

# If kiosk mode replaced a desktop login manager, bring it back.
if systemctl list-unit-files 2>/dev/null | grep -qE '^(lightdm|gdm3?|sddm)\.service'; then
  for dm in lightdm gdm3 gdm sddm; do
    if systemctl list-unit-files "$dm.service" >/dev/null 2>&1 && systemctl cat "$dm.service" >/dev/null 2>&1; then
      systemctl enable "$dm.service" >/dev/null 2>&1 && echo "Re-enabled $dm"; break
    fi
  done
fi

if [ "$PURGE" -eq 1 ]; then
  rm -rf /var/lib/pidash /etc/pidash
  userdel pidash 2>/dev/null || true
  echo "PiDash removed, including settings."
else
  echo "PiDash removed. Settings kept in /var/lib/pidash and /etc/pidash (use --purge to delete)."
fi
echo "Node.js (/opt/node) and any installed packages (chromium, cage...) were left in place."
