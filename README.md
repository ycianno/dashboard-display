# 🖥️ Dashboard Display

An always-on wall dashboard for repurposed hardware — built for a Surface Pro running
Edge in kiosk mode. Four swipeable pages: an at-a-glance **Overview**, **Today**
from a self-hosted habit tracker, a full **Spotify** player, and live
**Infrastructure** monitoring for a homelab.

**No frameworks. No build step. Vanilla ES modules, CSS and a small Node server.**

## Pages

Swipe left/right, tap the pager in the dock, or press `←` / `→` — or a number
key for the page in that position.

| Page | What's on it |
|---|---|
| **Overview** | Hero clock, daylight progress, 12-hour + 4-day forecast — and a jump tile per page below it, each summarising that page and opening it on a tap |
| **Today** | Level, rank, attributes, streak, the week's boss and today's quests from [The Forge](https://github.com/ycianno/the-forge) — tap a quest to complete it |
| **Music** | Album art, synced lyrics, queue, device switching, seek, volume — plus an immersive full-screen mode |
| **Servers** | Proxmox nodes and guests, Netdata agents, storage pools, HTTP service checks, alerts |

Whichever page you're on, a mini player in the dock keeps play/pause and skip
one tap away. After 3 minutes without a touch the display drifts back to the
default page.

## Features

### Music
- **Now playing** — album art, track, artist, album, progress
- **Full transport** — play/pause, skip, previous (restarts the track if you're >4s in), shuffle, repeat
- **Seek** — drag anywhere on the progress bar
- **Volume + device switching** — move playback to any Spotify Connect device from the display
- **Synced lyrics** — LRC-timestamped lyrics from [LRCLIB](https://lrclib.net) that scroll and highlight in time, with a single-line cue under the track title
- **Immersive mode** — tap the artwork to drop the chrome and go full-screen
- **Dynamic colour** — the accent palette is extracted from the album art by hue histogram, so covers actually tint the UI instead of averaging to grey

### Infrastructure
- **Proxmox VE** — per-node CPU/memory/disk with sparklines, load average, kernel and CPU model; VM and LXC list with live usage; storage pool capacity
- **Netdata** — CPU, RAM, disk, load and uptime from any number of agents
- **HTTP checks** — up/down and latency for anything else (Home Assistant, Plex, a router…)
- **Alerts** — threshold breaches roll up into the top bar and the Overview page

### Overview
- **A glance and an index** — the clock and forecast are read from across the room; underneath, one tile per page carrying enough of it to answer the question you would have swiped over to ask
- **Quests left, what's playing, what's on fire** — the Today, Music and Servers tiles each show their page's headline number, and a tap goes there
- **Only what's configured** — a tile appears for a page only if `dashboard.views` turned it on

### Today (The Forge)
- **Dressed like the game** — The Forge is amber and ember on warm black, so this page is too. The palette is scoped to the view; every other page still takes its accent from the album art
- **The whole sheet** — level orb, rank, tier and ladder pips, the next rung, day and week streaks, lifetime XP
- **The shape** — the app's own attribute radar, one wedge per attribute in its own colour, ported from The Forge so the panel draws the same figure
- **The cabinet** — trophies by grade (an empty grade is drawn, not hidden), insignia count, and your most recent records
- **The week's boss** — remaining HP, the attribute it's weak to, what finishing that category is still worth, and its taunt
- **The day, not a list** — quests run in as many columns as fit, so a nine-quest day is visible from the doorway without scrolling. Each carries its hour, attribute tag and XP; anything past its hour is flagged, and the next one still ahead of you is ringed
- **Tap to complete** — one tap ticks a quest and writes it back to The Forge; XP, streak, week score and boss HP all settle in the same tap
- **No second copy of the rules** — the numbers are computed by The Forge's own engine and served from its `/api/dashboard`, so the panel can never disagree with the app


### Display
- **Touch zone** — this panel's digitizer only answers on part of the glass, so `touchZone` declares which half is live and every control is laid out inside it. `?touchzone=1` draws the boundary on screen to check it on the hardware
- **Weather** — current conditions, hourly and daily forecast from [Open-Meteo](https://open-meteo.com) (free, no API key)
- **Burn-in protection** — the UI walks a small pixel diamond every 90 seconds
- **Night dimming** — screen brightness drops on a schedule that wraps past midnight
- **Touch-first** — large targets, press states, no hover dependencies, pointer hidden in kiosk mode
- **Degrades gracefully** — a dead server, a missing config or no network shows a state, not a blank page

## Architecture

```
dashboard-display/
├── index.html               # Shell + SVG icon sprite
├── css/
│   ├── tokens.css           # Design tokens, fluid type scale
│   ├── base.css             # Reset, ambient background, shared primitives
│   ├── shell.css            # Top bar, view deck, dock
│   ├── now-playing.css
│   ├── infra.css
│   ├── overview.css         # Glance + jump tiles
│   └── forge.css
├── js/
│   ├── main.js              # Boot + wiring
│   ├── config.js            # Defaults, merge, legacy-shape migration
│   ├── store.js             # Observable stores (player / weather / infra)
│   ├── router.js            # Paged views + swipe gestures
│   ├── player.js            # Spotify polling, progress interpolation, actions
│   ├── spotify-api.js       # Web API client with PKCE OAuth
│   ├── lyrics.js            # LRCLIB fetch + LRC parsing
│   ├── palette.js           # Album art → accent palette
│   ├── weather.js           # Open-Meteo
│   ├── infra-client.js      # Polls /api/infra
│   ├── forge-client.js      # Polls /api/forge, writes quest completions
│   ├── touch-zone.js        # Declares the live band + the ?touchzone=1 overlay
│   ├── visualizer.js, clock.js, display.js, mini-player.js, util.js
│   └── views/               # registry.js + one file per page
├── server.js                # Static server + the /api routes
├── server/
│   ├── infra.js             # Aggregation, history, alerts, caching
│   ├── collectors.js        # Proxmox / Netdata / HTTP check collectors
│   ├── forge.js             # The Forge summary + quest writes
│   ├── http-client.js       # Promise HTTP(S) with per-request TLS control
│   └── demo.js              # Synthetic snapshot for ?demo=1
├── config.js                # Browser config (git-ignored)
├── config.example.js
├── server.config.js         # Server config + API tokens (git-ignored)
└── server.config.example.js
```

### Why there's a server component

The browser can't talk to Proxmox directly: it sits behind CORS, uses a
self-signed certificate, and needs an API token that has no business being in
client-side JavaScript. So `server.js` — already there to serve the static
files — also exposes `GET /api/infra`, which polls your gear from Node,
caches the result briefly, keeps a rolling history for the sparklines, and
hands the browser one clean JSON snapshot.

The Forge is there for the same reason. A sync token can read and write
everything in your tracker, and that has no business in a page sitting unlocked
on a wall. It stays in `server.config.js`, and the browser only ever sees the
summary.

Spotify needs no backend: it uses the PKCE flow entirely in the browser.

### Query-string flags

Useful when you're debugging the display over SSH:

| Flag | Effect |
|---|---|
| `?demo=1` | Synthetic Spotify + infrastructure data |
| `?kiosk=0` | Bring back the mouse pointer |
| `?view=infra` | Open straight onto a page |
| `?touchzone=1` | Draw the touch-zone boundary over the UI |
| `?touch=full` | Override the configured touch zone for one load |

## Setup

### Prerequisites

- [Node.js](https://nodejs.org/) 18+
- A [Spotify Premium](https://spotify.com/premium) account (playback control requires Premium)

### 1. Configure the browser side

```bash
git clone <your-repo-url>
cd dashboard-display
cp config.example.js config.js
```

Set your Spotify client ID and your location in `config.js`. Everything else
has a sensible default — see the comments in `config.example.js`.

### 2. Create a Spotify app

1. Open the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard/)
2. **Create App**
3. Set the **Redirect URI** to exactly `http://127.0.0.1:8080/` (trailing slash included)
4. Tick **Web API**
5. Copy the **Client ID** into `config.js`

### 3. Configure your servers (optional)

```bash
cp server.config.example.js server.config.js
```

For Proxmox, create a token under **Datacenter → Permissions → API Tokens**.
Either untick *Privilege Separation* or grant the token `PVEAuditor` on `/`.
Then fill in `host`, `tokenId` and `tokenSecret`.

Netdata agents need nothing beyond their URL. HTTP checks take a name and a URL.

Skip this entirely and the Servers page shows setup instructions instead.

### 4. Connect The Forge (optional)

Add a `forge` block to `server.config.js` with your instance URL and a sync
token (The Forge → Settings → Sync, or `POST /api/sync/token`). Without it the
Today page shows setup instructions instead.

This needs a Forge new enough to serve `GET /api/dashboard`. Against an older
build the Today page says exactly that rather than showing a generic error,
and so does the Overview tile.

### 5. Set the touch zone

If your panel's digitizer is only alive on part of the glass, set
`dashboard.touchZone` in `config.js` to `top`, `bottom`, `left` or `right`.
Load the dashboard with `?touchzone=1` to see the boundary drawn over the UI
and confirm every control landed on the right side of it.

### 6. Run

```bash
node server.js
```

Open `http://127.0.0.1:8080/` and click **Connect Spotify**.

## Checking your work

There's no build step, so nothing catches a typo until the kiosk renders a
blank page in another room. Before deploying:

```bash
npm run check
```

It parses every JavaScript file in the project — server files as CommonJS,
browser files as ES modules.

## Spotify API scopes

| Scope | Used for |
|---|---|
| `user-read-currently-playing` | Current track, artwork, progress |
| `user-read-playback-state` | Play state, shuffle, repeat, volume, devices |
| `user-modify-playback-state` | Play, pause, skip, seek, volume, shuffle, repeat, transfer |

PKCE means no client secret. Tokens live in `localStorage` and refresh
automatically; changing the scope list forces a clean re-auth on next load.

## Kiosk mode

### Don't use `--kiosk`

Edge's `--kiosk` mode always runs **InPrivate**, which wipes `localStorage` when
the session ends — and that's where the Spotify refresh token lives. With
`--kiosk` you have to reconnect Spotify after every reboot.

Use `--app` with a dedicated profile instead, then enter fullscreen once the
page has painted. `start-kiosk.vbs` does exactly that, resolving every path at
runtime so it works for any user without editing:

```vbs
home    = sh.ExpandEnvironmentStrings("%USERPROFILE%")
profile = home & "\.dashboard-edge-profile"
opts = " --app=http://127.0.0.1:8080/ --start-fullscreen" _
     & " --user-data-dir=""" & profile & """" _
     & " --no-first-run --no-default-browser-check" _
     & " --disable-session-crashed-bubble --noerrdialogs"
sh.Run """" & edge & """" & opts, 1, False
sh.Run "powershell -NoProfile -ExecutionPolicy Bypass -File """ & home & "\dashboard-display\fullscreen.ps1""", 0, True
```

`fullscreen.ps1` waits for the window, lets the page settle, then sends one
`F11`. The wait matters: toggling fullscreen mid-load leaves Chromium's newly
exposed region unpainted. `--start-fullscreen` alone is not enough — the
Windows taskbar still draws on top of the window. And send `F11` exactly once:
`GetWindowRect` already reports full height before real fullscreen is active,
so it can't be used to decide whether the toggle is needed.

> A screen capture of the display taken with GDI (`CopyFromScreen`) will show
> the lower portion blank while Edge is in true fullscreen. That's a capture
> limitation — Chromium presents fullscreen through DirectComposition — not a
> rendering fault. Add `--disable-direct-composition` temporarily if you need a
> screenshot that reflects what's on screen.

### Auto-start on boot

Two scheduled tasks, both **At logon**, running as your user with
**Run only when user is logged on** (InteractiveToken):

| Task | Action |
|---|---|
| `DashboardServer` | `wscript.exe %USERPROFILE%\dashboard-display\start-hidden.vbs` |
| `LaunchEdge` | `wscript.exe %USERPROFILE%\dashboard-display\start-kiosk.vbs` |

`start-hidden.vbs` launches `node server.js` through `wscript` so no console
window appears on the display.

> `schtasks /change /tr ...` will demand the account password even for an
> InteractiveToken task. Use PowerShell instead — it doesn't:
> ```powershell
> $a = New-ScheduledTaskAction -Execute "wscript.exe" -Argument "$env:USERPROFILE\dashboard-display\start-hidden.vbs"
> Set-ScheduledTask -TaskName "DashboardServer" -Action $a
> ```

> Set `host: '127.0.0.1'` in `server.config.js`. Binding `0.0.0.0` makes
> Windows Firewall pop an "allow this app" dialog **over the dashboard** on
> every start, and the kiosk browser is on the same machine anyway.

### Keep the screen on

```cmd
powercfg /change monitor-timeout-ac 0
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0
powercfg /SETACVALUEINDEX SCHEME_CURRENT SUB_NONE CONSOLELOCK 0
powercfg /SETACTIVE SCHEME_CURRENT
```

### Auto-login (optional)

`Win+R` → `netplwiz` → untick "Users must enter a user name and password" → Apply.

## Remote management

If the display is reachable on your network (e.g. via Tailscale):

```bash
# Deploy updated files
scp -i ~/.ssh/your_key -r index.html css js server server.js user@device-ip:C:/path/to/dashboard-display/

# Restart
ssh user@device-ip "taskkill /F /IM node.exe & taskkill /F /IM msedge.exe"
ssh user@device-ip "powershell Start-Process 'node.exe' -ArgumentList 'server.js' -WorkingDirectory 'C:\path\to\dashboard-display' -WindowStyle Hidden"
ssh user@device-ip "schtasks /run /tn LaunchEdge"
```

Assets are served with `Cache-Control: no-cache`, so a redeploy takes effect on
reload without needing devtools on the kiosk.

## Network exposure

`server.config.js` sets `host`. The default `0.0.0.0` makes the dashboard —
and `/api/infra`, which reports your infrastructure — reachable from your LAN.
Set it to `127.0.0.1` to keep it on the display machine only.

## License

MIT
