/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Logger } from "@utils/Logger";
import type { RunningGame } from "@vencord/discord-types";
import { findByPropsLazy, findStoreLazy } from "@webpack";
import { RestAPI, UserStore } from "@webpack/common";

const SCIENCE_URL = "/science";
const ME_URL = "/users/@me";
const TOKEN_MAX_AGE_MS = 12 * 60 * 60 * 1_000;
const MIN_DURATION_MS = 60_000;
const MAX_BACKDATE_MS = 24 * 60 * 60 * 1_000;

const SuperProperties: { getSuperProperties(): Record<string, unknown>; } = findByPropsLazy("getSuperProperties");
const RunningGameStore: {
    getRunningGames(): DetectedGame[];
    getGamesSeen(includeHidden?: boolean): DetectedGame[];
} = findStoreLazy("RunningGameStore");
const logger = new Logger("BadgeFarmer");

type DetectedGame = RunningGame & { executableFingerprint?: string; };

export interface CreditableGame {
    id: string;
    name: string;
    exeName: string;
}

interface CachedToken {
    userId: string;
    token: string;
    fetchedAt: number;
}

// Keyed to the account that fetched it. Without the user check, switching
// accounts would keep posting sessions with the previous account's token.
let cachedToken: CachedToken | null = null;
let sequence = Math.floor(Math.random() * 100_000);
const fingerprints = new Map<string, string>();

export function fingerprintFor(gameId: string): string {
    const known = fingerprints.get(gameId);
    if (known != null) return known;

    let detected: DetectedGame[] = [];
    try {
        const running = RunningGameStore?.getRunningGames?.() ?? [];
        const seen = RunningGameStore?.getGamesSeen?.(true) ?? [];
        detected = [
            ...(Array.isArray(running) ? running : []),
            ...(Array.isArray(seen) ? seen : [])
        ];
    } catch (error) {
        logger.warn("Could not read Discord's detected games", error);
    }

    const fingerprint = detected.find(game => game.id === gameId && game.executableFingerprint)?.executableFingerprint ?? "";
    if (fingerprint !== "") fingerprints.set(gameId, fingerprint);

    return fingerprint;
}

async function getAnalyticsToken(): Promise<string> {
    const userId = UserStore.getCurrentUser()?.id;
    if (userId == null) throw new Error("You need to be logged in.");

    if (cachedToken != null && cachedToken.userId === userId && Date.now() - cachedToken.fetchedAt < TOKEN_MAX_AGE_MS) {
        return cachedToken.token;
    }

    const { body } = await RestAPI.get({ url: ME_URL, query: { with_analytics_token: true } });
    const token = body?.analytics_token;
    if (typeof token !== "string" || token === "") throw new Error("Discord didn't send an analytics token.");
    if (body?.id !== userId) throw new Error("You switched accounts mid-request. Start the run again.");

    cachedToken = { userId, token, fetchedAt: Date.now() };
    return token;
}

function clientSession(): { heartbeatSession: string; launchSignature: string; locale: string; } {
    let properties: Record<string, unknown> = {};
    try {
        properties = SuperProperties?.getSuperProperties?.() ?? {};
    } catch (error) {
        logger.warn("Could not read the client's super properties", error);
    }

    const text = (value: unknown) => typeof value === "string" && value !== "" ? value : null;

    return {
        heartbeatSession: text(properties.client_heartbeat_session_id) ?? crypto.randomUUID(),
        launchSignature: text(properties.launch_signature) ?? crypto.randomUUID(),
        locale: text(properties.system_locale) ?? "en-US"
    };
}

function buildLaunch(game: CreditableGame, fingerprint: string, at: number): Record<string, unknown> {
    const { heartbeatSession, launchSignature, locale } = clientSession();

    const properties: Record<string, unknown> = {
        client_track_timestamp: at,
        client_heartbeat_session_id: heartbeatSession,
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
        launch_signature: launchSignature,
        client_rtc_state: null,
        client_app_state: "focused",
        client_send_timestamp: at
    };

    if (fingerprint !== "") properties.executable_fingerprint = fingerprint;

    return { type: "launch_game", properties };
}

function buildHeartbeat(game: CreditableGame, durationMs: number, gameSession: string, initial: boolean, at: number): Record<string, unknown> {
    const { heartbeatSession, launchSignature } = clientSession();

    return {
        type: "running_game_heartbeat",
        properties: {
            client_track_timestamp: at,
            client_heartbeat_session_id: heartbeatSession,
            event_sequence_number: ++sequence,
            game_id: game.id,
            game_name: game.name,
            game_metadata: null,
            game_executable: game.exeName,
            game_detection_enabled: true,
            initial_heartbeat: initial,
            final_heartbeat: !initial,
            game_session_id: gameSession,
            duration_tracked_ms: durationMs,
            rtc_connection_id: null,
            media_session_id: null,
            launch_signature: launchSignature,
            client_app_state: "focused",
            client_send_timestamp: at
        }
    };
}

/** Throws when Discord rejects the request, so callers can retry. Returns the actual duration credited in ms. */
export async function creditPlaytime(game: CreditableGame, durationMs: number, startedAt: number): Promise<number> {
    const duration = Math.floor(durationMs);
    if (!Number.isFinite(duration) || duration < MIN_DURATION_MS) {
        throw new Error("Sessions shorter than a minute don't count.");
    }

    const now = Date.now();
    // Discord ignores events older than a day, and events stamped in the future look broken.
    const start = Math.min(Math.max(startedAt, now - MAX_BACKDATE_MS), now - MIN_DURATION_MS);
    const end = Math.min(start + duration, now);
    const actualDuration = Math.max(end - start, MIN_DURATION_MS);

    const fingerprint = fingerprintFor(game.id);
    const token = await getAnalyticsToken();
    const gameSession = crypto.randomUUID();

    await RestAPI.post({
        url: SCIENCE_URL,
        body: {
            token,
            events: [
                buildHeartbeat(game, 0, gameSession, true, start),
                buildLaunch(game, fingerprint, start),
                buildHeartbeat(game, actualDuration, gameSession, false, end)
            ]
        }
    });

    logger.info(`Sent ${Math.round(actualDuration / 60_000)} minutes of ${game.name}`);
    return actualDuration;
}
