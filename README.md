<div align="center">

# BadgeFarmer

**Discord activity badges without the grinding.**

[![Equicord userplugin](https://img.shields.io/badge/Equicord-userplugin-5865F2?logo=discord&logoColor=white)](https://github.com/Equicord/Equicord)
[![Vencord compatible](https://img.shields.io/badge/Vencord-userplugin-ED4245?logo=vencord&logoColor=white)](https://github.com/Vendicated/Vencord)
[![Mobile](https://img.shields.io/badge/Mobile-console%20edition-34C759?logo=ios&logoColor=white)](#mobile)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen)](../../pulls)

[Install](#install) · [How it works](#how-it-works) · [Modes](#modes) · [FAQ](#faq)

</div>

---

Discord hands out three activity badges: one for hours played, one for how many different games you've played, one for hours streamed. The top tier of each sits at 5,000 hours and 100 unique games. Do the math and you're trading a year of your life for pixels next to your name.

This plugin reports sessions to Discord's analytics endpoint, in the same event format the real client uses. Hours land on your profile through the nightly pipeline. You pick a game, pick a target, click once, and go do something else.

The game-time engine builds on [gameSessionSpoofer](https://github.com/Accentaro/gameSessionSpoofer). The streaming engine is a 1:1 port of [lawerth/discord-streamer](https://github.com/lawerth/discord-streamer)'s telemetry service.

## Install

Drop the `BadgeFarmer` folder into your userplugins directory, rebuild, restart:

```bash
# from your Equicord/Vencord clone
cd src/userplugins
git clone https://github.com/aboveproof/BadgeFarmer.git

# rebuild and restart
pnpm build
```

Enable it in **Settings → Plugins → BadgeFarmer**. The dashboard lives in the plugin settings.

> Using Vencord instead of Equicord? Same steps. The plugin only touches APIs both forks share.

## Mobile

There's no native Kettu or Snowcord plugin here, and that's deliberate: those mods use a completely different plugin API (Bunny-family manifests, metro module access) from Vencord's webpack layer, so the Equicord plugin can't just be dropped in. What works instead is [`console.js`](console.js), a self-contained script that runs in any client with a JavaScript console — Kettu's eval command, Revenge/Bunny dev tools, or desktop DevTools. It finds the session token on its own, falls back to a manual `BadgeFarmer.token = "..."` if it can't, and drives the same three engines:

```js
BadgeFarmer.gameTime("Dota 2", 5000)  // game time, backdated chunks
BadgeFarmer.variety()                 // 100 random games
BadgeFarmer.stream(100)               // live heartbeats, go live with a viewer first
BadgeFarmer.maxAll()
BadgeFarmer.stop()
BadgeFarmer.status
```

Everything runs in the foreground of that client, so on iOS keep the app open while it works.

## Modes

| Mode | What it does | Time to max |
| --- | --- | --- |
| **Game Time** | Credits hours for one game you pick, up to 5,000 (Eternal tier) | ~10 min |
| **Variety** | Credits short sessions across 100 unique detectable games (Universalist tier) | ~5 min |
| **Streaming** | Rides your live stream and credits 10h per minute of runtime | 5,000h in ~9 min live |
| **Max All** | All three, back to back | ~25 min total |

Game Time and Variety send finished sessions in 2-hour chunks, backdated up to 24 hours and chained without overlap, so 5,000 hours doesn't need 208 days of wall-clock time.

Streaming works differently, because the streaming badge works differently. Plain fabricated sessions never register: we tested that thoroughly, the requests succeed and the badge ignores every hour. Discord's pipeline validates stream hours against real live sessions on their media servers. So stream mode attaches to an actual live stream. Join a voice channel, go live with any screenshare, have someone watching (an alt account counts), start the run, and each minute of real runtime posts a heartbeat claiming 10 hours against your genuine session. A 5,000h target is 9 minutes of being live.

If you're not live when you start, the run says so and falls back to honest per-minute mode automatically.

The game catalog comes from Discord's public [detectable applications endpoint](https://discord.com/api/v10/applications/detectable) (about 25,000 titles), so every game you credit is one Discord already knows about.

## How it works

Discord's desktop client tracks detected games through a `RunningGameStore`. When it spots one, it sends `launch_game` and `running_game_heartbeat` events to the `/science` analytics endpoint, tagged with a session ID and a duration. The badge pipeline reads those heartbeats nightly and adds the duration to your totals.

BadgeFarmer does three things:

1. Injects a spoofed game into `RunningGameStore` through the client's own `RUNNING_GAME_SET_DEBUG_GAME` dispatch, so your presence shows the game.
2. Requests your real analytics token from `/users/@me`.
3. Sends the same `launch_game` + `running_game_heartbeat` pair the real client sends, duration filled in.

For streaming, the plugin reads your actual live stream from `ApplicationStreamingStore` (real guild and channel IDs, real viewer count) and posts `media_session_joined` / `video_stream_started` / `video_stream_heartbeat` / `video_stream_ended` events against it, using the event schemas from [discord-streamer](https://github.com/lawerth/discord-streamer)'s telemetry engine.

When a run hits its target, it stops itself and tells you it finished.

## FAQ

**How long until badges appear?**
Discord processes analytics nightly. Expect your badges within 24 hours of a run. Sometimes it takes two or three days.

**It's been days and nothing happened.**
The "use data to personalize" toggle in Discord's privacy settings must be on, or the events get dropped server-side. The client also needs to stay open for the whole run. NoTrack can stay enabled: its tracking patch only disables Discord's own analytics batching, and this plugin posts straight to `/science`, past that patch.

**Does the streaming badge need an actual stream?**
Yes. Fabricated sessions with no stream behind them never register, no matter what shape you send them in. Go live in a voice channel with any screenshare (a blank 10fps loop is enough) and have a viewer. An alt account in the channel watching the stream counts. Start the run while live and it does the rest.

**Can I pick which games get credited for variety?**
Variety mode pulls 100 random titles from Discord's catalog. The shuffle is the point. A uniform spread reads more natural than 100 hand-picked favorites.

**Is this detectable?**
The events match what the real client sends, fingerprints and session IDs included. You're still sending 5,000 hours of playtime in ten minutes, which no human produces. Discord hasn't acted on this pattern so far. Past performance is not a promise.

**Will this get my account banned?**
It violates the Terms of Service, same as every client mod. Ban risk from analytics spoofing appears to be zero in practice, and "appears to be" is doing work in that sentence. Your call, not mine.

## Credits

- [lawerth/discord-streamer](https://github.com/lawerth/discord-streamer) — the streaming telemetry engine, ported 1:1. Their research into the `media_session_joined` / `video_stream_started` / `video_stream_heartbeat` / `video_stream_ended` chain is what makes stream farming work. MIT licensed.
- [Accentaro/gameSessionSpoofer](https://github.com/Accentaro/gameSessionSpoofer) — the science endpoint approach and game-time event schemas.
- [Equicord](https://github.com/Equicord/Equicord) / [Vencord](https://github.com/Vendicated/Vencord) — the platform.

## License

MIT License
