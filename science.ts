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

export interface LiveStreamHandle {
    stop(): Promise<void>;
}

/**
 * Real-time streaming telemetry, ported 1:1 from lawerth/discord-streamer's
 * TelemetryService (MIT, https://github.com/lawerth/discord-streamer).
 * One video_stream_heartbeat per actual minute with a fixed
 * duration_tracked_ms of 60000, a fresh heartbeat session per stream, and
 * media_session_joined / video_stream_started / video_stream_ended framing
 * events. No backdating: the badge pipeline counts per-heartbeat minutes that
 * arrive in real time, exactly like a genuine broadcast.
 *
 * Discord only credits hours when a viewer is registered on the stream, so
 * pair this with a real voice channel someone (an alt works) is watching.
 */
export function startLiveStream(
    location: StreamLocation,
    shouldContinue: () => boolean,
    onMinutes: (totalMinutes: number) => void
): LiveStreamHandle {
    let stopped = false;
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    let resolveEnd: () => void = () => { };
    const ended = new Promise<void>(resolve => { resolveEnd = resolve; });

    void (async () => {
        const token = await getAnalyticsToken();
        const heartbeatSessionId = crypto.randomUUID();
        const launchSignature = crypto.randomUUID();
        const streamStartTime = Date.now();

        async function postScienceEvents(events: Array<{ type: string; properties: Record<string, unknown>; }>): Promise<boolean> {
            try {
                await RestAPI.post({
                    url: SCIENCE_URL,
                    body: {
                        token,
                        events: events.map(ev => ({
                            type: ev.type,
                            properties: {
                                client_track_timestamp: Date.now(),
                                client_send_timestamp: Date.now(),
                                client_heartbeat_session_id: heartbeatSessionId,
                                launch_signature: launchSignature,
                                event_sequence_number: ++sequence,
                                client_app_state: "focused",
                                ...ev.properties
                            }
                        }))
                    }
                });
                return true;
            } catch (error) {
                logger.warn("Science post rejected", error);
                return false;
            }
        }

        const streamProps = {
            guild_id: location.guildId,
            channel_id: location.channelId,
            channel_type: 2
        };

        await postScienceEvents([
            { type: "media_session_joined", properties: { ...streamProps } },
            { type: "video_stream_started", properties: { ...streamProps } }
        ]);

        let minutes = 0;
        let consecutiveFailures = 0;

        heartbeatTimer = setInterval(async () => {
            if (stopped) return;
            if (!shouldContinue()) {
                resolveEnd();
                return;
            }

            const totalDurationMs = Date.now() - streamStartTime;
            const ok = await postScienceEvents([
                {
                    type: "video_stream_heartbeat",
                    properties: {
                        ...streamProps,
                        duration_tracked_ms: 60000,
                        total_duration_ms: totalDurationMs
                    }
                }
            ]);

            if (ok) {
                consecutiveFailures = 0;
                minutes++;
                onMinutes(minutes);
            } else if (++consecutiveFailures >= 10) {
                logger.error("Live stream aborted after 10 consecutive failed heartbeats");
                resolveEnd();
            }
        }, 60000);

        await ended;

        if (heartbeatTimer != null) clearInterval(heartbeatTimer);
        heartbeatTimer = null;

        const durationMs = stopped || !shouldContinue() ? Date.now() - streamStartTime : 0;
        await postScienceEvents([
            {
                type: "video_stream_ended",
                properties: { ...streamProps, duration_ms: durationMs }
            }
        ]);
        logger.info(`Live stream session ended after ${minutes}m`);
        resolveEnd();
    })();

    return {
        stop(): Promise<void> {
            stopped = true;
            resolveEnd();
            return ended;
        }
    };
}
