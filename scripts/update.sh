#!/usr/bin/env bash
# PiDash update helper. Runs as root, started by pidash-update.path when the admin page asks for an update.
# Installed to /usr/local/lib/pidash/update.sh by install.sh (a root-owned copy the web server cannot edit).
#
# It deliberately ignores the contents of the request file: it only ever installs the newest commit of the repo
# named in /etc/pidash/update.conf, downloaded from GitHub over HTTPS and pinned to one commit id.
# If the new version does not answer its health check, the previous version is put back.
set -euo pipefail

CONF=${PIDASH_UPDATE_CONF:-/etc/pidash/update.conf}
# shellcheck source=/dev/null
. "$CONF"
# From the conf: REPO BRANCH APP_DIR NODE_DIR ENV_FILE REQUEST_FILE STATE_DIR HELPER_DST
STATUS_FILE=$STATE_DIR/status.json

mkdir -p "$STATE_DIR"
chmod 755 "$STATE_DIR"

set_status() { # state message
  local tmp="$STATE_DIR/.status.$$"
  printf '{"state":"%s","message":"%s","at":"%s"}\n' "$1" "$2" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$tmp"
  chmod 644 "$tmp"
  mv -f "$tmp" "$STATUS_FILE"
}

# One update at a time.
exec 9>"$STATE_DIR/lock"
flock -n 9 || exit 0

# Take the request now, so a failure cannot make the path unit run us in a loop.
rm -f "$REQUEST_FILE"

WORK=$(mktemp -d "${TMPDIR:-/var/tmp}/pidash-update.XXXXXX")
NEW=""
SWAPPED=0
cleanup() {
  rm -rf "$WORK"
  [ -n "$NEW" ] && rm -rf "$NEW"
  return 0
}
trap cleanup EXIT
fail() {
  set_status failed "$1"
  echo "pidash-update: $1" >&2
  exit 1
}

PORT=$(sed -n 's/^PORT=//p' "$ENV_FILE" 2>/dev/null | head -n1)
PORT=${PORT:-8080}

healthy() {

  for _ in $(seq 1 "${HEALTH_TRIES:-40}"); do
    if curl -fs --max-time 3 "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then return 0; fi
    sleep "${HEALTH_SLEEP:-1}"
  done
  return 1
}

set_status running "Checking GitHub"
SHA=$(curl -fsSL --max-time 30 -H 'Accept: application/vnd.github.sha' -H 'User-Agent: PiDash-updater' \
  "https://api.github.com/repos/$REPO/commits/$BRANCH") || fail "Could not reach GitHub."
[[ $SHA =~ ^[0-9a-f]{40}$ ]] || fail "GitHub gave an unexpected answer."

CURRENT=$(sed -n 's/.*"sha" *: *"\([0-9a-f]*\)".*/\1/p' "$APP_DIR/.version" 2>/dev/null | head -n1 || true)
if [ "$CURRENT" = "$SHA" ]; then
  set_status "done" "Already up to date."
  exit 0
fi

set_status running "Downloading ${SHA:0:7}"
curl -fsSL --max-time 300 -o "$WORK/src.tar.gz" "https://codeload.github.com/$REPO/tar.gz/$SHA" || fail "Download failed."
mkdir "$WORK/src"
tar -xzf "$WORK/src.tar.gz" -C "$WORK/src" --strip-components=1 || fail "The download was not a valid archive."
if [ ! -f "$WORK/src/package.json" ] || [ ! -f "$WORK/src/server/index.js" ]; then fail "The download does not look like PiDash."; fi

set_status running "Preparing ${SHA:0:7}"
NEW="$APP_DIR.new"
rm -rf "$NEW"
mkdir "$NEW"
tar -C "$WORK/src" --exclude=./.git --exclude=./node_modules --exclude=./data --exclude=./test -cf - . | tar -C "$NEW" -xf -
if [ -d "$APP_DIR/node_modules" ] && cmp -s "$APP_DIR/package.json" "$NEW/package.json" \
   && { [ ! -f "$NEW/package-lock.json" ] || cmp -s "$APP_DIR/package-lock.json" "$NEW/package-lock.json"; }; then
  cp -a "$APP_DIR/node_modules" "$NEW/node_modules"
else
  set_status running "Installing dependencies"
  (
    cd "$NEW"
    export PATH="$NODE_DIR:$PATH"
    if [ -f package-lock.json ]; then npm ci --omit=dev --no-audit --no-fund --loglevel=error
    else npm install --omit=dev --no-audit --no-fund --loglevel=error; fi
  ) || fail "Installing dependencies failed."
fi
printf '{"sha":"%s","installedAt":"%s"}\n' "$SHA" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$NEW/.version"
chown -R root:root "$NEW"
chmod 755 "$NEW/scripts/"*.sh

set_status running "Restarting"
rm -rf "$APP_DIR.old"
mv "$APP_DIR" "$APP_DIR.old"
mv "$NEW" "$APP_DIR"
NEW=""
SWAPPED=1
systemctl restart pidash.service || true

if healthy; then
  rm -rf "$APP_DIR.old"
  # Keep the root-owned helper itself current (rename is atomic, so this running copy is not disturbed).
  if ! cmp -s "$APP_DIR/scripts/update.sh" "$HELPER_DST"; then
    if install -m 755 "$APP_DIR/scripts/update.sh" "$HELPER_DST.new"; then mv -f "$HELPER_DST.new" "$HELPER_DST" || true; fi
  fi
  set_status "done" "Updated to ${SHA:0:7}"
  exit 0
fi

# The new version never became healthy: put the old one back.
if [ "$SWAPPED" -eq 1 ]; then
  set_status running "New version failed its health check - rolling back"
  rm -rf "$APP_DIR.failed"
  mv "$APP_DIR" "$APP_DIR.failed"
  mv "$APP_DIR.old" "$APP_DIR"
  rm -rf "$APP_DIR.failed"
  systemctl restart pidash.service || true
  if healthy; then fail "The new version did not start, so the previous version was restored."; fi
  fail "The new version did not start and the rollback did not start either - check: journalctl -u pidash"
fi
