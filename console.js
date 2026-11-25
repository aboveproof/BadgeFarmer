/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * BadgeFarmer Console Edition (desktop and mobile JS consoles)
 *
 * Uses your Discord session token to post batched /science play sessions for
 * Game Time and Variety, and tracks live Go Live stream hours on desktop.
 *
 * Commands:
 *   BadgeFarmer.gameTime("Dota 2", 5000)
 *   BadgeFarmer.variety(2, 100)
 *   BadgeFarmer.stream(1)
 *   BadgeFarmer.maxAll()
 *   BadgeFarmer.search("counter")
 *   BadgeFarmer.stop()
 *   BadgeFarmer.status
 */
(() => {
    const API = "https://discord.com/api/v9";
    const SCIENCE = `${API}/science`;
    const DETECTABLE = "https://discord.com/api/v10/applications/detectable";

    const MIN_DURATION_MS = 60_000;
    const MAX_SESSION_MS = 24 * 60 * 60 * 1_000;
    const BATCH_SIZE = 8;
    const REQUEST_DELAY_MS = 700;
    const RETRY_DELAY_MS = 3_000;
    const MAX_FAILED_BATCHES = 5;
    const STREAM_TICK_MS = 10_000;
    const MAX_TICK_DELTA_MS = STREAM_TICK_MS * 3;

    const state = {
        token: "",
        analyticsToken: "",
        analyticsFetchedAt: 0,
        sequence: Math.floor(Math.random() * 100_000),
        heartbeatSessionId: crypto.randomUUID(),
        launchSignature: crypto.randomUUID(),
        running: false,
        mode: "IDLE",
        creditedHours: 0,
        gamesCredited: 0,
        streamHours: 0,
        streamViewers: null,
        errors: 0,
        lastError: null,
        abort: null,
        catalogue: null
    };

    const log = (msg, ok = true) =>
        console.log(`%c[BadgeFarmer] ${msg}`, `color:${ok ? "#57f287" : "#f23f43"};font-weight:bold`);

    function wait(ms, signal) {
        if (ms <= 0 || signal?.aborted) return Promise.resolve();
        return new Promise(resolve => {
            const onAbort = () => { clearTimeout(timer); resolve(); };
            const timer = setTimeout(() => { signal?.removeEventListener("abort", onAbort); resolve(); }, ms);
            signal?.addEventListener("abort", onAbort, { once: true });
        });
    }

    function getWebpackExports() {
        const out = [];
        try {
            const w = typeof window !== "undefined" ? window : globalThis;
            if (!w?.webpackChunkdiscord_app?.push) return out;
            w.webpackChunkdiscord_app.push([[Symbol()], {}, req => {
                for (const mod of Object.values(req.c)) {
                    if (mod?.exports) out.push(mod.exports);
                }
            }]);
        } catch { /* ignore */ }
        return out;
    }

    function findStore(name) {
        for (const exp of getWebpackExports()) {
            const candidates = [exp, exp?.default, exp?.Z, exp?.ZP];
            for (const c of candidates) {
                if (c?.getName?.() === name) return c;
            }
        }
        return null;
    }

    function findToken() {
        for (const exp of getWebpackExports()) {
            const token = exp?.getToken?.() ?? exp?.default?.getToken?.();
            if (typeof token === "string" && token.length > 20) return token;
        }
        throw new Error('Could not find your session token. Set it with: BadgeFarmer.token = "..."');
    }

    function headers() {
        return {
            authorization: state.token,
            "content-type": "application/json"
        };
    }

    function ensureAuth() {
        if (state.token) return;
        state.token = findToken();
        log("Found session token");
    }

    async function ensureAnalyticsToken() {
        const fresh = state.analyticsToken && (Date.now() - state.analyticsFetchedAt < 12 * 3_600_000);
        if (fresh) return state.analyticsToken;

        const res = await fetch(`${API}/users/@me?with_analytics_token=true`, { headers: headers() });
        if (!res.ok) throw new Error(`HTTP ${res.status} fetching analytics token`);
        const body = await res.json();
        if (typeof body?.analytics_token !== "string" || body.analytics_token === "") {
            throw new Error("Discord returned no analytics_token. Turn on personalization under Data & Privacy.");
        }
        state.analyticsToken = body.analytics_token;
        state.analyticsFetchedAt = Date.now();
        return state.analyticsToken;
    }

    async function postScience(events) {
        const token = await ensureAnalyticsToken();
        const res = await fetch(SCIENCE, {
            method: "POST",
            headers: headers(),
            body: JSON.stringify({ token, events })
        });
        if (res.ok || res.status === 204) return;

        if (res.status === 401 || res.status === 403) {
            state.analyticsToken = "";
            state.analyticsFetchedAt = 0;
        }

        let retryAfter = Number(res.headers.get("retry-after"));
        let message = `HTTP ${res.status}`;
        try {
            const body = await res.json();
            if (typeof body?.retry_after === "number") retryAfter = body.retry_after;
            if (typeof body?.message === "string") message = body.message;
        } catch { /* ignore non-JSON body */ }

        const err = new Error(message);
        err.status = res.status;
        err.retryAfter = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null;
        throw err;
    }

    function executableFor(app) {
        const list = Array.isArray(app.executables) ? app.executables : [];
        const pick = list.find(e => e.os === "win32" && !e.is_launcher && !e.isLauncher)
            ?? list.find(e => e.os === "win32")
            ?? list[0];
        const fallback = `${app.name.replace(/[<>:"/\\|?*]/g, "").trim() || "game"}.exe`;
        const cleaned = pick?.name?.replace(/^>/, "").replace(/^.*[\\/]/, "").trim();
        return cleaned || fallback;
    }

    function normalizeApps(raw) {
        if (!Array.isArray(raw)) return [];
        const seen = new Set();
        const out = [];
        for (const item of raw) {
            if (!item || typeof item.id !== "string" || typeof item.name !== "string") continue;
            const name = item.name.trim();
            if (!name || seen.has(item.id)) continue;
            seen.add(item.id);
            out.push({
                id: item.id,
                name,
                aliases: Array.isArray(item.aliases) ? item.aliases.filter(a => typeof a === "string") : [],
                exeName: executableFor(item)
            });
        }
        return out;
    }

    async function loadCatalogue() {
        if (Array.isArray(state.catalogue) && state.catalogue.length > 0) return state.catalogue;

        const gameStore = findStore("GameStore");
        if (gameStore?.games?.length) {
            const local = normalizeApps(gameStore.games);
            if (local.length > 0) {
                state.catalogue = local;
                return local;
            }
        }

        const res = await fetch(DETECTABLE);
        if (!res.ok) throw new Error(`HTTP ${res.status} loading game catalog`);
        const apps = normalizeApps(await res.json());
        if (apps.length === 0) throw new Error("Discord returned an empty game catalog.");
        state.catalogue = apps;
        return apps;
    }

    function buildSessionEvents(game, durationMs, startedAt, sendAt) {
        const clamped = Math.min(Math.max(Math.floor(durationMs), MIN_DURATION_MS), MAX_SESSION_MS);
        const start = Math.min(Math.max(Math.floor(startedAt), sendAt - MAX_SESSION_MS), sendAt - MIN_DURATION_MS);
        const end = Math.min(start + clamped, sendAt);
        const actual = Math.max(end - start, MIN_DURATION_MS);
        const sessionId = crypto.randomUUID();

        const shared = {
            client_heartbeat_session_id: state.heartbeatSessionId,
            launch_signature: state.launchSignature,
            client_app_state: "focused",
            client_send_timestamp: sendAt
        };

        return {
            actual,
            events: [
                {
                    type: "launch_game",
                    properties: {
                        ...shared,
                        client_track_timestamp: start,
                        event_sequence_number: ++state.sequence,
                        game: game.name,
                        game_id: game.id,
                        verified: true,
                        elevated: false,
                        is_launcher: false,
                        game_platform: "desktop",
                        detection_method: "verified_game",
                        activity_status_enabled: true,
                        game_detection_enabled: true,
                        executable_path: game.exeName
                    }
                },
                {
                    type: "running_game_heartbeat",
                    properties: {
                        ...shared,
                        client_track_timestamp: start,
                        event_sequence_number: ++state.sequence,
                        game_id: game.id,
                        game_name: game.name,
                        game_executable: game.exeName,
                        game_detection_enabled: true,
                        initial_heartbeat: true,
                        final_heartbeat: false,
                        game_session_id: sessionId,
                        duration_tracked_ms: 0
                    }
                },
                {
                    type: "running_game_heartbeat",
                    properties: {
                        ...shared,
                        client_track_timestamp: end,
                        event_sequence_number: ++state.sequence,
                        game_id: game.id,
                        game_name: game.name,
                        game_executable: game.exeName,
                        game_detection_enabled: true,
                        initial_heartbeat: false,
                        final_heartbeat: true,
                        game_session_id: sessionId,
                        duration_tracked_ms: actual
                    }
                }
            ]
        };
    }

    async function sendBatchWithRetry(sessions, signal) {
        let maxAttempts = 3;
        for (let attempt = 1; attempt <= maxAttempts && !signal.aborted; attempt++) {
            const sendAt = Date.now();
            const events = [];
            let creditedMs = 0;
            for (const s of sessions) {
                const built = buildSessionEvents(s.game, s.durationMs, s.startedAt, sendAt);
                events.push(...built.events);
                creditedMs += built.actual;
            }
            try {
                await postScience(events);
                return { ok: true, creditedMs, count: sessions.length };
            } catch (err) {
                state.errors++;
                state.lastError = err.message;
                if (err.status === 429 && maxAttempts < 5) maxAttempts = 5;
                log(`Batch failed (attempt ${attempt}/${maxAttempts}): ${err.message}`, false);
                if (attempt < maxAttempts) {
                    const delay = err.retryAfter
                        ? Math.min(Math.ceil(err.retryAfter * 1_000) + 250, 30_000)
                        : RETRY_DELAY_MS * attempt;
                    await wait(delay, signal);
                }
            }
        }
        return { ok: false, creditedMs: 0, count: 0 };
    }

    function nextSlot(cursorRef, durationMs) {
        const now = Date.now();
        const floor = now - MAX_SESSION_MS;
        if (durationMs >= MAX_SESSION_MS) {
            cursorRef.value = floor;
            return floor;
        }
        if (cursorRef.value - durationMs < floor) {
            cursorRef.value = now - Math.floor(Math.random() * 30_000);
        }
        cursorRef.value -= durationMs;
        return Math.max(cursorRef.value, floor);
    }

    function begin(mode) {
        if (state.running) throw new Error("A run is active. Call BadgeFarmer.stop() first.");
        state.running = true;
        state.mode = mode;
        state.errors = 0;
        state.lastError = null;
        state.abort = new AbortController();
        return state.abort.signal;
    }

    function finish() {
        state.running = false;
        state.mode = "IDLE";
        state.abort = null;
    }

    async function runGameTime(app, hours, chunkHours, signal) {
        const targetMs = Math.round(Math.max(0.1, hours) * 3_600_000);
        const chunkMs = Math.min(Math.max(1, Math.floor(chunkHours)), 24) * 3_600_000;
        const cursorRef = { value: Date.now() };
        let creditedMs = 0;
        let failures = 0;
        state.creditedHours = 0;

        log(`Game Time: ${hours}h on ${app.name} (${chunkMs / 3_600_000}h sessions, ${BATCH_SIZE} per batch)`);

        while (!signal.aborted && targetMs - creditedMs >= MIN_DURATION_MS) {
            const batch = [];
            let planned = creditedMs;
            while (batch.length < BATCH_SIZE && targetMs - planned >= MIN_DURATION_MS) {
                const slice = Math.min(chunkMs, targetMs - planned);
                if (slice < MIN_DURATION_MS) break;
                batch.push({ game: app, durationMs: slice, startedAt: nextSlot(cursorRef, slice) });
                planned += slice;
            }
            if (batch.length === 0) break;

            const result = await sendBatchWithRetry(batch, signal);
            if (signal.aborted) return false;
            if (!result.ok) {
                if (++failures >= MAX_FAILED_BATCHES) {
                    log(`Stopped after ${MAX_FAILED_BATCHES} failed batches in a row.`, false);
                    return false;
                }
                continue;
            }
            failures = 0;
            creditedMs += result.creditedMs;
            state.creditedHours = Math.round((Math.min(creditedMs, targetMs) / 3_600_000) * 10) / 10;
            log(`${state.creditedHours}/${hours}h sent`);
            if (targetMs - creditedMs >= MIN_DURATION_MS) await wait(REQUEST_DELAY_MS, signal);
        }

        const done = !signal.aborted && targetMs - creditedMs < MIN_DURATION_MS;
        if (done) log(`Game Time done: ${state.creditedHours}h sent. Discord updates badges overnight.`);
        return done;
    }

    async function runVariety(games, minutesPerGame, signal) {
        const sessionMs = Math.min(MAX_SESSION_MS, Math.max(MIN_DURATION_MS, Math.floor(minutesPerGame * 60_000)));
        const cursorRef = { value: Date.now() };
        let failures = 0;
        state.gamesCredited = 0;

        log(`Variety: ${games.length} games, ${minutesPerGame} min each (${BATCH_SIZE} per batch)`);

        for (let i = 0; i < games.length; i += BATCH_SIZE) {
            if (signal.aborted) return false;
            const batch = games.slice(i, i + BATCH_SIZE).map(game => ({
                game,
                durationMs: sessionMs,
                startedAt: nextSlot(cursorRef, sessionMs)
            }));

            const result = await sendBatchWithRetry(batch, signal);
            if (signal.aborted) return false;
            if (!result.ok) {
                if (++failures >= MAX_FAILED_BATCHES) {
                    log(`Stopped after ${MAX_FAILED_BATCHES} failed batches in a row.`, false);
                    return false;
                }
                continue;
            }
            failures = 0;
            state.gamesCredited += result.count;
            log(`${state.gamesCredited}/${games.length} games sent`);
            if (i + BATCH_SIZE < games.length) await wait(REQUEST_DELAY_MS, signal);
        }

        const done = !signal.aborted && state.gamesCredited >= games.length;
        if (done) log(`Variety done: ${state.gamesCredited} games sent. Discord updates badges overnight.`);
        return done;
    }

    async function runStreamMonitor(hours, signal) {
        const streamingStore = findStore("ApplicationStreamingStore");
        if (!streamingStore?.getCurrentUserActiveStream) {
            log("Streaming requires Discord desktop with an active Go Live broadcast and at least one viewer. Fake telemetry earns nothing.", false);
            return false;
        }

        const targetMs = Math.round(Math.max(0.1, hours) * 3_600_000);
        let liveMs = 0;
        let lastTick = Date.now();
        let warnedNoStream = false;
        let warnedNoViewers = false;
        state.streamHours = 0;

        log(`Streaming: tracking ${hours}h. Start Go Live in a voice channel with at least one viewer watching.`);

        while (!signal.aborted && liveMs < targetMs) {
            const now = Date.now();
            const delta = Math.min(Math.max(0, now - lastTick), MAX_TICK_DELTA_MS);
            lastTick = now;

            const stream = streamingStore.getCurrentUserActiveStream();
            if (!stream) {
                state.streamViewers = null;
                if (!warnedNoStream) {
                    log("No active Go Live stream detected. Start Go Live in a voice channel.", false);
                    warnedNoStream = true;
                }
            } else {
                warnedNoStream = false;
                const key = stream.guildId != null
                    ? `guild:${stream.guildId}:${stream.channelId}:${stream.ownerId}`
                    : `call:${stream.channelId}:${stream.ownerId}`;
                const viewers = streamingStore.getViewerIds?.(key)?.length ?? 0;
                state.streamViewers = viewers;

                if (viewers > 0) {
                    warnedNoViewers = false;
                    liveMs += delta;
                    state.streamHours = Math.round((Math.min(liveMs, targetMs) / 3_600_000) * 100) / 100;
                } else if (!warnedNoViewers) {
                    log("Waiting for a viewer. Have another account watch your stream so hours count.", false);
                    warnedNoViewers = true;
                }
            }

            await wait(Math.min(STREAM_TICK_MS, Math.max(1_000, targetMs - liveMs)), signal);
        }

        const done = !signal.aborted && liveMs >= targetMs;
        if (done) log(`Streaming done: ${hours}h tracked. Give Discord up to 48 hours to update the badge.`);
        return done;
    }

    function pickRandom(apps, count) {
        const pool = [...apps];
        const take = Math.min(Math.max(0, Math.floor(count)), pool.length);
        for (let i = 0; i < take; i++) {
            const j = i + Math.floor(Math.random() * (pool.length - i));
            [pool[i], pool[j]] = [pool[j], pool[i]];
        }
        return pool.slice(0, take);
    }

    function rankSearch(apps, query) {
        const needle = query.trim().toLowerCase();
        if (!needle) return [];
        const matches = apps.filter(app =>
            app.name.toLowerCase().includes(needle)
            || app.aliases.some(alias => alias.toLowerCase().includes(needle)));
        matches.sort((a, b) => {
            const al = a.name.toLowerCase();
            const bl = b.name.toLowerCase();
            return (Number(bl === needle) - Number(al === needle))
                || (Number(bl.startsWith(needle)) - Number(al.startsWith(needle)))
                || (a.name.length - b.name.length)
                || a.name.localeCompare(b.name);
        });
        return matches.slice(0, 20);
    }

    const BadgeFarmer = {
        get token() { return state.token; },
        set token(value) { state.token = typeof value === "string" ? value.trim() : ""; },
        get status() {
            return {
                running: state.running,
                mode: state.mode,
                hours: state.creditedHours,
                games: state.gamesCredited,
                streamHours: state.streamHours,
                streamViewers: state.streamViewers,
                errors: state.errors,
                lastError: state.lastError
            };
        },

        stop() {
            if (!state.running) return;
            state.abort?.abort();
            log("Stopping run...");
        },

        async search(name) {
            if (typeof name !== "string" || name.trim() === "") return [];
            const apps = await loadCatalogue();
            return rankSearch(apps, name);
        },

        async gameTime(name, hours = 5_000, chunkHours = 24) {
            ensureAuth();
            const matches = await this.search(name);
            const app = matches[0];
            if (!app) throw new Error(`No game matched "${name}".`);
            const signal = begin("GAME_TIME");
            try {
                await runGameTime(app, hours, chunkHours, signal);
            } finally {
                finish();
            }
        },

        async variety(minutesPerGame = 2, count = 100) {
            ensureAuth();
            const apps = await loadCatalogue();
            const signal = begin("VARIETY");
            try {
                await runVariety(pickRandom(apps, count), minutesPerGame, signal);
            } finally {
                finish();
            }
        },

        async stream(hours = 1) {
            const signal = begin("STREAM");
            try {
                await runStreamMonitor(hours, signal);
            } finally {
                finish();
            }
        },

        async maxAll() {
            ensureAuth();
            const apps = await loadCatalogue();
            const pool = pickRandom(apps, 100);
            if (pool.length === 0) throw new Error("Game catalog is empty.");
            const signal = begin("MAX_ALL");
            try {
                const ok = await runVariety(pool, 2, signal);
                if (!ok || signal.aborted) return;
                await runGameTime(pool[0], 5_000, 24, signal);
            } finally {
                finish();
            }
        }
    };

    if (typeof window !== "undefined") window.BadgeFarmer = BadgeFarmer;
    else globalThis.BadgeFarmer = BadgeFarmer;

    log('Loaded. Try BadgeFarmer.gameTime("Dota 2", 5000), .variety(), .stream(1), .maxAll(), .stop(), .status');
    return BadgeFarmer;
})();
