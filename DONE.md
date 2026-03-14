# FocusGuard - Build Complete

## What Was Built
Chrome Manifest V3 extension called **FocusGuard** — pure HTML/CSS/JS, no npm dependencies.

### Features
- **Site Time Tracking**: Tracks cumulative daily minutes on YouTube, Discord, Instagram, Reddit, X (configurable)
- **Blocking**: Full-page overlay with motivational quotes when daily limit hit, cutoff hour reached, or schedule block active
- **Override System**: Type a random 20-char alphanumeric string (no paste allowed) for 5 more minutes, max 3 per site per day
- **Webhook Integration**: POST events (site_visit, limit_reached, override_used, daily_summary, extension_toggled, schedule_block) to configurable URL
- **Schedule Blocking**: JSON-based time ranges so LifeOS can push blocked periods via chrome.storage
- **Popup Dashboard**: Dark-mode horizontal usage bars (green/yellow/red/blocked), override counts, pause button
- **Options Page**: Add/remove sites, per-site limits & cutoffs, webhook URL + test button, schedule JSON, export/import, reset stats

### Files
- `manifest.json` — Manifest V3 config
- `background.js` — Service worker (time tracking via chrome.alarms, webhook sender, block state management)
- `content.js` — Block overlay injection on tracked sites
- `popup.html/js/css` — Dashboard popup
- `options.html/js/css` — Settings page
- `icons/` — 16/48/128 PNG shield icons
- `generate-icons.html` — Helper to regenerate icons in browser

## How to Use
1. Open `chrome://extensions/`
2. Enable **Developer mode** (top right toggle)
3. Click **Load unpacked** → select the `focus-guard` folder
4. Pin the FocusGuard shield icon in toolbar
5. Click shield icon to see dashboard; click Settings gear for configuration
6. Configure webhook URL in Settings if you want event notifications

## GitHub
Repo: `josephkerolos/focus-guard` (private)
Pushed to `main` branch.

## Achievement-Based Unlock System (v1.1)

### What Was Built
Sites can now require **real-world achievements** before they unlock each day. An external system (LifeOS) pushes achievement status via `chrome.storage.local` under the `'achievements'` key.

### How It Works
1. Enable **Achievement Mode** in Settings (off by default — extension works normally until enabled)
2. LifeOS writes achievement data to `chrome.storage.local` with key `'achievements'` containing today's date, completed achievements, and which sites each achievement unlocks with how many minutes
3. Sites start **locked** (🔒) each day — no achievements = fully blocked all day
4. Completing an achievement unlocks its linked sites for the specified minutes (minutes stack across multiple achievements)
5. The popup dashboard shows an **Achievements** section with each achievement's status, progress, and what it unlocks
6. The block page shows a **lock icon** (🔒) and lists which achievements would unlock the site
7. When Achievement Mode is off, everything works exactly as before (time limits only)

### Achievement Storage Format
```json
{
  "date": "2026-03-12",
  "completed": {
    "weigh_in": { "done": true, "unlocks": ["youtube.com"], "minutes": 30, "timestamp": "..." },
    "workout": { "done": false, "unlocks": ["youtube.com", "discord.com"], "minutes": 60 },
    "dev_hours": { "done": false, "target": 4, "current": 1.5, "unlocks": ["discord.com"], "minutes": 120 },
    "steps": { "done": false, "target": 5000, "current": 200, "unlocks": ["instagram.com"], "minutes": 30 }
  }
}
```

### Files Modified
- `background.js` — Achievement helpers, block state logic, effective limit calculation, new message handlers
- `content.js` — Achievement-locked block overlay with lock icon and unlock hints
- `popup.html/js/css` — Achievements section above site usage bars
- `options.html/js/css` — Achievement Mode toggle with help text
- `DONE.md` — Updated build summary

## FocusGuard Server + Bidirectional Communication (v1.2)

### What Was Built
A pure Node.js HTTP server (`focusguard-server/`) that acts as a bidirectional bridge between the Chrome extension and LifeOS/Claw AI. The extension now polls the server for state and sends events to it.

### Server Endpoints
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/health` | GET | Health check (no auth) |
| `/api/state` | GET | Current state for extension (achievements, schedule_blocks, limits, blocked_sites, messages) |
| `/api/events` | POST | Receive events from extension (site_visit, limit_reached, override_used, daily_summary) |
| `/api/events` | GET | Read events (for Claw), supports `?since=<timestamp>&limit=50` |
| `/api/command` | POST | Receive commands from Claw (block, unblock, set_limit, set_achievement, send_message) |
| `/api/summary` | GET | Today's summary (site time, achievements, overrides, adherence score) |
| `/api/auth` | POST | Verify API key |

All `/api` endpoints require `X-API-Key` header.

### Extension Updates
- Polls `GET /api/state` every 60 seconds
- Syncs schedule_blocks, achievements, site limits from server
- Sends all webhook events to server too
- Server messages shown via `chrome.notifications` and in popup
- **Options page**: New "Server Settings" section with URL, API Key, Test Connection button, connection dot
- **Popup**: Green/gray dot next to date showing server connection status, latest server message
- Works fully offline — server is an enhancement, not a requirement

### Server Files
- `focusguard-server/server.js` — Pure Node.js HTTP server (zero npm deps)
- `focusguard-server/package.json` — name: focusguard-server
- `focusguard-server/Dockerfile` — FROM node:20-alpine
- `focusguard-server/railway.json` — Railway deploy config with health check
- `focusguard-server/.env.example` — PORT, FOCUSGUARD_API_KEY

### How to Deploy to Railway
1. Push to GitHub (already done: `josephkerolos/focus-guard`)
2. In Railway, create new project from GitHub repo
3. Set root directory to `focusguard-server`
4. Set env vars:
   - `FOCUSGUARD_API_KEY` = your secret key
   - `PORT` = set automatically by Railway
5. Deploy — health check at `/health`

### Railway Environment Variables
```
FOCUSGUARD_API_KEY=<your-secret-key>
```

### How to Connect Extension to Server
1. Open FocusGuard Settings (options page)
2. In "Server Settings" section:
   - Server URL: `https://focusguard-xxx.up.railway.app`
   - API Key: same as `FOCUSGUARD_API_KEY`
3. Click "Test Connection" — should show green dot

### Example Claw Commands
```bash
# Block YouTube for deep work
curl -X POST https://YOUR-SERVER/api/command \
  -H 'X-API-Key: YOUR_KEY' -H 'Content-Type: application/json' \
  -d '{"action":"block","site":"youtube.com","reason":"Deep Work","until":"18:00"}'

# Set achievement
curl -X POST https://YOUR-SERVER/api/command \
  -H 'X-API-Key: YOUR_KEY' -H 'Content-Type: application/json' \
  -d '{"action":"set_achievement","key":"workout","done":true,"unlocks":["youtube.com","discord.com"],"minutes":60}'

# Send motivational message
curl -X POST https://YOUR-SERVER/api/command \
  -H 'X-API-Key: YOUR_KEY' -H 'Content-Type: application/json' \
  -d '{"action":"send_message","text":"Nice — 4h dev done. Discord unlocked."}'
```

## No Setup Steps Required
Zero dependencies for extension. Just load unpacked in Chrome. Server is optional.
