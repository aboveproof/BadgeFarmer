/*
Made with ❤️ by rico
I am not responsible for any damage caused by this plugin; use at your own risk
Vencord/Equicord does not endorse/support this plugin (Works with Equicord as well)
dm @wkcp if u need help or have any questions
https://github.com/aboveproof/BadgeFarmer
*/

/**
 * BadgeFarmer Console Edition (desktop and browser DevTools)
 *
 * Commands:
 *   BadgeFarmer.progress()                // Sync and display current tiers, hours, and remaining milestones
 *   BadgeFarmer.gameTime(5000, 20)        // Farm remaining hours up to 5,000h across unused Windows games
 *   BadgeFarmer.gameTime("Dota 2", 24)    // Single game (Discord caps ~24h/day per title)
 *   BadgeFarmer.variety(5, 100)           // Claim remaining unique Windows games up to 100
 *   BadgeFarmer.stream(20)                // Low-power Go Live farm up to target hours
 *   BadgeFarmer.watch()                   // Alt viewer auto-watch & unpause keepalive
 *   BadgeFarmer.maxAll()                  // Complete remaining Eternal + Universalist milestones
 *   BadgeFarmer.setBaseline({ time: 500, variety: 25, stream: 12 })
 *   BadgeFarmer.resetProgress()
 *   BadgeFarmer.stop()
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
    const STORAGE_LEDGER_PREFIX = "bf_ledger_v2_";

    const TIME_TIERS = [
        { level: 1, name: "Casual", at: 1, hash: "b75fcc4dd1c65dfd4169a203e21023453fd6fe853c9b5c1fd839781fda98e80d" },
        { level: 2, name: "Recreational", at: 5, hash: "f0f32cb2a0003475e443b76a7a2baf454356953ecb84195c7a08c3ce2fd95b70" },
        { level: 3, name: "Dedicated", at: 20, hash: "e0c82f41bcad94a2a52713800fbef7687d0d2c6a6066b09d5e5876156d086e1a" },
        { level: 4, name: "Committed", at: 75, hash: "16f2aeb7465c99efce4d67d9333e3ddcf7435d6e60d2f5f93dc0c07bc7c5a69b" },
        { level: 5, name: "Serious", at: 150, hash: "ba26e83fa68189b41837184e38706f41c288dd29ffba266035d1a5ad9adbae22" },
        { level: 6, name: "Devoted", at: 300, hash: "851b194288f1913ece6c8d99976519e48210580d6f42d994f21e37801611ad54" },
        { level: 7, name: "Seasoned", at: 500, hash: "8b10f5c0c30abbd521be5afc2e0dd4ec6da18bfbc689f06d93a51d06577cd84a" },
        { level: 8, name: "Ironclad", at: 1_000, hash: "d705628490898f2cc22d669cf8b415bc03fed1ddaf98a2a8cbd97442a509293c" },
        { level: 9, name: "Unshakeable", aliases: ["unshakable"], at: 2_000, hash: "2bddcbc9f9959dab805eb7196c8112ce9dc68b09766c8193ab499b1870e44ac7" },
        { level: 10, name: "Eternal", at: 5_000, hash: "457ce4e657f0ced23197891cc3d75b7de29cafa065cdb8cbb81060ac0e63b07f" }
    ];

    const VARIETY_TIERS = [
        { level: 1, name: "Sampler", at: 2, hash: "ed18d5976c01a4ea19f5a13af08f0547582405cbe48b098b0822e352b8e0a822" },
        { level: 2, name: "Dabbler", at: 5, hash: "e450d5279537db06ee47a104af520b884adaa7ffc3ef2627157526bf1c58e840" },
        { level: 3, name: "Enthusiast", at: 10, hash: "158a9d91b8ca9e96d4afeee38cd640fc51483a8196edb9af0c26e44727acafae" },
        { level: 4, name: "Ranger", at: 15, hash: "9e491942070007f64011ae4fc478926b96433698c07621fc43bafdd5efe83912" },
        { level: 5, name: "Explorer", at: 20, hash: "e25fc55814262150e154ddb1a2b55fc5ed8ed5ba2ff1a22a33d4a41e651e370a" },
        { level: 6, name: "Adventurer", at: 30, hash: "542d5277e0001ea738d5eb57b247dcab9ce6e0c29493d5892203f6258fde55b9" },
        { level: 7, name: "Voyager", at: 40, hash: "082e693cb9ce98b81af618978d449409efc6522b061bc0eac6e88a949fd888c6" },
        { level: 8, name: "Maverick", at: 60, hash: "6fc242e9e8259c471a5e4599cd09af5476e622a572ff235883173913bf506103" },
        { level: 9, name: "Polymath", at: 80, hash: "be9a4d119b8e0d7fc1df7e5a12081332637cb9c978a90377cb9c930500b2fbe6" },
        { level: 10, name: "Universalist", at: 100, hash: "fcc34d343451505c642f3397cec2669a2de3a4a410fb968f794b3a1a0dcd1728" }
    ];

    const STREAM_TIERS = [
        { level: 1, name: "Newcomer", at: 1, hash: "c56b451e3bf04181182c2529e9bd3659e569ea80f582858090007f0752401b38" },
        { level: 2, name: "Fledgling", at: 5, hash: "2e25ba794f6f371ea0f52eb2d3c8fb2b04094a56f388515e13a9bd6d7949a018" },
        { level: 3, name: "Breakout", at: 20, hash: "4e847b4dca20fbf1c56d3a47cac3c9204f02113c9d5a270ebebdf12909c75848" },
        { level: 4, name: "Standout", at: 75, hash: "27d0e6939f13dcf113243fc9eac642b15e9764ad891e06c5ed78d45a17678582" },
        { level: 5, name: "Trendsetter", at: 150, hash: "af681483be2035f14b0f2bfe2e25a8944c97149172938888ca1008edbe037aad" },
        { level: 6, name: "Headliner", at: 300, hash: "e69a0c86a476c9782ea1d3e7b5ba308eec3d9d6a3eae6ab8af3180f67d16b468" },
        { level: 7, name: "Star", at: 500, hash: "06b6206db966635cf626651bdb94eacce5a23ab05dc7f600f7d31aa482b2058c" },
        { level: 8, name: "Sensation", at: 1_000, hash: "1a3b9120ecd64c342083c37980b225d29ebf4544da6ab546c9268f87904c9dfe" },
        { level: 9, name: "Visionary", at: 2_000, hash: "85f714b90ed3ceb1e00e1f2069bf3ebd564962fa940c92540061537a045e54ab" },
        { level: 10, name: "Phenomenon", at: 5_000, hash: "61331d04b7a9542b38bfa59583360c0b9b93c6496a04f99c0ab37fa1d83ec58a" }
    ];

    const TRACK_TIERS = { time: TIME_TIERS, variety: VARIETY_TIERS, stream: STREAM_TIERS };
    const HASH_MAP = new Map();
    for (const [track, tiers] of Object.entries(TRACK_TIERS)) {
        tiers.forEach((tier, idx) => HASH_MAP.set(tier.hash, { track, idx, tier }));
    }

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
        if (fresh && state.userId) return state.analyticsToken;

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

    function emptyLedger() {
        return {
            gameHours: 0,
            varietyGames: 0,
            streamMs: 0,
            claimedIds: [],
            manualTime: null,
            manualVariety: null,
            manualStream: null
        };
    }

    function readLedger(userId) {
        const key = `${STORAGE_LEDGER_PREFIX}${userId || "anon"}`;
        try {
            const raw = localStorage.getItem(key);
            if (!raw) return emptyLedger();
            const parsed = JSON.parse(raw);
            return { ...emptyLedger(), ...parsed, claimedIds: Array.isArray(parsed?.claimedIds) ? parsed.claimedIds : [] };
        } catch {
            return emptyLedger();
        }
    }

    function writeLedger(userId, ledger) {
        const key = `${STORAGE_LEDGER_PREFIX}${userId || "anon"}`;
        ledger.claimedIds = (ledger.claimedIds || []).slice(-15_000);
        try {
            localStorage.setItem(key, JSON.stringify(ledger));
        } catch { /* ignore */ }
    }

    function getClientSeenIds() {
        const ids = new Set();
        try {
            const rgStore = findStore("RunningGameStore");
            const seen = rgStore?.getGamesSeen?.(true) ?? [];
            for (const g of seen) {
                if (g && !g.isLauncher && typeof g.id === "string" && /^\d+$/.test(g.id)) ids.add(g.id);
            }
        } catch { /* ignore */ }
        return ids;
    }

    function reachedTierIdx(val, tiers) {
        let idx = -1;
        for (let i = 0; i < tiers.length; i++) {
            if (val >= tiers[i].at) idx = i;
        }
        return idx;
    }

    async function fetchDirectoryEntries(userId) {
        const dirStore = findStore("BadgeDirectoryStore");
        const collectFromStore = () => {
            if (!dirStore) return [];
            const raw = [
                ...(dirStore.getBadges?.(userId) ?? []),
                ...(dirStore.getEarnableBadges?.(userId) ?? [])
            ];
            return raw
                .filter(b => b && typeof b === "object")
                .map(b => ({
                    badge: b,
                    currentTier: dirStore.getCurrentTier?.(b.badge_id ?? b.id, userId) ?? null
                }));
        };

        let entries = collectFromStore();
        if (entries.length === 0) {
            const fetchFn = findFnByCode("BADGE_DIRECTORY_FETCH_START") ?? findFnByCode("BADGE_DIRECTORY_FETCH_SUCCESS");
            if (fetchFn && /\.dispatch\s*\(/.test(String(fetchFn))) {
                try {
                    const src = String(fetchFn);
                    const p = /^\s*(?:async\s+)?(?:function\s*\w*\s*)?\(\s*\{/.test(src)
                        ? fetchFn({ userId })
                        : fetchFn(userId);
                    if (p instanceof Promise) await p.catch(() => undefined);
                    entries = collectFromStore();
                } catch { /* ignore */ }
            }
        }
        if (entries.length === 0) {
            for (const path of [`/users/${userId}/badges`, "/users/@me/badges"]) {
                try {
                    const res = await fetch(`${API}${path}`, { headers: headers() });
                    if (!res.ok) continue;
                    const data = await res.json();
                    const list = Array.isArray(data) ? data : (Array.isArray(data?.badges) ? data.badges : []);
                    if (list.length > 0) {
                        entries = list.map(b => ({ badge: b, currentTier: b?.current_tier ?? b?.currentTier ?? null }));
                        break;
                    }
                } catch { /* ignore */ }
            }
        }
        return entries;
    }

    function parseBadgesProgress(badges, directoryEntries = []) {
        const out = { time: null, variety: null, stream: null };

        for (const item of directoryEntries) {
            const b = item?.badge;
            const ct = item?.currentTier;
            if (!b) continue;
            const id = String(b.badge_id ?? b.id ?? "").toLowerCase();
            const name = String(b.name ?? "").toLowerCase();
            const label = String(ct?.info_label ?? ct?.infoLabel ?? b.info_label ?? b.infoLabel ?? "");
            const icons = [ct?.simple_icon_url, ct?.complex_icon_static_url, b.simple_icon_url, b.complex_icon_static_url].filter(Boolean).join(" ").toLowerCase();

            let track = null;
            if (id.includes("variety") || name === "game variety") track = "variety";
            else if (id.includes("stream") || name === "streaming") track = "stream";
            else if (id.includes("game_time") || id.includes("playtime") || name === "game time") track = "time";
            if (!track) {
                for (const [hash, info] of HASH_MAP) {
                    if (icons.includes(hash)) { track = info.track; break; }
                }
            }
            if (!track) {
                if (/\bgames?\s+played\b/i.test(label) && !/\b(?:hours?|hrs?|minutes?|mins?)\b/i.test(label)) track = "variety";
                else if (/\b(?:hours?|hrs?|minutes?|mins?)\s+of\s+games?\s+played\b/i.test(label)) track = "time";
                else if (/\bstream(?:ed|ing)\b/i.test(label)) track = "stream";
            }
            if (!track) continue;

            const tiers = TRACK_TIERS[track];
            let idx = -1;
            if (b.owned !== false || ct != null) {
                const lvl = typeof ct?.tier === "number" ? ct.tier : typeof ct?.level === "number" ? ct.level : NaN;
                if (Number.isInteger(lvl) && lvl >= 1 && lvl <= 10) idx = Math.max(idx, lvl - 1);
                const tName = String(ct?.name ?? b.name ?? "").toLowerCase();
                tiers.forEach((t, ti) => {
                    if ([t.name, ...(t.aliases ?? [])].some(n => tName.includes(n.toLowerCase()))) idx = Math.max(idx, ti);
                });
                for (const [hash, info] of HASH_MAP) {
                    if (info.track === track && icons.includes(hash)) idx = Math.max(idx, info.idx);
                }
            }

            let floor = idx >= 0 ? tiers[idx].at : 0;
            const numMatch = label.match(/(\d[\d,]*)/);
            if (numMatch) {
                const val = Number(numMatch[1].replace(/,/g, ""));
                if (Number.isFinite(val)) {
                    const minsOnly = /\b(?:minutes?|mins?)\b/i.test(label) && !/\b(?:hours?|hrs?)\b/i.test(label);
                    const normalized = minsOnly && track !== "variety" ? Math.round((val / 60) * 100) / 100 : val;
                    floor = Math.max(floor, normalized);
                    idx = Math.max(idx, reachedTierIdx(floor, tiers));
                }
            }
            if (b.owned === true && idx < 0) idx = 0;
            if (idx >= 0 || floor > 0) {
                if (!out[track] || floor > out[track].floor) {
                    out[track] = { track, idx, floor: Math.max(idx >= 0 ? tiers[idx].at : 0, floor) };
                }
            }
        }

        if (!Array.isArray(badges)) return out;

        for (const b of badges) {
            if (!b || typeof b !== "object") continue;
            const iconText = [b.icon, b.icon_asset, b.asset].filter(Boolean).join(" ").toLowerCase();
            let hit = null;
            for (const [hash, info] of HASH_MAP) {
                if (iconText.includes(hash)) {
                    hit = { track: info.track, idx: info.idx, floor: info.tier.at, tier: info.tier };
                    break;
                }
            }
            if (!hit) {
                const id = String(b.id || "").toLowerCase();
                const desc = String(b.description || "");
                const idMatch = id.match(/(?:^|_)(game_time|playtime|game_variety|streaming)[_-](\d{1,2})(?:$|_)/);
                if (idMatch) {
                    const track = idMatch[1] === "game_variety" ? "variety" : idMatch[1] === "streaming" ? "stream" : "time";
                    const lvl = Number(idMatch[2]);
                    if (lvl >= 1 && lvl <= 10) hit = { track, idx: lvl - 1, floor: TRACK_TIERS[track][lvl - 1].at };
                } else {
                    const sm = desc.match(/(\d[\d,]*)\+?\s*(?:hours?|hrs?)\s+(?:of\s+)?stream(?:ed|ing)/i)
                        ?? desc.match(/stream(?:ed|ing)?(?:\s+to\s+other\s+users)?\s+(?:for\s+)?(\d[\d,]*)\+?\s*(?:hours?|hrs?)/i);
                    const tm = desc.match(/(\d[\d,]*)\+?\s*(?:hours?|hrs?)\s+of\s+(?:detectable\s+)?(?:pc\s+)?games?(?:\s+played)?/i)
                        ?? desc.match(/play(?:ed)?\s+(\d[\d,]*)\+?\s*(?:hours?|hrs?)\s+of\s+(?:detectable\s+)?(?:pc\s+)?games/i);
                    const vm = desc.match(/(\d[\d,]*)\+?\s*(?:unique\s+|different\s+)?(?:detectable\s+)?(?:pc\s+)?games?(?:\s+played)?/i);
                    if (sm) {
                        const hrs = Number(sm[1].replace(/,/g, ""));
                        hit = { track: "stream", idx: Math.max(0, reachedTierIdx(hrs, STREAM_TIERS)), floor: hrs };
                    } else if (tm) {
                        const hrs = Number(tm[1].replace(/,/g, ""));
                        hit = { track: "time", idx: Math.max(0, reachedTierIdx(hrs, TIME_TIERS)), floor: hrs };
                    } else if (vm && !/hours?|hrs?/i.test(vm[0])) {
                        const gms = Number(vm[1].replace(/,/g, ""));
                        hit = { track: "variety", idx: Math.max(0, reachedTierIdx(gms, VARIETY_TIERS)), floor: gms };
                    }
                }
            }
            if (hit && (!out[hit.track] || hit.floor > out[hit.track].floor)) {
                out[hit.track] = hit;
            }
        }
        return out;
    }

    async function fetchProgressSummary() {
        ensureAuth();
        await ensureAnalyticsToken();
        const directoryEntries = await fetchDirectoryEntries(state.userId);
        let badges = [];
        try {
            const res = await fetch(`${API}/users/${state.userId}/profile?with_mutual_guilds=false&with_mutual_friends_count=false`, {
                headers: headers()
            });
            if (res.ok) {
                const data = await res.json();
                if (Array.isArray(data?.badges)) badges = data.badges;
            }
        } catch { /* ignore */ }

        const parsed = parseBadgesProgress(badges, directoryEntries);
        const ledger = readLedger(state.userId);
        const seenIds = getClientSeenIds();
        const allClaimed = new Set([...seenIds, ...(ledger.claimedIds || [])]);

        const timeCurrent = Math.round(Math.max(parsed.time?.floor ?? 0, ledger.gameHours || 0, ledger.manualTime ?? 0) * 10) / 10;
        const varietyCurrent = Math.floor(Math.max(parsed.variety?.floor ?? 0, allClaimed.size, ledger.varietyGames || 0, ledger.manualVariety ?? 0));
        const streamCurrent = Math.round(Math.max(parsed.stream?.floor ?? 0, (ledger.streamMs || 0) / 3_600_000, ledger.manualStream ?? 0) * 10) / 10;

        const describeTrack = (val, tiers, maxAt) => {
            const idx = reachedTierIdx(val, tiers);
            const curTier = idx >= 0 ? `${tiers[idx].name} (T${tiers[idx].level}/10)` : "Unranked (T0/10)";
            const next = tiers.find(t => val < t.at) || null;
            return {
                current: val,
                tier: curTier,
                nextTier: next ? `${next.name} at ${next.at}` : "Max tier",
                remainingToMax: Math.max(0, Math.round((maxAt - val) * 10) / 10)
            };
        };

        return {
            rawBadges: badges,
            time: describeTrack(timeCurrent, TIME_TIERS, 5_000),
            variety: describeTrack(varietyCurrent, VARIETY_TIERS, 100),
            stream: describeTrack(streamCurrent, STREAM_TIERS, 5_000)
        };
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
        const ledger = readLedger(state.userId);
        const seenIds = getClientSeenIds();
        const usedSet = new Set([...seenIds, ...(ledger.claimedIds || [])]);
        const chosen = shuffled(apps.filter(a => !usedSet.has(a.id))).slice(0, desired);

        if (chosen.length < desired) {
            const byId = new Map(apps.map(a => [a.id, a]));
            const chosenIds = new Set(chosen.map(a => a.id));
            for (const gid of ledger.claimedIds || []) {
                const found = byId.get(gid);
                if (found && !chosenIds.has(found.id) && !seenIds.has(found.id)) {
                    chosen.push(found);
                    chosenIds.add(found.id);
                    if (chosen.length >= desired) break;
                }
            }
        }

        return chosen;
    }

    function recordBatch(baseTime, baseVariety, addedHours, gameIds) {
        const ledger = readLedger(state.userId);
        if (addedHours > 0) {
            ledger.gameHours = Math.round((Math.max(ledger.gameHours || 0, baseTime) + addedHours) * 100) / 100;
        }
        if (gameIds.length > 0) {
            const pickedSet = new Set(gameIds);
            const existing = new Set(ledger.claimedIds || []);
            let newCount = 0;
            for (const id of gameIds) {
                if (!existing.has(id)) newCount++;
            }
            ledger.claimedIds = [...(ledger.claimedIds || []).filter(id => !pickedSet.has(id)), ...gameIds];
            ledger.varietyGames = Math.max(ledger.claimedIds.length, Math.max(ledger.varietyGames || 0, baseVariety) + newCount);
        }
        writeLedger(state.userId, ledger);
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

    async function runSpreadGameTime(apps, startHours, startVariety, neededHours, hoursPerGame, signal, minGames = 1) {
        const perGame = Math.min(Math.max(1, Math.floor(hoursPerGame)), 24);
        const effectiveNeeded = Math.min(Math.max(0.1, neededHours), apps.length * perGame);
        const neededMs = Math.round(effectiveNeeded * 3_600_000);
        const byHours = Math.max(1, Math.ceil(neededMs / (perGame * 3_600_000)));
        const count = Math.min(apps.length, Math.max(byHours, minGames));
        const perGameMs = Math.min(MAX_SESSION_MS, Math.max(MIN_DURATION_MS, Math.ceil(neededMs / count)));
        const pool = selectFreshGames(apps, count);

        let sentMs = 0;
        let failures = 0;
        let curTime = startHours;
        let curVariety = startVariety;
        state.creditedHours = startHours;
        state.gamesCredited = 0;

        log(`Game Time (spread): starting at ${startHours}h, adding +${Math.round(effectiveNeeded)}h across ${pool.length} unused games`);

        for (let i = 0; i < pool.length && !signal.aborted; i += BATCH_SIZE) {
            const batch = [];
            let planned = sentMs;
            const slice = pool.slice(i, i + BATCH_SIZE);
            for (let idx = 0; idx < slice.length; idx++) {
                const remGames = pool.length - (i + idx);
                const rem = neededMs - planned;
                if (rem < MIN_DURATION_MS && i + idx >= minGames) break;
                const share = remGames > 0 ? Math.ceil(rem / remGames) : perGameMs;
                const dur = Math.min(MAX_SESSION_MS, Math.max(MIN_DURATION_MS, Math.min(perGameMs, share)));
                batch.push({ game: slice[idx], durationMs: dur });
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
            sentMs += result.creditedMs;
            state.gamesCredited += result.count;
            const batchHrs = result.creditedMs / 3_600_000;
            recordBatch(curTime, curVariety, batchHrs, batch.map(entry => entry.game.id));
            curTime += batchHrs;
            curVariety += result.count;
            state.creditedHours = Math.round((startHours + Math.min(sentMs, neededMs) / 3_600_000) * 10) / 10;
            log(`${state.creditedHours}/${Math.round(startHours + effectiveNeeded)}h (${state.gamesCredited}/${pool.length} batch games)`);
            if (i + BATCH_SIZE < pool.length && (neededMs - sentMs >= MIN_DURATION_MS || state.gamesCredited < minGames)) {
                await wait(REQUEST_DELAY_MS, signal);
            }
        }

        const done = !signal.aborted && neededMs - sentMs < MIN_DURATION_MS;
        if (done) log(`Done: reached ${state.creditedHours}h across ${state.gamesCredited} games. Discord syncs badges in 24 to 48 hours.`);
        return done;
    }

    async function runSingleGameTime(app, startHours, startVariety, hours, chunkHours, signal) {
        const targetMs = Math.round(Math.max(0.1, hours) * 3_600_000);
        const chunkMs = Math.min(Math.max(1, Math.floor(chunkHours)), 24) * 3_600_000;
        const cursorRef = { value: Date.now() };
        let sentMs = 0;
        let failures = 0;
        let curTime = startHours;
        state.creditedHours = startHours;

        if (hours > 24) {
            log("Note: Discord caps playtime per single game at ~24h/day. Use BadgeFarmer.gameTime(5000) to spread across games.", false);
        }
        log(`Game Time (single): +${hours}h on ${app.name}`);

        while (!signal.aborted && targetMs - sentMs >= MIN_DURATION_MS) {
            const batch = [];
            let planned = sentMs;
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
            sentMs += result.creditedMs;
            const batchHrs = result.creditedMs / 3_600_000;
            recordBatch(curTime, startVariety, batchHrs, [app.id]);
            curTime += batchHrs;
            state.creditedHours = Math.round((startHours + Math.min(sentMs, targetMs) / 3_600_000) * 10) / 10;
            log(`${state.creditedHours}h total (+${Math.round((sentMs / 3_600_000) * 10) / 10}/${hours}h on ${app.name})`);
            if (targetMs - sentMs >= MIN_DURATION_MS) await wait(REQUEST_DELAY_MS, signal);
        }

        const done = !signal.aborted && targetMs - sentMs < MIN_DURATION_MS;
        if (done) log(`Done: +${hours}h sent on ${app.name}.`);
        return done;
    }

    async function runVariety(games, startGames, startHours, minutesPerGame, signal) {
        const sessionMs = Math.min(MAX_SESSION_MS, Math.max(MIN_DURATION_MS, Math.floor(minutesPerGame * 60_000)));
        const cursorRef = { value: Date.now() };
        let failures = 0;
        let sentGames = 0;
        let curTime = startHours;
        let curVariety = startGames;
        state.gamesCredited = startGames;

        log(`Variety: starting at ${startGames} games, claiming +${games.length} unused Windows games`);

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
            sentGames += result.count;
            state.gamesCredited = startGames + sentGames;
            const batchHrs = result.creditedMs / 3_600_000;
            recordBatch(curTime, curVariety, batchHrs, batch.map(entry => entry.game.id));
            curTime += batchHrs;
            curVariety += result.count;
            log(`${state.gamesCredited}/${startGames + games.length} unique games`);
            if (i + BATCH_SIZE < games.length) await wait(REQUEST_DELAY_MS, signal);
        }

        const done = !signal.aborted && sentGames >= games.length;
        if (done) log(`Variety done: reached ${state.gamesCredited} unique games. Discord syncs badges in 24 to 48 hours.`);
        return done;
    }

    function streamKeyOf(s) {
        return s.guildId != null
            ? `guild:${s.guildId}:${s.channelId}:${s.ownerId}`
            : `call:${s.channelId}:${s.ownerId}`;
    }

    async function runStreamFarm(startHours, neededHours, opts, signal) {
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
        const startMs = Math.round(startHours * 3_600_000);
        const neededMs = Math.round(Math.max(0.1, neededHours) * 3_600_000);
        let liveMs = 0;
        let unsavedMs = 0;
        let lastTick = Date.now();
        let segmentStart = Date.now();
        let warnedNoViewers = false;
        let owns = false;
        state.streamHours = startHours;

        if (lowPower && streamSettingsStore?.getState) {
            const cur = streamSettingsStore.getState();
            if (cur) state.savedStreamSettings = { preset: cur.preset, resolution: cur.resolution, fps: cur.fps };
            dispatcher.dispatch({ type: "STREAM_UPDATE_SETTINGS", preset: 3, resolution: 480, frameRate: 15 });
        }

        function saveStreamProgress() {
            if (unsavedMs <= 0 || !state.userId) return;
            const ledger = readLedger(state.userId);
            ledger.streamMs = Math.max(ledger.streamMs || 0, startMs + liveMs - unsavedMs) + unsavedMs;
            writeLedger(state.userId, ledger);
            unsavedMs = 0;
        }

        function cleanupStream() {
            saveStreamProgress();
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
            log(`Streaming: resuming at ${startHours}h (+${Math.round(neededHours * 10) / 10}h remaining). Keep a viewer watching.`);

            while (!signal.aborted && liveMs < neededMs) {
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
                    unsavedMs += delta;
                    state.streamHours = Math.round(((startMs + Math.min(liveMs, neededMs)) / 3_600_000) * 100) / 100;
                    if (unsavedMs >= 24_000) saveStreamProgress();
                } else if (!warnedNoViewers) {
                    log("Waiting for a viewer. Run BadgeFarmer.watch() in your alt's console.", false);
                    warnedNoViewers = true;
                }

                if (checkpoint && now - segmentStart >= STREAM_CHECKPOINT_MS && liveMs < neededMs) {
                    saveStreamProgress();
                    if (stopStreamFn) stopStreamFn(key);
                    segmentStart = Date.now();
                    await wait(2_500, signal);
                    lastTick = Date.now();
                    continue;
                }

                await wait(Math.min(STREAM_TICK_MS, Math.max(1_000, neededMs - liveMs)), signal);
            }
        } finally {
            cleanupStream();
        }

        const done = !signal.aborted && liveMs >= neededMs;
        if (done) log(`Streaming done: reached ${state.streamHours}h. Give Discord up to 48 hours to update the badge.`);
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

        async progress() {
            const summary = await fetchProgressSummary();
            console.table({
                "Game Time": summary.time,
                "Game Variety": summary.variety,
                Streaming: summary.stream
            });
            return summary;
        },

        async badges() {
            return (await BadgeFarmer.progress()).rawBadges;
        },

        async setBaseline({ time, variety, stream } = {}) {
            ensureAuth();
            await ensureAnalyticsToken();
            const ledger = readLedger(state.userId);
            if (typeof time === "number" && time >= 0) ledger.manualTime = time;
            if (typeof variety === "number" && variety >= 0) ledger.manualVariety = Math.floor(variety);
            if (typeof stream === "number" && stream >= 0) ledger.manualStream = stream;
            writeLedger(state.userId, ledger);
            return BadgeFarmer.progress();
        },

        async resetProgress() {
            ensureAuth();
            await ensureAnalyticsToken();
            try {
                localStorage.removeItem(`${STORAGE_LEDGER_PREFIX}${state.userId || "anon"}`);
            } catch { /* ignore */ }
            log("Cleared local progress cache.");
        },

        async search(name) {
            if (typeof name !== "string" || name.trim() === "") return [];
            const apps = await loadCatalogue();
            return rankSearch(apps, name);
        },

        async gameTime(targetOrName = 5_000, hoursOrPerGame = 20, opts = {}) {
            const summary = await fetchProgressSummary();
            const apps = await loadCatalogue();

            if (typeof targetOrName === "number") {
                const force = opts?.force === true;
                const startHours = force ? summary.time.current : Math.min(targetOrName, summary.time.current);
                const needed = force ? targetOrName : Math.max(0, targetOrName - startHours);
                if (needed * 3_600_000 < MIN_DURATION_MS) {
                    log(`Already at ${summary.time.current}h (${summary.time.tier}). Pass { force: true } as 3rd arg to add more.`);
                    return;
                }
                const signal = begin("GAME_TIME");
                try {
                    await runSpreadGameTime(apps, startHours, summary.variety.current, needed, hoursOrPerGame, signal);
                } finally {
                    finish();
                }
                return;
            }

            const matches = rankSearch(apps, String(targetOrName));
            const app = matches[0];
            if (!app) throw new Error(`No Windows game matched "${targetOrName}".`);
            const chunkHours = typeof opts === "number" ? opts : (opts?.chunkHours ?? 24);
            const signal = begin("GAME_TIME");
            try {
                await runSingleGameTime(app, summary.time.current, summary.variety.current, hoursOrPerGame, chunkHours, signal);
            } finally {
                finish();
            }
        },

        async variety(minutesPerGame = 5, count = 100, opts = {}) {
            const summary = await fetchProgressSummary();
            const apps = await loadCatalogue();
            const force = opts?.force === true;
            const startGames = force ? summary.variety.current : Math.min(count, summary.variety.current);
            const needed = force ? count : Math.max(0, count - startGames);
            if (needed <= 0) {
                log(`Already at ${summary.variety.current} unique games (${summary.variety.tier}). Pass { force: true } as 3rd arg to add more.`);
                return;
            }
            const signal = begin("VARIETY");
            try {
                await runVariety(selectFreshGames(apps, needed), startGames, summary.time.current, minutesPerGame, signal);
            } finally {
                finish();
            }
        },

        async stream(hours = 20, opts = {}) {
            const summary = await fetchProgressSummary();
            const force = opts?.force === true;
            const startHours = force ? summary.stream.current : Math.min(hours, summary.stream.current);
            const needed = force ? hours : Math.max(0, hours - startHours);
            if (needed * 3_600_000 < 30_000) {
                log(`Already at ${summary.stream.current}h (${summary.stream.tier}). Pick a higher target or pass { force: true }.`);
                return;
            }
            const signal = begin("STREAM");
            try {
                await runStreamFarm(startHours, needed, opts, signal);
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
            const summary = await fetchProgressSummary();
            const apps = await loadCatalogue();
            const missingHours = Math.max(0, 5_000 - summary.time.current);
            const missingGames = Math.max(0, 100 - summary.variety.current);

            if (missingHours * 3_600_000 < MIN_DURATION_MS && missingGames <= 0) {
                log("Eternal (5,000h) and Universalist (100 games) are already complete on this account.");
                return;
            }

            const signal = begin("MAX_ALL");
            try {
                if (missingHours * 3_600_000 >= MIN_DURATION_MS) {
                    await runSpreadGameTime(apps, summary.time.current, summary.variety.current, missingHours, 20, signal, Math.max(1, missingGames));
                } else {
                    await runVariety(selectFreshGames(apps, missingGames), summary.variety.current, summary.time.current, 5, signal);
                }
            } finally {
                finish();
            }
        }
    };

    if (typeof window !== "undefined") window.BadgeFarmer = BadgeFarmer;
    else globalThis.BadgeFarmer = BadgeFarmer;

    log("Loaded. Try BadgeFarmer.progress(), .gameTime(5000), .variety(), .stream(20), .watch(), .maxAll(), .stop()");
    return BadgeFarmer;
})();
