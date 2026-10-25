<div align="center">

# BadgeFarmer

**Discord activity badges without the grinding.**

[![Equicord userplugin](https://img.shields.io/badge/Equicord-userplugin-5865F2?logo=discord&logoColor=white)](https://github.com/Equicord/Equicord)
[![Vencord compatible](https://img.shields.io/badge/Vencord-userplugin-ED4245?logo=vencord&logoColor=white)](https://github.com/Vendicated/Vencord)
[![License](https://img.shields.io/badge/license-GPL--3.0-blue)](LICENSE)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen)](../../pulls)

[Install](#install) · [How it works](#how-it-works) · [Modes](#modes) · [FAQ](#faq)

</div>

---

Discord hands out three activity badges now: one for hours played, one for how many different games you've played, and one for hours streamed. The top tier of each sits at 5,000 hours and 100 unique games. Do the math on that and you're looking at a year of your life, minimum, for pixels next to your name.

This plugin reports finished game sessions to Discord's own analytics endpoint, using the same event format the real client sends when it detects a running game. Hours land on your profile through the normal nightly pipeline. You pick a game, pick a target, click once, and go do something else.

Built on the session-spoofing approach from [gameSessionSpoofer](https://github.com/Accentaro/gameSessionSpoofer), pushed to its logical conclusion.

## Install

**The short version:** drop the `BadgeFarmer` folder in your userplugins directory, rebuild, restart.

```bash
# from your Equicord/Vencord clone
cd src/userplugins
git clone https://github.com/aboveproof/BadgeFarmer.git

# rebuild and restart
pnpm build
```

Then enable it in **Settings → Plugins → BadgeFarmer**. The dashboard lives in the plugin settings.

> Using Vencord instead of Equicord? Same steps. The plugin only touches APIs both forks share.

## Modes

| Mode | What it does | Time to max |
| --- | --- | --- |
| **Game Time** | Credits hours for one game you pick, up to 5,000 (Eternal tier) | ~10 min |
| **Variety** | Credits short sessions across 100 unique detectable games (Universalist tier) | ~5 min |
| **Streaming** | Credits stream hours, up to 5,000 | ~10 min |
| **Max All** | All three, back to back | ~25 min |

Every mode shows a live progress bar for its badge track, so you can watch the numbers climb in real time.

## How it works

Discord's desktop client tracks detected games through a `RunningGameStore`. When it spots one, it starts sending `launch_game` and `running_game_heartbeat` events to the `/science` analytics endpoint, tagged with a session ID and a duration. The badge pipeline reads those heartbeats nightly and adds the duration to your totals.

BadgeFarmer does three things:

1. Injects a spoofed game into `RunningGameStore` through the client's own `RUNNING_GAME_SET_DEBUG_GAME` dispatch, so your presence shows the game like normal.
2. Requests your real analytics token from `/users/@me`.
3. Sends the same `launch_game` + `running_game_heartbeat` pair the real client sends, with the duration filled in. Streaming mode sends the matching `streamer_mode_session_heartbeat` events instead.

Session chunks are backdated up to 24 hours and chained without overlap, so 5,000 hours doesn't need 208 days of wall-clock time. Anything past the 24-hour window gets clamped, which keeps the timestamps inside the range the analytics pipeline accepts.

The game catalog comes straight from Discord's public [detectable applications endpoint](https://discord.com/api/v10/applications/detectable) (about 25,000 titles), so every game you credit is one Discord already knows about.

## FAQ

**How long until badges appear?**
Discord processes analytics nightly. Expect your badges within 24 hours of a run.

**It's been a day and nothing happened.**
Check three things: NoTrack (or any request blocker) is off, the "share data" toggles in Discord's privacy settings are on, and the client stayed open for the whole run. Any of those three will silently kill the analytics requests.

**Can I pick which games get credited for variety?**
Variety mode pulls 100 random titles from Discord's catalog. The shuffle is the point, a uniform-looking spread reads far more natural than 100 hand-picked favorites.

**Is this detectable?**
The events match what the real client sends, including fingerprints and session IDs. With that said, you're sending 5,000 hours of playtime in ten minutes, which no human produces. Discord hasn't acted on this pattern so far. Past performance is not a promise.

**Will this get my account banned?**
It violates the Terms of Service, same as every client mod. Ban risk from analytics spoofing specifically appears to be zero in practice, but "appears to be" is doing work in that sentence. This is your call to make, not mine.

**Does the streaming badge need an actual stream?**
No. The badge reads the analytics events, not the stream itself. Streaming mode never touches a voice channel.

## Credits

- [Accentaro/gameSessionSpoofer](https://github.com/Accentaro/gameSessionSpoofer) — the science endpoint approach and event schemas this is built on
- [Equicord](https://github.com/Equicord/Equicord) / [Vencord](https://github.com/Vendicated/Vencord) — the platform

## License

GPL-3.0. Do whatever, share it around.
