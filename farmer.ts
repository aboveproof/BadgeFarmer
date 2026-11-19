/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { IS_WINDOWS } from "@utils/constants";
import { Logger } from "@utils/Logger";
import { sleep } from "@utils/misc";
import type { Channel, RunningGame } from "@vencord/discord-types";
import { findByCodeLazy } from "@webpack";
import {
    ApplicationStreamingStore,
    ChannelStore,
    FluxDispatcher,
    MediaEngineStore,
    PermissionsBits,
    PermissionStore,
    SelectedChannelStore,
    showToast
} from "@webpack/common";

import { creditPlaytime, fingerprintFor } from "./science";

const logger = new Logger("BadgeFarmer");

interface DesktopSource {
    id: string;
    name: string;
}

interface StreamOptions {
    pid: number | null;
    sourceId: string;
    sourceName: string;
    audioSourceId: string | null;
    sound: boolean;
    previewDisabled: boolean;
}

// The same action creators Discord's Go Live button calls.
const startStream: (guildId: string | null, channelId: string, options: StreamOptions) => void = findByCodeLazy('type:"STREAM_START"');
const stopStream: (streamKey: string) => void = findByCodeLazy('type:"STREAM_STOP"');
const getDesktopSources: (engine: unknown, isWindows: boolean, types: string[], options: null) => Promise<DesktopSource[] | null> = findByCodeLazy("desktop sources");

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

interface GameSpec {
    id: string;
    name: string;
    exeName: string;
}

export type FarmerMode = "IDLE" | "GAME_TIME" | "VARIETY" | "STREAM" | "MAX_ALL";

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
    errors: number;
    lastError: string | null;
    finishedMessage: string | null;
}

export const ETERNAL_HOURS = 5_000;
export const UNIVERSALIST_GAMES = 100;
export const MAX_TARGET_HOURS = 1_000_000;
export const MAX_CHUNK_HOURS = 500;
export const DEFAULT_CHUNK_HOURS = 24;
export const DEFAULT_VARIETY_MINUTES = 2;

const MIN_CHUNK_MS = 60_000;
const MAX_BACKDATE_MS = 24 * 60 * 60 * 1_000;
const REQUEST_DELAY_MS = 600;
const RETRY_DELAY_MS = 3_000;
const MAX_FAILED_CHUNKS = 5;

// Discord cuts streams off at 5 hours, so the farm restarts at 4.
const STREAM_ROTATE_MS = 4 * 60 * 60 * 1_000;
const STREAM_REJOIN_GAP_MS = 3_000;
const STREAM_TICK_MS = 15_000;
const STREAM_START_TIMEOUT_MS = 10_000;
const STREAM_RESTART_LIMIT = 3;

let mode: FarmerMode = "IDLE";
let activeGame: SpoofedGame | null = null;
let hoursCredited = 0;
let hoursTarget = 0;
let gamesCredited = 0;
let gamesTarget = 0;
let streamHours = 0;
let streamTarget = 0;
let streamViewers: number | null = null;
let errors = 0;
let lastError: string | null = null;
let finishedMessage: string | null = null;

let running = false;
let runId = 0;
let cursor = 0;
let ownsStream = false;

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

/** A run stays alive until Stop is pressed or a newer run replaces it. */
function alive(id: number): boolean {
    return running && id === runId;
}

function describeError(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (error != null && typeof error === "object") {
        const { body, status } = error as { body?: { message?: unknown; }; status?: unknown; };
        if (typeof body?.message === "string") return body.message;
        if (typeof status === "number") return `Discord answered with HTTP ${status}`;
    }
    return String(error);
}

export function executableFor(app: DetectableApp): string {
    const executables = app.executables ?? [];
    const executable = executables.find(entry => entry.os === "win32" && entry.is_launcher !== true)
        ?? executables.find(entry => entry.os === "win32")
        ?? executables[0];

    const fallback = `${app.name.replace(/[<>:"/\\|?*]/g, "").trim() || "game"}.exe`;
    return (executable?.name.replace(/^>/, "") ?? fallback).replace(/^.*[\\/]/, "") || fallback;
}

function specFor(app: DetectableApp): GameSpec {
    return { id: app.id, name: app.name, exeName: executableFor(app) };
}

export function shuffled<T>(items: readonly T[], count = items.length): T[] {
    const pool = [...items];
    const take = Math.min(count, pool.length);
    for (let index = 0; index < take; index++) {
        const picked = index + Math.floor(Math.random() * (pool.length - index));
        [pool[index], pool[picked]] = [pool[picked], pool[index]];
    }
    return pool.slice(0, take);
}

function buildGame(app: GameSpec, startedAt: number): SpoofedGame {
    const folder = app.name.replace(/[<>:"/\\|?*]/g, "").trim().toLowerCase() || "game";
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

function showGame(game: SpoofedGame | null): void {
    if (game != null) fingerprintFor(game.id);
    activeGame = game;
    FluxDispatcher.dispatch({ type: "RUNNING_GAME_SET_DEBUG_GAME", game });
}

/** Hands out back-to-back time slots within Discord's 24-hour window so sessions do not overlap. */
function nextSlotStart(durationMs: number): number {
    const floor = Date.now() - MAX_BACKDATE_MS;
    if (cursor - durationMs < floor) {
        cursor = Date.now() - Math.floor(Math.random() * 60_000);
    }
    cursor -= durationMs;
    return Math.max(cursor, floor);
}

function retryDelayMs(error: unknown): number {
    if (error != null && typeof error === "object") {
        const retryAfter = (error as { body?: { retry_after?: unknown; }; }).body?.retry_after;
        if (typeof retryAfter === "number" && retryAfter > 0) {
            return Math.min(Math.ceil(retryAfter * 1_000), 30_000);
        }
    }
    return RETRY_DELAY_MS;
}

async function withRetry(id: number, label: string, action: () => Promise<void>): Promise<boolean> {
    for (let attempt = 1; attempt <= 3 && alive(id); attempt++) {
        try {
            await action();
            return true;
        } catch (error) {
            errors++;
            lastError = describeError(error);
            logger.error(`${label} failed on attempt ${attempt}`, error);
            notify();
            if (attempt < 3) await sleep(retryDelayMs(error));
        }
    }
    return false;
}

async function runGameTime(id: number, app: GameSpec, targetHours: number, chunkHours: number): Promise<void> {
    const chunkSize = Math.min(Math.max(1, chunkHours), MAX_CHUNK_HOURS);
    const game = buildGame(app, cursor);
    let failures = 0;

    hoursTarget = targetHours;
    showGame(game);
    notify();

    while (alive(id) && hoursCredited < targetHours) {
        const chunk = Math.min(chunkSize, targetHours - hoursCredited);
        const chunkMs = chunk * 3_600_000;
        // Discord drops sessions shorter than a minute, so a leftover sliver never counts.
        if (chunkMs < MIN_CHUNK_MS) break;

        const slotStart = nextSlotStart(chunkMs);
        const ok = await withRetry(id, `${chunk}h chunk for ${game.name}`, async () => {
            await creditPlaytime(game, chunkMs, slotStart);
        });
        if (!alive(id)) return;

        if (!ok) {
            if (++failures >= MAX_FAILED_CHUNKS) {
                lastError = `Stopped after ${MAX_FAILED_CHUNKS} failed chunks in a row. Last error: ${lastError ?? "unknown"}`;
                return;
            }
            continue;
        }

        failures = 0;
        hoursCredited += chunk;
        notify();
        await sleep(REQUEST_DELAY_MS);
    }
}

async function runVariety(id: number, apps: DetectableApp[], minutesPerGame: number): Promise<void> {
    const sessionMs = minutesPerGame * 60_000;
    let failures = 0;
    gamesTarget = apps.length;
    notify();

    for (const app of apps) {
        if (!alive(id)) return;
        const game = buildGame(specFor(app), cursor);
        showGame(game);

        const slotStart = nextSlotStart(sessionMs);
        const ok = await withRetry(id, `Variety session for ${game.name}`, async () => {
            await creditPlaytime(game, sessionMs, slotStart);
        });
        if (!alive(id)) return;

        if (!ok) {
            if (++failures >= MAX_FAILED_CHUNKS) {
                lastError = `Stopped after ${MAX_FAILED_CHUNKS} failed games in a row. Last error: ${lastError ?? "unknown"}`;
                return;
            }
            continue;
        }

        failures = 0;
        gamesCredited++;
        notify();
        await sleep(REQUEST_DELAY_MS);
    }

    showGame(null);
}

function currentVoiceChannel(): Channel | null {
    const channelId = SelectedChannelStore.getVoiceChannelId();
    if (channelId == null || channelId === "") return null;
    return ChannelStore.getChannel(channelId) ?? null;
}

function voiceProblem(channel: Channel | null): string | null {
    if (channel == null) return "Join a voice channel, then start the stream farm.";
    // Stage channels use a separate stream flow.
    if (channel.type === 13) return "Stage channels don't support Go Live. Pick a regular voice channel.";
    const isGuild = !channel.isDM() && !channel.isGroupDM();
    if (isGuild && !PermissionStore.can(PermissionsBits.STREAM, channel)) {
        return "You don't have permission to stream in this voice channel.";
    }
    return null;
}

function streamKeyOf(stream: { guildId: string | null; channelId: string; ownerId: string; }): string {
    return stream.guildId != null
        ? `guild:${stream.guildId}:${stream.channelId}:${stream.ownerId}`
        : `call:${stream.channelId}:${stream.ownerId}`;
}

function readLiveStream(): { viewers: number; } | null {
    try {
        const stream = ApplicationStreamingStore.getCurrentUserActiveStream();
        if (stream == null) return null;
        return { viewers: ApplicationStreamingStore.getViewerIds(streamKeyOf(stream)).length };
    } catch (error) {
        logger.warn("Could not read the active stream", error);
        return null;
    }
}

function endOwnedStream(): void {
    if (!ownsStream) return;
    ownsStream = false;
    try {
        const stream = ApplicationStreamingStore.getCurrentUserActiveStream();
        if (stream != null) stopStream(streamKeyOf(stream));
    } catch (error) {
        logger.error("Could not end the stream", error);
    }
}

async function goLive(id: number, channel: Channel): Promise<boolean> {
    try {
        const sources = await getDesktopSources(MediaEngineStore.getMediaEngine(), IS_WINDOWS, ["screen"], null) ?? [];
        const source = sources[0];
        if (source == null) {
            lastError = "Discord found no screen to share.";
            return false;
        }
        if (!alive(id)) return false;

        startStream(channel.guild_id ?? null, channel.id, {
            pid: null,
            sourceId: source.id,
            sourceName: source.name,
            audioSourceId: null,
            sound: false,
            previewDisabled: false
        });

        // Keep waiting even after Stop, so a stream that comes up late gets ended instead of left running.
        const deadline = Date.now() + STREAM_START_TIMEOUT_MS;
        while (Date.now() < deadline) {
            await sleep(500);
            const stream = ApplicationStreamingStore.getCurrentUserActiveStream();
            if (stream == null) continue;
            if (!alive(id)) {
                if (!running) stopStream(streamKeyOf(stream));
                return false;
            }
            ownsStream = true;
            return true;
        }
        lastError = "Go Live didn't start within 10 seconds.";
        return false;
    } catch (error) {
        lastError = `Go Live failed: ${describeError(error)}`;
        logger.error("Go Live failed", error);
        return false;
    }
}

async function runStream(id: number, targetHours: number): Promise<boolean> {
    const targetMs = targetHours * 3_600_000;
    streamTarget = targetHours;

    const problem = voiceProblem(currentVoiceChannel());
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
        const issue = voiceProblem(channel);
        if (issue != null) {
            lastError = issue;
            break;
        }

        const live = readLiveStream();
        const now = Date.now();

        if (live == null) {
            if (restarts >= STREAM_RESTART_LIMIT) {
                lastError = `Go Live failed ${STREAM_RESTART_LIMIT} times in a row. ${lastError ?? ""}`.trim();
                break;
            }
            restarts++;
            streamViewers = null;
            notify();
            if (await goLive(id, channel!)) {
                restarts = 0;
                segmentStart = Date.now();
                lastTick = Date.now();
                if (lastError?.startsWith("Go Live")) lastError = null;
            } else {
                await sleep(5_000);
            }
            continue;
        }

        liveMs += now - lastTick;
        lastTick = now;
        streamHours = Math.min(liveMs, targetMs) / 3_600_000;
        streamViewers = live.viewers;

        if (live.viewers === 0) {
            lastError = "Nobody is watching. Bring an alt into the channel to open your stream.";
        } else if (lastError?.startsWith("Nobody is watching")) {
            lastError = null;
        }

        if (now - segmentStart >= STREAM_ROTATE_MS) {
            logger.info("Restarting the stream before Discord's 5 hour cutoff");
            // Rotating means the farm owns the stream from here on, even one it adopted.
            ownsStream = true;
            endOwnedStream();
            segmentStart = Date.now();
            await sleep(STREAM_REJOIN_GAP_MS);
            lastTick = Date.now();
            continue;
        }

        notify();
        await sleep(Math.min(STREAM_TICK_MS, Math.max(1_000, targetMs - liveMs)));
    }

    if (alive(id)) {
        endOwnedStream();
        streamViewers = null;
        notify();
    }

    return liveMs >= targetMs;
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
    errors = 0;
    lastError = null;
    finishedMessage = null;
    cursor = Date.now();
    ownsStream = false;
    notify();
    return ++runId;
}

function end(id: number): void {
    if (id !== runId) return;
    running = false;
    mode = "IDLE";
    showGame(null);
    endOwnedStream();
    streamViewers = null;
    notify();
}

function markFinished(message: string): void {
    finishedMessage = message;
    showToast({ text: message, variant: "success" });
}

export async function startGameTime(app: DetectableApp, hours = ETERNAL_HOURS, chunkHours = DEFAULT_CHUNK_HOURS): Promise<void> {
    const id = begin("GAME_TIME");
    if (id == null) return;
    try {
        await runGameTime(id, specFor(app), hours, chunkHours);
        if (alive(id) && hoursCredited >= hours) {
            markFinished(`Sent ${Math.round(hoursCredited).toLocaleString()} hours of ${app.name}. Discord updates the badge overnight.`);
        }
    } finally {
        end(id);
    }
}

export async function startVariety(apps: DetectableApp[], minutesPerGame = DEFAULT_VARIETY_MINUTES): Promise<void> {
    const id = begin("VARIETY");
    if (id == null) return;
    try {
        await runVariety(id, apps, minutesPerGame);
        if (alive(id) && gamesCredited >= apps.length) {
            markFinished(`Sent sessions for ${gamesCredited} games. Discord updates the badge overnight.`);
        }
    } finally {
        end(id);
    }
}

export async function startStreamFarm(hours = ETERNAL_HOURS): Promise<void> {
    const id = begin("STREAM");
    if (id == null) return;
    try {
        const reached = await runStream(id, hours);
        if (alive(id) && reached) {
            markFinished(`Streamed ${Math.round(streamHours).toLocaleString()} hours. Give Discord a day or two to update the badge.`);
        }
    } finally {
        end(id);
    }
}

export async function maxAll(apps: DetectableApp[]): Promise<void> {
    const id = begin("MAX_ALL");
    if (id == null) return;
    try {
        const pool = shuffled(apps, UNIVERSALIST_GAMES);
        await runVariety(id, pool, DEFAULT_VARIETY_MINUTES);
        if (!alive(id) || pool.length === 0) return;

        await runGameTime(id, specFor(pool[0]), ETERNAL_HOURS, DEFAULT_CHUNK_HOURS);
        if (!alive(id)) return;

        const summary = `${gamesCredited} games and ${Math.round(hoursCredited).toLocaleString()} hours of ${pool[0].name}`;

        if (voiceProblem(currentVoiceChannel()) != null) {
            markFinished(`Sent ${summary}. Join a voice channel and run Streaming on its own for the third badge.`);
            return;
        }

        showToast({ text: `Sent ${summary}. Going live for the streaming badge now.`, variant: "success" });
        const reached = await runStream(id, ETERNAL_HOURS);
        if (alive(id) && reached) {
            markFinished(`Done. ${summary}, plus ${Math.round(streamHours).toLocaleString()} hours streamed.`);
        }
    } finally {
        end(id);
    }
}

export function stop(): void {
    if (!running) return;
    end(runId);
    runId++;
}
