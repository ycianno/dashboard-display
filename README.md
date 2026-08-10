# 🖥️ Dashboard Display

A minimal, beautiful always-on dashboard built for repurposing old tablets and laptops (like a Surface Pro) as a dedicated Spotify + clock + weather display.

**No frameworks. No build step. Just HTML, CSS, and vanilla JS.**

![Dashboard Preview](docs/preview.png)

## Features

- 🎵 **Spotify Now Playing** — Live album art, track name, artist, and progress bar
- 🎛️ **Playback Controls** — Play, pause, skip, previous, shuffle, and repeat (touch-friendly)
- 📋 **Up Next Queue** — Shows the next 3 tracks in your Spotify queue
- 🕐 **Clock** — 12-hour digital clock with seconds and AM/PM
- 🌤️ **Weather** — Current temperature and conditions (via OpenWeatherMap)
- 🌑 **Always-On Optimized** — Dark theme, no harsh whites, subtle animations to minimize burn-in
- 📱 **Touch-Friendly** — Large buttons designed for touchscreens (works great with partially broken digitizers)
- 🔒 **No Backend Required** — Uses Spotify PKCE auth flow, everything runs client-side

## Architecture

```
dashboard-display/
├── index.html          # Layout and structure
├── styles.css          # Glassmorphism dark theme, responsive grid
├── app.js              # Clock, weather, Spotify polling, queue, controls
├── spotify.js          # Spotify Web API client with PKCE OAuth
├── server.js           # Minimal Node.js static file server (32 lines)
├── config.js           # Your API keys and settings (git-ignored)
├── config.example.js   # Template for config.js
└── .gitignore
```

### How It Works

1. `server.js` serves the static files on port 8080
2. `spotify.js` handles OAuth PKCE authentication with Spotify (no backend/secret needed)
3. `app.js` polls the Spotify Web API every 5 seconds for the currently playing track
4. The browser runs in Edge Kiosk Mode (fullscreen, no URL bar, no tabs)
5. On Windows startup, a batch script starts the server and opens Edge automatically

## Setup

### Prerequisites

- [Node.js](https://nodejs.org/) (for the static file server)
- A [Spotify Premium](https://spotify.com/premium) account
- *(Optional)* An [OpenWeatherMap](https://openweathermap.org/) free API key

### 1. Clone & Configure

```bash
git clone <your-repo-url>
cd dashboard-display
cp config.example.js config.js
```

Edit `config.js` with your credentials:

```js
const CONFIG = {
  spotify: {
    clientId: 'your-spotify-client-id',     // From Spotify Developer Dashboard
    redirectUri: 'http://127.0.0.1:8080/',  // Must match Spotify app settings
    scopes: 'user-read-currently-playing user-read-playback-state user-modify-playback-state'
  },
  weather: {
    apiKey: 'your-openweathermap-key',      // Optional, leave blank to hide weather
    city: 'San Juan',
    units: 'imperial'                       // 'imperial' for °F, 'metric' for °C
  },
  dashboard: {
    refreshInterval: 30000,
    spotifyPollInterval: 5000
  }
};
```

### 2. Create a Spotify App

1. Go to the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard/)
2. Click **Create App**
3. Set **Redirect URI** to exactly: `http://127.0.0.1:8080/` (including trailing slash)
4. Check **Web API** under APIs used
5. Copy the **Client ID** into your `config.js`

### 3. Run

```bash
node server.js
```

Open `http://127.0.0.1:8080/` in your browser and click **Connect Spotify**.

## Kiosk Mode (Dedicated Display)

To run this as a full-screen always-on display on Windows:

### Edge Kiosk Mode

```cmd
msedge.exe --kiosk http://127.0.0.1:8080/ --edge-kiosk-type=fullscreen --no-first-run --no-default-browser-check --disable-session-crashed-bubble
```

### Auto-Start on Boot

Create `launch-dashboard.bat` in the Windows Startup folder (`Win+R` → `shell:startup`):

```bat
@echo off
cd /d C:\Path\To\dashboard-display
start "DashboardServer" /min "C:\Program Files\nodejs\node.exe" server.js
timeout /t 5 /nobreak > nul
start msedge.exe --kiosk http://127.0.0.1:8080/ --edge-kiosk-type=fullscreen --no-first-run --no-default-browser-check --disable-session-crashed-bubble
```

### Prevent Sleep & Lock Screen

Run these commands once (as admin) to keep the display always on:

```cmd
powercfg /change monitor-timeout-ac 0
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0
powercfg /SETACVALUEINDEX SCHEME_CURRENT SUB_NONE CONSOLELOCK 0
powercfg /SETACTIVE SCHEME_CURRENT
```

### Auto-Login (Optional)

`Win+R` → `netplwiz` → Uncheck "Users must enter a user name and password" → Apply.

## Spotify API Scopes

| Scope | Used For |
|---|---|
| `user-read-currently-playing` | Show current track, album art, progress |
| `user-read-playback-state` | Detect play/pause state, shuffle, repeat |
| `user-modify-playback-state` | Play, pause, skip, previous, shuffle, repeat controls |

The app uses the **PKCE authorization flow**, which means no client secret is needed and everything runs client-side in the browser. Tokens are stored in `localStorage` and automatically refresh when expired.

## Remote Management via SSH

If the display device is on your network (e.g., via Tailscale), you can manage it remotely:

```bash
# Deploy updated files
scp -i ~/.ssh/your_key index.html styles.css app.js user@device-ip:C:/path/to/dashboard-display/

# Restart the server
ssh user@device-ip "taskkill /F /IM node.exe & taskkill /F /IM msedge.exe"
ssh user@device-ip "powershell Start-Process 'node.exe' -ArgumentList 'server.js' -WorkingDirectory 'C:\path\to\dashboard-display' -WindowStyle Hidden"
ssh user@device-ip "schtasks /run /tn LaunchEdge"
```

## License

MIT
