# Running PiDash on a server with Docker

PiDash runs fine as a plain web app on any always-on machine (NAS, home server, VPS, another Pi). Anything with a browser can then be the screen: a TV, tablet, old laptop or a Pi in kiosk mode pointed at the server.

## Start it

```bash
git clone https://github.com/Torresmi9294/pidash.git && cd pidash
cp .env.example .env        # set TZ (and PIDASH_PORT if 8080 is taken)
docker compose up -d --build
```

- Display: `http://<server-ip>:8080/`
- Admin: `http://<server-ip>:8080/admin/`. Set an admin password under **Security** first.

The image is built from the checkout, which works on amd64, arm64 and 32-bit ARM. Settings, API keys and reminders live in the `pidash-data` Docker volume and survive restarts and upgrades.

## Upgrade / logs / stop

```bash
git pull && docker compose up -d --build
docker compose logs -f pidash
docker compose down            # keeps your data; add -v to delete it
```

## Backup

```bash
docker run --rm -v pidash_pidash-data:/data -v "$PWD":/backup alpine tar czf /backup/pidash-data.tgz -C /data .
```

(The volume is named `<folder>_pidash-data`; check with `docker volume ls`.)

## Photo backgrounds and custom widgets

Copy files into the volume, e.g.:

```bash
docker cp ./photos/. pidash:/data/backgrounds/
docker cp ./my-widget pidash:/data/widgets/my-widget && docker compose restart pidash
```

## Google Calendar sign-in from a server

Google only allows `localhost` or an HTTPS domain as an OAuth redirect. Pick one:

- **Easiest:** use an ICS feed URL in the Calendar widget (no OAuth at all).
- **Keep the default redirect:** sign in from any browser. When Google redirects to a `localhost` page that fails to load, copy that full URL from the address bar and paste it into Admin > Google > **Finish connecting**.
- **HTTPS domain:** use the Caddy overlay below and set the redirect URI to `https://<your-domain>/api/google/callback` in both Google Cloud and Admin > Google.

## Optional HTTPS (Caddy)

```bash
# in .env: PIDASH_DOMAIN=dash.example.com
docker compose -f docker-compose.yml -f docker-compose.https.yml up -d --build
```

Caddy obtains and renews a Let's Encrypt certificate automatically. The overlay needs Docker Compose v2.24+ (it uses `!reset`).

## Security

The display page is read-only, but `/admin/` can change settings and read calendar data, so always set an admin password. Over plain HTTP that password is sent unencrypted, so keep the server on your LAN/VPN (e.g. Tailscale) or use the HTTPS overlay if it's reachable from the internet.

## Pi as the screen

Install PiDash on the Pi normally (`sudo ./scripts/install.sh`), then set `KIOSK_URL=http://<server-ip>:8080/` in `/etc/pidash/pidash.env` and reboot. The Pi's kiosk then shows the server's dashboard; the Pi's own local copy just goes unused.
