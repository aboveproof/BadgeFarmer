/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * BadgeFarmer Console Edition (desktop and browser DevTools)
 *
 * Commands:
 *   BadgeFarmer.gameTime(5000, 20)        // Spread 5,000h across 250 Windows games (~9s)
 *   BadgeFarmer.gameTime("Dota 2", 24)    // Single game (Discord caps ~24h/day per title)
 *   BadgeFarmer.variety(5, 100)           // 100 fresh Windows games, 5 min each
 *   BadgeFarmer.stream(1)                 // Low-power Go Live farm on desktop
 *   BadgeFarmer.watch()                   // Alt viewer auto-watch & unpause keepalive
 *   BadgeFarmer.maxAll()                  // Unlocks Eternal + Universalist in one pass
 *   BadgeFarmer.badges()                  // Inspect equipped profile badges
 *   BadgeFarmer.search("counter")
 *   BadgeFarmer.stop()
 *   BadgeFarmer.status
 */
(() => {
    function apiOrigin() {
        try {
            const { origin, hostname } = location;
            if (hostname === "discord.com" || hostname.endsWith(".discord.com") || hostname.endsWith(".discordapp.com")) {
                return origin;
            }
        } catch { /* ignore */ }
        return "https://discord.com";
    }

    const ORIGIN = apiOrigin();
    const API = `${ORIGIN}/api/v9`;
    const SCIENCE = `${API}/science`;
    const DETECTABLE_URLS = [
        `${ORIGIN}/api/v10/applications/detectable`,
        "https://cdn.discordapp.com/detectables/games.json"
    ];

    const MIN_DURATION_MS = 60_000;
    const MAX_SESSION_MS = 24 * 60 * 60 * 1_000;
    const BATCH_SIZE = 20;
    const REQUEST_DELAY_MS = 550;
    const RETRY_DELAY_MS = 3_000;
    const MAX_FAILED_BATCHES = 5;
    const STREAM_TICK_MS = 8_000;
    const VIEWER_TICK_MS = 4_000;
    const STREAM_CHECKPOINT_MS = 2 * 60 * 60 * 1_000;
    const MAX_TICK_DELTA_MS = STREAM_TICK_MS * 3;
    const STORAGE_USED_KEY = "bf_used_games_v1";

    const USER_AGENT =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) discord/1.0.9253 Chrome/148.0.7778.280 Electron/42.7.1 Safari/537.36";

    const state = {
        token: "",
        userId: "",
        analyticsToken: "",
        analyticsFetchedAt: 0,
        sequence: Math.floor(Math.random() * 10_000),
        heartbeatSessionId: crypto.randomUUID(),
        launchSignature: crypto.randomUUID(),
        clientLaunchId: crypto.randomUUID(),
        superProps: "",
        running: false,
        mode: "IDLE",
        creditedHours: 0,
        gamesCredited: 0,
        streamHours: 0,
        streamViewers: null,
        watchingOwner: null,
        errors: 0,
        lastError: null,
        abort: null,
        catalogue: null,
        savedStreamSettings: null
    };

    const log = (msg, ok = true) =>
        console.log(`%c[BadgeFarmer] ${msg}`, `color:${ok ? "#57f287" : "#f23f43"};font-weight:bold`);

    function encodeBase64Utf8(text) {
        const bytes = new TextEncoder().encode(text);
        let binary = "";
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        return btoa(binary);
    }

    function buildSuperProps() {
        if (state.superProps) return state.superProps;
        const props = {
            os: "Windows",
            browser: "Discord Client",
            release_channel: "stable",
            client_version: "1.0.9253",
            os_version: "10.0.26200",
            os_arch: "x64",
            app_arch: "x64",
            system_locale: navigator.language || "en-US",
            has_client_mods: false,
            browser_user_agent: USER_AGENT,
            browser_version: "42.7.1",
            os_sdk_version: "26200",
            client_build_number: 594031,
            native_build_number: 88414,
            client_event_source: null,
            client_app_state: "focused",
            client_launch_id: state.clientLaunchId,
            launch_signature: state.launchSignature,
            client_heartbeat_session_id: state.heartbeatSessionId
        };
        state.superProps = encodeBase64Utf8(JSON.stringify(props));
        return state.superProps;
    }

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
            for (const c of [exp, exp?.default, exp?.Z, exp?.ZP]) {
                if (c?.getName?.() === name) return c;
            }
        }
        return null;
    }

    function findDispatcher() {
        for (const exp of getWebpackExports()) {
            for (const c of [exp, exp?.default, exp?.Z, exp?.ZP]) {
                if (typeof c?.dispatch === "function" && typeof c?.subscribe === "function") return c;
            }
        }
        return null;
    }

    function findFnByCode(snippet) {
        for (const exp of getWebpackExports()) {
            if (typeof exp === "function" && String(exp).includes(snippet)) return exp;
            if (exp && typeof exp === "object") {
                for (const val of Object.values(exp)) {
                    if (typeof val === "function" && String(val).includes(snippet)) return val;
                }
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
            "content-type": "application/json",
            "x-discord-locale": navigator.language || "en-US",
            "x-super-properties": buildSuperProps()
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
        state.userId = typeof body?.id === "string" ? body.id : "";
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

    function normalizeApps(raw) {
        if (!Array.isArray(raw)) return [];
        const seen = new Set();
        const out = [];
        for (const item of raw) {
            if (!item || typeof item.id !== "string" || typeof item.name !== "string") continue;
            const id = item.id.trim();
            const name = item.name.trim();
            if (!/^\d+$/.test(id) || !name || seen.has(id) || !Array.isArray(item.executables)) continue;

            const winExes = item.executables.filter(
                e => e && e.os === "win32" && typeof e.name === "string" && e.name.replace(/^>/, "").trim() !== ""
            );
            if (winExes.length === 0) continue;
            seen.add(id);

            const pick = winExes.find(e => !e.is_launcher && !e.isLauncher) ?? winExes[0];
            out.push({
                id,
                name,
                aliases: Array.isArray(item.aliases) ? item.aliases.filter(a => typeof a === "string") : [],
                exeName: pick.name.replace(/^>/, "").trim()
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

        let lastErr = null;
        for (const url of DETECTABLE_URLS) {
            try {
                const res = await fetch(url);
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const apps = normalizeApps(await res.json());
                if (apps.length > 0) {
                    state.catalogue = apps;
                    return apps;
                }
            } catch (err) {
                lastErr = err;
            }
        }
        throw lastErr ?? new Error("Discord returned an empty game catalog.");
    }

    function readUsedIds() {
        try {
            const raw = localStorage.getItem(STORAGE_USED_KEY);
            const parsed = raw ? JSON.parse(raw) : [];
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }

    function writeUsedIds(ids) {
        try {
            localStorage.setItem(STORAGE_USED_KEY, JSON.stringify(ids.slice(-15_000)));
        } catch { /* ignore */ }
    }

    function shuffled(items) {
        const pool = [...items];
        for (let i = pool.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [pool[i], pool[j]] = [pool[j], pool[i]];
        }
        return pool;
    }

    function selectFreshGames(apps, count) {
        const desired = Math.min(Math.max(1, Math.floor(count)), apps.length);
        const usedList = readUsedIds();
        const usedSet = new Set(usedList);
        const chosen = shuffled(apps.filter(a => !usedSet.has(a.id))).slice(0, desired);

        if (chosen.length < desired) {
            const byId = new Map(apps.map(a => [a.id, a]));
            const chosenIds = new Set(chosen.map(a => a.id));
            for (const gid of usedList) {
                const found = byId.get(gid);
                if (found && !chosenIds.has(found.id)) {
                    chosen.push(found);
                    chosenIds.add(found.id);
                    if (chosen.length >= desired) break;
                }
            }
        }

        return chosen;
    }

    function recordUsedIds(gameIds) {
        if (!gameIds.length) return;
        const usedList = readUsedIds();
        const pickedSet = new Set(gameIds);
        writeUsedIds([...usedList.filter(id => !pickedSet.has(id)), ...gameIds]);
    }

    function buildSessionEvents(game, durationMs, startedAt, now, index) {
        const duration = Math.min(Math.max(Math.floor(durationMs), MIN_DURATION_MS), MAX_SESSION_MS);
        const jitter = index * 400 + Math.floor(Math.random() * 350);
        const end = startedAt != null
            ? Math.min(Math.max(Math.floor(startedAt) + duration, now - MAX_SESSION_MS + MIN_DURATION_MS), now)
            : Math.max(MIN_DURATION_MS, now - jitter);
        const start = Math.max(0, end - duration);
        const openBeatTs = Math.min(end, start + 50);
        const sessionId = crypto.randomUUID();
        const locale = navigator.language || "en-US";

        const shared = {
            client_heartbeat_session_id: state.heartbeatSessionId,
            launch_signature: state.launchSignature,
            client_app_state: "focused",
            client_send_timestamp: now
        };

        return {
            actual: duration,
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
                        is_overlay_enabled: false,
                        is_overlay_game_enabled: true,
                        is_overlay_game_source: "OOP_DEFAULT_DATABASE",
                        fullscreen_type: "UNKNOWN",
                        hardware_display_count: 1,
                        overlay_method: "Disabled",
                        activity_status_enabled: true,
                        activity_status_shared_guilds: [],
                        current_user_status: "online",
                        game_detection_enabled: true,
                        executable_path: game.exeName,
                        voice_channel_id: null,
                        voice_channel_type: null,
                        voice_channel_bitrate: null,
                        voice_channel_guild_id: null,
                        hidden_by_distributor: false,
                        game_metadata: null,
                        client_performance_cpu: null,
                        client_performance_memory: null,
                        cpu_core_count: null,
                        accessibility_features: 0,
                        rendered_locale: locale,
                        client_rtc_state: null
                    }
                },
                {
                    type: "running_game_heartbeat",
                    properties: {
                        ...shared,
                        client_track_timestamp: openBeatTs,
                        event_sequence_number: ++state.sequence,
                        game_id: game.id,
                        game_name: game.name,
                        game_metadata: null,
                        game_executable: game.exeName,
                        game_detection_enabled: true,
                        initial_heartbeat: true,
                        final_heartbeat: false,
                        game_session_id: sessionId,
                        duration_tracked_ms: 0,
                        rtc_connection_id: null,
                        media_session_id: null
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
                        game_metadata: null,
                        game_executable: game.exeName,
                        game_detection_enabled: true,
                        initial_heartbeat: false,
                        final_heartbeat: true,
                        game_session_id: sessionId,
                        duration_tracked_ms: duration,
                        rtc_connection_id: null,
                        media_session_id: null
                    }
                }
            ]
        };
    }

    async function sendBatchWithRetry(sessions, signal) {
        let maxAttempts = 3;
        for (let attempt = 1; attempt <= maxAttempts && !signal.aborted; attempt++) {
            const now = Date.now();
            const events = [];
            let creditedMs = 0;
            for (let idx = 0; idx < sessions.length; idx++) {
                const s = sessions[idx];
                const built = buildSessionEvents(s.game, s.durationMs, s.startedAt, now, idx);
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
        state.watchingOwner = null;
        state.abort = new AbortController();
        return state.abort.signal;
    }

    function finish() {
        state.running = false;
        state.mode = "IDLE";
        state.watchingOwner = null;
        state.abort = null;
    }

    async function runSpreadGameTime(apps, totalHours, hoursPerGame, signal) {
        const perGame = Math.min(Math.max(1, Math.floor(hoursPerGame)), 24);
        const perGameMs = perGame * 3_600_000;
        const effectiveHours = Math.min(Math.max(1, totalHours), apps.length * perGame);
        const targetMs = Math.round(effectiveHours * 3_600_000);
        const needed = Math.min(apps.length, Math.max(1, Math.ceil(targetMs / perGameMs)));
        const pool = selectFreshGames(apps, needed);

        let creditedMs = 0;
        let failures = 0;
        state.creditedHours = 0;
        state.gamesCredited = 0;

        log(`Game Time (spread): ${effectiveHours}h across ${pool.length} Windows games (${perGame}h each)`);

        for (let i = 0; i < pool.length && !signal.aborted && targetMs - creditedMs >= MIN_DURATION_MS; i += BATCH_SIZE) {
            const batch = [];
            let planned = creditedMs;
            for (const game of pool.slice(i, i + BATCH_SIZE)) {
                const rem = targetMs - planned;
                if (rem < MIN_DURATION_MS) break;
                const dur = Math.max(MIN_DURATION_MS, Math.min(perGameMs, rem));
                batch.push({ game, durationMs: dur });
                planned += dur;
            }
            if (batch.length === 0) break;

            const result = await sendBatchWithRetry(batch, signal);
            if (signal.aborted) return false;
            if (!result.ok) {
                if (++failures >= MAX_FAILED_BATCHES) {
                    log(`Stopped after ${MAX_FAILED_BATCHES} failed batches in a row.`, false);
                    return false;
                }
                await wait(RETRY_DELAY_MS, signal);
                i -= BATCH_SIZE;
                continue;
            }
            failures = 0;
            recordUsedIds(batch.map(entry => entry.game.id));
            creditedMs += result.creditedMs;
            state.gamesCredited += result.count;
            state.creditedHours = Math.round((Math.min(creditedMs, targetMs) / 3_600_000) * 10) / 10;
            log(`${state.creditedHours}/${effectiveHours}h sent (${state.gamesCredited}/${pool.length} games)`);
            if (i + BATCH_SIZE < pool.length && targetMs - creditedMs >= MIN_DURATION_MS) {
                await wait(REQUEST_DELAY_MS, signal);
            }
        }

        const done = !signal.aborted && targetMs - creditedMs < MIN_DURATION_MS;
        if (done) log(`Done: ${state.creditedHours}h across ${state.gamesCredited} games. Discord syncs badges in 24 to 48 hours.`);
        return done;
    }

    async function runSingleGameTime(app, hours, chunkHours, signal) {
        const targetMs = Math.round(Math.max(0.1, hours) * 3_600_000);
        const chunkMs = Math.min(Math.max(1, Math.floor(chunkHours)), 24) * 3_600_000;
        const cursorRef = { value: Date.now() };
        let creditedMs = 0;
        let failures = 0;
        state.creditedHours = 0;

        if (hours > 24) {
            log("Note: Discord caps playtime per single game at ~24h/day. Use BadgeFarmer.gameTime(5000) to spread across games.", false);
        }
        log(`Game Time (single): ${hours}h on ${app.name}`);

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
                await wait(RETRY_DELAY_MS, signal);
                continue;
            }
            failures = 0;
            creditedMs += result.creditedMs;
            state.creditedHours = Math.round((Math.min(creditedMs, targetMs) / 3_600_000) * 10) / 10;
            log(`${state.creditedHours}/${hours}h sent`);
            if (targetMs - creditedMs >= MIN_DURATION_MS) await wait(REQUEST_DELAY_MS, signal);
        }

        const done = !signal.aborted && targetMs - creditedMs < MIN_DURATION_MS;
        if (done) log(`Done: ${state.creditedHours}h sent on ${app.name}.`);
        return done;
    }

    async function runVariety(games, minutesPerGame, signal) {
        const sessionMs = Math.min(MAX_SESSION_MS, Math.max(MIN_DURATION_MS, Math.floor(minutesPerGame * 60_000)));
        const cursorRef = { value: Date.now() };
        let failures = 0;
        state.gamesCredited = 0;

        log(`Variety: ${games.length} Windows games, ${minutesPerGame} min each (${BATCH_SIZE} per batch)`);

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
                await wait(RETRY_DELAY_MS, signal);
                i -= BATCH_SIZE;
                continue;
            }
            failures = 0;
            recordUsedIds(batch.map(entry => entry.game.id));
            state.gamesCredited += result.count;
            log(`${state.gamesCredited}/${games.length} games sent`);
            if (i + BATCH_SIZE < games.length) await wait(REQUEST_DELAY_MS, signal);
        }

        const done = !signal.aborted && state.gamesCredited >= games.length;
        if (done) log(`Variety done: ${state.gamesCredited} games sent. Discord syncs badges in 24 to 48 hours.`);
        return done;
    }

    function streamKeyOf(s) {
        return s.guildId != null
            ? `guild:${s.guildId}:${s.channelId}:${s.ownerId}`
            : `call:${s.channelId}:${s.ownerId}`;
    }

    async function runStreamFarm(hours, opts, signal) {
        const dispatcher = findDispatcher();
        const streamingStore = findStore("ApplicationStreamingStore");
        const streamSettingsStore = findStore("ApplicationStreamingSettingsStore");
        const selectedStore = findStore("SelectedChannelStore");
        const channelStore = findStore("ChannelStore");
        const rtcStore = findStore("RTCConnectionStore");
        const mediaStore = findStore("MediaEngineStore");
        const startStreamFn = findFnByCode('type:"STREAM_START"');
        const stopStreamFn = findFnByCode('type:"STREAM_STOP"');
        const getSourcesFn = findFnByCode("desktop sources");

        if (!streamingStore?.getCurrentUserActiveStream || !dispatcher) {
            log("Streaming requires Discord desktop with an active Go Live broadcast and a viewer.", false);
            return false;
        }

        const lowPower = opts?.lowPower !== false;
        const checkpoint = opts?.checkpoint === true;
        const targetMs = Math.round(Math.max(0.1, hours) * 3_600_000);
        let liveMs = 0;
        let lastTick = Date.now();
        let segmentStart = Date.now();
        let warnedNoViewers = false;
        let owns = false;
        state.streamHours = 0;

        if (lowPower && streamSettingsStore?.getState) {
            const cur = streamSettingsStore.getState();
            if (cur) state.savedStreamSettings = { preset: cur.preset, resolution: cur.resolution, fps: cur.fps };
            dispatcher.dispatch({ type: "STREAM_UPDATE_SETTINGS", preset: 3, resolution: 480, frameRate: 15 });
        }

        function cleanupStream() {
            try {
                if (owns && stopStreamFn) {
                    const active = streamingStore.getCurrentUserActiveStream();
                    if (active) stopStreamFn(streamKeyOf(active));
                }
            } catch { /* ignore */ }
            owns = false;
            if (state.savedStreamSettings) {
                const s = state.savedStreamSettings;
                state.savedStreamSettings = null;
                try {
                    dispatcher.dispatch({ type: "STREAM_UPDATE_SETTINGS", preset: s.preset, resolution: s.resolution, frameRate: s.fps });
                } catch { /* ignore */ }
            }
        }

        try {
            log(`Streaming: target ${hours}h. Keep at least one viewer watching (run BadgeFarmer.watch() on your alt).`);

            while (!signal.aborted && liveMs < targetMs) {
                const channelId = selectedStore?.getVoiceChannelId?.();
                const channel = channelId ? channelStore?.getChannel?.(channelId) : null;
                if (!channel) {
                    log("Join a voice channel before streaming.", false);
                    break;
                }

                const now = Date.now();
                if (rtcStore?.isConnected && !rtcStore.isConnected()) {
                    lastTick = now;
                    await wait(3_000, signal);
                    continue;
                }

                let stream = streamingStore.getCurrentUserActiveStream();
                if (!stream && startStreamFn && getSourcesFn && mediaStore?.getMediaEngine) {
                    try {
                        const engine = mediaStore.getMediaEngine();
                        const isWin = navigator.userAgent.includes("Windows");
                        const sources = getSourcesFn.length === 3
                            ? await getSourcesFn(engine, ["screen", "window"], null)
                            : await getSourcesFn(engine, isWin, ["screen", "window"], null);
                        const source = sources?.[0];
                        if (source) {
                            startStreamFn(channel.guild_id ?? null, channel.id, {
                                pid: null,
                                sourceId: source.id,
                                sourceName: source.name,
                                audioSourceId: null,
                                sound: false,
                                previewDisabled: lowPower
                            });
                            await wait(2_500, signal);
                            stream = streamingStore.getCurrentUserActiveStream();
                        }
                    } catch (err) {
                        log(`Auto-start Go Live failed (${err.message}). Click Go Live in Discord.`, false);
                    }
                }

                if (!stream) {
                    lastTick = Date.now();
                    await wait(5_000, signal);
                    continue;
                }

                owns = true;
                const key = streamKeyOf(stream);
                dispatcher.dispatch({ type: "STREAM_SET_PAUSED", streamKey: key, paused: false });

                const delta = Math.min(Math.max(0, now - lastTick), MAX_TICK_DELTA_MS);
                lastTick = now;
                const viewers = streamingStore.getViewerIds?.(key)?.length ?? 0;
                state.streamViewers = viewers;

                if (viewers > 0) {
                    warnedNoViewers = false;
                    liveMs += delta;
                    state.streamHours = Math.round((Math.min(liveMs, targetMs) / 3_600_000) * 100) / 100;
                } else if (!warnedNoViewers) {
                    log("Waiting for a viewer. Run BadgeFarmer.watch() in your alt's console.", false);
                    warnedNoViewers = true;
                }

                if (checkpoint && now - segmentStart >= STREAM_CHECKPOINT_MS && liveMs < targetMs) {
                    if (stopStreamFn) stopStreamFn(key);
                    segmentStart = Date.now();
                    await wait(2_500, signal);
                    lastTick = Date.now();
                    continue;
                }

                await wait(Math.min(STREAM_TICK_MS, Math.max(1_000, targetMs - liveMs)), signal);
            }
        } finally {
            cleanupStream();
        }

        const done = !signal.aborted && liveMs >= targetMs;
        if (done) log(`Streaming done: ${hours}h tracked. Give Discord up to 48 hours to update the badge.`);
        return done;
    }

    async function runViewerHelper(signal) {
        const dispatcher = findDispatcher();
        const streamingStore = findStore("ApplicationStreamingStore");
        const selectedStore = findStore("SelectedChannelStore");
        const userStore = findStore("UserStore");

        if (!dispatcher || !streamingStore || !selectedStore) {
            throw new Error("Discord voice/stream stores not found.");
        }

        const myId = userStore?.getCurrentUser?.()?.id;
        log("Viewer auto-watch active. Leave this account in the voice channel.");

        while (!signal.aborted) {
            const channelId = selectedStore.getVoiceChannelId?.();
            if (channelId) {
                const streams = streamingStore.getAllApplicationStreamsForChannel?.(channelId) ?? [];
                const target = streams.find(s => s.ownerId !== myId);
                if (target) {
                    const key = streamKeyOf(target);
                    const active = streamingStore.getActiveStreamForStreamKey?.(key);
                    if (!active) {
                        dispatcher.dispatch({ type: "STREAM_WATCH", streamKey: key, allowMultiple: true });
                    }
                    dispatcher.dispatch({ type: "STREAM_SET_PAUSED", streamKey: key, paused: false });
                    state.watchingOwner = target.ownerId;
                } else {
                    state.watchingOwner = null;
                }
            } else {
                state.watchingOwner = null;
            }
            await wait(VIEWER_TICK_MS, signal);
        }
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
                watchingOwner: state.watchingOwner,
                errors: state.errors,
                lastError: state.lastError
            };
        },

        stop() {
            if (!state.running) return;
            state.abort?.abort();
            log("Stopping run...");
        },

        async badges() {
            ensureAuth();
            await ensureAnalyticsToken();
            if (!state.userId) throw new Error("Could not resolve user ID.");
            const res = await fetch(`${API}/users/${state.userId}/profile?with_mutual_guilds=false&with_mutual_friends_count=false`, {
                headers: headers()
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            const list = Array.isArray(data?.badges) ? data.badges : [];
            log(list.length ? `Equipped badges: ${list.map(b => b.description || b.id).join(", ")}` : "No badges equipped yet.");
            return list;
        },

        async search(name) {
            if (typeof name !== "string" || name.trim() === "") return [];
            const apps = await loadCatalogue();
            return rankSearch(apps, name);
        },

        async gameTime(targetOrName = 5_000, hoursOrPerGame = 20, chunkHours = 24) {
            ensureAuth();
            const apps = await loadCatalogue();
            if (typeof targetOrName === "number") {
                const signal = begin("GAME_TIME");
                try {
                    await runSpreadGameTime(apps, targetOrName, hoursOrPerGame, signal);
                } finally {
                    finish();
                }
                return;
            }
            const matches = rankSearch(apps, String(targetOrName));
            const app = matches[0];
            if (!app) throw new Error(`No Windows game matched "${targetOrName}".`);
            const signal = begin("GAME_TIME");
            try {
                await runSingleGameTime(app, hoursOrPerGame, chunkHours, signal);
            } finally {
                finish();
            }
        },

        async variety(minutesPerGame = 5, count = 100) {
            ensureAuth();
            const apps = await loadCatalogue();
            const signal = begin("VARIETY");
            try {
                await runVariety(selectFreshGames(apps, count), minutesPerGame, signal);
            } finally {
                finish();
            }
        },

        async stream(hours = 1, opts = {}) {
            const signal = begin("STREAM");
            try {
                await runStreamFarm(hours, opts, signal);
            } finally {
                finish();
            }
        },

        async watch() {
            const signal = begin("VIEWER");
            try {
                await runViewerHelper(signal);
            } finally {
                finish();
            }
        },

        async maxAll() {
            ensureAuth();
            const apps = await loadCatalogue();
            const signal = begin("MAX_ALL");
            try {
                await runSpreadGameTime(apps, 5_000, 20, signal);
            } finally {
                finish();
            }
        }
    };

    if (typeof window !== "undefined") window.BadgeFarmer = BadgeFarmer;
    else globalThis.BadgeFarmer = BadgeFarmer;

    log("Loaded. Try BadgeFarmer.gameTime(5000), .variety(), .stream(1), .watch(), .badges(), .maxAll(), .stop()");
    return BadgeFarmer;
})();
