#!/bin/sh
# Start as root only long enough to make /data writable, then drop privileges.
# Set PUID/PGID to match your host user if you bind-mount a folder (Unraid: 99/100).
set -e
if [ "$(id -u)" = "0" ]; then
  PUID="${PUID:-1000}"
  PGID="${PGID:-1000}"
  mkdir -p "${DATA_DIR:-/data}"
  chown -R "$PUID:$PGID" "${DATA_DIR:-/data}"
  exec su-exec "$PUID:$PGID" "$@"
fi
exec "$@"
