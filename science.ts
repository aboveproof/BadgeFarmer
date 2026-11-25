/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Logger } from "@utils/Logger";
import type { RunningGame } from "@vencord/discord-types";
import { findByPropsLazy, findStoreLazy } from "@webpack";
import { RestAPI, RunningGameStore, UserStore } from "@webpack/common";

const SCIENCE_URL = "/science";
const ME_URL = "/users/@me";
const TOKEN_MAX_AGE_MS = 12 * 60 * 60 * 1_000;

export const MIN_DURATION_MS = 60_000;
export const MAX_SESSION_MS = 24 * 60 * 60 * 1_000;
export const MAX_SESSIONS_PER_BATCH = 12;

const SuperProperties: { getSuperProperties?(): Record<string, unknown>; } = findByPropsLazy("getSuperProperties");
const ConsentStore: { hasConsented?(type: string): boolean; } = findStoreLazy("ConsentStore");
const AnalyticsTrackingStore: { submitEventsImmediately?: (...args: unknown[]) => unknown; } = findStoreLazy("AnalyticsTrackingStore");
const logger = new Logger("BadgeFarmer");

type DetectedGame = RunningGame & { executableFingerprint?: string; };

export interface CreditableGame {
    id: string;
    name: string;
    exeName: string;
}

export interface PlaytimeSession {
    game: CreditableGame;
    durationMs: number;
    startedAt: number;
}

export interface BatchResult {
    creditedMs: number;
    sessions: number;
}

interface CachedToken {
    userId: string;
    token: string;
    fetchedAt: number;
}

interface ClientTelemetry {
    heartbeatSession: string;
    launchSignature: string;
    locale: string;
}

// Keyed to the account that fetched it so switching accounts never reuses the previous token.
let cachedToken: CachedToken | null = null;
let sequence = Math.floor(Math.random() * 100_000);
const fallbackHeartbeatSession = crypto.randomUUID();
const fallbackLaunchSignature = crypto.randomUUID();
const fingerprints = new Map<string, string>();

export function invalidateAnalyticsToken(): void {
    cachedToken = null;
}

export function isPersonalizationEnabled(): boolean | null {
    try {
        if (typeof ConsentStore?.hasConsented !== "function") return null;
        return Boolean(ConsentStore.hasConsented("personalization"));
    } catch {
        return null;
    }
}

/** True when NoTrack's stub store is active in memory and dropping client stream events. */
export function isAnalyticsStubbed(): boolean {
    try {
        const fn = AnalyticsTrackingStore?.submitEventsImmediately;
        return typeof fn === "function" && String(fn).includes("NoTrack");
    } catch {
        return false;
    }
}

export function fingerprintFor(gameId: string): string {
    const known = fingerprints.get(gameId);
    if (known != null) return known;

    let detected: DetectedGame[] = [];
    try {
        const running = RunningGameStore?.getRunningGames?.() ?? [];
        const seen = RunningGameStore?.getGamesSeen?.(true) ?? [];
        detected = [
            ...(Array.isArray(running) ? running as DetectedGame[] : []),
            ...(Array.isArray(seen) ? seen as DetectedGame[] : [])
        ];
    } catch (error) {
        logger.warn("Could not read Discord's detected games", error);
    }

    const match = detected.find(game => game.id === gameId && typeof game.executableFingerprint === "string" && game.executableFingerprint !== "");
    const fingerprint = match?.executableFingerprint ?? "";
    if (fingerprint !== "") fingerprints.set(gameId, fingerprint);

    return fingerprint;
}

async function getAnalyticsToken(): Promise<string> {
    const userId = UserStore?.getCurrentUser?.()?.id;
    if (userId == null) throw new Error("Log in to Discord first.");

    if (cachedToken != null && cachedToken.userId === userId && Date.now() - cachedToken.fetchedAt < TOKEN_MAX_AGE_MS) {
        return cachedToken.token;
    }

    const response = await RestAPI.get({ url: ME_URL, query: { with_analytics_token: true } });
    const body = response?.body as { id?: unknown; analytics_token?: unknown; } | undefined;
    const token = body?.analytics_token;
    if (typeof token !== "string" || token === "") {
        throw new Error("Discord did not return an analytics token. Turn on personalization under Data & Privacy.");
    }
    if (body?.id !== userId) {
        throw new Error("You switched accounts mid-request. Start the run again.");
    }

    cachedToken = { userId, token, fetchedAt: Date.now() };
    return token;
}

function readClientTelemetry(): ClientTelemetry {
    let properties: Record<string, unknown> = {};
    try {
        properties = SuperProperties?.getSuperProperties?.() ?? {};
    } catch (error) {
        logger.warn("Could not read client super properties", error);
    }

    const text = (value: unknown) => typeof value === "string" && value !== "" ? value : null;

    return {
        heartbeatSession: text(properties.client_heartbeat_session_id) ?? fallbackHeartbeatSession,
        launchSignature: text(properties.launch_signature) ?? fallbackLaunchSignature,
        locale: text(properties.system_locale) ?? "en-US"
    };
}

function buildLaunch(
    game: CreditableGame,
    exeLower: string,
    fingerprint: string,
    telemetry: ClientTelemetry,
    trackAt: number,
    sendAt: number
): Record<string, unknown> {
    const properties: Record<string, unknown> = {
        client_track_timestamp: trackAt,
        client_heartbeat_session_id: telemetry.heartbeatSession,
        event_sequence_number: ++sequence,
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
        executable_path: exeLower,
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
        rendered_locale: telemetry.locale,
        launch_signature: telemetry.launchSignature,
        client_rtc_state: null,
        client_app_state: "focused",
        client_send_timestamp: sendAt
    };

    if (fingerprint !== "") properties.executable_fingerprint = fingerprint;

    return { type: "launch_game", properties };
}

function buildHeartbeat(
    game: CreditableGame,
    exeLower: string,
    durationMs: number,
    gameSession: string,
    initial: boolean,
    telemetry: ClientTelemetry,
    trackAt: number,
    sendAt: number
): Record<string, unknown> {
    return {
        type: "running_game_heartbeat",
        properties: {
            client_track_timestamp: trackAt,
            client_heartbeat_session_id: telemetry.heartbeatSession,
            event_sequence_number: ++sequence,
            game_id: game.id,
            game_name: game.name,
            game_metadata: null,
            game_executable: exeLower,
            game_detection_enabled: true,
            initial_heartbeat: initial,
            final_heartbeat: !initial,
            game_session_id: gameSession,
            duration_tracked_ms: durationMs,
            rtc_connection_id: null,
            media_session_id: null,
            launch_signature: telemetry.launchSignature,
            client_app_state: "focused",
            client_send_timestamp: sendAt
        }
    };
}

function isAuthError(error: unknown): boolean {
    if (error == null || typeof error !== "object") return false;
    const { status } = error as { status?: unknown; };
    return status === 401 || status === 403;
}

/**
 * Posts up to MAX_SESSIONS_PER_BATCH finished play sessions in one /science request.
 * Throws on failure so callers can retry with backoff.
 */
export async function creditPlaytimeBatch(sessions: readonly PlaytimeSession[]): Promise<BatchResult> {
    if (sessions.length === 0) {
        throw new Error("No sessions to send.");
    }

    const token = await getAnalyticsToken();
    const telemetry = readClientTelemetry();
    const sendAt = Date.now();
    const events: Record<string, unknown>[] = [];
    let creditedMs = 0;
    let count = 0;

    for (const session of sessions) {
        const requested = Math.floor(session.durationMs);
        if (!Number.isFinite(requested) || requested < MIN_DURATION_MS) continue;

        const duration = Math.min(requested, MAX_SESSION_MS);
        // Keep timestamps inside Discord's 24-hour window so end - start equals duration_tracked_ms.
        const start = Math.min(Math.max(Math.floor(session.startedAt), sendAt - MAX_SESSION_MS), sendAt - MIN_DURATION_MS);
        const end = Math.min(start + duration, sendAt);
        const actualDuration = Math.max(end - start, MIN_DURATION_MS);

        const exeLower = session.game.exeName.toLowerCase();
        const fingerprint = fingerprintFor(session.game.id);
        const gameSession = crypto.randomUUID();

        events.push(
            buildLaunch(session.game, exeLower, fingerprint, telemetry, start, sendAt),
            buildHeartbeat(session.game, exeLower, 0, gameSession, true, telemetry, start, sendAt),
            buildHeartbeat(session.game, exeLower, actualDuration, gameSession, false, telemetry, end, sendAt)
        );

        creditedMs += actualDuration;
        count++;
    }

    if (count === 0) {
        throw new Error("Sessions shorter than a minute do not count.");
    }

    try {
        await RestAPI.post({
            url: SCIENCE_URL,
            body: { token, events }
        });
    } catch (error) {
        if (isAuthError(error)) invalidateAnalyticsToken();
        throw error;
    }

    logger.info(`Sent ${count} session${count === 1 ? "" : "s"} (${Math.round(creditedMs / 60_000)} min)`);
    return { creditedMs, sessions: count };
}

/** Convenience wrapper for a single session. */
export async function creditPlaytime(game: CreditableGame, durationMs: number, startedAt: number): Promise<number> {
    const result = await creditPlaytimeBatch([{ game, durationMs, startedAt }]);
    return result.creditedMs;
}
