/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { isPluginEnabled } from "@api/PluginManager";
import { Logger } from "@utils/Logger";
import { sleep } from "@utils/misc";
import type { RunningGame } from "@vencord/discord-types";
import { findByCodeLazy } from "@webpack";
import { ApplicationStreamingStore, ChannelStore, FluxDispatcher, SelectedChannelStore, showToast } from "@webpack/common";

import { creditPlaytime, fingerprintFor, type StreamLocation } from "./science";

const logger = new Logger("BadgeFarmer:Farmer");

interface StreamSourceInfo {
    sourceId: string;
    sourceName: string;
    sourceIcon?: string;
    sourcePid?: number | null;
}

// The client's own Go Live entry point. It performs permission checks,
// negotiates the stream with the media servers, and starts the real
// capture pipeline. This is the exact call the Go Live button makes.
const startStreamWithSource = findByCodeLazy("no user or channel") as
    (source: StreamSourceInfo | number, opts?: { sound?: boolean; soundshareEnabled?: boolean; }) => Promise<[boolean, string | undefined]>;

export interface DetectableApp {
    id: string;
    name: string;
    executables?: Array<{ name: string; os?: string; is_launcher?: boolean; }>;
}

export interface SpoofedGame extends Omit<RunningGame, "distributor"> {
    id: string;
    pid: number;
    exeName: string;
    pidPath: number[];
    processName: string;
    start: number;
}

export type FarmerMode = "IDLE" | "GAME_TIME" | "VARIETY" | "STREAM" | "MAX_ALL";

export interface FarmerStatus {
    mode: FarmerMode;
    activeGame: SpoofedGame | null;
    varietyIndex: number;
    varietyTotal: number;
    gamesCreditedThisRun: number;
    hoursCreditedThisRun: number;
    streamHoursCreditedThisRun: number;
    streamBatch: number;
    streamBatches: number;
    errors: number;
    lastError: string | null;
    notrackBlocked: boolean;
    finishedMessage: string | null;
}

export const MAX_TIME_HOURS = 1000000;
export const MAX_VARIETY_GAMES = 100;
export const DEFAULT_VARIETY_MINUTES = 2;
export const DEFAULT_CHUNK_HOURS = 24;
const MAX_CHUNK_HOURS = 500;
const REQUEST_DELAY_MS = 600;
const RETRY_DELAY_MS = 3_000;

let mode: FarmerMode = "IDLE";
let activeGame: SpoofedGame | null = null;
let varietyList: SpoofedGame[] = [];
let varietyIndex = 0;
let gamesCredited = 0;
let hoursCredited = 0;
let streamHoursCredited = 0;
let streamMinutesCredited = 0;
let streamBatch = 0;
let streamBatches = 0;
let errors = 0;
let lastError: string | null = null;
let finishedMessage: string | null = null;
let running = false;
let abortToken = 0;
let cursor = 0;

const listeners = new Set<() => void>();

export function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

function notify(): void {
    for (const listener of listeners) listener();
}

export function getStatus(): FarmerStatus {
    return {
        mode,
        activeGame,
        varietyIndex: varietyIndex < varietyList.length ? varietyIndex : varietyList.length,
        varietyTotal: varietyList.length,
        gamesCreditedThisRun: gamesCredited,
        hoursCreditedThisRun: hoursCredited,
        streamHoursCreditedThisRun: streamHoursCredited,
        streamBatch,
        streamBatches,
        errors,
        lastError,
        notrackBlocked: isPluginEnabled("NoTrack"),
        finishedMessage
    };
}

export function executableFor(app: DetectableApp): string {
    const executables = app.executables ?? [];
    const executable = executables.find(entry => entry.os === "win32" && entry.is_launcher !== true)
        ?? executables.find(entry => entry.os === "win32")
        ?? executables[0];

    return (executable?.name.replace(/^>/, "") ?? `${app.name}.exe`).replace(/^.*[\\/]/, "");
}

export function buildGame(app: { id: string; name: string; exeName: string; }, startedAt: number): SpoofedGame {
    const folder = app.name.replace(/[<>:"/\\|?*]/g, "").toLowerCase();
    const pid = 10_000 + Math.floor(Math.random() * 40_000);

    return {
        id: app.id,
        name: app.name,
        exeName: app.exeName,
        exePath: `c:/program files/${folder}/${app.exeName}`,
        cmdLine: `c:/program files/${folder}/${app.exeName}`,
        processName: app.name,
        pid,
        pidPath: [pid],
        start: startedAt,
        lastFocused: Math.floor(startedAt / 1000),
        lastLaunched: startedAt,
        nativeProcessObserverId: -1,
        hidden: false,
        isLauncher: false,
        elevated: false,
        sandboxed: false
    };
}

function setDebugGame(game: SpoofedGame | null): void {
    FluxDispatcher.dispatch({ type: "RUNNING_GAME_SET_DEBUG_GAME", game });
}

function showGame(game: SpoofedGame): void {
    fingerprintFor(game.id);
    activeGame = game;
    setDebugGame(game);
}

function clearGame(): void {
    activeGame = null;
    setDebugGame(null);
}

interface Slot {
    start: number;
    end: number;
}

function nextSlot(durationMs: number): Slot {
    const end = cursor;
    const start = end - durationMs;
    cursor = start;
    return { start, end };
}

async function withRetry(label: string, action: () => Promise<void>): Promise<boolean> {
    for (let attempt = 0; attempt < 3 && running; attempt++) {
        try {
            await action();
            return true;
        } catch (error) {
            errors++;
            lastError = String(error);
            logger.error(`${label} failed (attempt ${attempt + 1})`, error);
            if (attempt < 2) await sleep(RETRY_DELAY_MS);
        }
    }
    return false;
}

const MAX_FAILED_BURSTS = 5;

function shuffled<T>(items: T[]): T[] {
    const pool = [...items];
    for (let index = pool.length - 1; index > 0; index--) {
        const picked = Math.floor(Math.random() * (index + 1));
        [pool[index], pool[picked]] = [pool[picked], pool[index]];
    }
    return pool;
}

async function creditGameChunk(game: SpoofedGame, hours: number): Promise<void> {
    const slot = nextSlot(hours * 3_600_000);
    await creditPlaytime(game, hours * 3_600_000, slot.start);
    hoursCredited += hours;
}

async function creditVarietySession(game: SpoofedGame, minutes: number): Promise<void> {
    const slot = nextSlot(minutes * 60_000);
    await creditPlaytime(game, minutes * 60_000, slot.start);
    gamesCredited++;
}

/**
 * Reads the user's actual live stream from ApplicationStreamingStore.
 * Stream objects carry channelId/guildId directly. Returns the location and
 * viewer count, or null when not currently live.
 */
function activeLiveStream(): { location: StreamLocation; viewers: number; } | null {
    try {
        const stream = ApplicationStreamingStore.getCurrentUserActiveStream();
        if (stream == null) return null;

        const { channelId } = (stream as { channelId?: string; });
        if (typeof channelId !== "string" || channelId === "") return null;

        const { guildId } = (stream as { guildId?: string | null; });

        const viewers = ApplicationStreamingStore.getViewerIds(stream).length;
        return { location: { guildId: guildId ?? "0", channelId }, viewers };
    } catch (error) {
        logger.warn("Could not read active stream", error);
        return null;
    }
}

/**
 * Client-native Go Live streaming. Research across every working tool
 * (BadgeMaxxer at 283 stars, discord-streamer, the badge-spoofers) says the
 * same thing: the streaming badge validates REAL media sessions server-side.
 * Science telemetry alone never counts. The winning approach is a genuine
 * Go Live stream kept alive hour by hour, with a viewer in the channel.
 *
 * This implementation drives Discord's own media engine: the same
 * startStreamWithSource call the Go Live button makes, the real capture
 * pipeline, the real voice connection. Every frame is genuine from the
 * server's perspective. The stream claims a screen source, so what gets
 * broadcast is whatever the capture pipeline picks up. A frozen or near
 * black screen still registers as a live media session.
 *
 * Discord ends streams at the 5 hour mark, so we rotate: stop, brief gap,
 * go live again. Hours accumulate across segments.
 */
const STREAM_ROTATE_MS = 4 * 60 * 60 * 1_000;
const STREAM_REJOIN_GAP_MS = 3_000;
const STREAM_RECREATE_LIMIT = 3;

function currentVoiceChannel(): { guildId: string | null; channelId: string; } | null {
    const channelId = SelectedChannelStore.getVoiceChannelId();
    if (typeof channelId !== "string" || channelId === "") return null;
    const channel = ChannelStore.getChannel(channelId);
    const guildId = channel != null
        ? ((channel as unknown as { getGuildId?: () => string; }).getGuildId?.() ?? (channel as unknown as { guild_id?: string }).guild_id ?? null)
        : null;
    return { guildId: guildId ?? null, channelId };
}

async function goLiveOnce(): Promise<boolean> {
    const [ok, reason] = await startStreamWithSource({
        sourceId: "entire-screen",
        sourceName: "Screen 1"
    });
    if (!ok) {
        logger.warn(`Go Live refused: ${reason ?? "unknown reason"}`);
        return false;
    }
    return true;
}

function stopLive(): void {
    const stream = ApplicationStreamingStore.getCurrentUserActiveStream();
    if (stream == null) return;
    const channelId = (stream as { channelId?: string; }).channelId ?? "";
    const guildId = (stream as { guildId?: string | null; }).guildId ?? null;
    const ownerId = (stream as { ownerId?: string; }).ownerId ?? "";
    if (guildId == null) return;
    // STREAM_STOP dispatch through the client's own action creator
    FluxDispatcher.dispatch({
        type: "STREAM_STOP",
        streamKey: `guild:${guildId}:${channelId}:${ownerId}`,
        appContext: "APP"
    });
}

async function runStream(targetHours: number): Promise<void> {
    const targetMs = targetHours * 3_600_000;
    const startedAt = Date.now();
    let segmentStart = Date.now();
    let recreates = 0;

    const voice = currentVoiceChannel();
    if (voice == null) {
        lastError = "Join a voice channel first, then start the stream farm. Hours only count while live with a viewer watching.";
        logger.warn(lastError);
        notify();
        return;
    }

    logger.info(`Stream farm: go live in ${voice.channelId}, target ${targetHours}h`);
    notify();

    while (running && Date.now() - startedAt < targetMs) {
        // Go live if we're not already
        const current = activeLiveStream();
        if (current == null) {
            if (recreates >= STREAM_RECREATE_LIMIT) {
                lastError = "Go Live kept failing. Check stream permissions in this channel and try again.";
                logger.error(lastError);
                break;
            }
            const ok = await goLiveOnce();
            if (!ok) {
                recreates++;
                await sleep(5_000);
                continue;
            }
            recreates = 0;
            segmentStart = Date.now();
            logger.info("Go Live active");
        }

        // Rotate before Discord's 5h cutoff kills the stream
        const segmentAge = Date.now() - segmentStart;
        if (segmentAge >= STREAM_ROTATE_MS) {
            logger.info("4h segment done, rotating stream before the 5h limit");
            stopLive();
            await sleep(STREAM_REJOIN_GAP_MS);
            continue;
        }

        // Track progress + verify the stream is still alive
        const check = activeLiveStream();
        if (check != null) {
            streamHoursCredited = (Date.now() - startedAt) / 3_600_000;
            streamMinutesCredited = Math.round((Date.now() - startedAt) / 60_000);
            streamBatch = streamMinutesCredited % 60;
            streamBatches = 60;
            if (check.viewers === 0) {
                lastError = "Nobody is watching. Hours only count with a viewer in the channel. Bring an alt.";
            } else if (lastError?.startsWith("Nobody is watching")) {
                lastError = null;
            }
        } else {
            // Stream died unexpectedly; the loop's go-live step will restart it
            recreates++;
        }

        notify();
        await sleep(30_000);
    }

    if (running) {
        stopLive();
    }
    streamHoursCredited = Math.min((Date.now() - startedAt) / 3_600_000, targetHours);
    notify();
    logger.info(`Stream farm ended at ${streamHoursCredited.toFixed(2)}h`);
}

async function runGameTime(app: { id: string; name: string; exeName: string; }, targetHours: number, chunkHours = DEFAULT_CHUNK_HOURS): Promise<void> {
    let credited = 0;
    let failedBursts = 0;
    const chunkSize = Math.min(Math.max(1, chunkHours), MAX_CHUNK_HOURS);
    while (running && credited < targetHours) {
        const chunk = Math.min(chunkSize, targetHours - credited);
        const game = activeGame ?? buildGame(app, cursor);
        showGame(game);
        const ok = await withRetry(`Game time chunk (${chunk}h ${game.name})`, () => creditGameChunk(game, chunk));
        if (!ok) {
            if (++failedBursts >= MAX_FAILED_BURSTS) {
                lastError = "Stopped after repeated failures";
                return;
            }
            continue;
        }
        failedBursts = 0;
        credited += chunk;
        notify();
        await sleep(REQUEST_DELAY_MS);
    }
}

async function runVariety(list: SpoofedGame[], minutesPerGame: number): Promise<void> {
    for (varietyIndex = 0; varietyIndex < list.length && running; varietyIndex++) {
        const game = list[varietyIndex];
        showGame(game);
        await withRetry(`Variety session ${game.name}`, () => creditVarietySession(game, minutesPerGame));
        notify();
        await sleep(REQUEST_DELAY_MS);
    }
}

function begin(nextMode: FarmerMode): boolean {
    if (running) return false;
    running = true;
    mode = nextMode;
    gamesCredited = 0;
    hoursCredited = 0;
    streamHoursCredited = 0;
    streamMinutesCredited = 0;
    streamBatch = 0;
    streamBatches = 0;
    errors = 0;
    lastError = null;
    finishedMessage = null;
    cursor = Date.now();
    abortToken++;
    notify();
    return true;
}

function markFinished(message: string): void {
    finishedMessage = message;
    showToast({ text: message, variant: "success" });
}

type GameSpec = { id: string; name: string; exeName: string; };

export async function startGameTime(app: DetectableApp, hours = MAX_TIME_HOURS, chunkHours = DEFAULT_CHUNK_HOURS): Promise<void> {
    const spec: GameSpec = { id: app.id, name: app.name, exeName: executableFor(app) };
    if (!begin("GAME_TIME")) return;
    const token = abortToken;
    try {
        await runGameTime(spec, hours, chunkHours);
        if (running && hoursCredited >= hours) {
            markFinished(`Game Time done. ${Math.round(hoursCredited)}h credited to ${spec.name}. Badge updates on the next nightly pass.`);
        }
    } finally {
        if (token === abortToken) finish();
    }
}

export async function startVariety(apps: DetectableApp[], minutesPerGame = DEFAULT_VARIETY_MINUTES): Promise<void> {
    if (!begin("VARIETY")) return;
    varietyList = apps.map(app => buildGame({ id: app.id, name: app.name, exeName: executableFor(app) }, cursor));
    varietyIndex = 0;
    const token = abortToken;
    try {
        await runVariety(varietyList, minutesPerGame);
        if (running && gamesCredited >= varietyList.length) {
            markFinished(`Variety done. ${gamesCredited} games credited. Badge updates on the next nightly pass.`);
        }
    } finally {
        if (token === abortToken) finish();
    }
}

export async function startStream(hours = MAX_TIME_HOURS): Promise<void> {
    if (!begin("STREAM")) return;
    const token = abortToken;
    try {
        await runStream(hours);
        if (running && streamHoursCredited >= hours) {
            markFinished(`Streaming done. ${Math.round(streamHoursCredited)}h streamed live. Badge updates within 24 to 48 hours.`);
        }
    } finally {
        if (token === abortToken) finish();
    }
}

export async function maxAll(apps: DetectableApp[]): Promise<void> {
    if (!begin("MAX_ALL")) return;
    const token = abortToken;
    try {
        varietyList = shuffled(apps).slice(0, MAX_VARIETY_GAMES).map(app => buildGame({ id: app.id, name: app.name, exeName: executableFor(app) }, cursor));
        varietyIndex = 0;
        await runVariety(varietyList, 1.5);

        if (running && varietyList.length > 0) {
            await runGameTime(varietyList[0], MAX_TIME_HOURS);
        }

        if (running) {
            await runStream(MAX_TIME_HOURS);
        }

        if (running && gamesCredited >= varietyList.length && hoursCredited >= MAX_TIME_HOURS && streamHoursCredited >= MAX_TIME_HOURS) {
            markFinished(`All badges done. ${gamesCredited} games, ${Math.round(hoursCredited)}h game time, ${Math.round(streamHoursCredited)}h streaming. Badge updates on the next nightly pass.`);
        }
    } finally {
        if (token === abortToken) finish();
    }
}

function finish(): void {
    running = false;
    mode = "IDLE";
    clearGame();
    varietyList = [];
    varietyIndex = 0;
    notify();
}

export function stop(): void {
    abortToken++;
    finish();
}

export function isRunning(): boolean {
    return running;
}
