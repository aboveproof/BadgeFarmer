/*
Made with ❤️ by rico
I am not responsible for any damage caused by this plugin; use at your own risk
Vencord/Equicord does not endorse/support this plugin (Works with Equicord as well)
dm @wkcp if u need help or have any questions
https://github.com/aboveproof/BadgeFarmer
*/

import * as DataStore from "@api/DataStore";
import { Settings } from "@api/Settings";
import { IS_WINDOWS } from "@utils/constants";
import { Logger } from "@utils/Logger";
import type { ApplicationStream, Channel, FluxStore, ProfileBadge, RunningGame } from "@vencord/discord-types";
import { filters, findAll } from "@webpack";
import {
    ApplicationStreamingStore,
    ChannelStore,
    Constants,
    FluxDispatcher,
    MediaEngineStore,
    PermissionsBits,
    PermissionStore,
    RestAPI,
    RTCConnectionStore,
    RunningGameStore,
    SelectedChannelStore,
    showToast,
    UserProfileStore,
    UserStore,
    VoiceStateStore
} from "@webpack/common";

import {
    type BadgeTier,
    type BadgeTrack,
    type DirectoryBadgeInput,
    nextTierFor,
    parseAllUserBadges,
    reachedTierIndex,
    tierIconUrl,
    TIME_TIERS,
    TRACK_TIERS,
    VARIETY_TIERS
} from "./badges";
import {
    apiOrigin,
    creditPlaytimeBatch,
    fingerprintFor,
    isAnalyticsStubbed,
    MAX_SESSION_MS,
    MAX_SESSIONS_PER_BATCH,
    MIN_DURATION_MS,
    type PlaytimeSession
} from "./science";

const logger = new Logger("BadgeFarmer");

const CATALOGUE_TIMEOUT_MS = 20_000;
const DIRECTORY_FETCH_WAIT_MS = 4_500;
const LEGACY_USED_GAMES_PREFIX = "BadgeFarmer_usedGames_v1_";
const LEDGER_KEY_PREFIX = "BadgeFarmer_ledger_v2_";

const PRESET_CUSTOM = 3;
const LOW_POWER_RESOLUTION = 480;
const LOW_POWER_FPS = 15;

export interface DesktopSource {
    id: string;
    name: string;
    kind: "screen" | "window";
}

export interface StreamFarmConfig {
    sourceId?: string;
    lowPower?: boolean;
    checkpoint?: boolean;
    subtractExisting?: boolean;
}

interface StreamOptions {
    pid: number | null;
    sourceId: string;
    sourceName: string;
    audioSourceId: string | null;
    sound: boolean;
    previewDisabled: boolean;
}

interface SavedStreamSettings {
    preset: number;
    resolution: number;
    fps: number;
}

interface StoredProgressLedger {
    gameHours: number;
    varietyGames: number;
    streamMs: number;
    claimedGameIds: string[];
    manualTimeHours: number | null;
    manualVarietyGames: number | null;
    manualStreamHours: number | null;
    dailySingleGame: Record<string, Record<string, number>>;
}

export interface TrackProgress {
    track: BadgeTrack;
    profileTierIndex: number;
    profileTier: BadgeTier | null;
    profileFloor: number;
    clientSeenGames: number;
    trackedTotal: number;
    manualBaseline: number | null;
    current: number;
    pendingSync: number;
    currentTierIndex: number;
    currentTier: BadgeTier | null;
    nextTier: BadgeTier | null;
    iconUrl: string;
}

export interface AccountProgress {
    userId: string | null;
    syncedAt: number | null;
    loading: boolean;
    time: TrackProgress;
    variety: TrackProgress;
    stream: TrackProgress;
    otherBadges: ProfileBadge[];
}

interface BadgeDirectoryStoreShape extends FluxStore {
    getBadges?(userId: string): unknown[];
    getEarnableBadges?(userId: string): unknown[];
    getUnownedBadges?(userId: string): unknown[];
    getAllBadges?(userId: string): unknown[];
    getBadgeById?(badgeId: string, userId: string): unknown;
    getCurrentTier?(badgeId: string, userId: string): unknown;
    getState?(): unknown;
}

type RawDesktopSource = { id?: unknown; name?: unknown; };
type GetDesktopSources4 = (engine: unknown, isWindows: boolean, types: string[], options: null) => Promise<RawDesktopSource[] | null>;
type GetDesktopSources3 = (engine: unknown, types: string[], options: null) => Promise<RawDesktopSource[] | null>;

function resolveStartStream(): ((guildId: string | null, channelId: string, options: StreamOptions) => void) | undefined {
    return findAll(filters.byCode('type:"STREAM_START"'))[0];
}

function resolveStopStream(): ((streamKey: string) => void) | undefined {
    return findAll(filters.byCode('type:"STREAM_STOP"'))[0];
}

function resolveWatchStream(): ((stream: ApplicationStream | string, allowMultiple?: boolean) => void) | undefined {
    return findAll(filters.byCode('type:"STREAM_WATCH"'))[0];
}

function resolveGetDesktopSources(): (GetDesktopSources4 & GetDesktopSources3) | undefined {
    return findAll(filters.byCode("desktop sources"))[0];
}

interface GameStoreShape {
    games?: unknown;
    getState?(): {
        blocklistExecutables?: unknown;
        blocklistPatterns?: unknown;
    };
}

interface StreamingSettingsStoreShape {
    getState?(): {
        preset: number;
        resolution: number;
        fps: number;
    };
}

function getGameStore(): GameStoreShape | null {
    try {
        return (findAll(filters.byStoreName("GameStore"))[0] as GameStoreShape | undefined) ?? null;
    } catch {
        return null;
    }
}

function getStreamingSettingsStore(): StreamingSettingsStoreShape | null {
    try {
        return (findAll(filters.byStoreName("ApplicationStreamingSettingsStore"))[0] as StreamingSettingsStoreShape | undefined) ?? null;
    } catch {
        return null;
    }
}

export function getBadgeDirectoryStore(): BadgeDirectoryStoreShape | null {
    try {
        return (findAll(filters.byStoreName("BadgeDirectoryStore"))[0] as BadgeDirectoryStoreShape | undefined) ?? null;
    } catch {
        return null;
    }
}

export interface DetectableExecutable {
    name: string;
    os?: string;
    is_launcher?: boolean;
    isLauncher?: boolean;
}

export interface DetectableApp {
    id: string;
    name: string;
    aliases?: string[];
    executables: DetectableExecutable[];
}

export interface SpoofedGame extends Omit<RunningGame, "distributor"> {
    id: string;
    pid: number;
    exeName: string;
    pidPath: number[];
    processName: string;
    start: number;
}

interface GameSpec {
    id: string;
    name: string;
    exeName: string;
}

export type FarmerMode = "IDLE" | "GAME_TIME" | "VARIETY" | "STREAM" | "VIEWER" | "MAX_ALL";

export interface FarmerStatus {
    mode: FarmerMode;
    activeGame: SpoofedGame | null;
    hoursCredited: number;
    hoursTarget: number;
    gamesCredited: number;
    gamesTarget: number;
    streamHours: number;
    streamTarget: number;
    streamViewers: number | null;
    streamPaused: boolean;
    watchingOwner: string | null;
    errors: number;
    lastError: string | null;
    finishedMessage: string | null;
}

export interface VoiceReadiness {
    channelName: string | null;
    peersInChannel: number;
    problem: string | null;
}

export type NoTrackStreamState = "ok" | "disabled_in_settings" | "needs_restart";

export const ETERNAL_HOURS = TIME_TIERS[TIME_TIERS.length - 1].at;
export const UNIVERSALIST_GAMES = VARIETY_TIERS[VARIETY_TIERS.length - 1].at;
export const MAX_TARGET_HOURS = 1_000_000;
export const MAX_CHUNK_HOURS = 24;
export const DEFAULT_HOURS_PER_GAME = 20;
export const DEFAULT_SINGLE_GAME_HOURS = 24;
export const DEFAULT_VARIETY_MINUTES = 5;
export const BATCH_SIZE = MAX_SESSIONS_PER_BATCH;

const REQUEST_DELAY_MS = 550;
const RETRY_DELAY_MS = 3_000;
const MAX_RATE_LIMIT_WAIT_MS = 30_000;
const MAX_FAILED_BATCHES = 5;

const STREAM_CHECKPOINT_MS = 2 * 60 * 60 * 1_000;
const STREAM_REJOIN_GAP_MS = 2_500;
const STREAM_TICK_MS = 8_000;
const VIEWER_TICK_MS = 4_000;
const MAX_TICK_DELTA_MS = STREAM_TICK_MS * 3;
const STREAM_START_TIMEOUT_MS = 10_000;
const STREAM_RESTART_LIMIT = 4;
const VOICE_RECONNECT_GRACE_MS = 30_000;
const STREAM_SAVE_INTERVAL_MS = 24_000;

/** Compact browser console snippet users can paste on an unmodded alt tab to auto-watch and stay unpaused 24/7. */
export const ALT_WATCH_SNIPPET = `(() => {
  if (window.__bfWatch) clearInterval(window.__bfWatch);
  let Dispatcher, StreamStore, ChannelStore, UserStore;
  webpackChunkdiscord_app.push([[Symbol()], {}, req => {
    for (const m of Object.values(req.c)) {
      const e = m?.exports;
      for (const c of [e, e?.default, e?.Z, e?.ZP]) {
        if (!c) continue;
        if (c.dispatch && c.subscribe) Dispatcher = c;
        if (c.getName?.() === "ApplicationStreamingStore") StreamStore = c;
        if (c.getName?.() === "SelectedChannelStore") ChannelStore = c;
        if (c.getName?.() === "UserStore") UserStore = c;
      }
    }
  }]);
  if (!Dispatcher || !StreamStore || !ChannelStore) return console.error("[BadgeFarmer] Discord stores not found.");
  const tick = () => {
    const ch = ChannelStore.getVoiceChannelId?.();
    if (!ch) return;
    const myId = UserStore?.getCurrentUser?.()?.id;
    const streams = StreamStore.getAllApplicationStreamsForChannel?.(ch) ?? [];
    for (const s of streams) {
      if (myId && s.ownerId === myId) continue;
      const key = s.guildId ? \`guild:\${s.guildId}:\${s.channelId}:\${s.ownerId}\` : \`call:\${s.channelId}:\${s.ownerId}\`;
      const active = StreamStore.getActiveStreamForStreamKey?.(key);
      if (!active) Dispatcher.dispatch({ type: "STREAM_WATCH", streamKey: key, allowMultiple: true });
      Dispatcher.dispatch({ type: "STREAM_SET_PAUSED", streamKey: key, paused: false });
    }
  };
  tick();
  window.__bfWatch = setInterval(tick, 3000);
  console.log("%c[BadgeFarmer] Alt auto-watcher active. Leave this tab in the voice channel.", "color:#57f287;font-weight:bold");
})();`;

let mode: FarmerMode = "IDLE";
let activeGame: SpoofedGame | null = null;
let hoursCredited = 0;
let hoursTarget = 0;
let gamesCredited = 0;
let gamesTarget = 0;
let streamHours = 0;
let streamTarget = 0;
let streamViewers: number | null = null;
let streamPaused = false;
let watchingOwner: string | null = null;
let errors = 0;
let lastError: string | null = null;
let finishedMessage: string | null = null;

let running = false;
let runId = 0;
let runAbort: AbortController | null = null;
let cursor = 0;
let ownsStream = false;
let dispatchedDebugPresence = false;
let showSpoofedPresence = false;
let savedStreamSettings: SavedStreamSettings | null = null;

let cataloguePromise: Promise<DetectableApp[]> | null = null;
const memoryLedgers = new Map<string, StoredProgressLedger>();
let cachedProfileUserId: string | null = null;
let cachedRawBadges: ProfileBadge[] = [];
let cachedFallbackDirectory: DirectoryBadgeInput[] = [];
let cachedSyncedAt: number | null = null;
let progressLoading = false;

const listeners = new Set<() => void>();

export function setShowSpoofedPresence(show: boolean): void {
    showSpoofedPresence = show;
    if (!show && dispatchedDebugPresence) {
        dispatchedDebugPresence = false;
        try {
            FluxDispatcher.dispatch({ type: "RUNNING_GAME_SET_DEBUG_GAME", game: null });
        } catch {
            // Ignore cleanup errors.
        }
    }
}

export function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => void listeners.delete(listener);
}

function notify(): void {
    for (const listener of listeners) {
        try {
            listener();
        } catch (error) {
            logger.error("Status listener threw", error);
        }
    }
}

export function getStatus(): FarmerStatus {
    return {
        mode,
        activeGame,
        hoursCredited,
        hoursTarget,
        gamesCredited,
        gamesTarget,
        streamHours,
        streamTarget,
        streamViewers,
        streamPaused,
        watchingOwner,
        errors,
        lastError,
        finishedMessage
    };
}

export function isRunning(): boolean {
    return running;
}

export function dismissFinished(): void {
    if (running) return;
    finishedMessage = null;
    lastError = null;
    notify();
}

export function getNoTrackStreamState(): NoTrackStreamState {
    try {
        const noTrack = Settings.plugins?.NoTrack as
            | { enabled?: boolean; disableAnalytics?: boolean; allowBadgeTracking?: boolean; }
            | undefined;
        if (noTrack != null && noTrack.enabled !== false && noTrack.disableAnalytics === true && noTrack.allowBadgeTracking === false) {
            return "disabled_in_settings";
        }
        if (isAnalyticsStubbed()) {
            return "needs_restart";
        }
        return "ok";
    } catch {
        return "ok";
    }
}

export function enableNoTrackBadgeTracking(): boolean {
    try {
        const noTrack = Settings.plugins?.NoTrack as { allowBadgeTracking?: boolean; } | undefined;
        if (noTrack == null) return false;
        noTrack.allowBadgeTracking = true;
        return true;
    } catch {
        return false;
    }
}

function emptyLedger(): StoredProgressLedger {
    return {
        gameHours: 0,
        varietyGames: 0,
        streamMs: 0,
        claimedGameIds: [],
        manualTimeHours: null,
        manualVarietyGames: null,
        manualStreamHours: null,
        dailySingleGame: {}
    };
}

function utcDayKey(): string {
    return new Date().toISOString().slice(0, 10);
}

function sanitizeLedger(raw: unknown): StoredProgressLedger {
    if (raw == null || typeof raw !== "object") return emptyLedger();
    const obj = raw as Partial<StoredProgressLedger>;
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0);
    const optNum = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);

    const claimed = Array.isArray(obj.claimedGameIds)
        ? obj.claimedGameIds.filter((id): id is string => typeof id === "string" && /^\d+$/.test(id))
        : [];

    const today = utcDayKey();
    const daily: Record<string, Record<string, number>> = {};
    if (obj.dailySingleGame != null && typeof obj.dailySingleGame === "object") {
        const todayBucket = (obj.dailySingleGame as Record<string, unknown>)[today];
        if (todayBucket != null && typeof todayBucket === "object") {
            const cleanBucket: Record<string, number> = {};
            for (const [gid, hrs] of Object.entries(todayBucket as Record<string, unknown>)) {
                if (/^\d+$/.test(gid) && typeof hrs === "number" && Number.isFinite(hrs) && hrs > 0) {
                    cleanBucket[gid] = hrs;
                }
            }
            daily[today] = cleanBucket;
        }
    }

    return {
        gameHours: num(obj.gameHours),
        varietyGames: Math.max(num(obj.varietyGames), claimed.length),
        streamMs: num(obj.streamMs),
        claimedGameIds: claimed.slice(-15_000),
        manualTimeHours: optNum(obj.manualTimeHours),
        manualVarietyGames: optNum(obj.manualVarietyGames),
        manualStreamHours: optNum(obj.manualStreamHours),
        dailySingleGame: daily
    };
}

async function ensureLedger(userId: string): Promise<StoredProgressLedger> {
    const existing = memoryLedgers.get(userId);
    if (existing != null) return existing;

    let ledger = emptyLedger();
    try {
        const stored = await DataStore.get<unknown>(`${LEDGER_KEY_PREFIX}${userId}`);
        if (stored != null) {
            ledger = sanitizeLedger(stored);
        } else {
            const legacyUsed = await DataStore.get<unknown>(`${LEGACY_USED_GAMES_PREFIX}${userId}`);
            if (Array.isArray(legacyUsed)) {
                const validIds = legacyUsed.filter((id): id is string => typeof id === "string" && /^\d+$/.test(id));
                ledger.claimedGameIds = validIds.slice(-15_000);
                ledger.varietyGames = ledger.claimedGameIds.length;
            }
        }
    } catch {
        // Keep in-memory ledger if IndexedDB fails.
    }

    memoryLedgers.set(userId, ledger);
    return ledger;
}

async function persistLedger(userId: string, ledger: StoredProgressLedger): Promise<void> {
    ledger.claimedGameIds = ledger.claimedGameIds.slice(-15_000);
    memoryLedgers.set(userId, ledger);
    try {
        await DataStore.set(`${LEDGER_KEY_PREFIX}${userId}`, ledger);
    } catch {
        // Ignore IndexedDB errors.
    }
}

function persistLedgerSync(userId: string, ledger: StoredProgressLedger): void {
    ledger.claimedGameIds = ledger.claimedGameIds.slice(-15_000);
    memoryLedgers.set(userId, ledger);
    void DataStore.set(`${LEDGER_KEY_PREFIX}${userId}`, ledger).catch(() => undefined);
}

/** Reads verified numeric game IDs Discord has already detected on this PC in RunningGameStore. */
export function getClientSeenGameIds(): Set<string> {
    const ids = new Set<string>();
    try {
        const seen = RunningGameStore?.getGamesSeen?.(true) ?? [];
        const runningGames = RunningGameStore?.getRunningGames?.() ?? [];
        for (const item of [...(Array.isArray(seen) ? seen : []), ...(Array.isArray(runningGames) ? runningGames : [])]) {
            if (item != null && !item.isLauncher && typeof item.id === "string" && /^\d+$/.test(item.id)) {
                ids.add(item.id);
            }
        }
    } catch {
        // Ignore store access errors.
    }
    return ids;
}

/** Reads owned and earnable badges (plus currentTier) from Discord's BadgeDirectoryStore ("Your badges" modal). */
function readDirectoryEntriesFromStore(userId: string): DirectoryBadgeInput[] {
    const store = getBadgeDirectoryStore();
    if (store == null) return [];

    const rawItems: Record<string, unknown>[] = [];
    const seenIds = new Set<string>();

    const collect = (list: unknown) => {
        if (!Array.isArray(list)) return;
        for (const item of list) {
            if (item == null || typeof item !== "object") continue;
            const rec = item as Record<string, unknown>;
            const key = String(rec.badge_id ?? rec.id ?? "");
            if (key !== "") {
                if (seenIds.has(key)) continue;
                seenIds.add(key);
            }
            rawItems.push(rec);
        }
    };

    try {
        collect(store.getBadges?.(userId));
        collect(store.getEarnableBadges?.(userId));
        collect(store.getUnownedBadges?.(userId));
        collect(store.getAllBadges?.(userId));
    } catch {
        // Ignore partial store method failures.
    }

    for (const candidateId of ["game_time", "game_variety", "streaming", "evolving_badge_game_time", "evolving_badge_game_variety", "evolving_badge_streaming"]) {
        if (seenIds.has(candidateId)) continue;
        try {
            const direct = store.getBadgeById?.(candidateId, userId);
            if (direct != null && typeof direct === "object") {
                seenIds.add(candidateId);
                rawItems.push(direct as Record<string, unknown>);
            }
        } catch {
            // Ignore lookup failures.
        }
    }

    return rawItems.map(badge => {
        let currentTier: Record<string, unknown> | null = null;
        const badgeId = typeof badge.badge_id === "string"
            ? badge.badge_id
            : typeof badge.id === "string" ? badge.id : null;
        if (badgeId != null) {
            try {
                const resolved = store.getCurrentTier?.(badgeId, userId);
                if (resolved != null && typeof resolved === "object") {
                    currentTier = resolved as Record<string, unknown>;
                }
            } catch {
                // Ignore tier lookup errors.
            }
        }
        return { badge, currentTier };
    });
}

function discoverBadgeEndpoints(userId: string): string[] {
    const urls = new Set<string>();
    try {
        const endpoints = Constants?.Endpoints as Record<string, unknown> | undefined;
        if (endpoints != null && typeof endpoints === "object") {
            for (const [key, entry] of Object.entries(endpoints)) {
                const upper = key.toUpperCase();
                if (!upper.includes("BADGE")) continue;
                if (/(?:SETTING|PIN|ACK|SEEN|GUILD|CLAN|BOOST|PACK|ICON)/.test(upper)) continue;
                if (typeof entry === "string" && entry.startsWith("/users/")) {
                    urls.add(entry);
                } else if (typeof entry === "function" && entry.length <= 1) {
                    try {
                        const built = (entry as (id: string) => unknown)(userId);
                        if (typeof built === "string" && built.startsWith("/users/") && !built.includes("undefined")) {
                            urls.add(built);
                        }
                    } catch {
                        // Ignore endpoints requiring non-user parameters.
                    }
                }
            }
        }
    } catch {
        // Ignore endpoint discovery failures.
    }
    urls.add(`/users/${userId}/badges`);
    urls.add("/users/@me/badges");
    return [...urls];
}

function extractDirectoryListFromBody(body: unknown): DirectoryBadgeInput[] {
    if (body == null) return [];
    const collected: Record<string, unknown>[] = [];
    const pushList = (candidate: unknown) => {
        if (!Array.isArray(candidate)) return;
        for (const item of candidate) {
            if (item != null && typeof item === "object") {
                collected.push(item as Record<string, unknown>);
            }
        }
    };

    if (Array.isArray(body)) {
        pushList(body);
    } else if (typeof body === "object") {
        const obj = body as Record<string, unknown>;
        pushList(obj.badges);
        pushList(obj.directory_badges);
        pushList(obj.earnable_badges);
        pushList(obj.owned_badges);
        pushList(obj.items);
    }

    return collected.map(badge => {
        const rawCur = badge.current_tier ?? badge.currentTier;
        const currentTier = rawCur != null && typeof rawCur === "object" ? rawCur as Record<string, unknown> : null;
        return { badge, currentTier };
    });
}

async function triggerBadgeDirectoryFetch(userId: string, forceNetwork: boolean): Promise<void> {
    const store = getBadgeDirectoryStore();
    const existing = readDirectoryEntriesFromStore(userId);
    if (!forceNetwork && (existing.length > 0 || cachedFallbackDirectory.length > 0)) return;

    const actionFns = findAll(
        mod => typeof mod === "function"
            && (String(mod).includes("BADGE_DIRECTORY_FETCH_START") || String(mod).includes("BADGE_DIRECTORY_FETCH_SUCCESS"))
            && /\.dispatch\s*\(/.test(String(mod))
    ) as Array<(...args: unknown[]) => unknown>;

    if (actionFns.length > 0) {
        const waitDispatched = new Promise<void>(resolve => {
            let settled = false;
            const finish = () => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                FluxDispatcher.unsubscribe("BADGE_DIRECTORY_FETCH_SUCCESS", finish);
                FluxDispatcher.unsubscribe("BADGE_DIRECTORY_FETCH_FAILURE", finish);
                resolve();
            };
            const timer = setTimeout(finish, DIRECTORY_FETCH_WAIT_MS);
            FluxDispatcher.subscribe("BADGE_DIRECTORY_FETCH_SUCCESS", finish);
            FluxDispatcher.subscribe("BADGE_DIRECTORY_FETCH_FAILURE", finish);
        });

        for (const fn of actionFns) {
            try {
                const src = String(fn);
                const result = /^\s*(?:async\s+)?(?:function\s*\w*\s*)?\(\s*\{/.test(src)
                    ? fn({ userId, force: forceNetwork })
                    : fn(userId, forceNetwork);
                if (result instanceof Promise) {
                    await Promise.race([result.catch(() => undefined), waitDispatched]);
                } else {
                    await waitDispatched;
                }
                if (store != null && readDirectoryEntriesFromStore(userId).length > 0) return;
            } catch {
                // Try next candidate or REST fallback.
            }
        }
    }

    // Fallback when BadgeDirectoryStore's chunk has not loaded yet or returned empty.
    for (const url of discoverBadgeEndpoints(userId)) {
        try {
            const res = await RestAPI.get({ url });
            const extracted = extractDirectoryListFromBody(res?.body);
            if (extracted.length > 0) {
                cachedFallbackDirectory = extracted;
                return;
            }
        } catch {
            // Endpoint may not exist on older server rollouts; ignore.
        }
    }
}

function buildTrackProgress(
    track: BadgeTrack,
    parsedBadges: ReturnType<typeof parseAllUserBadges>,
    ledger: StoredProgressLedger,
    clientSeenCount: number
): TrackProgress {
    const tiers = TRACK_TIERS[track];
    const detected = parsedBadges.tracks[track];
    const profileTierIndex = detected?.tierIndex ?? -1;
    const profileTier = detected?.tier ?? null;
    const profileFloor = detected?.parsedFloor ?? 0;

    const seenFloor = track === "variety" ? clientSeenCount : 0;
    const trackedTotal = track === "time"
        ? ledger.gameHours
        : track === "variety"
            ? Math.max(ledger.varietyGames, ledger.claimedGameIds.length)
            : ledger.streamMs / 3_600_000;
    const manualBaseline = track === "time"
        ? ledger.manualTimeHours
        : track === "variety"
            ? ledger.manualVarietyGames
            : ledger.manualStreamHours;

    const rawCurrent = Math.max(profileFloor, seenFloor, trackedTotal, manualBaseline ?? 0);
    const current = track === "variety"
        ? Math.floor(rawCurrent)
        : Math.round(rawCurrent * 10) / 10;

    const baselineFloor = Math.max(profileFloor, seenFloor, manualBaseline ?? 0);
    const rawPending = Math.max(0, trackedTotal - baselineFloor);
    const pendingSync = track === "variety"
        ? Math.floor(rawPending)
        : Math.round(rawPending * 10) / 10;

    const currentTierIndex = Math.max(profileTierIndex, reachedTierIndex(current, tiers));
    const currentTier = currentTierIndex >= 0 ? tiers[currentTierIndex] : null;
    const nextTier = currentTierIndex >= tiers.length - 1 ? null : nextTierFor(current, tiers);
    const iconUrl = detected?.iconUrl ?? tierIconUrl(currentTier ?? tiers[0]);

    return {
        track,
        profileTierIndex,
        profileTier,
        profileFloor,
        clientSeenGames: seenFloor,
        trackedTotal,
        manualBaseline,
        current,
        pendingSync,
        currentTierIndex,
        currentTier,
        nextTier,
        iconUrl
    };
}

export function getAccountProgress(): AccountProgress {
    const userId = UserStore?.getCurrentUser?.()?.id ?? null;
    if (userId != null && cachedProfileUserId !== userId) {
        try {
            const storeBadges = UserProfileStore?.getUserProfile?.(userId)?.badges;
            if (Array.isArray(storeBadges)) {
                cachedProfileUserId = userId;
                cachedRawBadges = storeBadges;
            }
        } catch {
            // Ignore store lookup failures.
        }
    }

    const ledger = userId != null ? (memoryLedgers.get(userId) ?? emptyLedger()) : emptyLedger();
    const clientSeenIds = getClientSeenGameIds();
    const unionVarietyIds = new Set<string>([...clientSeenIds, ...ledger.claimedGameIds]);

    const directoryEntries = userId != null
        ? [...readDirectoryEntriesFromStore(userId), ...cachedFallbackDirectory]
        : [];
    const profileBadges = userId != null
        ? (UserProfileStore?.getUserProfile?.(userId)?.badges ?? (cachedProfileUserId === userId ? cachedRawBadges : []))
        : [];
    const parsed = parseAllUserBadges(profileBadges, directoryEntries);

    return {
        userId,
        syncedAt: cachedProfileUserId === userId ? cachedSyncedAt : null,
        loading: progressLoading,
        time: buildTrackProgress("time", parsed, ledger, 0),
        variety: buildTrackProgress("variety", parsed, ledger, unionVarietyIds.size),
        stream: buildTrackProgress("stream", parsed, ledger, 0),
        otherBadges: parsed.otherBadges
    };
}

export function getTodaySingleGameHours(gameId: string): number {
    const userId = UserStore?.getCurrentUser?.()?.id;
    if (userId == null) return 0;
    const ledger = memoryLedgers.get(userId);
    if (ledger == null) return 0;
    const hours = ledger.dailySingleGame[utcDayKey()]?.[gameId] ?? 0;
    return Math.round(hours * 10) / 10;
}

export async function syncAccountProgress(forceNetwork = false): Promise<AccountProgress> {
    const userId = UserStore?.getCurrentUser?.()?.id ?? null;
    if (userId == null) return getAccountProgress();

    progressLoading = true;
    notify();

    try {
        await ensureLedger(userId);
        await triggerBadgeDirectoryFetch(userId, forceNetwork);

        let badges: ProfileBadge[] | null = null;
        if (!forceNetwork) {
            try {
                const cached = UserProfileStore?.getUserProfile?.(userId)?.badges;
                if (Array.isArray(cached) && cached.length > 0) badges = cached;
            } catch {
                // Fall through to REST fetch.
            }
        }

        if (badges == null) {
            try {
                const res = await RestAPI.get({
                    url: `/users/${userId}/profile`,
                    query: { with_mutual_guilds: false, with_mutual_friends_count: false }
                });
                const raw = (res?.body as { badges?: unknown; } | undefined)?.badges;
                if (Array.isArray(raw)) badges = raw as ProfileBadge[];
            } catch (error) {
                logger.warn("Could not fetch profile badges", error);
            }
        }

        if (badges != null) {
            cachedProfileUserId = userId;
            cachedRawBadges = badges;
        }
        cachedSyncedAt = Date.now();
    } finally {
        progressLoading = false;
        notify();
    }

    return getAccountProgress();
}

export async function updateManualBaselines(baselines: {
    timeHours?: number | null;
    varietyGames?: number | null;
    streamHours?: number | null;
}): Promise<void> {
    const userId = UserStore?.getCurrentUser?.()?.id;
    if (userId == null) return;
    const ledger = await ensureLedger(userId);
    if (baselines.timeHours !== undefined) ledger.manualTimeHours = baselines.timeHours;
    if (baselines.varietyGames !== undefined) ledger.manualVarietyGames = baselines.varietyGames;
    if (baselines.streamHours !== undefined) ledger.manualStreamHours = baselines.streamHours;
    await persistLedger(userId, ledger);
    notify();
}

export async function resetLocalProgressCache(): Promise<void> {
    const userId = UserStore?.getCurrentUser?.()?.id;
    if (userId == null) return;
    const clean = emptyLedger();
    memoryLedgers.set(userId, clean);
    try {
        await DataStore.del(`${LEDGER_KEY_PREFIX}${userId}`);
        await DataStore.del(`${LEGACY_USED_GAMES_PREFIX}${userId}`);
    } catch {
        // Ignore IndexedDB errors.
    }
    notify();
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
    if (ms <= 0 || signal?.aborted) return Promise.resolve();
    return new Promise(resolve => {
        const onAbort = () => {
            clearTimeout(timer);
            resolve();
        };
        const timer = setTimeout(() => {
            signal?.removeEventListener("abort", onAbort);
            resolve();
        }, ms);
        signal?.addEventListener("abort", onAbort, { once: true });
    });
}

function alive(id: number): boolean {
    return running && id === runId;
}

function describeError(error: unknown): string {
    if (error instanceof Error) {
        if (error.name === "AbortError" || error.name === "TimeoutError") {
            return "Request timed out. Check your connection.";
        }
        return error.message;
    }
    if (error != null && typeof error === "object") {
        const { body, status } = error as { body?: { message?: unknown; }; status?: unknown; };
        if (status === 429) return "Discord rate limited requests. Cooling down.";
        if (status === 401 || status === 403) return "Discord rejected the session token.";
        if (typeof body?.message === "string" && body.message !== "") return body.message;
        if (typeof status === "number") return `Discord answered with HTTP ${status}.`;
    }
    return String(error);
}

function isLauncherExe(entry: DetectableExecutable): boolean {
    return entry.is_launcher === true || entry.isLauncher === true;
}

function cleanExePath(raw: string): string {
    return raw.replace(/^>/, "").trim();
}

function readExecutableBlocklist(): { exact: Set<string>; patterns: RegExp[]; } {
    const exact = new Set<string>();
    const patterns: RegExp[] = [];
    try {
        const state = getGameStore()?.getState?.();
        if (Array.isArray(state?.blocklistExecutables)) {
            for (const exe of state.blocklistExecutables) {
                if (typeof exe === "string" && exe !== "") exact.add(exe.toLowerCase());
            }
        }
        if (Array.isArray(state?.blocklistPatterns)) {
            for (const pat of state.blocklistPatterns) {
                if (typeof pat !== "string" || pat === "") continue;
                try {
                    patterns.push(new RegExp(pat, "i"));
                } catch {
                    // Ignore malformed regex entries.
                }
            }
        }
    } catch {
        // Ignore GameStore state read failures.
    }
    return { exact, patterns };
}

function isBlockedExe(exePath: string, blocklist: { exact: Set<string>; patterns: RegExp[]; }): boolean {
    const lower = exePath.toLowerCase();
    const baseName = lower.replace(/^.*[\\/]/, "");
    if (blocklist.exact.has(lower) || blocklist.exact.has(baseName)) return true;
    return blocklist.patterns.some(rx => rx.test(exePath));
}

/**
 * Keeps verified detectable entries with a numeric snowflake ID and at least one non-blocked
 * win32 executable so Discord's backend recognizes each title for Game Time and Game Variety.
 */
function normalizeApps(raw: unknown): DetectableApp[] {
    if (!Array.isArray(raw)) return [];
    const blocklist = readExecutableBlocklist();
    const seen = new Set<string>();
    const apps: DetectableApp[] = [];

    for (const item of raw) {
        if (item == null || typeof item !== "object") continue;
        const entry = item as { id?: unknown; name?: unknown; aliases?: unknown; executables?: unknown; };
        const id = typeof entry.id === "string" ? entry.id.trim() : "";
        const name = typeof entry.name === "string" ? entry.name.trim() : "";
        if (!/^\d+$/.test(id) || name === "" || seen.has(id)) continue;
        if (!Array.isArray(entry.executables)) continue;

        const winExes = entry.executables.filter((exe): exe is DetectableExecutable => {
            if (exe == null || typeof exe !== "object") return false;
            const candidate = exe as DetectableExecutable;
            if (candidate.os !== "win32" || typeof candidate.name !== "string") return false;
            const cleaned = cleanExePath(candidate.name);
            return cleaned !== "" && !isBlockedExe(cleaned, blocklist);
        });

        if (winExes.length === 0) continue;
        seen.add(id);

        const aliases = Array.isArray(entry.aliases)
            ? entry.aliases.filter((alias): alias is string => typeof alias === "string" && alias.trim() !== "")
            : undefined;

        apps.push({ id, name, aliases, executables: winExes });
    }

    return apps;
}

export function clearCatalogueCache(): void {
    cataloguePromise = null;
}

async function fetchJsonWithTimeout(url: string): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CATALOGUE_TIMEOUT_MS);
    try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.json();
    } finally {
        clearTimeout(timer);
    }
}

/** Loads Discord's detectable Windows games, preferring GameStore before API and CDN fallbacks. */
export function loadCatalogue(): Promise<DetectableApp[]> {
    try {
        const local = normalizeApps(getGameStore()?.games);
        if (local.length > 0) {
            cataloguePromise = Promise.resolve(local);
            return cataloguePromise;
        }
    } catch (error) {
        logger.warn("Could not read GameStore cache", error);
    }

    if (cataloguePromise != null) return cataloguePromise;

    cataloguePromise = (async () => {
        let lastErr: unknown = null;

        try {
            const apiRes = await RestAPI.get({ url: "/applications/detectable" });
            const apps = normalizeApps(apiRes?.body);
            if (apps.length > 0) return apps;
        } catch (error) {
            lastErr = error;
        }

        const urls = [
            `${apiOrigin()}/api/v10/applications/detectable`,
            "https://cdn.discordapp.com/detectables/games.json"
        ];
        for (const url of urls) {
            try {
                const data = await fetchJsonWithTimeout(url);
                const apps = normalizeApps(data);
                if (apps.length > 0) return apps;
            } catch (error) {
                lastErr = error;
            }
        }
        cataloguePromise = null;
        throw new Error(describeError(lastErr ?? new Error("Discord returned an empty game list.")));
    })();

    return cataloguePromise;
}

/** Preserves the relative executable path from Discord's catalog (such as "bin/win64/cs2.exe"). */
export function executableFor(app: DetectableApp): string {
    const executables = app.executables ?? [];
    const pick = executables.find(entry => entry.os === "win32" && !isLauncherExe(entry))
        ?? executables.find(entry => entry.os === "win32")
        ?? executables[0];

    const cleaned = pick?.name ? cleanExePath(pick.name) : "";
    return cleaned !== "" ? cleaned : "game.exe";
}

function specFor(app: DetectableApp): GameSpec {
    return { id: app.id, name: app.name, exeName: executableFor(app) };
}

export function shuffled<T>(items: readonly T[], count = items.length): T[] {
    const pool = [...items];
    const take = Math.min(Math.max(0, Math.floor(count)), pool.length);
    for (let index = 0; index < take; index++) {
        const picked = index + Math.floor(Math.random() * (pool.length - index));
        [pool[index], pool[picked]] = [pool[picked], pool[index]];
    }
    return pool.slice(0, take);
}

/**
 * Selects count unique games, skipping both RunningGameStore seen games and prior claimed
 * IDs first so neither real games nor prior runs get double-farmed.
 */
export async function selectFreshGames(apps: readonly DetectableApp[], count: number): Promise<DetectableApp[]> {
    const desired = Math.min(Math.max(1, Math.floor(count)), apps.length);
    const userId = UserStore?.getCurrentUser?.()?.id ?? "anon";
    const ledger = await ensureLedger(userId);
    const clientSeen = getClientSeenGameIds();
    const usedSet = new Set<string>([...clientSeen, ...ledger.claimedGameIds]);

    const nonLaunchers = apps.filter(app => !usedSet.has(app.id) && app.executables.some(e => !isLauncherExe(e)));
    const nonLauncherSet = new Set(nonLaunchers.map(app => app.id));
    const unusedRest = apps.filter(app => !usedSet.has(app.id) && !nonLauncherSet.has(app.id));
    const chosen: DetectableApp[] = [...shuffled(nonLaunchers), ...shuffled(unusedRest)].slice(0, desired);

    if (chosen.length < desired) {
        const byId = new Map(apps.map(app => [app.id, app]));
        const chosenIds = new Set(chosen.map(app => app.id));
        for (const gid of ledger.claimedGameIds) {
            const found = byId.get(gid);
            if (found != null && !chosenIds.has(found.id) && !clientSeen.has(found.id)) {
                chosen.push(found);
                chosenIds.add(found.id);
                if (chosen.length >= desired) break;
            }
        }
        if (chosen.length < desired) {
            for (const app of shuffled(apps)) {
                if (!chosenIds.has(app.id)) {
                    chosen.push(app);
                    chosenIds.add(app.id);
                    if (chosen.length >= desired) break;
                }
            }
        }
    }

    return chosen;
}

async function recordBatchProgress(options: {
    addedHours: number;
    claimedIds: readonly string[];
    singleGameId?: string;
}): Promise<void> {
    const userId = UserStore?.getCurrentUser?.()?.id;
    if (userId == null) return;

    const currentProgress = getAccountProgress();
    const ledger = await ensureLedger(userId);

    if (options.addedHours > 0) {
        const baseHours = Math.max(ledger.gameHours, currentProgress.time.current);
        ledger.gameHours = Math.round((baseHours + options.addedHours) * 100) / 100;
    }

    if (options.singleGameId != null && options.addedHours > 0) {
        const day = utcDayKey();
        const bucket = ledger.dailySingleGame[day] ?? {};
        bucket[options.singleGameId] = Math.round(((bucket[options.singleGameId] ?? 0) + options.addedHours) * 100) / 100;
        ledger.dailySingleGame = { [day]: bucket };
    }

    if (options.claimedIds.length > 0) {
        const pickedSet = new Set(options.claimedIds);
        const existingSet = new Set(ledger.claimedGameIds);
        let newlyAdded = 0;
        for (const id of options.claimedIds) {
            if (!existingSet.has(id)) newlyAdded++;
        }
        ledger.claimedGameIds = [...ledger.claimedGameIds.filter(gid => !pickedSet.has(gid)), ...options.claimedIds];
        const baseVariety = Math.max(ledger.varietyGames, currentProgress.variety.current);
        ledger.varietyGames = Math.max(ledger.claimedGameIds.length, baseVariety + newlyAdded);
    }

    await persistLedger(userId, ledger);
}

function recordStreamDeltaSync(deltaMs: number, floorMs: number): void {
    if (deltaMs <= 0) return;
    const userId = UserStore?.getCurrentUser?.()?.id;
    if (userId == null) return;
    const ledger = memoryLedgers.get(userId) ?? emptyLedger();
    ledger.streamMs = Math.max(ledger.streamMs, floorMs) + deltaMs;
    persistLedgerSync(userId, ledger);
}

function buildGame(app: GameSpec, startedAt: number): SpoofedGame {
    const folder = app.name.replace(/[<>:"/\\|?*]/g, "").trim().toLowerCase() || "game";
    const pid = 10_000 + Math.floor(Math.random() * 40_000);
    const exePath = `c:/program files/${folder}/${app.exeName}`;

    return {
        id: app.id,
        name: app.name,
        exeName: app.exeName,
        exePath,
        cmdLine: exePath,
        processName: app.name,
        pid,
        pidPath: [pid],
        start: startedAt,
        lastFocused: Math.floor(startedAt / 1_000),
        lastLaunched: startedAt,
        nativeProcessObserverId: -1,
        hidden: false,
        isLauncher: false,
        elevated: false,
        sandboxed: false
    };
}

function showGame(game: SpoofedGame | null): void {
    if (game != null) fingerprintFor(game.id);
    activeGame = game;

    if (game != null && !showSpoofedPresence) return;
    if (game == null && !dispatchedDebugPresence) return;

    try {
        FluxDispatcher.dispatch({ type: "RUNNING_GAME_SET_DEBUG_GAME", game });
        dispatchedDebugPresence = game != null;
    } catch (error) {
        logger.warn("Could not update debug game presence", error);
    }
}

function nextSlotStart(durationMs: number): number {
    const now = Date.now();
    const floor = now - MAX_SESSION_MS;
    if (durationMs >= MAX_SESSION_MS) {
        cursor = floor;
        return floor;
    }
    if (cursor - durationMs < floor) {
        cursor = now - Math.floor(Math.random() * 30_000);
    }
    cursor -= durationMs;
    return Math.max(cursor, floor);
}

function readRetryAfterMs(error: unknown): number | null {
    if (error == null || typeof error !== "object") return null;
    const obj = error as {
        body?: { retry_after?: unknown; };
        headers?: Record<string, unknown>;
    };

    const bodySeconds = obj.body?.retry_after;
    if (typeof bodySeconds === "number" && Number.isFinite(bodySeconds) && bodySeconds > 0) {
        return Math.min(Math.ceil(bodySeconds * 1_000) + 250, MAX_RATE_LIMIT_WAIT_MS);
    }

    const headerRaw = obj.headers?.["retry-after"] ?? obj.headers?.["Retry-After"];
    const headerSeconds = typeof headerRaw === "string" ? Number(headerRaw) : typeof headerRaw === "number" ? headerRaw : NaN;
    if (Number.isFinite(headerSeconds) && headerSeconds > 0) {
        return Math.min(Math.ceil(headerSeconds * 1_000) + 250, MAX_RATE_LIMIT_WAIT_MS);
    }

    return null;
}

function isRateLimited(error: unknown): boolean {
    return error != null && typeof error === "object" && (error as { status?: unknown; }).status === 429;
}

async function withRetry(id: number, label: string, action: () => Promise<void>): Promise<boolean> {
    let maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts && alive(id); attempt++) {
        try {
            await action();
            return true;
        } catch (error) {
            errors++;
            lastError = describeError(error);
            logger.error(`${label} failed on attempt ${attempt}`, error);
            notify();

            if (isRateLimited(error) && maxAttempts < 5) maxAttempts = 5;
            if (attempt < maxAttempts) {
                const delay = readRetryAfterMs(error) ?? RETRY_DELAY_MS * attempt;
                await wait(delay, runAbort?.signal);
            }
        }
    }
    return false;
}

/**
 * Spreads neededHours across unique detectable Windows games (each <= 24h) starting from startHours
 * so Discord's daily per-game aggregation cap never discards overlapping sessions and prior progress is preserved.
 */
async function runSpreadGameTime(
    id: number,
    apps: readonly DetectableApp[],
    startHours: number,
    neededHours: number,
    hoursPerGame: number,
    minUniqueGames = 1
): Promise<boolean> {
    const cappedPerGame = Math.min(Math.max(1, hoursPerGame), MAX_CHUNK_HOURS);
    const maxAchievableDelta = apps.length * cappedPerGame;
    const effectiveNeededHours = Math.min(neededHours, maxAchievableDelta);
    const neededMs = Math.round(effectiveNeededHours * 3_600_000);

    const byHoursCount = Math.max(1, Math.ceil(neededMs / Math.round(cappedPerGame * 3_600_000)));
    const gamesNeeded = Math.min(apps.length, Math.max(byHoursCount, minUniqueGames));
    const perGameMs = Math.min(
        MAX_SESSION_MS,
        Math.max(MIN_DURATION_MS, Math.ceil(neededMs / gamesNeeded))
    );

    const pool = await selectFreshGames(apps, gamesNeeded);
    if (!alive(id) || pool.length === 0) return false;

    hoursCredited = startHours;
    hoursTarget = Math.round((startHours + effectiveNeededHours) * 10) / 10;
    gamesCredited = 0;
    gamesTarget = pool.length;
    notify();

    let sentMs = 0;
    let failures = 0;

    for (let offset = 0; offset < pool.length && alive(id); offset += BATCH_SIZE) {
        const slice = pool.slice(offset, offset + BATCH_SIZE);
        const batch: PlaytimeSession[] = [];
        let plannedMs = sentMs;

        for (let idx = 0; idx < slice.length; idx++) {
            const remainingGames = pool.length - (offset + idx);
            const remainingMs = neededMs - plannedMs;
            if (remainingMs < MIN_DURATION_MS && offset + idx >= minUniqueGames) break;
            const fairShareMs = remainingGames > 0 ? Math.ceil(remainingMs / remainingGames) : perGameMs;
            const durationMs = Math.min(MAX_SESSION_MS, Math.max(MIN_DURATION_MS, Math.min(perGameMs, Math.max(fairShareMs, MIN_DURATION_MS))));
            batch.push({ game: specFor(slice[idx]), durationMs });
            plannedMs += durationMs;
        }

        if (batch.length === 0) break;

        showGame(buildGame(batch[0].game, Date.now()));
        notify();

        let batchMs = 0;
        let batchGames = 0;
        const ok = await withRetry(id, `Playtime batch (${batch.length} games)`, async () => {
            const result = await creditPlaytimeBatch(batch);
            batchMs = result.creditedMs;
            batchGames = result.sessions;
        });
        if (!alive(id)) return false;

        if (!ok) {
            if (++failures >= MAX_FAILED_BATCHES) {
                lastError = `Stopped after ${MAX_FAILED_BATCHES} failed batches in a row. Last error: ${lastError ?? "unknown"}`;
                return false;
            }
            await wait(RETRY_DELAY_MS, runAbort?.signal);
            offset -= BATCH_SIZE;
            continue;
        }

        failures = 0;
        sentMs += batchMs;
        gamesCredited += batchGames;
        hoursCredited = Math.min(hoursTarget, startHours + sentMs / 3_600_000);
        await recordBatchProgress({
            addedHours: batchMs / 3_600_000,
            claimedIds: batch.map(entry => entry.game.id)
        });
        if (lastError != null) lastError = null;
        notify();

        if (offset + BATCH_SIZE < pool.length && (neededMs - sentMs >= MIN_DURATION_MS || gamesCredited < minUniqueGames)) {
            await wait(REQUEST_DELAY_MS, runAbort?.signal);
        }
    }

    showGame(null);
    return alive(id) && neededMs - sentMs < MIN_DURATION_MS;
}

async function runSingleGameTime(
    id: number,
    app: GameSpec,
    startHours: number,
    neededHours: number,
    chunkHours: number
): Promise<boolean> {
    const chunkMs = Math.min(Math.max(1, chunkHours), MAX_CHUNK_HOURS) * 3_600_000;
    const neededMs = Math.round(neededHours * 3_600_000);
    let sentMs = 0;
    let failures = 0;

    hoursCredited = startHours;
    hoursTarget = Math.round((startHours + neededHours) * 10) / 10;
    showGame(buildGame(app, Date.now()));
    notify();

    while (alive(id) && neededMs - sentMs >= MIN_DURATION_MS) {
        const batch: PlaytimeSession[] = [];
        let plannedMs = sentMs;

        while (batch.length < BATCH_SIZE && neededMs - plannedMs >= MIN_DURATION_MS) {
            const sliceMs = Math.min(chunkMs, neededMs - plannedMs);
            if (sliceMs < MIN_DURATION_MS) break;
            batch.push({
                game: app,
                durationMs: sliceMs,
                startedAt: nextSlotStart(sliceMs)
            });
            plannedMs += sliceMs;
        }

        if (batch.length === 0) break;

        let batchCredited = 0;
        const ok = await withRetry(id, `${batch.length}-session batch for ${app.name}`, async () => {
            const result = await creditPlaytimeBatch(batch);
            batchCredited = result.creditedMs;
        });
        if (!alive(id)) return false;

        if (!ok) {
            if (++failures >= MAX_FAILED_BATCHES) {
                lastError = `Stopped after ${MAX_FAILED_BATCHES} failed requests in a row. Last error: ${lastError ?? "unknown"}`;
                return false;
            }
            await wait(RETRY_DELAY_MS, runAbort?.signal);
            continue;
        }

        failures = 0;
        sentMs += batchCredited;
        hoursCredited = Math.min(hoursTarget, startHours + sentMs / 3_600_000);
        await recordBatchProgress({
            addedHours: batchCredited / 3_600_000,
            claimedIds: [app.id],
            singleGameId: app.id
        });
        if (lastError != null && errors > 0) lastError = null;
        notify();

        if (neededMs - sentMs >= MIN_DURATION_MS) {
            await wait(REQUEST_DELAY_MS, runAbort?.signal);
        }
    }

    showGame(null);
    return alive(id) && neededMs - sentMs < MIN_DURATION_MS;
}

async function runVariety(
    id: number,
    apps: DetectableApp[],
    startGames: number,
    minutesPerGame: number
): Promise<boolean> {
    const unique: DetectableApp[] = [];
    const seen = new Set<string>();
    for (const app of apps) {
        if (app?.id && !seen.has(app.id)) {
            seen.add(app.id);
            unique.push(app);
        }
    }

    const sessionMs = Math.min(MAX_SESSION_MS, Math.max(MIN_DURATION_MS, Math.floor(minutesPerGame * 60_000)));
    let sentGames = 0;
    let failures = 0;

    gamesCredited = startGames;
    gamesTarget = startGames + unique.length;
    notify();

    for (let offset = 0; offset < unique.length; offset += BATCH_SIZE) {
        if (!alive(id)) return false;

        const slice = unique.slice(offset, offset + BATCH_SIZE);
        const specs = slice.map(specFor);
        showGame(buildGame(specs[0], Date.now()));
        notify();

        const batch: PlaytimeSession[] = specs.map(spec => ({
            game: spec,
            durationMs: sessionMs,
            startedAt: nextSlotStart(sessionMs)
        }));

        let sentCount = 0;
        let sentMs = 0;
        const ok = await withRetry(id, `Variety batch (${specs[0].name} + ${specs.length - 1} more)`, async () => {
            const result = await creditPlaytimeBatch(batch);
            sentCount = result.sessions;
            sentMs = result.creditedMs;
        });
        if (!alive(id)) return false;

        if (!ok) {
            if (++failures >= MAX_FAILED_BATCHES) {
                lastError = `Stopped after ${MAX_FAILED_BATCHES} failed batches in a row. Last error: ${lastError ?? "unknown"}`;
                return false;
            }
            await wait(RETRY_DELAY_MS, runAbort?.signal);
            offset -= BATCH_SIZE;
            continue;
        }

        failures = 0;
        sentGames += sentCount;
        gamesCredited = startGames + sentGames;
        await recordBatchProgress({
            addedHours: sentMs / 3_600_000,
            claimedIds: specs.map(spec => spec.id)
        });
        if (lastError != null) lastError = null;
        notify();

        if (offset + BATCH_SIZE < unique.length) {
            await wait(REQUEST_DELAY_MS, runAbort?.signal);
        }
    }

    showGame(null);
    return alive(id) && sentGames >= unique.length;
}

function currentVoiceChannel(): Channel | null {
    try {
        const channelId = SelectedChannelStore?.getVoiceChannelId?.();
        if (channelId == null || channelId === "") return null;
        return ChannelStore?.getChannel?.(channelId) ?? null;
    } catch {
        return null;
    }
}

function countOtherChannelMembers(channelId: string): number {
    try {
        const myId = UserStore?.getCurrentUser?.()?.id;
        const states = VoiceStateStore?.getVoiceStatesForChannel?.(channelId);
        if (states == null || typeof states !== "object") return 0;
        let count = 0;
        for (const userId of Object.keys(states)) {
            if (userId !== myId) count++;
        }
        return count;
    } catch {
        return 0;
    }
}

function voiceProblem(channel: Channel | null, requireStreamPerm = true): string | null {
    if (channel == null) return "Join a voice channel before starting.";
    if (channel.type === 13) return "Stage channels do not support Go Live. Pick a regular voice channel.";
    if (requireStreamPerm) {
        const isDm = typeof channel.isDM === "function" ? channel.isDM() : channel.type === 1;
        const isGroupDm = typeof channel.isGroupDM === "function" ? channel.isGroupDM() : channel.type === 3;
        const isGuild = !isDm && !isGroupDm;
        if (isGuild && PermissionStore?.can && !PermissionStore.can(PermissionsBits.STREAM, channel)) {
            return "You lack permission to stream in this voice channel.";
        }
    }
    return null;
}

export function getVoiceState(): VoiceReadiness {
    const channel = currentVoiceChannel();
    const problem = voiceProblem(channel, true);
    const channelName = channel == null
        ? null
        : (channel.name && channel.name.trim() !== "" ? `#${channel.name}` : "Voice Call");
    const peersInChannel = channel != null ? countOtherChannelMembers(channel.id) : 0;
    return { channelName, peersInChannel, problem };
}

function streamKeyOf(stream: { guildId: string | null; channelId: string; ownerId: string; }): string {
    return stream.guildId != null
        ? `guild:${stream.guildId}:${stream.channelId}:${stream.ownerId}`
        : `call:${stream.channelId}:${stream.ownerId}`;
}

function keepStreamUnpaused(streamKey: string): void {
    try {
        FluxDispatcher.dispatch({
            type: "STREAM_SET_PAUSED",
            streamKey,
            paused: false
        });
    } catch (error) {
        logger.warn("Could not unpause stream", error);
    }
}

function applyLowPowerStreamSettings(): void {
    if (savedStreamSettings != null) return;
    try {
        const state = getStreamingSettingsStore()?.getState?.();
        if (state != null) {
            savedStreamSettings = {
                preset: state.preset,
                resolution: state.resolution,
                fps: state.fps
            };
        }
        FluxDispatcher.dispatch({
            type: "STREAM_UPDATE_SETTINGS",
            preset: PRESET_CUSTOM,
            resolution: LOW_POWER_RESOLUTION,
            frameRate: LOW_POWER_FPS
        });
    } catch (error) {
        logger.warn("Could not apply low-power stream settings", error);
    }
}

function restoreStreamSettings(): void {
    if (savedStreamSettings == null) return;
    const restore = savedStreamSettings;
    savedStreamSettings = null;
    try {
        FluxDispatcher.dispatch({
            type: "STREAM_UPDATE_SETTINGS",
            preset: restore.preset,
            resolution: restore.resolution,
            frameRate: restore.fps
        });
    } catch (error) {
        logger.warn("Could not restore stream settings", error);
    }
}

function isRtcReady(): boolean {
    try {
        if (typeof RTCConnectionStore?.isConnected !== "function") return true;
        return RTCConnectionStore.isConnected();
    } catch {
        return true;
    }
}

function readLiveStream(): { key: string; viewers: number; } | null {
    try {
        const stream = ApplicationStreamingStore?.getCurrentUserActiveStream?.() as
            | { guildId: string | null; channelId: string; ownerId: string; state?: string; }
            | null
            | undefined;
        if (stream == null) return null;
        if (stream.state === "ENDED" || stream.state === "FAILED") return null;
        const key = streamKeyOf(stream);
        const viewerIds = ApplicationStreamingStore?.getViewerIds?.(key);
        return { key, viewers: Array.isArray(viewerIds) ? viewerIds.length : 0 };
    } catch (error) {
        logger.warn("Could not read the active stream", error);
        return null;
    }
}

export function endOwnedStream(): void {
    const shouldStop = ownsStream;
    ownsStream = false;
    try {
        if (shouldStop) {
            const stream = ApplicationStreamingStore?.getCurrentUserActiveStream?.();
            const stopFn = resolveStopStream();
            if (stream != null && typeof stopFn === "function") {
                stopFn(streamKeyOf(stream));
            }
        }
    } catch (error) {
        logger.error("Could not end the stream", error);
    } finally {
        restoreStreamSettings();
    }
}

async function fetchRawSources(types: string[]): Promise<RawDesktopSource[]> {
    const engine = MediaEngineStore?.getMediaEngine?.();
    const getSources = resolveGetDesktopSources();
    if (engine == null || typeof getSources !== "function") return [];

    try {
        const list = getSources.length === 3
            ? await getSources(engine, types, null)
            : await getSources(engine, IS_WINDOWS, types, null);
        if (Array.isArray(list) && list.length > 0) return list;
    } catch {
        // Fall through to the alternate signature below.
    }

    try {
        const list = getSources.length === 3
            ? await getSources(engine, IS_WINDOWS, types, null)
            : await getSources(engine, types, null);
        return Array.isArray(list) ? list : [];
    } catch (error) {
        logger.warn("Could not list desktop capture sources", error);
        return [];
    }
}

export async function listStreamSources(): Promise<DesktopSource[]> {
    const raw = await fetchRawSources(["screen", "window"]);
    const sources: DesktopSource[] = [];
    const seen = new Set<string>();

    for (const entry of raw) {
        if (typeof entry?.id !== "string" || entry.id === "" || seen.has(entry.id)) continue;
        seen.add(entry.id);
        const name = typeof entry.name === "string" && entry.name.trim() !== "" ? entry.name.trim() : entry.id;
        const kind: "screen" | "window" = entry.id.startsWith("window:") ? "window" : "screen";
        sources.push({ id: entry.id, name, kind });
    }

    return sources;
}

async function goLive(id: number, channel: Channel, config: StreamFarmConfig): Promise<boolean> {
    const startFn = resolveStartStream();
    const stopFn = resolveStopStream();

    if (typeof startFn !== "function") {
        lastError = "Start Share Your Screen in Discord's voice panel; BadgeFarmer will manage the stream once live.";
        return false;
    }

    try {
        const sources = await listStreamSources();
        const preferred = config.sourceId != null && config.sourceId !== ""
            ? sources.find(item => item.id === config.sourceId)
            : undefined;
        const source = preferred ?? sources.find(item => item.kind === "screen") ?? sources[0];

        if (source == null) {
            lastError = "Click Share Your Screen in Discord's voice panel to pick a window; BadgeFarmer will take over once live.";
            return false;
        }
        if (!alive(id)) return false;

        const lowPower = config.lowPower !== false;
        if (lowPower) applyLowPowerStreamSettings();

        startFn(channel.guild_id ?? null, channel.id, {
            pid: null,
            sourceId: source.id,
            sourceName: source.name,
            audioSourceId: null,
            sound: false,
            previewDisabled: lowPower
        });

        const deadline = Date.now() + STREAM_START_TIMEOUT_MS;
        while (Date.now() < deadline) {
            await wait(500);
            const stream = ApplicationStreamingStore?.getCurrentUserActiveStream?.();
            if (stream == null) continue;
            const key = streamKeyOf(stream);
            if (!alive(id)) {
                if (!running && typeof stopFn === "function") stopFn(key);
                restoreStreamSettings();
                return false;
            }
            ownsStream = true;
            keepStreamUnpaused(key);
            return true;
        }
        lastError = "Go Live did not start within 10 seconds.";
        return false;
    } catch (error) {
        lastError = `Go Live failed: ${describeError(error)}`;
        logger.error("Go Live failed", error);
        return false;
    }
}

async function runStream(
    id: number,
    startHours: number,
    neededHours: number,
    config: StreamFarmConfig = {}
): Promise<boolean> {
    const startMs = Math.round(startHours * 3_600_000);
    const neededMs = Math.round(neededHours * 3_600_000);
    const totalTargetMs = startMs + neededMs;

    streamHours = startHours;
    streamTarget = Math.round((totalTargetMs / 3_600_000) * 10) / 10;

    const noTrackState = getNoTrackStreamState();
    if (noTrackState === "disabled_in_settings") {
        lastError = 'NoTrack blocks stream badge events. Click "Enable in NoTrack" and reload Discord first.';
        notify();
        return false;
    }
    if (noTrackState === "needs_restart") {
        lastError = "Reload Discord once so NoTrack's badge tracking change takes effect.";
        notify();
        return false;
    }

    const problem = voiceProblem(currentVoiceChannel(), true);
    if (problem != null) {
        lastError = problem;
        notify();
        return false;
    }

    let sessionLiveMs = 0;
    let unsavedDeltaMs = 0;
    let lastSaveAt = Date.now();
    let lastTick = Date.now();
    let segmentStart = Date.now();
    let voiceLostSince: number | null = null;
    let restarts = 0;

    try {
        while (alive(id) && sessionLiveMs < neededMs) {
            const now = Date.now();
            const channel = currentVoiceChannel();
            const issue = voiceProblem(channel, true);

            if (issue != null) {
                if (ownsStream || sessionLiveMs > 0) {
                    voiceLostSince ??= now;
                    if (now - voiceLostSince < VOICE_RECONNECT_GRACE_MS) {
                        lastTick = now;
                        streamPaused = true;
                        lastError = "Voice connection dropped. Waiting up to 30 seconds to reconnect...";
                        notify();
                        await wait(3_000, runAbort?.signal);
                        continue;
                    }
                }
                lastError = issue;
                break;
            }
            voiceLostSince = null;

            if (!isRtcReady()) {
                lastTick = now;
                streamPaused = true;
                lastError = "Voice connection is reconnecting. Waiting for RTC...";
                notify();
                await wait(3_000, runAbort?.signal);
                continue;
            }

            const live = readLiveStream();

            if (live == null) {
                if (restarts >= STREAM_RESTART_LIMIT) {
                    lastError = `Go Live failed ${STREAM_RESTART_LIMIT} times in a row. ${lastError ?? ""}`.trim();
                    break;
                }
                restarts++;
                streamViewers = null;
                streamPaused = false;
                notify();

                if (await goLive(id, channel!, config)) {
                    restarts = 0;
                    segmentStart = Date.now();
                    lastTick = Date.now();
                    if (lastError?.startsWith("Go Live") || lastError?.startsWith("Click Share") || lastError?.startsWith("Start Share") || lastError?.startsWith("Voice connection")) {
                        lastError = null;
                    }
                } else {
                    notify();
                    lastTick = Date.now();
                    await wait(6_000, runAbort?.signal);
                }
                continue;
            }

            restarts = 0;
            ownsStream = true;
            if (config.lowPower !== false && savedStreamSettings == null) {
                applyLowPowerStreamSettings();
            }
            keepStreamUnpaused(live.key);

            const delta = Math.min(Math.max(0, now - lastTick), MAX_TICK_DELTA_MS);
            lastTick = now;
            streamViewers = live.viewers;

            if (live.viewers > 0) {
                sessionLiveMs += delta;
                unsavedDeltaMs += delta;
                streamHours = Math.min(totalTargetMs, startMs + sessionLiveMs) / 3_600_000;
                streamPaused = false;
                if (lastError != null) lastError = null;
                if (now - lastSaveAt >= STREAM_SAVE_INTERVAL_MS && unsavedDeltaMs > 0) {
                    recordStreamDeltaSync(unsavedDeltaMs, startMs + sessionLiveMs - unsavedDeltaMs);
                    unsavedDeltaMs = 0;
                    lastSaveAt = now;
                }
            } else {
                streamPaused = true;
                const others = countOtherChannelMembers(channel!.id);
                lastError = others > 0
                    ? "Waiting for a viewer. Have the other person in call click Watch Stream (or run Auto-watch on your alt)."
                    : "Waiting for a viewer. Bring an alt into this voice channel and watch your stream.";
            }

            if (config.checkpoint === true && now - segmentStart >= STREAM_CHECKPOINT_MS && sessionLiveMs < neededMs) {
                if (unsavedDeltaMs > 0) {
                    recordStreamDeltaSync(unsavedDeltaMs, startMs + sessionLiveMs - unsavedDeltaMs);
                    unsavedDeltaMs = 0;
                    lastSaveAt = now;
                }
                logger.info("Checkpointing stream so Discord flushes video_stream_ended");
                endOwnedStream();
                segmentStart = Date.now();
                await wait(STREAM_REJOIN_GAP_MS, runAbort?.signal);
                lastTick = Date.now();
                continue;
            }

            notify();
            await wait(Math.min(STREAM_TICK_MS, Math.max(1_000, neededMs - sessionLiveMs)), runAbort?.signal);
        }
    } finally {
        if (unsavedDeltaMs > 0) {
            recordStreamDeltaSync(unsavedDeltaMs, startMs + sessionLiveMs - unsavedDeltaMs);
        }
    }

    if (alive(id)) {
        endOwnedStream();
        streamViewers = null;
        streamPaused = false;
        notify();
    }

    return alive(id) && sessionLiveMs >= neededMs;
}

async function runViewerHelper(id: number): Promise<void> {
    const myId = UserStore?.getCurrentUser?.()?.id;
    const watchFn = resolveWatchStream();

    while (alive(id)) {
        const channel = currentVoiceChannel();
        const issue = voiceProblem(channel, false);
        if (issue != null) {
            watchingOwner = null;
            lastError = issue;
            notify();
            await wait(VIEWER_TICK_MS, runAbort?.signal);
            continue;
        }

        try {
            const streams = ApplicationStreamingStore?.getAllApplicationStreamsForChannel?.(channel!.id) ?? [];
            const target = streams.find(stream => stream.ownerId !== myId) ?? null;

            if (target == null) {
                watchingOwner = null;
                lastError = `Waiting for someone to Go Live in ${channel!.name ? `#${channel!.name}` : "this call"}...`;
            } else {
                const key = streamKeyOf(target);
                const active = ApplicationStreamingStore?.getActiveStreamForStreamKey?.(key);
                if (active == null) {
                    if (typeof watchFn === "function") {
                        watchFn(target, true);
                    } else {
                        FluxDispatcher.dispatch({ type: "STREAM_WATCH", streamKey: key, allowMultiple: true });
                    }
                }
                keepStreamUnpaused(key);
                watchingOwner = target.ownerId;
                lastError = null;
            }
        } catch (error) {
            logger.warn("Viewer auto-watch tick failed", error);
        }

        notify();
        await wait(VIEWER_TICK_MS, runAbort?.signal);
    }
}

function begin(nextMode: FarmerMode): number | null {
    if (running) return null;
    running = true;
    mode = nextMode;
    activeGame = null;
    hoursCredited = 0;
    hoursTarget = 0;
    gamesCredited = 0;
    gamesTarget = 0;
    streamHours = 0;
    streamTarget = 0;
    streamViewers = null;
    streamPaused = false;
    watchingOwner = null;
    errors = 0;
    lastError = null;
    finishedMessage = null;
    cursor = Date.now();
    ownsStream = false;
    runAbort = new AbortController();
    notify();
    return ++runId;
}

function end(id: number): void {
    if (id !== runId) return;
    running = false;
    mode = "IDLE";
    runAbort?.abort();
    runAbort = null;
    showGame(null);
    endOwnedStream();
    streamViewers = null;
    streamPaused = false;
    watchingOwner = null;
    notify();
}

function markFinished(message: string): void {
    finishedMessage = message;
    try {
        showToast({ text: message, variant: "success" });
    } catch (error) {
        logger.warn("Could not show completion toast", error);
    }
}

export async function startSpreadGameTime(
    apps: readonly DetectableApp[],
    hours = ETERNAL_HOURS,
    hoursPerGame = DEFAULT_HOURS_PER_GAME,
    subtractExisting = true
): Promise<void> {
    if (!Array.isArray(apps) || apps.length === 0) {
        lastError = "Game catalog is empty. Reload the list and try again.";
        notify();
        return;
    }

    const safeHours = Number.isFinite(hours) ? Math.min(Math.max(1, hours), MAX_TARGET_HOURS) : ETERNAL_HOURS;
    const safePerGame = Number.isFinite(hoursPerGame)
        ? Math.min(Math.max(1, Math.floor(hoursPerGame)), MAX_CHUNK_HOURS)
        : DEFAULT_HOURS_PER_GAME;

    const progress = await syncAccountProgress(false);
    const startHours = subtractExisting ? Math.min(safeHours, progress.time.current) : progress.time.current;
    const neededHours = subtractExisting ? Math.max(0, safeHours - startHours) : safeHours;

    if (neededHours * 3_600_000 < MIN_DURATION_MS) {
        markFinished(`Account is at ${progress.time.current.toLocaleString()} hours. Switch Goal mode to "Add full amount on top" to farm extra hours.`);
        notify();
        return;
    }

    const id = begin("GAME_TIME");
    if (id == null) return;
    try {
        const completed = await runSpreadGameTime(id, apps, startHours, neededHours, safePerGame);
        if (completed) {
            markFinished(
                `Reached ${Math.round(hoursCredited).toLocaleString()} hours (+${Math.round(neededHours).toLocaleString()}h across ${gamesCredited.toLocaleString()} games). Discord syncs badges in 24 to 48 hours.`
            );
        }
    } catch (error) {
        lastError = describeError(error);
        logger.error("Spread Game Time run crashed", error);
    } finally {
        end(id);
    }
}

export async function startSingleGameTime(
    app: DetectableApp,
    hours = DEFAULT_SINGLE_GAME_HOURS,
    chunkHours = MAX_CHUNK_HOURS,
    subtractExisting = false
): Promise<void> {
    if (app == null || typeof app.id !== "string" || typeof app.name !== "string") {
        lastError = "Pick a valid game before starting.";
        notify();
        return;
    }

    const safeHours = Number.isFinite(hours) ? Math.min(Math.max(0.1, hours), MAX_TARGET_HOURS) : DEFAULT_SINGLE_GAME_HOURS;
    const safeChunk = Number.isFinite(chunkHours) ? Math.min(Math.max(1, Math.floor(chunkHours)), MAX_CHUNK_HOURS) : MAX_CHUNK_HOURS;

    const progress = await syncAccountProgress(false);
    const startHours = subtractExisting ? Math.min(safeHours, progress.time.current) : progress.time.current;
    const neededHours = subtractExisting ? Math.max(0, safeHours - startHours) : safeHours;

    if (neededHours * 3_600_000 < MIN_DURATION_MS) {
        markFinished(`Account is at ${progress.time.current.toLocaleString()} hours.`);
        notify();
        return;
    }

    const id = begin("GAME_TIME");
    if (id == null) return;
    try {
        const completed = await runSingleGameTime(id, specFor(app), startHours, neededHours, safeChunk);
        if (completed) {
            markFinished(`Sent ${Math.round(neededHours).toLocaleString()} hours on ${app.name} (${Math.round(hoursCredited).toLocaleString()}h total). Discord syncs badges in 24 to 48 hours.`);
        }
    } catch (error) {
        lastError = describeError(error);
        logger.error("Single Game Time run crashed", error);
    } finally {
        end(id);
    }
}

export async function startVariety(
    apps: readonly DetectableApp[],
    count = UNIVERSALIST_GAMES,
    minutesPerGame = DEFAULT_VARIETY_MINUTES,
    subtractExisting = true
): Promise<void> {
    if (!Array.isArray(apps) || apps.length === 0) {
        lastError = "Game catalog is empty. Reload the list and try again.";
        notify();
        return;
    }

    const safeCount = Number.isFinite(count) ? Math.min(Math.max(1, Math.floor(count)), apps.length) : UNIVERSALIST_GAMES;
    const safeMinutes = Number.isFinite(minutesPerGame) ? Math.min(Math.max(1, minutesPerGame), 1_440) : DEFAULT_VARIETY_MINUTES;

    const progress = await syncAccountProgress(false);
    const startGames = subtractExisting ? Math.min(safeCount, progress.variety.current) : progress.variety.current;
    const neededGames = subtractExisting ? Math.max(0, safeCount - startGames) : safeCount;

    if (neededGames <= 0) {
        markFinished(`Account has ${progress.variety.current.toLocaleString()} unique games recorded. Switch Goal mode to "Add full amount on top" to claim more.`);
        notify();
        return;
    }

    const id = begin("VARIETY");
    if (id == null) return;
    try {
        const pool = await selectFreshGames(apps, neededGames);
        if (!alive(id) || pool.length === 0) return;
        const completed = await runVariety(id, pool, startGames, safeMinutes);
        if (completed) {
            markFinished(`Reached ${gamesCredited.toLocaleString()} unique Windows games (+${pool.length} new). Discord syncs badges in 24 to 48 hours.`);
        }
    } catch (error) {
        lastError = describeError(error);
        logger.error("Variety run crashed", error);
    } finally {
        end(id);
    }
}

export async function startStreamFarm(hours = ETERNAL_HOURS, config: StreamFarmConfig = {}): Promise<void> {
    const safeHours = Number.isFinite(hours) ? Math.min(Math.max(0.1, hours), MAX_TARGET_HOURS) : ETERNAL_HOURS;
    const subtractExisting = config.subtractExisting !== false;

    const progress = await syncAccountProgress(false);
    const startHours = subtractExisting ? Math.min(safeHours, progress.stream.current) : progress.stream.current;
    const neededHours = subtractExisting ? Math.max(0, safeHours - startHours) : safeHours;

    if (neededHours * 3_600_000 < 30_000) {
        markFinished(`Account has ${progress.stream.current.toLocaleString()} stream hours recorded. Pick a higher tier or switch Goal mode to "Add full amount on top".`);
        notify();
        return;
    }

    const id = begin("STREAM");
    if (id == null) return;
    try {
        const reached = await runStream(id, startHours, neededHours, config);
        if (reached) {
            markFinished(`Reached ${Math.round(streamHours).toLocaleString()} stream hours (+${(Math.round(neededHours * 10) / 10).toLocaleString()}h this run). Give Discord up to 48 hours to update the badge.`);
        }
    } catch (error) {
        lastError = describeError(error);
        logger.error("Stream run crashed", error);
    } finally {
        end(id);
    }
}

export async function startViewerWatch(): Promise<void> {
    const channel = currentVoiceChannel();
    const problem = voiceProblem(channel, false);
    if (problem != null) {
        lastError = problem;
        notify();
        return;
    }
    const id = begin("VIEWER");
    if (id == null) return;
    try {
        await runViewerHelper(id);
    } catch (error) {
        lastError = describeError(error);
        logger.error("Viewer helper crashed", error);
    } finally {
        end(id);
    }
}

export async function maxAll(apps: readonly DetectableApp[], config: StreamFarmConfig = {}): Promise<void> {
    if (!Array.isArray(apps) || apps.length === 0) {
        lastError = "Game catalog is not ready yet. Wait for it to finish loading.";
        notify();
        return;
    }

    const progress = await syncAccountProgress(false);
    const missingHours = Math.max(0, ETERNAL_HOURS - progress.time.current);
    const missingGames = Math.max(0, UNIVERSALIST_GAMES - progress.variety.current);
    const missingStreamHours = Math.max(0, ETERNAL_HOURS - progress.stream.current);

    if (missingHours * 3_600_000 < MIN_DURATION_MS && missingGames <= 0 && missingStreamHours * 3_600_000 < 30_000) {
        markFinished("Eternal, Universalist, and Phenomenon are all reached on this account.");
        notify();
        return;
    }

    const id = begin("MAX_ALL");
    if (id == null) return;
    try {
        let stepOneSummary = "Eternal + Universalist already reached";

        if (missingHours * 3_600_000 >= MIN_DURATION_MS) {
            const ok = await runSpreadGameTime(
                id,
                apps,
                progress.time.current,
                missingHours,
                DEFAULT_HOURS_PER_GAME,
                Math.max(1, missingGames)
            );
            if (!ok || !alive(id)) return;
            stepOneSummary = `+${Math.round(missingHours).toLocaleString()}h across ${gamesCredited} games`;
        } else if (missingGames > 0) {
            const pool = await selectFreshGames(apps, missingGames);
            if (!alive(id) || pool.length === 0) return;
            const ok = await runVariety(id, pool, progress.variety.current, DEFAULT_VARIETY_MINUTES);
            if (!ok || !alive(id)) return;
            stepOneSummary = `+${pool.length} games for Universalist`;
        }

        if (missingStreamHours * 3_600_000 < 30_000) {
            markFinished(`Completed ${stepOneSummary}. Phenomenon is already reached.`);
            return;
        }

        if (voiceProblem(currentVoiceChannel(), true) != null || getNoTrackStreamState() !== "ok") {
            markFinished(`Completed ${stepOneSummary}. Join a voice channel and run Streaming for the remaining ${Math.ceil(missingStreamHours).toLocaleString()}h.`);
            return;
        }

        try {
            showToast({ text: `${stepOneSummary}. Starting Go Live (${Math.ceil(missingStreamHours).toLocaleString()}h remaining).`, variant: "success" });
        } catch {
            // Toast failures are non-fatal.
        }
        const reached = await runStream(id, progress.stream.current, missingStreamHours, config);
        if (reached) {
            markFinished(`Completed ${stepOneSummary} and reached ${Math.round(streamHours).toLocaleString()} stream hours.`);
        }
    } catch (error) {
        lastError = describeError(error);
        logger.error("All three run crashed", error);
    } finally {
        end(id);
    }
}

export function stop(): void {
    if (!running) return;
    end(runId);
    runId++;
}
