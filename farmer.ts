/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Settings } from "@api/Settings";
import { IS_LINUX, IS_MAC, IS_WINDOWS } from "@utils/constants";
import { Logger } from "@utils/Logger";
import type { ApplicationStream, Channel, RunningGame } from "@vencord/discord-types";
import { findByCodeLazy } from "@webpack";
import {
    ApplicationStreamingSettingsStore,
    ApplicationStreamingStore,
    ChannelStore,
    FluxDispatcher,
    GameStore,
    MediaEngineStore,
    PermissionsBits,
    PermissionStore,
    RTCConnectionStore,
    SelectedChannelStore,
    showToast,
    UserStore,
    VoiceStateStore
} from "@webpack/common";

import {
    creditPlaytimeBatch,
    fingerprintFor,
    isAnalyticsStubbed,
    MAX_SESSION_MS,
    MAX_SESSIONS_PER_BATCH,
    MIN_DURATION_MS,
    type PlaytimeSession
} from "./science";

const logger = new Logger("BadgeFarmer");

const DETECTABLE_APPS_URL = "https://discord.com/api/v10/applications/detectable";
const CATALOGUE_TIMEOUT_MS = 20_000;

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

type RawDesktopSource = { id?: unknown; name?: unknown; };
type GetDesktopSources4 = (engine: unknown, isWindows: boolean, types: string[], options: null) => Promise<RawDesktopSource[] | null>;
type GetDesktopSources3 = (engine: unknown, types: string[], options: null) => Promise<RawDesktopSource[] | null>;

// Discord's internal Go Live action creators.
const startStream: ((guildId: string | null, channelId: string, options: StreamOptions) => void) | undefined =
    findByCodeLazy('type:"STREAM_START"');
const stopStream: ((streamKey: string) => void) | undefined =
    findByCodeLazy('type:"STREAM_STOP"');
const watchStreamAction: ((stream: ApplicationStream | string, allowMultiple?: boolean) => void) | undefined =
    findByCodeLazy('type:"STREAM_WATCH"');
const getDesktopSources: (GetDesktopSources4 & GetDesktopSources3) | undefined =
    findByCodeLazy("desktop sources");

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
    executables?: DetectableExecutable[];
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

export const ETERNAL_HOURS = 5_000;
export const UNIVERSALIST_GAMES = 100;
export const MAX_TARGET_HOURS = 1_000_000;
export const MAX_CHUNK_HOURS = 24;
export const DEFAULT_CHUNK_HOURS = 24;
export const DEFAULT_VARIETY_MINUTES = 2;
export const BATCH_SIZE = MAX_SESSIONS_PER_BATCH;

const REQUEST_DELAY_MS = 500;
const RETRY_DELAY_MS = 3_000;
const MAX_RATE_LIMIT_WAIT_MS = 30_000;
const MAX_FAILED_BATCHES = 5;

// Optional periodic checkpoint to flush video_stream_ended when paired with an auto-watching alt.
const STREAM_CHECKPOINT_MS = 2 * 60 * 60 * 1_000;
const STREAM_REJOIN_GAP_MS = 2_500;
const STREAM_TICK_MS = 8_000;
const VIEWER_TICK_MS = 4_000;
const MAX_TICK_DELTA_MS = STREAM_TICK_MS * 3;
const STREAM_START_TIMEOUT_MS = 10_000;
const STREAM_RESTART_LIMIT = 4;

/** Compact browser console snippet users can paste on an unmodded alt tab to auto-watch and stay unpaused 24/7. */
export const ALT_WATCH_SNIPPET = `(() => {
  if (window.__bfWatch) clearInterval(window.__bfWatch);
  let Dispatcher, StreamStore, ChannelStore;
  webpackChunkdiscord_app.push([[Symbol()], {}, req => {
    for (const m of Object.values(req.c)) {
      const e = m?.exports;
      for (const c of [e, e?.default, e?.Z, e?.ZP]) {
        if (!c) continue;
        if (c.dispatch && c.subscribe) Dispatcher = c;
        if (c.getName?.() === "ApplicationStreamingStore") StreamStore = c;
        if (c.getName?.() === "SelectedChannelStore") ChannelStore = c;
      }
    }
  }]);
  if (!Dispatcher || !StreamStore || !ChannelStore) return console.error("[BadgeFarmer] Discord stores not found.");
  const tick = () => {
    const ch = ChannelStore.getVoiceChannelId?.();
    if (!ch) return;
    const streams = StreamStore.getAllApplicationStreamsForChannel?.(ch) ?? [];
    for (const s of streams) {
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
let savedStreamSettings: SavedStreamSettings | null = null;

let cataloguePromise: Promise<DetectableApp[]> | null = null;

const listeners = new Set<() => void>();

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

function normalizeApps(raw: unknown): DetectableApp[] {
    if (!Array.isArray(raw)) return [];
    const seen = new Set<string>();
    const apps: DetectableApp[] = [];

    for (const item of raw) {
        if (item == null || typeof item !== "object") continue;
        const entry = item as { id?: unknown; name?: unknown; aliases?: unknown; executables?: unknown; };
        if (typeof entry.id !== "string" || typeof entry.name !== "string") continue;
        const name = entry.name.trim();
        if (name === "" || seen.has(entry.id)) continue;
        seen.add(entry.id);

        const aliases = Array.isArray(entry.aliases)
            ? entry.aliases.filter((alias): alias is string => typeof alias === "string" && alias.trim() !== "")
            : undefined;
        const executables = Array.isArray(entry.executables)
            ? entry.executables.filter((exe): exe is DetectableExecutable =>
                exe != null && typeof exe === "object" && typeof (exe as { name?: unknown; }).name === "string")
            : undefined;

        apps.push({ id: entry.id, name, aliases, executables });
    }

    return apps;
}

export function clearCatalogueCache(): void {
    cataloguePromise = null;
}

/** Loads Discord's detectable games, preferring the in-memory GameStore cache before HTTP. */
export function loadCatalogue(): Promise<DetectableApp[]> {
    try {
        const local = normalizeApps(GameStore?.games);
        if (local.length > 0) {
            cataloguePromise = Promise.resolve(local);
            return cataloguePromise;
        }
    } catch (error) {
        logger.warn("Could not read GameStore cache", error);
    }

    if (cataloguePromise != null) return cataloguePromise;

    cataloguePromise = (async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), CATALOGUE_TIMEOUT_MS);
        try {
            const response = await fetch(DETECTABLE_APPS_URL, { signal: controller.signal });
            if (!response.ok) throw new Error(`Discord answered with HTTP ${response.status}.`);
            const data: unknown = await response.json();
            const apps = normalizeApps(data);
            if (apps.length === 0) throw new Error("Discord returned an empty game list.");
            return apps;
        } catch (error) {
            cataloguePromise = null;
            throw new Error(describeError(error));
        } finally {
            clearTimeout(timer);
        }
    })();

    return cataloguePromise;
}

function preferredOs(): string {
    if (IS_WINDOWS) return "win32";
    if (IS_MAC) return "darwin";
    if (IS_LINUX) return "linux";
    return "win32";
}

function isLauncherExe(entry: DetectableExecutable): boolean {
    return entry.is_launcher === true || entry.isLauncher === true;
}

export function executableFor(app: DetectableApp): string {
    const executables = app.executables ?? [];
    const os = preferredOs();
    const executable = executables.find(entry => entry.os === os && !isLauncherExe(entry))
        ?? executables.find(entry => entry.os === "win32" && !isLauncherExe(entry))
        ?? executables.find(entry => entry.os === os)
        ?? executables.find(entry => entry.os === "win32")
        ?? executables.find(entry => !isLauncherExe(entry))
        ?? executables[0];

    const fallback = `${app.name.replace(/[<>:"/\\|?*]/g, "").trim() || "game"}.exe`;
    const cleaned = executable?.name?.replace(/^>/, "").replace(/^.*[\\/]/, "").trim();
    return cleaned && cleaned !== "" ? cleaned : fallback;
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
    try {
        FluxDispatcher.dispatch({ type: "RUNNING_GAME_SET_DEBUG_GAME", game });
    } catch (error) {
        logger.warn("Could not set debug game on presence", error);
    }
}

/** Hands out back-to-back slots within Discord's 24-hour window so shorter sessions do not overlap. */
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

async function runGameTime(id: number, app: GameSpec, targetHours: number, chunkHours: number): Promise<boolean> {
    const chunkMs = Math.min(Math.max(1, chunkHours), MAX_CHUNK_HOURS) * 3_600_000;
    const targetMs = Math.round(targetHours * 3_600_000);
    let creditedMs = 0;
    let failures = 0;

    hoursTarget = targetHours;
    showGame(buildGame(app, Date.now()));
    notify();

    while (alive(id) && targetMs - creditedMs >= MIN_DURATION_MS) {
        const batch: PlaytimeSession[] = [];
        let plannedMs = creditedMs;

        while (batch.length < BATCH_SIZE && targetMs - plannedMs >= MIN_DURATION_MS) {
            const sliceMs = Math.min(chunkMs, targetMs - plannedMs);
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
            continue;
        }

        failures = 0;
        creditedMs += batchCredited;
        hoursCredited = Math.min(creditedMs, targetMs) / 3_600_000;
        if (lastError != null && errors > 0) lastError = null;
        notify();

        if (targetMs - creditedMs >= MIN_DURATION_MS) {
            await wait(REQUEST_DELAY_MS, runAbort?.signal);
        }
    }

    return alive(id) && targetMs - creditedMs < MIN_DURATION_MS;
}

async function runVariety(id: number, apps: DetectableApp[], minutesPerGame: number): Promise<boolean> {
    const unique: DetectableApp[] = [];
    const seen = new Set<string>();
    for (const app of apps) {
        if (app?.id && !seen.has(app.id)) {
            seen.add(app.id);
            unique.push(app);
        }
    }

    const sessionMs = Math.min(MAX_SESSION_MS, Math.max(MIN_DURATION_MS, Math.floor(minutesPerGame * 60_000)));
    let failures = 0;
    gamesTarget = unique.length;
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
        const ok = await withRetry(id, `Variety batch (${specs[0].name} + ${specs.length - 1} more)`, async () => {
            const result = await creditPlaytimeBatch(batch);
            sentCount = result.sessions;
        });
        if (!alive(id)) return false;

        if (!ok) {
            if (++failures >= MAX_FAILED_BATCHES) {
                lastError = `Stopped after ${MAX_FAILED_BATCHES} failed batches in a row. Last error: ${lastError ?? "unknown"}`;
                return false;
            }
            continue;
        }

        failures = 0;
        gamesCredited += sentCount;
        if (lastError != null) lastError = null;
        notify();

        if (offset + BATCH_SIZE < unique.length) {
            await wait(REQUEST_DELAY_MS, runAbort?.signal);
        }
    }

    showGame(null);
    return alive(id) && gamesCredited >= unique.length;
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
        const state = ApplicationStreamingSettingsStore?.getState?.();
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
            if (stream != null && typeof stopStream === "function") {
                stopStream(streamKeyOf(stream));
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
    if (engine == null || typeof getDesktopSources !== "function") return [];

    // Try Discord's current 4-argument signature first, then fall back to the 3-argument signature.
    try {
        const list = getDesktopSources.length === 3
            ? await getDesktopSources(engine, types, null)
            : await getDesktopSources(engine, IS_WINDOWS, types, null);
        if (Array.isArray(list) && list.length > 0) return list;
    } catch {
        // Fall through to the alternate signature below.
    }

    try {
        const list = getDesktopSources.length === 3
            ? await getDesktopSources(engine, IS_WINDOWS, types, null)
            : await getDesktopSources(engine, types, null);
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
    if (typeof startStream !== "function" || typeof getDesktopSources !== "function") {
        lastError = "Go Live requires the Discord desktop app.";
        return false;
    }

    try {
        const sources = await listStreamSources();
        const preferred = config.sourceId != null && config.sourceId !== ""
            ? sources.find(item => item.id === config.sourceId)
            : undefined;
        const source = preferred ?? sources.find(item => item.kind === "screen") ?? sources[0];

        if (source == null) {
            lastError = "Discord found no screen or window to share.";
            return false;
        }
        if (!alive(id)) return false;

        const lowPower = config.lowPower !== false;
        if (lowPower) applyLowPowerStreamSettings();

        startStream(channel.guild_id ?? null, channel.id, {
            pid: null,
            sourceId: source.id,
            sourceName: source.name,
            audioSourceId: null,
            sound: false,
            previewDisabled: lowPower
        });

        // Keep polling after Stop so a late stream gets ended instead of staying live.
        const deadline = Date.now() + STREAM_START_TIMEOUT_MS;
        while (Date.now() < deadline) {
            await wait(500);
            const stream = ApplicationStreamingStore?.getCurrentUserActiveStream?.();
            if (stream == null) continue;
            const key = streamKeyOf(stream);
            if (!alive(id)) {
                if (!running && typeof stopStream === "function") stopStream(key);
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

async function runStream(id: number, targetHours: number, config: StreamFarmConfig = {}): Promise<boolean> {
    const targetMs = Math.round(targetHours * 3_600_000);
    streamTarget = targetHours;

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

    let liveMs = 0;
    let lastTick = Date.now();
    let segmentStart = Date.now();
    let restarts = 0;

    while (alive(id) && liveMs < targetMs) {
        const channel = currentVoiceChannel();
        const issue = voiceProblem(channel, true);
        if (issue != null) {
            lastError = issue;
            break;
        }

        const now = Date.now();
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
                if (lastError?.startsWith("Go Live") || lastError?.startsWith("Voice connection")) {
                    lastError = null;
                }
            } else {
                lastTick = Date.now();
                await wait(5_000, runAbort?.signal);
            }
            continue;
        }

        // Adopt the active stream so stopping or finishing dispatches STREAM_STOP and flushes video_stream_ended.
        ownsStream = true;
        if (config.lowPower !== false && savedStreamSettings == null) {
            applyLowPowerStreamSettings();
        }
        keepStreamUnpaused(live.key);

        // Clamp delta so OS sleep/wake jumps cannot fabricate fake stream hours.
        const delta = Math.min(Math.max(0, now - lastTick), MAX_TICK_DELTA_MS);
        lastTick = now;
        streamViewers = live.viewers;

        if (live.viewers > 0) {
            liveMs += delta;
            streamHours = Math.min(liveMs, targetMs) / 3_600_000;
            streamPaused = false;
            if (lastError?.startsWith("Waiting for a viewer") || lastError?.startsWith("Voice connection")) {
                lastError = null;
            }
        } else {
            streamPaused = true;
            const others = countOtherChannelMembers(channel!.id);
            lastError = others > 0
                ? "Waiting for a viewer. Have the other person in call click Watch Stream (or run Auto-watch on your alt)."
                : "Waiting for a viewer. Bring an alt into this voice channel and watch your stream.";
        }

        if (config.checkpoint === true && now - segmentStart >= STREAM_CHECKPOINT_MS && liveMs < targetMs) {
            logger.info("Checkpointing stream so Discord flushes video_stream_ended");
            endOwnedStream();
            segmentStart = Date.now();
            await wait(STREAM_REJOIN_GAP_MS, runAbort?.signal);
            lastTick = Date.now();
            continue;
        }

        notify();
        await wait(Math.min(STREAM_TICK_MS, Math.max(1_000, targetMs - liveMs)), runAbort?.signal);
    }

    if (alive(id)) {
        endOwnedStream();
        streamViewers = null;
        streamPaused = false;
        notify();
    }

    return alive(id) && liveMs >= targetMs;
}

async function runViewerHelper(id: number): Promise<void> {
    const myId = UserStore?.getCurrentUser?.()?.id;

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
                    if (typeof watchStreamAction === "function") {
                        watchStreamAction(target, true);
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

export async function startGameTime(app: DetectableApp, hours = ETERNAL_HOURS, chunkHours = DEFAULT_CHUNK_HOURS): Promise<void> {
    if (app == null || typeof app.id !== "string" || typeof app.name !== "string") {
        lastError = "Pick a valid game before starting.";
        notify();
        return;
    }
    const safeHours = Number.isFinite(hours) ? Math.min(Math.max(0.1, hours), MAX_TARGET_HOURS) : ETERNAL_HOURS;
    const safeChunk = Number.isFinite(chunkHours) ? Math.min(Math.max(1, Math.floor(chunkHours)), MAX_CHUNK_HOURS) : DEFAULT_CHUNK_HOURS;
    const id = begin("GAME_TIME");
    if (id == null) return;
    try {
        const completed = await runGameTime(id, specFor(app), safeHours, safeChunk);
        if (completed) {
            markFinished(`Sent ${Math.round(hoursCredited).toLocaleString()} hours of ${app.name}. Discord updates badges overnight.`);
        }
    } catch (error) {
        lastError = describeError(error);
        logger.error("Game Time run crashed", error);
    } finally {
        end(id);
    }
}

export async function startVariety(apps: DetectableApp[], minutesPerGame = DEFAULT_VARIETY_MINUTES): Promise<void> {
    if (!Array.isArray(apps) || apps.length === 0) {
        lastError = "Game catalog is empty. Reload the list and try again.";
        notify();
        return;
    }
    const safeMinutes = Number.isFinite(minutesPerGame) ? Math.min(Math.max(1, minutesPerGame), 1_440) : DEFAULT_VARIETY_MINUTES;
    const id = begin("VARIETY");
    if (id == null) return;
    try {
        const completed = await runVariety(id, apps, safeMinutes);
        if (completed) {
            markFinished(`Sent sessions for ${gamesCredited} games. Discord updates badges overnight.`);
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
    const id = begin("STREAM");
    if (id == null) return;
    try {
        const reached = await runStream(id, safeHours, config);
        if (reached) {
            markFinished(`Streamed ${Math.round(streamHours).toLocaleString()} hours. Give Discord up to 48 hours to update the badge.`);
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

export async function maxAll(apps: DetectableApp[], config: StreamFarmConfig = {}): Promise<void> {
    if (!Array.isArray(apps) || apps.length === 0) {
        lastError = "Game catalog is not ready yet. Wait for it to finish loading.";
        notify();
        return;
    }
    const id = begin("MAX_ALL");
    if (id == null) return;
    try {
        const pool = shuffled(apps, UNIVERSALIST_GAMES);
        if (pool.length === 0) {
            lastError = "Could not pick games from the catalog.";
            return;
        }

        const varietyOk = await runVariety(id, pool, DEFAULT_VARIETY_MINUTES);
        if (!varietyOk || !alive(id)) return;

        const timeOk = await runGameTime(id, specFor(pool[0]), ETERNAL_HOURS, DEFAULT_CHUNK_HOURS);
        if (!timeOk || !alive(id)) return;

        const summary = `${gamesCredited} games and ${Math.round(hoursCredited).toLocaleString()} hours of ${pool[0].name}`;

        if (voiceProblem(currentVoiceChannel(), true) != null || getNoTrackStreamState() !== "ok") {
            markFinished(`Sent ${summary}. Join a voice channel and run Streaming on its own for the third badge.`);
            return;
        }

        try {
            showToast({ text: `Sent ${summary}. Starting Go Live for the streaming badge.`, variant: "success" });
        } catch {
            // Toast failures are non-fatal.
        }
        const reached = await runStream(id, ETERNAL_HOURS, config);
        if (reached) {
            markFinished(`Finished ${summary}, plus ${Math.round(streamHours).toLocaleString()} hours streamed.`);
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
