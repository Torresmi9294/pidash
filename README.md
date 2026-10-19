# PiDash

A self-hosted smart-display dashboard in the style of DAKboard / MagicMirror for Raspberry Pi. A clock and weather stay on screen while **rotating widgets** (calendar, reminders, ESPN fantasy, news, anything you add) take turns on the main panel. Everything is configured from a web admin page, including API keys. No config files are needed.

- **Google Calendar** via OAuth, or any **ICS/iCal feed** URL (no API setup)
- **Weather** from Open-Meteo (no key) or OpenWeatherMap (your key)
- **Reminders** managed from the admin page
- **ESPN Fantasy** league standings and matchups with team logos (football, baseball, basketball, hockey)
- **News** from any RSS/Atom feeds
- **Sports Highlights**: ESPN headlines and video clips for NFL, NBA, MLB, NHL, college, WNBA, MLS or Premier League, with optional muted clip playback
- **Verse of the Day**: Bible Gateway's daily verse in NIV/ESV/NKJV/NLT and more, a curated daily list in public-domain translations, or your own list of verses
- **Health**: steps, activity rings, heart rate, sleep and weight pushed from your phone/watch (Apple Health via Shortcuts or Health Auto Export; Android via any automation app)
- **Plugin widgets**: drop a folder in and it appears in the admin. See [docs/WRITING_WIDGETS.md](docs/WRITING_WIDGETS.md)
- **11 themes** (Midnight, Light, Ocean, Forest, Sunset, Nebula, Rose, Slate, AMOLED, Paper, High contrast) with custom accent and background colors, card styles, fonts, text size, and an automatic night theme
- Photo-slideshow background, portrait rotation, night dimming, live reload when you save
- Runs from Pi Zero up to Pi 5, and on any x86 Linux box or Docker host

## Install on a Raspberry Pi

1. **Flash** Raspberry Pi OS with Raspberry Pi Imager. Use *Lite* for a dedicated display. In the Imager's settings, set the hostname, Wi-Fi, your time zone and enable SSH.
2. **SSH in** (`ssh pi@raspberrypi.local`) and run:

   ```bash
   sudo apt-get install -y git
   git clone https://github.com/Torresmi9294/pidash.git
   cd pidash
   sudo ./scripts/install.sh
   sudo reboot
   ```

3. After the reboot the Pi boots straight into the full-screen dashboard. From any phone or PC open **`http://raspberrypi.local:8080/admin/`** to add widgets and API keys.

The installer detects the CPU, installs Node.js (checksum-verified) if the system has none, creates a locked-down `pidash` service user, sets up systemd services and Chromium kiosk mode, and prints the URLs when finished. Re-run it after a `git pull` to upgrade. Your settings are kept.

### Hardware support

| Hardware | CPU / OS | Server | On-screen kiosk |
|---|---|---|---|
| Pi 5, Pi 4, Pi 400, CM4 | 64-bit (or 32-bit) | ✅ | ✅ |
| Pi 3, Pi 3+, Pi Zero 2 W | 64-bit or 32-bit | ✅ | ✅ (Zero 2 W: low-memory flags applied automatically) |
| Pi 2 | ARMv7 | ✅ | ✅ |
| Pi Zero / Zero W / Pi 1 | ARMv6 | ✅ | ⚠️ Chromium is very slow or unavailable on ARMv6. Use `--kiosk none` and open the display URL from another device. |
| x86_64 PC / NUC / VM | Debian, Ubuntu | ✅ | ✅ |

The installer and kiosk setup were written against Raspberry Pi OS (Bookworm/Bullseye) and Debian/Ubuntu. They have **not yet been tested on physical Pi hardware** (the server, widgets, admin and tests were run on a desktop). If something misbehaves, see [Troubleshooting](#troubleshooting) and please open an issue.

### Installer options

```
sudo ./scripts/install.sh [--port 8080] [--kiosk auto|cage|x11|desktop|none] [--replace-desktop]
```

| `--kiosk` | What it does |
|---|---|
| `auto` (default) | `desktop` if a desktop login manager is enabled, otherwise `cage` |
| `cage` | Chromium inside [cage](https://github.com/cage-kiosk/cage), a minimal Wayland compositor. Best for Pi OS Lite. |
| `x11` | Chromium in X11 + openbox. Fallback if cage does not work on your display. |
| `desktop` | Adds an autostart entry so an existing Pi OS Desktop session opens the dashboard full-screen. |
| `none` | Server only. Point any browser, TV, tablet or old phone at the URL. |

Uninstall with `sudo ./scripts/uninstall.sh` (add `--purge` to also delete settings).

### Docker (any machine, server only)

```bash
cp .env.example .env         # set TZ so "today" is correct
docker compose up -d --build
```

Open `http://<host>:8080/` for the display and `/admin/` for settings, from any browser. Data lives in a Docker volume. See [docs/DOCKER.md](docs/DOCKER.md) for upgrades, backups, Google sign-in on a server, and optional automatic HTTPS (Caddy overlay).

### Run from source

```bash
npm ci && npm start          # http://localhost:8080  (needs Node 18+)
```

## Setting up widgets

Open **/admin/**, choose a widget, set its options, press **Save & apply**. The display reloads by itself. Each widget can be **Always visible** (side panel) or **Rotating** (main panel), with its own on-screen time, and you can reorder or add several of the same type, e.g. two ESPN leagues.

### Calendar

**Easiest: ICS URL (no API).** In Google Calendar: Settings → your calendar → *Secret address in iCal format*, then paste it into the Calendar widget's *ICS feed URLs*. iCloud, Outlook and Fastmail work the same way. Recurring events are expanded.

**Google Calendar API (OAuth).** Admin → Google tab has step-by-step instructions:
1. Create a Google Cloud project and enable the *Google Calendar API*.
2. Create an OAuth client of type **Web application** with redirect URI `http://localhost:8080/api/google/callback`.
3. **Publish the OAuth consent screen ("In production").** Apps left in "Testing" have their login revoked every 7 days. For your own account you'll see an "unverified app" notice. That's expected.
4. Paste the Client ID/Secret into the admin, press **Connect Google**. If you signed in from a PC or phone rather than the Pi itself, the final redirect to `localhost` won't load. Copy the full URL from the address bar and paste it into **Finish connecting**.

The calendar widget has an agenda list and a month grid view.

### Weather

Works out of the box with **Open-Meteo** (no key). Enter a city. To use **OpenWeatherMap**, switch the provider and paste your API key. Units (°F/°C) come from Admin → Display.

### ESPN Fantasy

Enter your league ID (the `leagueId=` number in your league URL) and sport. For **private leagues** you also need two cookies from a browser signed in to fantasy.espn.com: open DevTools → Application/Storage → Cookies → `espn.com`, and copy `SWID` and `espn_s2`. Both are stored on the Pi only and hidden in the admin once saved. This uses ESPN's unofficial API, which can change without notice.

### Reminders and news

Reminders are added on the admin Reminders tab (instant). The News widget takes any list of RSS/Atom URLs.

### Health

Apple Health and Android Health Connect keep data on the phone and offer no cloud API, so your phone **pushes** a daily summary to PiDash. Open **Admin → Health** for your endpoint, a private token, ready-to-copy `curl` example, and iPhone Shortcut / Health Auto Export / Android instructions, then add the **Health** widget. Use the *Send sample data* button to preview the widget before your phone is connected. The supported fields are `steps, activeCalories, exerciseMinutes, standHours, heartRate, restingHeartRate, sleepHours, bloodOxygen, distanceKm/Mi, weightKg/Lb`. Send a `person` name to track several people (one widget each).

### Highlights

Every highlight is an option in the admin, so you decide what stands out:

- **Highlight what matters** (on by default, per widget). ESPN: leader in green, trailing team dimmed, close games flagged, medals and win/loss streaks in the standings. Calendar: live **NOW** / **NEXT** markers and dimmed past events. Reminders: overdue in red, due-today in amber. Weather: rain, storm, freezing, heat and wind alert chips. Health: goal-reached glow, step streaks and best day.
- **Matchup callouts** (ESPN): top score, biggest blowout, closest game and your team's rank/streak.
- **Pinned items**: star reminders (Admin → Reminders), list keywords to highlight in the Calendar (e.g. `birthday, flight`), and pin extra ESPN team IDs such as a rival.
- **Sports video highlights**: add the *Sports Highlights* widget. Tick *Play the video clips* to play them muted on the display (best on a Pi 4/5 or PC; otherwise it shows thumbnails and headlines). It uses ESPN's public, unofficial feeds for personal use.

### Photo background

Set Display → Background to *Photo slideshow* and copy JPG/PNG/WebP files into `/var/lib/pidash/data/backgrounds/` (Docker: see [docs/DOCKER.md](docs/DOCKER.md)).

## Security

- The display is read-only and shows no secrets. API keys and OAuth tokens are stored in `config.json` (mode 600, owned by the `pidash` user) and never sent back to the browser.
- **Set an admin password** in Admin → Security (HTTP Basic auth, any username). Without one, anyone on your LAN can open the admin page. The password is sent in the clear over HTTP, so keep PiDash on a trusted network and don't expose it to the internet. If you must, put it behind a reverse proxy with HTTPS or a VPN such as Tailscale.

## Troubleshooting

| Symptom | Try |
|---|---|
| Black screen after reboot (cage) | `journalctl -u pidash-kiosk -b`. Then try `sudo ./scripts/install.sh --kiosk x11`. |
| A fantasy team shows initials instead of its logo | PiDash fetches and caches logos itself. Initials mean ESPN has no logo for that team or it could not be downloaded. See the reason with `journalctl -u pidash \| grep logos` (Docker: `docker compose logs pidash \| grep logos`). Cached copies live in `<data dir>/cache/logos` and refresh weekly. |
| Page loads but icons are boxes | `sudo apt install fonts-noto-color-emoji` and reboot. |
| Wrong "today" / event times | Set the time zone: `sudo raspi-config` → Localisation → Timezone. |
| Server problems | `journalctl -u pidash -f` |
| Chromium needs a different scale on a TV | Set `KIOSK_EXTRA_FLAGS=--force-device-scale-factor=1.5` in `/etc/pidash/pidash.env` and reboot. |
| Different port | `sudo ./scripts/install.sh --port 80` |
| Screen turns off | Pi OS Desktop: *Preferences → Screen Blanking → off*. Cage/x11 modes already disable blanking. |

## Development

```bash
npm ci
npm test            # node:test suite (API, secret masking, auth, ICS recurrence...)
npm run dev         # auto-restart server; data in ./data
```

Layout: `server/` (Express API, config, Google OAuth), `widgets/<name>/{server.js,client.js}` (built-in widgets), `public/` (display + admin UI, no build step), `scripts/` (installer, kiosk launcher), `examples/` (a sample plugin widget).

## License

MIT
