<div align="center">

# BadgeFarmer

**Earn Discord's activity badges without a year of idling.**

[![Equicord userplugin](https://img.shields.io/badge/Equicord-userplugin-5865F2?logo=discord&logoColor=white)](https://github.com/Equicord/Equicord)
[![Vencord compatible](https://img.shields.io/badge/Vencord-userplugin-ED4245?logo=vencord&logoColor=white)](https://github.com/Vendicated/Vencord)
[![License](https://img.shields.io/badge/license-GPL--3.0-blue)](LICENSE)

[Install](#install) · [Progress detection](#progress-detection) · [Requirements](#requirements) · [Modes](#modes) · [Badge tiers](#badge-tiers) · [Architecture](#architecture) · [Console script](#console-script) · [FAQ](#faq)

</div>

---

Discord tracks three evolving activity badges: **Game Time**, **Game Variety**, and **Streaming**. Top tiers require 5,000 hours played, 100 unique games, and 5,000 hours streamed.

BadgeFarmer reads your unlocked profile badge tiers and local game history first, subtracts the hours and games you already hold so nothing gets double-farmed, unlocks remaining Game Time and Variety milestones in seconds via `/science`, and runs a resumable low-power Go Live broadcast with an alt viewer helper for Streaming. You can build it without changes on **Equicord** or **Vencord**, and run it on Windows, macOS, Linux, Vesktop, and Equibop.

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

## Progress detection

Opening the dashboard syncs three sources so runs start from your real progress instead of zero:

1. **Discord profile badges**: matches all 30 official evolving tier icons, badge IDs, and tooltip descriptions from `GET /users/{id}/profile` (for example `Seasoned` = `500h`, `Voyager` = `40 games`, `Breakout` = `20h`).
2. **Local client history**: reads `RunningGameStore.getGamesSeen(true)` to count verified Windows games Discord already saw you play on this PC and excludes them from random Variety and Spread runs.
3. **Per-account `DataStore` ledger**: saves sent Game Time hours, claimed game IDs, per-day single-game hours, and live viewer-verified Streaming time every 24 seconds so multi-day runs resume right where you stopped.

Click **Set baseline** on the progress card if you know exact hours above your current badge floor (for example `640` hours played on another PC), or switch **Goal mode** between **Reach target** (subtracts existing progress) and **Add full amount on top**.

## Requirements

Check these settings before starting a run:

1. **Data personalization**: turn on **Use data to personalize my Discord experience** under **User Settings › Data & Privacy**. Discord drops badge telemetry when this toggle is off. BadgeFarmer checks `ConsentStore` and shows a red banner if personalization is disabled.
2. **NoTrack (for Streaming)**: Discord's Streaming badge reads client telemetry events (`media_session_joined`, `video_stream_started`, and `video_stream_ended` with `context: "stream"`). If `NoTrack` has **Allow badge tracking** off (or you have not reloaded Discord since turning it on), zero stream hours reach your badge. BadgeFarmer detects both states in the Streaming tab and gives you one-click **Enable in NoTrack** and **Reload** buttons. Game Time and Variety post to `/science` with custom desktop headers and work while `NoTrack` is on.
3. **Voice channel + viewer (for Streaming)**: join a regular voice channel on Discord desktop (Stage channels do not support Go Live) where you hold Stream permission, and keep at least one other account watching your stream.

## Modes

| Mode | Action | Time to top tier |
| --- | --- | --- |
| **Game Time** | Subtracts existing hours and spreads the remainder across unused Windows games (`20h` each), or logs up to 24h/day on one title. | About 9 seconds |
| **Variety** | Claims missing unique Windows games from Discord's catalog while skipping PC-detected and prior games. Universalist needs 100. | About 4 seconds |
| **Streaming** | Resumes from your saved hours with SFU unpause keepalive, 30s voice reconnect recovery, and alt auto-watch. Phenomenon needs 5,000h. | Real time |
| **All three** | Computes missing hours and games, finishes Eternal and Universalist first (skipping completed tracks), then transitions into Streaming. | About 9 seconds for the first two |

### Game Time and the 24-hour per-game cap

Discord's scheduled badge job caps playtime per single `(user, game, day)` at around 24 hours, then sums total hours across unique detectable games. Sending 200 overlapping sessions on one game in a single day adds at most 24 hours.

BadgeFarmer gives you two options in the Game Time tab:

- **Spread across catalog (Recommended, default)**: subtracts your known hours and distributes the remaining delta across unused `win32` games at 20 hours per game, unlocking **Eternal** and **Universalist** in one sync.
- **Single game (24h/day cap)**: logs sessions on one favorite game and tracks how many hours you already sent on that title today (UTC) so you do not waste overlapping sessions.

### Silent status

Game Time and Variety runs stay hidden from your live Discord Rich Presence by default so friends do not see random games flash on your status. Toggle **Show farmed games on your live Discord status** in plugin settings if you want to preview them.

### Streaming

Discord validates Streaming hours against active WebRTC media sessions on its Selective Forwarding Unit (SFU) servers alongside client `/science` events. Discord's backend discards `/science` packets that lack a matching server media session and an active viewer, so nothing skips real time for Streaming.

BadgeFarmer prevents the failure modes that stall live Go Live sessions:

- **Active SFU unpause keepalive**: dispatches `STREAM_SET_PAUSED` (`paused: false`) on each tick so minimizing Discord, sharing a background window, or locking your screen does not pause RTP transmission (`op: 22`).
- **Overnight voice reconnect grace**: waits up to 30 seconds for Discord to finish reconnecting during brief network drops before stopping a live stream run, saving accumulated viewer time every 24 seconds.
- **Low-power 480p / 15 FPS mode** (on by default): switches `ApplicationStreamingSettingsStore` to `480p @ 15 FPS` with audio off and local preview disabled (~90% less GPU and upload load), then restores your prior stream quality on Stop or client close.
- **Optional 2-hour checkpoints**: Discord can cap single continuous streams past ~10 hours and commits `video_stream_ended` when a stream ends. Turning on **2-hour checkpoints** restarts Go Live every 2 hours to bank hours along the way when paired with alt auto-watch.
- **Alt viewer auto-watch**: click **Watch this call** on a second Equicord or Vencord client, or click **Copy alt script** and paste it into an unmodded browser tab's DevTools console. Your alt joins new or restarted streams via `STREAM_WATCH` within seconds and stays unpaused in background tabs.
- **Themed capture source picker**: select a single blank window instead of your main monitor so you do not broadcast your desktop.

> [!WARNING]
> Leaving **Capture source** on `Main screen` shares your full monitor with participants in the voice channel. Pick a single window or close private tabs before clicking **Go live**.

## Badge tiers

Each badge progresses through 10 tiers. Earned tiers light up green on the tier bar, planned tiers light up blurple, and clicking any segment sets your target input to that tier.

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
| 9 | Unshakeable (2,000) | Polymath (80) | Visionary (2,000) |
| 10 | Eternal (5,000) | Universalist (100) | Phenomenon (5,000) |

## Architecture

1. **Desktop `X-Super-Properties` sync**: constructs a Base64 Windows `Discord Client` `X-Super-Properties` header (`os: "Windows"`, `browser: "Discord Client"`, `has_client_mods: false`) paired with the same `launch_signature` and `client_heartbeat_session_id` inside each event, and sends `/science` requests via `fetch` on the active client origin (`discord.com`, `ptb.discord.com`, or `canary.discord.com`) so Discord's internal request wrapper cannot overwrite the OS header on Linux, macOS, Vesktop, Equibop, or web.
2. **Catalog and blocklist filtering**: reads `GameStore.games` in memory first, checks `GameStore`'s executable blocklist, and falls back to `/applications/detectable` and `cdn.discordapp.com/detectables/games.json`. Keeps numeric IDs with non-blocked `win32` executables and preserves relative executable paths so titles match Discord's detector database.
3. **Session payloads**: sends `launch_game` (attaching any real `executableFingerprint` captured by `RunningGameStore`), `running_game_heartbeat` (`0ms`, `initial_heartbeat: true`), and `running_game_heartbeat` (`duration_tracked_ms`, `final_heartbeat: true`) in batches of 20 sessions per `POST /science` with HTTP 429 `retry-after` backoff and 401/403 token refresh.

### Project layout

| File | Responsibility |
| --- | --- |
| [index.tsx](index.tsx) | Cross-client plugin entry (Equicord HeaderBar + Vencord Toolbox), silent status setting, startup hooks |
| [badges.ts](badges.ts) | Official 30-tier catalog, Discord CDN icon hashes, and profile badge parser |
| [farmer.ts](farmer.ts) | Account progress ledger (`DataStore`), smart delta calculator, `/science` runners, Go Live controller |
| [science.ts](science.ts) | Desktop `X-Super-Properties` builder, analytics token cache, `/science` batch poster |
| [ui.tsx](ui.tsx) | 3-track progress cards, baseline editor, tier meters, custom source dropdown, and live ETA view |
| [styles.css](styles.css) | Theme-aware styles using Discord's CSS variables for dark and light themes |
| [console.js](console.js) | Standalone DevTools script with `.progress()`, smart delta calculation, and `.watch()` |

## Console script

If you do not run Equicord or Vencord, paste [console.js](console.js) into Discord's DevTools console (`Ctrl+Shift+I` › Console):

```js
BadgeFarmer.progress();                 // Inspect current badge tiers, hours, and remaining milestones
BadgeFarmer.gameTime(5000, 20);         // Farm remaining hours up to 5,000h across unused Windows games
BadgeFarmer.gameTime("Dota 2", 24);     // Single game (24h/day per-game cap)
BadgeFarmer.variety(5, 100);            // Claim remaining unique Windows games up to 100
BadgeFarmer.stream(20);                 // Resume low-power Go Live farm up to 20h
BadgeFarmer.watch();                    // Run on your alt to auto-watch and stay unpaused 24/7
BadgeFarmer.maxAll();                   // Complete remaining Eternal + Universalist milestones
BadgeFarmer.setBaseline({ time: 640 }); // Optional manual baseline override
BadgeFarmer.stop();                     // Stop active run and restore stream settings
```

## FAQ

**Badge update schedule**
Discord runs badge aggregation every 24 to 48 hours. Click **Sync profile** on the progress overview to inspect your live profile badges, while the `+queued` pill tracks hours sent ahead of Discord's sync.

**Game Time stuck at a few hours**
Older builds sent 5,000 hours on a single game ID in one day, hitting Discord's ~24-hour daily per-game cap, or let Discord's client wrapper send non-Windows `X-Super-Properties` on Linux, Vesktop, or web. Keep **Spread across catalog** selected so each unique Windows game claims 20 hours.

**Detection and Terms of Service**
Client mods violate Discord's Terms of Service, and sending synthetic telemetry carries more risk than visual tweaks. Test on a secondary account if you want zero risk to your main profile.

## Credits

Built on research from the Discord modding community for Equicord and Vencord.

## License

GPL-3.0. See [LICENSE](LICENSE).
