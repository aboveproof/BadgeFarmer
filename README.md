<div align="center">

# BadgeFarmer

**Discord's activity badges, minus the year of grinding.**

[![Equicord userplugin](https://img.shields.io/badge/Equicord-userplugin-5865F2?logo=discord&logoColor=white)](https://github.com/Equicord/Equicord)
[![Vencord compatible](https://img.shields.io/badge/Vencord-userplugin-ED4245?logo=vencord&logoColor=white)](https://github.com/Vendicated/Vencord)
[![License](https://img.shields.io/badge/license-GPL--3.0-blue)](LICENSE)

[Install](#install) · [Modes](#modes) · [Under the hood](#under-the-hood) · [FAQ](#faq)

</div>

---

Discord gives out three activity badges for hours played, unique games played, and hours streamed. The top tiers sit at 5,000 hours and 100 games. Earning them by hand costs you most of a year.

BadgeFarmer finishes the first two in a few minutes and runs the stream for you on the third. Open the plugin settings, pick a mode, and leave Discord open.

## Install

Clone the plugin into your userplugins folder and rebuild:

```bash
# from your Equicord or Vencord checkout
cd src/userplugins
git clone https://github.com/aboveproof/BadgeFarmer.git
cd ../..
pnpm build
```

Restart Discord and turn it on under **Settings › Plugins › BadgeFarmer**. The dashboard lives inside the plugin settings. Vencord uses the same steps.

## Modes

| Mode | Result | Time to top tier |
| --- | --- | --- |
| **Game Time** | Hours on one game you pick. Eternal starts at 5,000. | About 4 minutes |
| **Variety** | One short session each across random games. Universalist needs 100. | About 2 minutes |
| **Streaming** | A real Go Live stream in your voice channel, kept running hour after hour. | Real time |
| **All three** | Variety, then Game Time, then Streaming if you sit in a voice channel. | Minutes for the first two |

Game Time and Variety send finished play sessions in back-to-back slots within Discord's 24-hour window, so 5,000 hours does not take 208 days on the clock. You choose how many hours each request claims. Bigger chunks finish sooner.

Streaming follows different rules. Discord checks stream hours against live media sessions on its servers, so fake telemetry earns nothing. BadgeFarmer starts Go Live through Discord's own stream actions and restarts the broadcast at the 4-hour mark to stay ahead of Discord's 5-hour cutoff. Sit in a voice channel with one viewer watching. An alt account counts.

> [!WARNING]
> Go Live shares your main screen with the voice channel. Close private windows before you start a stream run.

The game list comes from Discord's public detectable applications endpoint, around 25,000 titles.

## Under the hood

Discord's desktop client reports detected games to its `/science` analytics endpoint as `launch_game` and `running_game_heartbeat` events, each carrying a session ID and a duration. Discord's overnight job adds those durations to your badge totals.

For Game Time and Variety, BadgeFarmer puts the game on your presence through Discord's `RUNNING_GAME_SET_DEBUG_GAME` dispatch, fetches your analytics token from `/users/@me` (cached per account), and posts the launch and heartbeat events with the duration filled in.

For Streaming, it calls the same `STREAM_START` and `STREAM_STOP` actions the Go Live button uses, reads the viewer count from `ApplicationStreamingStore`, and counts hours while you stay live.

A run stops itself when it hits the target and pops a toast.

## FAQ

**Badge timing**
Discord runs its badge update overnight. Expect Game Time and Variety within a day or two. Streaming can take up to 48 hours.

**Nothing showed up after a few days**
Turn on "Use data to personalize my Discord experience" under Data & Privacy. With it off, Discord drops the sessions. Keep the client open until the run finishes. NoTrack can stay on, since BadgeFarmer posts to `/science` on its own.

**Choosing the Variety games**
You can't. Variety pulls a random spread from Discord's catalog, and a random spread reads more natural than 100 hand-picked favorites.

**Detection**
The events match the real client's format, fingerprints and session IDs included. No human logs 5,000 hours in four minutes, though. Discord has not acted on this pattern so far, and that can change.

**Bans**
Client mods break Discord's Terms of Service, and this one goes further than most. Nobody has reported a ban for it yet. You take the risk.

## Credits

Built on research from the Discord modding community, with Equicord and Vencord underneath.

## License

GPL-3.0.
