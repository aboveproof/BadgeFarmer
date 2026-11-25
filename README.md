<div align="center">

# BadgeFarmer

**Earn Discord's activity badges without a year of idling.**

[![Equicord userplugin](https://img.shields.io/badge/Equicord-userplugin-5865F2?logo=discord&logoColor=white)](https://github.com/Equicord/Equicord)
[![Vencord compatible](https://img.shields.io/badge/Vencord-userplugin-ED4245?logo=vencord&logoColor=white)](https://github.com/Vendicated/Vencord)
[![License](https://img.shields.io/badge/license-GPL--3.0-blue)](LICENSE)

[Install](#install) · [Requirements](#requirements) · [Modes](#modes) · [Badge tiers](#badge-tiers) · [How it works](#how-it-works) · [Console script](#console-script) · [FAQ](#faq)

</div>

---

Discord tracks three evolving desktop activity badges: **Game Time**, **Game Variety**, and **Streaming**. Reaching the top tier takes 5,000 hours played, 100 unique games, and 5,000 hours streamed.

BadgeFarmer finishes Game Time and Variety in under 20 seconds using batched `/science` sessions, and runs a low-power, unpaused Go Live setup with an alt viewer helper so Streaming hours go through to your badge. Open the dashboard from the top-right badge button in Discord's header bar or inside plugin settings.

## Install

Clone the repository into your Equicord or Vencord `src/userplugins` directory and rebuild:

```bash
cd src/userplugins
git clone https://github.com/aboveproof/BadgeFarmer.git
cd ../..
pnpm build
```

Restart Discord and turn on **BadgeFarmer** under **User Settings › Plugins**.

### Plugin settings

- **Header bar button** (on by default): adds a badge icon to Discord's top-right header bar that opens the BadgeFarmer modal from any screen. The icon turns green while a run is active.
- **Run All three on Discord startup** (off by default): waits for Discord to finish logging in (`CONNECTION_OPEN`), loads the game catalog, and starts the **All three** workflow.

## Requirements

Check these settings before starting a run:

1. **Discord desktop app**: Discord ignores console play and browser-only sessions for activity badges.
2. **Data personalization**: turn on **Use data to personalize my Discord experience** under **User Settings › Data & Privacy**. Discord drops badge telemetry when this setting is off. BadgeFarmer checks `ConsentStore` and shows a red banner if personalization is disabled.
3. **NoTrack (for Streaming)**: Discord's Streaming badge needs three client telemetry events (`media_session_joined`, `video_stream_started`, and `video_stream_ended` with `context: "stream"`). If `NoTrack` has **Allow badge tracking** turned off (or has not reloaded since turning it on), zero stream hours will reach your badge. BadgeFarmer detects both states in the Streaming tab and gives you a one-click **Enable in NoTrack** and **Reload** button. Game Time and Variety post to `/science` on their own and work regardless of `NoTrack`.
4. **Voice channel + viewer (for Streaming)**: join a regular voice channel (Stage channels do not support Go Live) where you have Stream permission, and keep at least one other account watching your stream.

## Modes

| Mode | What it sends or runs | Time to top tier |
| --- | --- | --- |
| **Game Time** | Batched play sessions for one game you choose. Eternal needs 5,000 hours. | About 12 seconds |
| **Variety** | One short session each for random unique games from Discord's catalog. Universalist needs 100 games. | About 6 seconds |
| **Streaming** | Managed low-power Go Live broadcast with SFU unpause keepalive and alt auto-watch support. Phenomenon needs 5,000 hours. | Real time |
| **All three** | Runs Variety (100 games), then Game Time (5,000 hours on the first game), then Streaming if you sit in a voice channel. | Under 20 seconds for the first two |

### Game Time

Search Discord's full catalog of ~25,000 detectable games by name or alias (such as `cs2` or `lol`), pick a target hour count, and choose how many hours each session claims (1 to 24 hours). BadgeFarmer batches up to 12 sessions per `/science` request (up to 288 hours per POST) while keeping each session's timestamps inside Discord's 24-hour window. Click any segment on the tier bar to set the target to that tier.

### Variety

Pick how many random games to log and how long each session lasts (2 minutes is enough). BadgeFarmer deduplicates the pool, places sessions in back-to-back non-overlapping slots within the last 24 hours, and sends them in batches of 12.

### Streaming (and why hours count)

Unlike Game Time, Discord validates Streaming hours against active WebRTC media sessions on its Selective Forwarding Unit (SFU) servers alongside client `/science` events (`media_session_joined`, `video_stream_started`, `video_stream_ended`). Discord's backend discards `/science` packets that lack a matching server media session and an active viewer, so nothing fast-forwards Streaming past real time.

Instead, BadgeFarmer eliminates the failure modes that cause real Go Live hours to stall or drop overnight:

- **Active SFU unpause keepalive**: dispatches `STREAM_SET_PAUSED` (`paused: false`) on each tick so minimizing Discord, sharing a background window, or locking your screen does not pause RTP transmission (`op: 22`).
- **Low-power 480p / 15 FPS mode** (on by default): switches `ApplicationStreamingSettingsStore` to `480p @ 15 FPS` with audio off and local preview disabled (~90% less GPU and upload load), then restores your original resolution and frame rate when stopped or unloaded.
- **No blind viewer disconnects**: keeps an active stream running without kicking manual viewers off at fixed intervals, and offers an optional **2-hour checkpoints** toggle to flush `video_stream_ended` along the way when paired with alt auto-watch.
- **Alt viewer auto-watch**: run **Watch this call** on a second Equicord client, or click **Copy alt script** and paste it into an unmodded browser tab's DevTools console. The alt joins new or restarted streams via `STREAM_WATCH` within seconds and keeps its incoming feed unpaused in background tabs.
- **Themed capture source picker**: select a single blank window instead of your main monitor so you do not expose your desktop.
- **Clean teardown on Stop and reload**: dispatches `STREAM_STOP` before unload so Discord sends `video_stream_ended` and commits earned hours.

> [!WARNING]
> Leaving **Capture source** on `Main screen` shares your full monitor with everyone in the voice channel. Pick a single window or close private tabs before clicking **Go live**.

### All three

Runs Variety (100 games, 2 minutes each), then Game Time (5,000 hours on the first game from that batch), then Streaming if you sit in a valid voice channel with `NoTrack` badge tracking enabled. If an earlier step fails after retries, the run stops and reports the error instead of continuing. Pressing **Stop** cancels pending waits at once.

## Badge tiers

All three badges progress through 10 tiers. Clicking any segment on the tier bar in the dashboard jumps your target input to that tier.

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

## How it works

### Game Time and Variety telemetry

1. **Catalog loading**: reads Discord's in-memory `GameStore.games` cache first for an instant load. If the store is empty, falls back to `GET https://discord.com/api/v10/applications/detectable` with a 20-second timeout and a Retry button on failure.
2. **Analytics token**: fetches your account's `analytics_token` from `GET /users/@me?with_analytics_token=true`, caches it per user ID for 12 hours, and clears it on HTTP 401/403 so retries fetch a fresh token.
3. **Session payloads**: for each session, builds three chronological events (`launch_game`, initial `running_game_heartbeat` with `duration_tracked_ms: 0`, and final `running_game_heartbeat` with `duration_tracked_ms` matching `end - start`), normalizes executable casing, pulls any cached `executableFingerprint` from `RunningGameStore`, keeps `client_heartbeat_session_id` and `launch_signature` stable across the run, and stamps `client_send_timestamp` to batch send time.
4. **Presence & batching**: dispatches `RUNNING_GAME_SET_DEBUG_GAME` for visual presence, sends up to 12 sessions (36 events) per `POST /science`, respects HTTP 429 `retry-after` headers and body timers, and aborts after 5 consecutive failed batches.

### Project layout

| File | Responsibility |
| --- | --- |
| [index.tsx](index.tsx) | Plugin entry, settings definition, header bar button, startup and `beforeunload` hooks |
| [farmer.ts](farmer.ts) | Run state machine, catalog loader, batch scheduler, Go Live controller, low-power encoder, alt viewer helper |
| [science.ts](science.ts) | Analytics token cache, `ConsentStore` and `NoTrack` checks, `/science` event builder and batch poster |
| [ui.tsx](ui.tsx) | Dashboard modal and settings UI, indexed game search, custom source dropdown, toggles, tier bars |
| [styles.css](styles.css) | Theme-aware styles using Discord's CSS variables for dark and light themes |
| [console.js](console.js) | Standalone DevTools console edition with batched `/science` requests, Go Live control, and `.watch()` alt helper |

## Console script

If you do not run Equicord or Vencord, paste [console.js](console.js) into Discord's DevTools console (`Ctrl+Shift+I` › Console). It grabs your session token from webpack (or lets you set `BadgeFarmer.token = "..."` by hand), caches the catalog from `GameStore` or HTTP, and exposes:

```js
BadgeFarmer.search("counter");          // Search detectable games by name or alias
BadgeFarmer.gameTime("Dota 2", 5000);   // 5,000h in batched 24h sessions (~12s)
BadgeFarmer.variety(2, 100);            // 100 random games, 2 min each (~6s)
BadgeFarmer.stream(1);                  // Low-power Go Live farm on desktop
BadgeFarmer.watch();                    // Run on your alt to auto-watch and stay unpaused 24/7
BadgeFarmer.maxAll();                   // Variety (100) then Game Time (5,000h)
BadgeFarmer.stop();                     // Stop the active run and restore stream settings
BadgeFarmer.status;                     // Inspect current mode, progress, viewers, errors
```

## FAQ

**When do badges update on my profile?**
Discord processes Game Time and Variety overnight. Streaming takes up to 48 hours after your client sends `video_stream_ended`.

**Nothing changed after two days.**
Confirm **Use data to personalize my Discord experience** is on under **User Settings › Data & Privacy**. For Streaming, check that you enabled **Allow badge tracking** in `NoTrack` and reloaded Discord, kept at least one viewer watching your stream, and stopped the run before closing Discord so `video_stream_ended` flushed.

**Can you spoof Streaming in seconds like Game Time?**
No. Discord joins Streaming telemetry against live WebRTC media sessions on its SFU servers and requires an active viewer connection. Use Low-power mode on your main account plus `Watch this call` (or `Copy alt script`) on an alt to accumulate real hours with minimal CPU and GPU load.

**Detection and Terms of Service**
Client mods violate Discord's Terms of Service, and sending synthetic telemetry carries more risk than visual tweaks. Payloads follow Discord's client format, though logging 5,000 hours in 12 seconds is an obvious anomaly if Discord audits accounts. Use it at your own risk.

## Credits

Built on research from the Discord modding community for Equicord and Vencord.

## License

GPL-3.0. See [LICENSE](LICENSE).
