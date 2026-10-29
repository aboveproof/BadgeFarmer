/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Logger } from "@utils/Logger";
import type { RunningGame } from "@vencord/discord-types";
import { findByPropsLazy, findStoreLazy } from "@webpack";
import { RestAPI } from "@webpack/common";

const SCIENCE_URL = "/science";
const ME_URL = "/users/@me";
const TOKEN_MAX_AGE = 12 * 60 * 60 * 1_000;
const MIN_DURATION_MS = 60_000;

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

let analyticsToken = "";
let analyticsTokenFetchedAt = 0;
let sequence = Math.floor(Math.random() * 100_000);
const fingerprints = new Map<string, string>();

export function fingerprintFor(gameId: string): string {
    const known = fingerprints.get(gameId);
    if (known != null) return known;

    let detected: DetectedGame[] = [];
    try {
        detected = [...RunningGameStore.getRunningGames(), ...RunningGameStore.getGamesSeen(true)];
    } catch (error) {
        logger.warn("Could not read Discord's detected games", error);
    }

    const fingerprint = detected.find(game => game.id === gameId && game.executableFingerprint)?.executableFingerprint ?? "";
    if (fingerprint !== "") fingerprints.set(gameId, fingerprint);

    return fingerprint;
}

async function getAnalyticsToken(): Promise<string> {
    if (analyticsToken !== "" && Date.now() - analyticsTokenFetchedAt < TOKEN_MAX_AGE) return analyticsToken;

    const { body } = await RestAPI.get({ url: ME_URL, query: { with_analytics_token: true } });
    if (typeof body?.analytics_token !== "string") throw new Error("Discord returned no analytics_token");

    analyticsToken = body.analytics_token;
    analyticsTokenFetchedAt = Date.now();

    return analyticsToken;
}

function clientSession(): { heartbeatSession: string; launchSignature: string; locale: string; } {
    let properties: Record<string, unknown> = {};
    try {
        properties = SuperProperties.getSuperProperties() ?? {};
    } catch (error) {
        logger.warn("Could not read the client's super properties", error);
    }

    return {
        heartbeatSession: properties.client_heartbeat_session_id as string ?? crypto.randomUUID(),
        launchSignature: properties.launch_signature as string ?? crypto.randomUUID(),
        locale: properties.system_locale as string ?? "en-US"
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

const MAX_BACKDATE_MS = 24 * 60 * 60 * 1_000;

function resolveStart(duration: number, startedAt: number | undefined): number {
    const now = Date.now();
    if (startedAt == null) return Math.max(now - duration, now - MAX_BACKDATE_MS);
    return Math.max(startedAt, now - MAX_BACKDATE_MS);
}

export async function creditPlaytime(game: CreditableGame, durationMs: number, startedAt?: number): Promise<void> {
    const duration = Math.floor(durationMs);
    if (duration < MIN_DURATION_MS) return;

    const fingerprint = fingerprintFor(game.id);
    const token = await getAnalyticsToken();
    const gameSession = crypto.randomUUID();
    const start = resolveStart(duration, startedAt);

    await RestAPI.post({
        url: SCIENCE_URL,
        body: {
            token,
            events: [
                buildHeartbeat(game, 0, gameSession, true, start),
                buildLaunch(game, fingerprint, start),
                buildHeartbeat(game, duration, gameSession, false, start + duration)
            ]
        }
    });

    logger.info(`Credited ${Math.round(duration / 60_000)}m of ${game.name}`);
}

export interface StreamLocation {
    guildId: string;
    channelId: string;
}

const HEARTBEAT_INTERVAL_MS = 60_000;
const MAX_EVENTS_PER_POST = 50;
const BATCH_DELAY_MS = 5_000;
const RATE_LIMIT_DELAY_MS = 60_000;

function streamBase(location: StreamLocation): Record<string, unknown> {
    return {
        guild_id: location.guildId,
        channel_id: location.channelId,
        channel_type: 2
    };
}

export async function creditStreamTime(durationMs: number, startedAt?: number, location?: StreamLocation): Promise<void> {
    const duration = Math.floor(durationMs);
    if (duration < MIN_DURATION_MS) return;

    const token = await getAnalyticsToken();
    const start = resolveStart(duration, startedAt);
    const spot = location ?? { guildId: "0", channelId: "0" };
    const { heartbeatSession, launchSignature } = clientSession();

    function event(type: string, extra: Record<string, unknown>, at: number): Record<string, unknown> {
        return {
            type,
            properties: {
                client_track_timestamp: at,
                client_send_timestamp: at,
                client_heartbeat_session_id: heartbeatSession,
                launch_signature: launchSignature,
                event_sequence_number: ++sequence,
                client_app_state: "focused",
                ...streamBase(spot),
                ...extra
            }
        };
    }

    const events: Record<string, unknown>[] = [
        event("media_session_joined", {}, start),
        event("video_stream_started", {}, start)
    ];

    for (let elapsed = HEARTBEAT_INTERVAL_MS; elapsed <= duration; elapsed += HEARTBEAT_INTERVAL_MS) {
        events.push(event("video_stream_heartbeat", {
            duration_tracked_ms: HEARTBEAT_INTERVAL_MS,
            total_duration_ms: elapsed
        }, start + elapsed));
    }

    const trailing = duration % HEARTBEAT_INTERVAL_MS;
    if (trailing >= MIN_DURATION_MS) {
        events.push(event("video_stream_heartbeat", {
            duration_tracked_ms: trailing,
            total_duration_ms: duration
        }, start + duration));
    }

    events.push(event("video_stream_ended", { duration_ms: duration }, start + duration));

    // /science rate-limits hard. Pace batches, back off on 429, and resume
    // instead of failing the whole 24h session and replaying every batch.
    for (let offset = 0; offset < events.length; offset += MAX_EVENTS_PER_POST) {
        for (let attempt = 0; ; attempt++) {
            try {
                await RestAPI.post({
                    url: SCIENCE_URL,
                    body: { token, events: events.slice(offset, offset + MAX_EVENTS_PER_POST) }
                });
                break;
            } catch (error) {
                if (attempt >= 5) throw error;
                const wait = attempt === 0 ? RATE_LIMIT_DELAY_MS : RATE_LIMIT_DELAY_MS * (attempt + 1);
                logger.warn(`Science batch rejected, backing off ${wait / 1000}s`, error);
                await new Promise(resolve => setTimeout(resolve, wait));
            }
        }
        if (offset + MAX_EVENTS_PER_POST < events.length) {
            await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
        }
    }

    logger.info(`Credited ${Math.round(duration / 60_000)}m of streaming`);
}
