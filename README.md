# PiDash

A self-hosted smart-display dashboard in the style of DAKboard / MagicMirror for Raspberry Pi. A clock and weather stay on screen while **rotating widgets** (calendar, reminders, ESPN fantasy, news, anything you add) take turns on the main panel. Everything is configured from a web admin page, including API keys. No config files are needed.

- **Google Calendar** via OAuth, or any **ICS/iCal feed** URL (no API setup)
- **Weather** from Open-Meteo (no key) or OpenWeatherMap (your key)
- **Reminders** managed from the admin page
- **ESPN Fantasy** league standings and matchups with team logos (football, baseball, basketball, hockey)
- **Fantasy Roster** your team's lineup: starters, bench and injured reserve with player photos, injury tags (Q / D / OUT / IR), weekly and projected points. Pick a team, or leave it blank to rotate through every team in the league
- **Fantasy Matchup Rosters** this week's head-to-head with both lineups matched up position by position (QB vs QB, RB vs RB...), live scores, projections and the higher score at each spot highlighted. Shows your matchup, or rotates through every matchup in the league
- **News** from any RSS/Atom feeds, with thumbnails when the feed includes images, a featured top story + list, a rotating one-story-at-a-time slideshow, and short summaries
- **Live Scoreboard**: live scores, upcoming games and finals for NFL, NBA, MLB, NHL, college football and basketball, WNBA, MLS and the big soccer leagues, with team logos, records, rankings, game clock, football down-and-distance/possession and baseball count. Mark your teams to star them and put them first, or show only their games. Uses ESPN's free public scoreboard feed (no account, key or subscription)
- **Sports Highlights**: ESPN headlines and video clips for NFL, NBA, MLB, NHL, college, WNBA, MLS or Premier League, with optional muted clip playback
- **Verse of the Day**: Bible Gateway's daily verse in NIV/ESV/NKJV/NLT and more, a curated daily list in public-domain translations, or your own list of verses
- **Health**: steps, activity rings, heart rate, sleep and weight pushed from your phone/watch (Apple Health via Shortcuts or Health Auto Export; Android via any automation app)
- **Plugin widgets**: drop a folder in and it appears in the admin. See [docs/WRITING_WIDGETS.md](docs/WRITING_WIDGETS.md)
- **22 themes**: 11 classic (Midnight, Light, Ocean, Forest, Sunset, Nebula, Rose, Slate, AMOLED, Paper, High contrast) and 11 seasonal/holiday ones (Autumn, Winter, Spring, Summer, Halloween, Christmas, Valentine's, St. Patrick's, 4th of July, Thanksgiving, New Year), with custom accent and background colors, card styles, fonts, text size, and an automatic night theme
- **Theme modes**: fixed, **random** (a new theme every load/hour/day, from all or just your chosen themes), or **seasonal** (follows the seasons and holidays automatically)
- **Backgrounds**: gradient (linear/radial/solid, any angle) or a photo slideshow with photos **uploaded from the admin page** (dimming, blur, fit, cross-fade)
- **Content fit**: every widget scales to its cell so nothing is cut off, shrinking in small cells and growing to fill big ones. It is a per-widget setting (Fill, Shrink only, or Off)
- **7 layouts** (sidebar left/right, top bar, bottom bar, grid with everything on screen at once, **rotating grid** where you choose what each pane cycles through, focus), plus sidebar width, spacing, corner roundness and rotation transition (fade/slide/zoom)
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

**Updating:** open **Admin > Updates** and press **Check for updates**, then **Update now**. PiDash downloads the newest version from GitHub, restarts, and automatically rolls back if the new version doesn't start. It requires an admin password (updates install code) and is available once you've run the installer from this version or newer (`git pull && sudo ./scripts/install.sh` one last time). Docker installs update with `docker compose pull && docker compose up -d`.

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

Open **/admin/**, choose a widget, set its options, press **Save & apply**. The display reloads by itself. Each widget can be **Always visible** (side panel) or **Rotating** (main panel), with its own on-screen time, and you can reorder or add several of the same type, e.g. two ESPN leagues. Every widget can also be **renamed** (e.g. "Family Calendar", "Brian's League") or have its title bar hidden, and you can show titles in capitals or exactly as typed (Display → Layout).

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

### ESPN Fantasy (league, roster and matchup widgets)

There are three ESPN widgets: **ESPN Fantasy** (standings + scores), **Fantasy Roster** and **Fantasy Matchup Rosters**. Each has its own copy of the league settings below, so you can point them at different leagues. Football is the primary target; baseball, basketball and hockey rosters use ESPN's position codes on a best-effort basis.


Enter your league ID (the `leagueId=` number in your league URL) and sport. For **private leagues** you also need two cookies from a browser signed in to fantasy.espn.com: open DevTools → Application/Storage → Cookies → `espn.com`, and copy `SWID` and `espn_s2`. Both are stored on the Pi only and hidden in the admin once saved. This uses ESPN's unofficial API, which can change without notice.

### Reminders and news

Reminders are added on the admin Reminders tab (instant). The News widget takes any list of RSS/Atom URLs. Thumbnails are picked up from the places feeds put them (`media:thumbnail`, `media:content`, image enclosures, `itunes:image`, or the first image in the article HTML), cached on the server, and simply omitted when a feed has none. Duplicate headlines are shown once.

### Health

Apple Health and Android Health Connect keep data on the phone and offer no cloud API, so your phone **pushes** a daily summary to PiDash. Open **Admin → Health** for your endpoint, a private token, ready-to-copy `curl` example, and iPhone Shortcut / Health Auto Export / Android instructions, then add the **Health** widget. Use the *Send sample data* button to preview the widget before your phone is connected. The supported fields are `steps, activeCalories, exerciseMinutes, standHours, heartRate, restingHeartRate, sleepHours, bloodOxygen, distanceKm/Mi, weightKg/Lb`. Send a `person` name to track several people (one widget each).

### Rotating grid

Pick **Admin → Display → Layout → Rotating grid**, then build your panes: each pane is one cell of the grid. Tick the widgets a pane should cycle through (reorder them with the arrows), choose its size (from half a cell, ½×½, ½×1 or 1×½, up to wide, tall, 2×2 large, and 3×1 / 1×3 for long strips, so a clock or verse doesn't waste a whole cell) and how long each widget stays. A pane with one widget simply stays put. Start from the suggested arrangement (each always-visible widget alone, rotating widgets together in one wide pane) and adjust from there.

### Live Scoreboard

Add the **Live Scoreboard** widget and pick up to three leagues. Choose a **View**: *Cards* (a grid of games), *List* (one dense line per game), *Slideshow* (one big game at a time, with team logos, a large score, the clock and down/count; it shows only live games while any game is live, otherwise everything, and you set the seconds per game) or *Ticker* (a scrolling strip of scores, with slow/medium/fast speed). *Games to show* can be everything in the feed (the NFL feed is the whole week), today's games, live and upcoming only, or live games only (it then tells you when the next game starts). Put your teams in *My teams* (abbreviations like `NE` or names like `Celtics`) to star and sort them first, or tick *Only show games with my teams*. It refreshes every 30 seconds while any game is live and only every few minutes otherwise, so it stays polite to the free feed. The feed is unofficial and can change or lag a little behind TV.

### Highlights

Every highlight is an option in the admin, so you decide what stands out:

- **Highlight what matters** (on by default, per widget). ESPN: leader in green, trailing team dimmed, close games flagged, medals and win/loss streaks in the standings. Calendar: live **NOW** / **NEXT** markers and dimmed past events. Reminders: overdue in red, due-today in amber. Weather: rain, storm, freezing, heat and wind alert chips. Health: goal-reached glow, step streaks and best day.
- **Auto-scroll** (per widget): under *When content still doesn't fit*, choose *Auto-scroll slowly* instead of hiding the extra items. The widget keeps a readable size and the part that is cut off scrolls slowly, pausing at the top and bottom; pick a speed from very slow to very fast. Headings and totals stay put while a list scrolls. It works for rotating, grid and pane widgets (not the always-visible side panel), so give the widget enough *Seconds on screen* to finish a pass.
- **Matchup callouts** (ESPN): top score, biggest blowout, closest game and your team's rank/streak.
- **Pinned items**: star reminders (Admin → Reminders), list keywords to highlight in the Calendar (e.g. `birthday, flight`), and pin extra ESPN team IDs such as a rival.
- **Sports video highlights**: add the *Sports Highlights* widget. Tick *Play the video clips* to play them muted on the display (best on a Pi 4/5 or PC; otherwise it shows thumbnails and headlines). Both Sports Highlights and the News slideshow have **Show the timer** and **Show the dots** checkboxes if you'd rather have a clean slide with no progress bar or dots. It uses ESPN's public, unofficial feeds for personal use.

### Backgrounds and photos

Open **Admin → Themes → Background**. Choose *Gradient* (linear with any angle, radial, or solid; colors come from the theme or your own) or *Photo slideshow*. To add photos, drop them on the upload box or choose files: they are stored on the server (in the data folder, so Docker keeps them) and shown as a gallery you can delete from. Big phone photos are shrunk in your browser to 1920 px first (changeable), which keeps the Pi fast and the upload small. You can also tune the slideshow: seconds per photo, shuffled or by name, fill vs. show-whole-photo, dimming (so text stays readable), blur and cross-fade time. JPG, PNG, WebP, GIF and AVIF work; HEIC (iPhone) photos need to be exported as JPG first.

Behind a reverse proxy, uploads can fail with "too big" if the proxy limits request size. Raise it (Nginx / Nginx Proxy Manager: `client_max_body_size 30m`). With the default 1920 px shrinking most photos are well under 1 MB anyway.

