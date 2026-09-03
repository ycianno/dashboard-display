#!/usr/bin/env bash
#
# Deploy the dashboard to the wall panel.
#
# The whole point of this script is what it does NOT copy.
#
# Three things live only on the display and can never be recovered from git:
#
#   config.js         the Spotify client id and the page layout for that panel
#   server.config.js  the Proxmox token and The Forge sync token
#   the Edge profile  where the Spotify refresh token lives, in localStorage
#
# Copying the repo over the top of the panel wipes the first two and changes
# the scope/client id under the third, which signs the display out — and
# signing back in means carrying a keyboard to the wall. So this script pushes
# code only, and tells you when the live config has drifted behind the example
# instead of silently overwriting it.
#
# Usage:  scripts/deploy.sh [ssh-host]
#
set -euo pipefail

HOST="${1:-budgetnote-win01}"
REMOTE_DIR='C:/Users/pj640/dashboard-display'

# Code only. Deliberately excludes config.js and server.config.js.
PAYLOAD=(index.html server.js package.json css js server scripts)

# Local state on the panel that a deploy must never touch.
PROTECTED=(config.js server.config.js)

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }

say "Checking $HOST"
ssh -o ConnectTimeout=10 "$HOST" "powershell -NoProfile -Command \"Test-Path '$REMOTE_DIR'\"" \
  | tr -d '\r' | grep -q True || { echo "  $REMOTE_DIR not found on $HOST"; exit 1; }

for f in "${PROTECTED[@]}"; do
  present=$(ssh -o ConnectTimeout=10 "$HOST" \
    "powershell -NoProfile -Command \"Test-Path '$REMOTE_DIR/$f'\"" | tr -d '\r')
  if [ "$present" != "True" ]; then
    echo "  $f is MISSING on the panel — deploying would leave it unconfigured."
    echo "  Copy it there once by hand, then re-run. Refusing to continue."
    exit 1
  fi
  echo "  $f present, will not be touched"
done

say "Local syntax check"
npm run check

say "Stopping the display"
ssh "$HOST" 'powershell -NoProfile -Command "Get-Process node,msedge -ErrorAction SilentlyContinue | Stop-Process -Force"' || true
sleep 2

say "Copying code"
scp -q -r "${PAYLOAD[@]}" "$HOST:$REMOTE_DIR/"
echo "  sent: ${PAYLOAD[*]}"

say "Config drift"
# Options added to the example but not yet present on the panel. Reported,
# never applied — the live file is the operator's, not the repo's.
for pair in "config.example.js:config.js" "server.config.example.js:server.config.js"; do
  example="${pair%%:*}"; live="${pair##*:}"
  # `|| true`: a no-match grep exits non-zero, and under `set -e` that would
  # abort the deploy here — after the code is copied and before anything is
  # restarted, which is the worst possible place to stop.
  keys=$(grep -oE '^\s{2,4}[a-zA-Z]+:' "$example" | tr -d ' :' | sort -u || true)
  if [ -z "$keys" ]; then
    echo "  $example has no readable options to compare — skipping"
    continue
  fi
  missing=""
  for k in $keys; do
    if ! ssh "$HOST" "powershell -NoProfile -Command \"Select-String -Path '$REMOTE_DIR/$live' -Pattern '$k' -Quiet\"" \
         | tr -d '\r' | grep -q True; then
      missing="$missing $k"
    fi
  done
  if [ -n "$missing" ]; then
    echo "  $live is missing:$missing"
  else
    echo "  $live has every option in $example"
  fi
done

say "Restarting"
ssh "$HOST" 'powershell -NoProfile -Command "Start-ScheduledTask -TaskName DashboardServer"'
for i in $(seq 1 20); do
  sleep 2
  if ssh "$HOST" 'powershell -NoProfile -Command "try { (Invoke-WebRequest -Uri http://127.0.0.1:8080/api/health -UseBasicParsing -TimeoutSec 3).Content } catch { \"\" }"' \
     | tr -d '\r' | grep -q '"ok":true'; then
    echo "  server up after $((i * 2))s"
    break
  fi
done
ssh "$HOST" 'powershell -NoProfile -Command "Start-ScheduledTask -TaskName LaunchEdge"'

say "Done"
echo "  The Spotify session and both config files were left alone."
