/**
 * BadgeFarmer Console Edition — mobile + desktop
 *
 * Runs anywhere Discord's JS console exists: Kettu's eval command,
 * Revenge/Bunny dev tools, desktop DevTools. No webpack, no plugin API.
 * Talks straight to Discord's REST + science endpoints with the session
 * token, so it works on modded mobile IPAs where the Equicord plugin
 * can't run.
 *
 * Game Time and Variety: backdated session chunks, same engine as the
 * Equicord plugin. Streaming: live heartbeats (lawerth's telemetry shape)
 * — go live with a viewer first, or those hours won't count.
 *
 * MIT. Telemetry schemas from lawerth/discord-streamer, game-time engine
 * from Accentaro/gameSessionSpoofer via aboveproof/BadgeFarmer.
 */
(() => {
    const API = "https://discord.com/api/v9";
    const SCIENCE = `${API}/science`;
    const DETECTABLE = "https://discord.com/api/v10/applications/detectable";

    const state = {
        token: "",
        analyticsToken: "",
        sequence: Math.floor(Math.random() * 100000),
        heartbeatSessionId: crypto.randomUUID(),
        launchSignature: crypto.randomUUID(),
        running: false,
        creditedHours: 0,
        gamesCredited: 0,
        streamMinutes: 0,
        stopFlag: false
    };

    const log = (msg, ok) => console.log(`%c[BadgeFarmer] ${msg}`, `color:${ok ? "#57f194" : "#f23f43"};font-weight:bold`);

    function headers() {
        return {
            authorization: state.token,
            "content-type": "application/json"
        };
    }

    async function findToken() {
        // Desktop/web: token lives in webpack. Mobile mods often expose it too.
        try {
            const w = typeof window !== "undefined" ? window : globalThis;
            if (w?.webpackChunkdiscord_app?.push) {
                let token;
                w.webpackChunkdiscord_app.push([[Symbol()], {}, req => {
                    for (const m of Object.values(req.c)) {
                        const exp = m?.exports;
                        const scan = exp?.getToken?.() ?? exp?.default?.getToken?.();
                        if (scan) { token = scan; break; }
                    }
                }]);
                if (token) return token;
            }
        } catch { /* fall through */ }
        throw new Error("Could not find the session token. Set it manually: BadgeFarmer.token = \"...\"");
    }

    async function ensureAuth() {
        if (state.token) return;
        state.token = await findToken();
        log(`token found (${state.token.slice(0, 12)}...)`, true);
    }

    async function ensureAnalyticsToken() {
        if (state.analyticsToken) return;
        const res = await fetch(`${API}/users/@me?with_analytics_token=true`, { headers: headers() });
        if (!res.ok) throw new Error(`token fetch failed: ${res.status}`);
        const body = await res.json();
        if (!body.analytics_token) throw new Error("no analytics_token (check the personalize-data privacy toggle)");
        state.analyticsToken = body.analytics_token;
    }

    async function postScience(events) {
        await ensureAnalyticsToken();
        const res = await fetch(SCIENCE, {
            method: "POST",
            headers: headers(),
            body: JSON.stringify({ token: state.analyticsToken, events })
        });
        if (!res.ok && res.status !== 204) throw new Error(`science ${res.status}`);
    }

    function baseProps(extra) {
        return {
            client_track_timestamp: Date.now(),
            client_send_timestamp: Date.now(),
            client_heartbeat_session_id: state.heartbeatSessionId,
            launch_signature: state.launchSignature,
            event_sequence_number: ++state.sequence,
            client_app_state: "focused",
            ...extra
        };
    }

    async function loadCatalogue() {
        const res = await fetch(DETECTABLE);
        if (!res.ok) throw new Error(`catalogue ${res.status}`);
        return res.json();
    }

    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

    // ---- Game Time + Variety (backdated chunks, same shape as the plugin) ----

    async function creditPlaytime(game, durationMs, start) {
        const session = crypto.randomUUID();
        const events = [
            { type: "running_game_heartbeat", properties: baseProps({ game_id: game.id, game_name: game.name, game_executable: game.exeName, initial_heartbeat: true, final_heartbeat: false, game_session_id: session, duration_tracked_ms: 0 }) },
            { type: "launch_game", properties: baseProps({ game: game.name, game_id: game.id, verified: true, detection_method: "verified_game", game_platform: "desktop" }) },
            { type: "running_game_heartbeat", properties: baseProps({ game_id: game.id, game_name: game.name, game_executable: game.exeName, initial_heartbeat: false, final_heartbeat: true, game_session_id: session, duration_tracked_ms: durationMs }) }
        ];
        // rewrite timestamps onto the session window
        const now = Date.now();
        for (const ev of events) {
            ev.properties.client_track_timestamp = start;
            ev.properties.client_send_timestamp = start + durationMs;
        }
        events[2].properties.client_track_timestamp = start + durationMs;
        await postScience(events);
    }

    async function farmGameTime(app, hours) {
        await ensureAuth();
        state.running = true; state.stopFlag = false; state.creditedHours = 0;
        let cursor = Date.now();
        log(`Game Time: ${hours}h on ${app.name}...`);
        while (state.running && !state.stopFlag && state.creditedHours < hours) {
            const chunk = Math.min(2, hours - state.creditedHours);
            const dur = chunk * 3600000;
            const start = cursor - dur;
            cursor = start;
            try {
                await creditPlaytime(app, dur, start);
                state.creditedHours += chunk;
                log(`${state.creditedHours}/${hours}h credited`, true);
            } catch (e) {
                log(`chunk failed: ${e.message} — retrying in 5s`);
                await sleep(5000);
            }
            await sleep(800);
        }
        state.running = false;
        log(`Game Time done: ${state.creditedHours}h. Badge updates on the next nightly pass.`, true);
    }

    async function farmVariety(games, minutesPerGame) {
        await ensureAuth();
        state.running = true; state.stopFlag = false; state.gamesCredited = 0;
        let cursor = Date.now();
        log(`Variety: ${games.length} games, ${minutesPerGame}min each...`);
        for (const game of games) {
            if (state.stopFlag) break;
            const dur = minutesPerGame * 60000;
            const start = cursor - dur;
            cursor = start;
            try {
                await creditPlaytime(game, dur, start);
                state.gamesCredited++;
                if (state.gamesCredited % 10 === 0) log(`${state.gamesCredited}/${games.length} games`, true);
            } catch (e) {
                log(`${game.name} failed: ${e.message}`);
            }
            await sleep(800);
        }
        state.running = false;
        log(`Variety done: ${state.gamesCredited} games. Badge updates on the next nightly pass.`, true);
    }

    // ---- Streaming (live per-minute heartbeats, lawerth's shape) ----

    async function farmStream(hours) {
        await ensureAuth();
        state.running = true; state.stopFlag = false; state.streamMinutes = 0;
        state.heartbeatSessionId = crypto.randomUUID();
        state.launchSignature = crypto.randomUUID();
        const target = hours * 60;
        const streamProps = { guild_id: "0", channel_id: "0", channel_type: 2 };

        log(`Streaming: ${hours}h target. Go live with a viewer NOW — 1h per real hour.`);
        await postScience([
            { type: "media_session_joined", properties: baseProps({ ...streamProps }) },
            { type: "video_stream_started", properties: baseProps({ ...streamProps }) }
        ]);

        let fails = 0;
        while (state.running && !state.stopFlag && state.streamMinutes < target) {
            await sleep(60000);
            if (state.stopFlag) break;
            try {
                await postScience([{
                    type: "video_stream_heartbeat",
                    properties: baseProps({ ...streamProps, duration_tracked_ms: 60000, total_duration_ms: (state.streamMinutes + 1) * 60000 })
                }]);
                state.streamMinutes++;
                fails = 0;
                if (state.streamMinutes % 30 === 0) log(`${state.streamMinutes}/${target}min credited`, true);
            } catch (e) {
                if (++fails >= 10) { log("10 straight failures — aborting"); break; }
            }
        }

        await postScience([{
            type: "video_stream_ended",
            properties: baseProps({ ...streamProps, duration_ms: state.streamMinutes * 60000 })
        }]);
        state.running = false;
        log(`Streaming done: ${state.streamMinutes}min. Badge updates on the next nightly pass.`, true);
    }

    // ---- helpers for picking games ----

    function pickRandom(apps, count) {
        const pool = [...apps];
        for (let i = pool.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [pool[i], pool[j]] = [pool[j], pool[i]];
        }
        return pool.slice(0, count).map(a => ({ id: a.id, name: a.name, exeName: (a.executables?.[0]?.name ?? a.name + ".exe").replace(/^.*[\\/]/, "") }));
    }

    const BadgeFarmer = {
        get token() { return state.token; },
        set token(v) { state.token = v; },
        get status() { return { running: state.running, hours: state.creditedHours, games: state.gamesCredited, streamMinutes: state.streamMinutes }; },
        stop() { state.stopFlag = true; log("stopping after the current chunk..."); },

        search(name) {
            return loadCatalogue().then(apps => apps.filter(a => a.name.toLowerCase().includes(name.toLowerCase())).slice(0, 20));
        },

        gameTime(name, hours = 5000) {
            return this.search(name).then(([app]) => {
                if (!app) throw new Error(`no game matched "${name}"`);
                return farmGameTime({ id: app.id, name: app.name, exeName: (app.executables?.[0]?.name ?? app.name + ".exe").replace(/^.*[\\/]/, "") }, hours);
            });
        },

        variety(minutesPerGame = 2, count = 100) {
            return loadCatalogue().then(apps => farmVariety(pickRandom(apps, count), minutesPerGame));
        },

        stream(hours = 5000) {
            return farmStream(hours);
        },

        async maxAll() {
            const apps = await loadCatalogue();
            await this.variety(2, 100);
            const [game] = pickRandom(apps, 1);
            await farmGameTime(game, 5000);
        }
    };

    if (typeof window !== "undefined") window.BadgeFarmer = BadgeFarmer;
    else globalThis.BadgeFarmer = BadgeFarmer;

    log("loaded. BadgeFarmer.gameTime(\"Dota 2\"), .variety(), .stream(100), .maxAll(), .stop(), .status", true);
    return BadgeFarmer;
})();
