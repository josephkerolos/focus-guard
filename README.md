# FocusGuard

Chrome Manifest V3 extension that tracks and limits time on distracting sites. Pure HTML/CSS/JS — no dependencies.

## Features

- **Time Tracking** — Tracks daily minutes on configurable sites (YouTube, Discord, Instagram, Reddit, X)
- **Blocking** — Full-page overlay when daily limit hit, cutoff hour reached, or schedule block active
- **Override System** — Type a random 20-char code to get 5 more minutes (max 3/day/site, no pasting)
- **Webhook Integration** — POST events (site visits, limits, overrides, daily summaries) to any URL
- **Schedule Blocking** — JSON-based time ranges for external systems (LifeOS) to push blocked periods
- **Popup Dashboard** — Dark-mode usage bars with color coding and override counts
- **Options Page** — Add/remove sites, set limits/cutoffs, configure webhooks, import/export settings

## Install

1. Open `chrome://extensions/`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** and select this folder
4. Pin the FocusGuard icon in the toolbar

## Default Sites & Limits

| Site | Daily Limit | Cutoff |
|------|------------|--------|
| youtube.com | 120 min | 22:00 |
| discord.com | 60 min | — |
| instagram.com | 30 min | — |
| reddit.com | 30 min | — |
| x.com | 30 min | — |

## Webhook Events

Configure a webhook URL in Settings. Events sent as POST with JSON body:

- `site_visit` — First visit to a tracked site today
- `limit_reached` — Daily time limit hit
- `override_used` — User typed the override challenge
- `daily_summary` — End-of-day summary of all sites
- `extension_toggled` — Extension enabled/disabled
- `schedule_block` — Site blocked by schedule/cutoff/limit

## Schedule Blocks (for LifeOS integration)

Push schedule blocks via `chrome.storage.local`:

```json
[
  { "site": "youtube.com", "start": "09:00", "end": "17:00", "days": [1,2,3,4,5] }
]
```

`days` is optional (0=Sun, 6=Sat). Omit for every day.
