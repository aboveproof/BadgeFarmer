<div align="center">

# BadgeFarmer

**Discord activity badges without the grinding.**

[![Equicord userplugin](https://img.shields.io/badge/Equicord-userplugin-5865F2?logo=discord&logoColor=white)](https://github.com/Equicord/Equicord)
[![Vencord compatible](https://img.shields.io/badge/Vencord-userplugin-ED4245?logo=vencord&logoColor=white)](https://github.com/Vendicated/Vencord)
[![Mobile](https://img.shields.io/badge/Mobile-console%20edition-34C759?logo=ios&logoColor=white)](#mobile)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

[Install](#install) · [Mobile](#mobile) · [How it works](#how-it-works) · [FAQ](#faq)

</div>

---

Discord gives you three activity badges now. One for hours played, one for how many different games, one for hours streamed. Top tier is 5,000 hours and 100 games each. That's a year of your life for pixels next to your name.

This plugin reports sessions to Discord's analytics endpoint using the same event format the real client sends. Hours land on your profile through the nightly pipeline. Pick a game, pick a target, click once, go do something else.

Game time engine builds on [gameSessionSpoofer](https://github.com/Accentaro/gameSessionSpoofer). Streaming engine is a 1:1 port of [lawerth/discord-streamer](https://github.com/lawerth/discord-streamer)'s telemetry service.

## Install

Drop the `BadgeFarmer` folder into your userplugins directory, rebuild, restart:

```bash
# from your Equicord/Vencord clone
cd src/userplugins
git clone https://github.com/aboveproof/BadgeFarmer.git

# rebuild and restart
pnpm build
```

Enable it in **Settings, Plugins, BadgeFarmer**. The dashboard lives in the plugin settings.

Vencord instead of Equicord works too. The plugin only touches APIs both forks share.

## Mobile

No native Kettu or Snowcord plugin, on purpose. Those mods run a completely different plugin system than Vencord so the Equicord plugin can't just be dropped in. What works instead is [`console.js`](console.js), a single script that runs in any client with a JavaScript console. Kettu's eval command, Revenge and Bunny dev tools, desktop DevTools, all fine. It finds your session token on its own and falls back to `BadgeFarmer.token = "..."` if it can't.

```js
BadgeFarmer.gameTime("Dota 2", 5000)  // game time, backdated chunks
BadgeFarmer.variety()                 // 100 random games
BadgeFarmer.stream(100)               // live heartbeats, go live with a viewer first
BadgeFarmer.maxAll()
BadgeFarmer.stop()
BadgeFarmer.status
```

iOS suspends backgrounded apps so keep the client open while it runs.

## Modes

| Mode | What it does | Time to max |
| --- | --- | --- |
| **Game Time** | Credits hours for one game you pick, up to 5,000 (Eternal tier) | ~10 min |
| **Variety** | Credits short sessions across 100 unique games (Universalist tier) | ~5 min |
| **Streaming** | Attaches to your live stream and credits 10h per minute of runtime | 5,000h in ~9 min live |
| **Max All** | All three, back to back | ~25 min total |

Game Time and Variety send finished sessions in 2 hour chunks, backdated up to 24 hours and chained without overlap. 5,000 hours doesn't need 208 days of wall clock time.

Streaming is different because the streaming badge is different. Fake sessions never register. We tested that thoroughly: the requests succeed and the badge ignores every hour. Discord checks stream hours against real live sessions on their media servers. So stream mode attaches to an actual live stream. Join a voice channel, go live with any screenshare, have someone watching (an alt counts), start the run. Each minute of real runtime posts a heartbeat claiming 10 hours against your real session. 5,000 hours takes 9 minutes of being live.

Not live when you start? The run tells you and falls back to per minute mode.

The game catalog comes from Discord's public [detectable applications endpoint](https://discord.com/api/v10/applications/detectable), about 25,000 titles, so every game you credit is one Discord already knows.

## How it works

Discord's desktop client tracks detected games through a `RunningGameStore`. When it spots one it sends `launch_game` and `running_game_heartbeat` events to the `/science` analytics endpoint, tagged with a session ID and a duration. The badge pipeline reads those heartbeats nightly and adds the duration to your totals.

BadgeFarmer does three things:

1. Injects a spoofed game into `RunningGameStore` through the client's own `RUNNING_GAME_SET_DEBUG_GAME` dispatch, so your presence shows the game
2. Grabs your real analytics token from `/users/@me`
3. Sends the same `launch_game` + `running_game_heartbeat` pair the real client sends, duration filled in

For streaming the plugin reads your actual live stream from `ApplicationStreamingStore`, real guild and channel IDs, real viewer count, and posts the `media_session_joined`, `video_stream_started`, `video_stream_heartbeat`, `video_stream_ended` chain against it. Event schemas come from [discord-streamer](https://github.com/lawerth/discord-streamer).

When a run hits its target it stops itself and tells you it's done.

## FAQ

**How long until badges appear?**
Discord processes analytics nightly. Expect movement within 24 hours of a run. Sometimes it takes two or three days.

**It's been days and nothing happened.**
Check the "use data to personalize" toggle in Settings, Privacy and Safety. If that's off, Discord drops the events server side and you get nothing. The client also needs to stay open for the whole run. NoTrack is fine, leave it on. Its patch only kills Discord's own analytics batching and this plugin posts straight to `/science`, which goes around it.

**Does the streaming badge need an actual stream?**
Yes. Fabricated sessions with no stream behind them never register, no matter what shape you send them in. Go live in a voice channel with any screenshare, a blank 10fps loop is enough, and have a viewer. An alt account watching the stream counts. Start the run while live.

**Can I pick which games get credited for variety?**
Variety pulls 100 random titles from Discord's catalog. The shuffle is the point. A spread of random games reads way more natural than 100 hand picked favorites.

**Is this detectable?**
The events match what the real client sends, fingerprints and session IDs included. You're still sending 5,000 hours of playtime in ten minutes, which no human produces. Discord hasn't acted on this pattern so far. Past performance is not a promise.

**Will this get my account banned?**
It violates the Terms of Service, same as every client mod. Ban risk from analytics spoofing looks like zero in practice, and "looks like" is doing a lot of work in that sentence. Your call.

## Credits

- [lawerth/discord-streamer](https://github.com/lawerth/discord-streamer) for the streaming telemetry engine, ported 1:1. Their research into the media session and video stream event chain is what makes stream farming work at all. MIT licensed.
- [Accentaro/gameSessionSpoofer](https://github.com/Accentaro/gameSessionSpoofer) for the science endpoint approach and the game time event schemas.
- [Equicord](https://github.com/Equicord/Equicord) and [Vencord](https://github.com/Vendicated/Vencord) for the platform.

## License

MIT
