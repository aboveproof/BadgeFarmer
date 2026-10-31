/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { isPluginEnabled } from "@api/PluginManager";
import { Logger } from "@utils/Logger";
import { sleep } from "@utils/misc";
import type { RunningGame } from "@vencord/discord-types";
import { FluxDispatcher, SelectedChannelStore } from "@webpack/common";

import { creditPlaytime, creditStreamBackdated, fingerprintFor, startLiveStream, type StreamLocation } from "./science";

const logger = new Logger("BadgeFarmer:Farmer");

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
}

export const MAX_TIME_HOURS = 5000;
export const MAX_VARIETY_GAMES = 100;
export const DEFAULT_VARIETY_MINUTES = 2;
const CHUNK_HOURS = 2;
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
let liveSession: ReturnType<typeof startLiveStream> | null = null;
let liveSessionDone: (() => void) | null = null;
let errors = 0;
let lastError: string | null = null;
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
        notrackBlocked: isPluginEnabled("NoTrack")
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

function currentStreamLocation(): StreamLocation {
    const channelId = SelectedChannelStore.getVoiceChannelId();
    if (typeof channelId === "string" && channelId !== "") {
        return { guildId: "0", channelId };
    }
    // Fallback when not in voice. Badge hours count best with a real channel
    // someone is watching; the event chain still goes out regardless.
    return { guildId: "900000000000000000", channelId: "900000000000000001" };
}

const TURBO_SESSION_HOURS = 24;

async function runStream(targetHours: number): Promise<void> {
    // Turbo phase: backdated 24h sessions chained backward from now, same
    // event shapes the live engine sends, one hourly heartbeat each. The
    // game-time engine credits multi-hour backdated sessions on this pipeline
    // without a 24h cap, so stream sessions ride the same freedom. 5,000h is
    // ~210 single requests, done in under five minutes. If Discord's badge
    // pipeline turns out to reject them, hours stay flat and the live phase
    // still delivers real credit.
    const location = currentStreamLocation();
    const firstSessionEnd = Date.now() - 60_000;
    let turboHours = 0;
    let failedBursts = 0;

    while (running && turboHours < targetHours) {
        const sessionHours = Math.min(TURBO_SESSION_HOURS, targetHours - turboHours);
        const sessionEnd = firstSessionEnd - turboHours * 3_600_000;
        const sessionStart = sessionEnd - sessionHours * 3_600_000;
        const ok = await withRetry(`Turbo stream session (${sessionHours}h)`, async () => {
            await creditStreamBackdated(sessionHours, sessionStart, location);
        });
        if (!ok) {
            if (++failedBursts >= MAX_FAILED_BURSTS) {
                lastError = "Turbo backdating rejected. Falling back to live streaming.";
                logger.warn(lastError);
                break;
            }
            continue;
        }
        failedBursts = 0;
        turboHours += sessionHours;
        streamHoursCredited = turboHours;
        notify();
        await sleep(REQUEST_DELAY_MS);
    }

    const remainingHours = targetHours - turboHours;
    if (!running || remainingHours <= 0) return;

    // Live phase: lawerth engine, one heartbeat per real minute, for whatever
    // is left (partial sessions under 24h, or everything if turbo was rejected).
    const targetMinutes = Math.round(remainingHours * 60);
    let liveDone: (() => void) | null = null;

    liveSession = startLiveStream(
        location,
        () => running && streamMinutesCredited < targetMinutes,
        totalMinutes => {
            streamMinutesCredited = Math.min(totalMinutes, targetMinutes);
            streamHoursCredited = turboHours + streamMinutesCredited / 60;
            streamBatch = streamMinutesCredited % 60;
            streamBatches = 60;
            notify();
        }
    );
    liveSessionDone = () => liveDone?.();

    await new Promise<void>(resolve => { liveDone = resolve; });
    await liveSession.stop();
    liveSession = null;
    liveSessionDone = null;
}

async function runGameTime(app: { id: string; name: string; exeName: string; }, targetHours: number): Promise<void> {
    let credited = 0;
    let failedBursts = 0;
    while (running && credited < targetHours) {
        const chunk = Math.min(CHUNK_HOURS, targetHours - credited);
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
    cursor = Date.now();
    abortToken++;
    notify();
    return true;
}

type GameSpec = { id: string; name: string; exeName: string; };

export async function startGameTime(app: DetectableApp, hours = MAX_TIME_HOURS): Promise<void> {
    const spec: GameSpec = { id: app.id, name: app.name, exeName: executableFor(app) };
    if (!begin("GAME_TIME")) return;
    const token = abortToken;
    try {
        await runGameTime(spec, hours);
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
    } finally {
        if (token === abortToken) finish();
    }
}

export async function startStream(hours = MAX_TIME_HOURS): Promise<void> {
    if (!begin("STREAM")) return;
    const token = abortToken;
    try {
        await runStream(hours);
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
    liveSessionDone?.();
    liveSessionDone = null;
    notify();
}

export function stop(): void {
    abortToken++;
    const session = liveSession;
    if (session != null) {
        void session.stop().then(() => {
            liveSession = null;
        });
    }
    finish();
}

export function isRunning(): boolean {
    return running;
}
