<div align="center">

# BadgeFarmer

**Earn Discord's activity badges without a year of idling.**

[![Equicord userplugin](https://img.shields.io/badge/Equicord-userplugin-5865F2?logo=discord&logoColor=white)](https://github.com/Equicord/Equicord)
[![Vencord compatible](https://img.shields.io/badge/Vencord-userplugin-ED4245?logo=vencord&logoColor=white)](https://github.com/Vendicated/Vencord)
[![License](https://img.shields.io/badge/license-GPL--3.0-blue)](LICENSE)

[Install](#install) · [Requirements](#requirements) · [Modes](#modes) · [Badge tiers](#badge-tiers) · [Architecture](#architecture) · [Console script](#console-script) · [FAQ](#faq)

</div>

---

Discord tracks three evolving activity badges: **Game Time**, **Game Variety**, and **Streaming**. Top tiers require 5,000 hours played, 100 unique games, and 5,000 hours streamed.

BadgeFarmer unlocks Game Time and Variety in under 15 seconds using batched `/science` telemetry, and runs a low-power, unpaused Go Live setup with an alt viewer helper so Streaming hours count. You can build it without changes on **Equicord** or **Vencord**, and run it on Windows, macOS, Linux, Vesktop, and Equibop.

## Install

Clone the repository into your Equicord or Vencord `src/userplugins` directory and rebuild:

```bash
cd src/userplugins
git clone https://github.com/aboveproof/BadgeFarmer.git
cd ../..
pnpm build
```

Inject if needed (`pnpm inject` on Vencord or Equicord), restart Discord, and turn on **BadgeFarmer** under **User Settings › Plugins**.

### Opening the dashboard

- **Equicord**: click the badge icon in Discord's top-right header bar, open the Equicord Toolbox menu, or visit **Settings › Plugins › BadgeFarmer**.
- **Vencord**: open **Settings › Vencord › Plugins › BadgeFarmer** (or pick **Open Badge Farmer** inside `VencordToolbox`).

## Requirements

Check these settings before starting a run:

1. **Data personalization**: turn on **Use data to personalize my Discord experience** under **User Settings › Data & Privacy**. Discord drops badge telemetry when this toggle is off. BadgeFarmer checks `ConsentStore` and shows a red banner if personalization is disabled.
2. **NoTrack (for Streaming)**: Discord's Streaming badge reads client telemetry events (`media_session_joined`, `video_stream_started`, and `video_stream_ended` with `context: "stream"`). If `NoTrack` has **Allow badge tracking** off (or you have not reloaded Discord since turning it on), zero stream hours reach your badge. BadgeFarmer detects both states in the Streaming tab and gives you one-click **Enable in NoTrack** and **Reload** buttons. Game Time and Variety post to `/science` with custom desktop headers and work while `NoTrack` is on.
3. **Voice channel + viewer (for Streaming)**: join a regular voice channel on Discord desktop (Stage channels do not support Go Live) where you hold Stream permission, and keep at least one other account watching your stream.

## Modes

| Mode | Action | Time to top tier |
| --- | --- | --- |
| **Game Time** | Spreads hours across unique verified Windows games (`250 games × 20h = 5,000h`), or logs up to 24h/day on one chosen title. | About 9 seconds |
| **Variety** | Sends one session each across fresh verified Windows games from Discord's catalog. Universalist needs 100 games. | About 4 seconds |
| **Streaming** | Runs a low-power Go Live broadcast with SFU unpause keepalive and alt auto-watch support. Phenomenon needs 5,000 hours. | Real time |
| **All three** | Unlocks Eternal (5,000h) and Universalist (250 games) in one pass, then starts Streaming if you sit in a voice channel. | About 9 seconds for the first two |

### Game Time and the 24-hour per-game cap

Discord's scheduled badge job caps playtime per single `(user, game, day)` at around 24 hours, then sums total hours across unique detectable games. Sending 200 overlapping sessions on one game in a single day adds at most 24 hours.

BadgeFarmer gives you two options in the Game Time tab:

- **Spread across catalog (Recommended, default)**: distributes your target across fresh, verified `win32` games at 20 hours per game (`250 unique games × 20h = 5,000 hours`), unlocking **Eternal** and **Universalist** in one sync.
- **Single game (24h/day cap)**: logs sessions on one favorite game if you want to build hours on a single title day by day.

### Variety

BadgeFarmer filters Discord's catalog down to verified numeric application IDs with valid `win32` executables (skipping console SKUs and empty entries), preserves relative executable paths from Discord's database (such as `bin/win64/cs2.exe`), and records claimed IDs in `DataStore` after each accepted batch so repeat runs pick unused games first.

### Streaming

Discord validates Streaming hours against active WebRTC media sessions on its Selective Forwarding Unit (SFU) servers alongside client `/science` events. Discord's backend discards `/science` packets that lack a matching server media session and an active viewer, so nothing skips real time for Streaming.

BadgeFarmer prevents the failure modes that stall live Go Live sessions:

- **Active SFU unpause keepalive**: dispatches `STREAM_SET_PAUSED` (`paused: false`) on each tick so minimizing Discord, sharing a background window, or locking your screen does not pause RTP transmission (`op: 22`).
- **Low-power 480p / 15 FPS mode** (on by default): switches `ApplicationStreamingSettingsStore` to `480p @ 15 FPS` with audio off and local preview disabled (~90% less GPU and upload load), then restores your prior stream quality on Stop or client close.
- **Optional 2-hour checkpoints**: Discord can cap single continuous streams past ~10 hours and commits `video_stream_ended` when a stream ends. Turning on **2-hour checkpoints** restarts Go Live every 2 hours to bank hours along the way when paired with alt auto-watch.
- **Alt viewer auto-watch**: click **Watch this call** on a second Equicord or Vencord client, or click **Copy alt script** and paste it into an unmodded browser tab's DevTools console. Your alt joins new or restarted streams via `STREAM_WATCH` within seconds and stays unpaused in background tabs.
- **Themed capture source picker**: select a single blank window instead of your main monitor so you do not broadcast your desktop.

> [!WARNING]
> Leaving **Capture source** on `Main screen` shares your full monitor with participants in the voice channel. Pick a single window or close private tabs before clicking **Go live**.

## Badge tiers

Each badge progresses through 10 tiers. Clicking any segment on the tier bar in the dashboard sets your target input to that tier, and the **Equipped badges** bar at the top checks your live profile badges.

| Tier | Game Time (hours) | Game Variety (games) | Streaming (hours) |
| --- | --- | --- | --- |
| 1 | Casual (1) | Sampler (2) | Newcomer (1) |
| 2 | Recreational (5) | Dabbler (5) | Fledgling (5) |
| 3 | Dedicated (20) | Enthusiast (10) | Breakout (20) |
| 4 | Committed (75) | Ranger (15) | Standout (75) |
| 5 | Serious (150) | Explorer (20) | Trendsetter (150) |
| 6 | Devoted (300) | Adventurer (30) | Headliner (300) |
| 7 | Seasoned (500) | Voyager (40) | Star (500) |
| 8 | Ironclad (1,000) | Maverick (60) | Sensation (1,000) |
| 9 | Unshakable (2,000) | Polymath (80) | Visionary (2,000) |
| 10 | Eternal (5,000) | Universalist (100) | Phenomenon (5,000) |

## Architecture

1. **Desktop `X-Super-Properties` sync**: constructs a Base64 Windows `Discord Client` `X-Super-Properties` header (`os: "Windows"`, `browser: "Discord Client"`, `has_client_mods: false`) paired with the same `launch_signature` and `client_heartbeat_session_id` inside each event, and sends `/science` requests via `fetch` on the active client origin (`discord.com`, `ptb.discord.com`, or `canary.discord.com`) so Discord's internal request wrapper cannot overwrite the OS header on Linux, macOS, Vesktop, Equibop, or web.
2. **Catalog and executable accuracy**: reads `GameStore.games` in memory first, then falls back to `/applications/detectable` and `cdn.discordapp.com/detectables/games.json`. Keeps numeric IDs with valid `win32` executables and preserves relative executable paths so titles match Discord's detector database.
3. **Session payloads**: sends `launch_game` (attaching any real `executableFingerprint` captured by `RunningGameStore`), `running_game_heartbeat` (`0ms`, `initial_heartbeat: true`), and `running_game_heartbeat` (`duration_tracked_ms`, `final_heartbeat: true`) in batches of 20 sessions per `POST /science` with HTTP 429 `retry-after` backoff and 401/403 token refresh.

### Project layout

| File | Responsibility |
| --- | --- |
| [index.tsx](index.tsx) | Cross-client plugin entry (Equicord HeaderBar + Vencord Toolbox), startup and `beforeunload` hooks |
| [farmer.ts](farmer.ts) | Spread & single Game Time, Variety rotation (`DataStore`), Go Live controller, alt viewer helper |
| [science.ts](science.ts) | Desktop `X-Super-Properties` builder, analytics token cache, `/science` batch poster |
| [ui.tsx](ui.tsx) | Dashboard modal and settings UI, live badge checker, strategy pills, custom source dropdown |
| [styles.css](styles.css) | Theme-aware styles using Discord's CSS variables for dark and light themes |
| [console.js](console.js) | Standalone DevTools script with Desktop `X-Super-Properties`, spread Game Time, and `.watch()` |

## Console script

If you do not run Equicord or Vencord, paste [console.js](console.js) into Discord's DevTools console (`Ctrl+Shift+I` › Console):

```js
BadgeFarmer.gameTime(5000, 20);         // Spread 5,000h across 250 Windows games (~9s)
BadgeFarmer.gameTime("Dota 2", 24);     // Single game (24h/day per-game cap)
BadgeFarmer.variety(5, 100);            // 100 fresh Windows games, 5 min each (~4s)
BadgeFarmer.stream(1);                  // Low-power Go Live farm on desktop
BadgeFarmer.watch();                    // Run on your alt to auto-watch and stay unpaused 24/7
BadgeFarmer.maxAll();                   // Eternal (5,000h) + Universalist (250 games)
BadgeFarmer.badges();                   // Check equipped profile badges
BadgeFarmer.stop();                     // Stop active run and restore stream settings
```

## FAQ

**Badge update schedule**
Discord runs badge aggregation every 24 to 48 hours. Click **Check** on the **Equipped badges** bar in the dashboard to inspect your profile badges.

**Game Time stuck at a few hours**
Older builds sent 5,000 hours on a single game ID in one day, hitting Discord's ~24-hour daily per-game cap, or let Discord's client wrapper send non-Windows `X-Super-Properties` on Linux, Vesktop, or web. Keep **Spread across catalog** selected so each unique Windows game claims 20 hours (`250 × 20h = 5,000h`).

**Detection and Terms of Service**
Client mods violate Discord's Terms of Service, and sending synthetic telemetry carries more risk than visual tweaks. Test on a secondary account if you want zero risk to your main profile.

## Credits

Built on research from the Discord modding community for Equicord and Vencord.

## License

GPL-3.0. See [LICENSE](LICENSE).
