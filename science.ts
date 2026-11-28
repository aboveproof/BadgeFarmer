/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Logger } from "@utils/Logger";
import type { RunningGame } from "@vencord/discord-types";
import { findByPropsLazy, findStoreLazy } from "@webpack";
import { AuthenticationStore, RestAPI, RunningGameStore, UserStore } from "@webpack/common";

const SCIENCE_URL = "/science";
const ME_URL = "/users/@me";
const TOKEN_MAX_AGE_MS = 12 * 60 * 60 * 1_000;
const SCIENCE_TIMEOUT_MS = 15_000;

export const MIN_DURATION_MS = 60_000;
export const MAX_SESSION_MS = 24 * 60 * 60 * 1_000;
export const MAX_SESSIONS_PER_BATCH = 20;

const FALLBACK_CLIENT_VERSION = "1.0.9253";
const FALLBACK_BUILD_NUMBER = 594031;
const FALLBACK_NATIVE_BUILD = 88414;
const FALLBACK_OS_VERSION = "10.0.26200";
const FALLBACK_USER_AGENT =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) discord/1.0.9253 Chrome/148.0.7778.280 Electron/42.7.1 Safari/537.36";

const SuperProperties: { getSuperProperties?(): Record<string, unknown>; } = findByPropsLazy("getSuperProperties");
const TokenManager: { getToken?(): string | null | undefined; } = findByPropsLazy("getToken", "init");
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
    startedAt?: number;
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
    encodedSuperProperties: string;
}

let cachedToken: CachedToken | null = null;
let sequence = Math.floor(Math.random() * 10_000);
const sessionHeartbeatId = crypto.randomUUID();
const sessionLaunchSignature = crypto.randomUUID();
const sessionClientLaunchId = crypto.randomUUID();
const fingerprints = new Map<string, string>();
let fallbackFingerprint = "";

export function apiOrigin(): string {
    try {
        const { origin, hostname } = window.location;
        if (hostname === "discord.com" || hostname.endsWith(".discord.com") || hostname.endsWith(".discordapp.com")) {
            return origin;
        }
    } catch {
        // Default to stable origin.
    }
    return "https://discord.com";
}

function readSessionToken(): string | null {
    try {
        const fromStore = (AuthenticationStore as unknown as { getToken?(): unknown; })?.getToken?.();
        if (typeof fromStore === "string" && fromStore.length > 10) return fromStore;
    } catch {
        // Fall through to TokenManager.
    }
    try {
        const fromModule = TokenManager?.getToken?.();
        if (typeof fromModule === "string" && fromModule.length > 10) return fromModule;
    } catch {
        // Fall back to RestAPI when direct token access is unavailable.
    }
    return null;
}

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

function encodeBase64Utf8(text: string): string {
    const bytes = new TextEncoder().encode(text);
    let binary = "";
    for (let index = 0; index < bytes.length; index++) {
        binary += String.fromCharCode(bytes[index]);
    }
    return btoa(binary);
}

export function fingerprintFor(gameId: string): string {
    const known = fingerprints.get(gameId);
    if (known != null) return known;

    let detected: DetectedGame[] = [];
    try {
        const running = RunningGameStore?.getRunningGames?.() ?? [];
        const seen = RunningGameStore?.getGamesSeen?.(true) ?? [];
        const candidates = RunningGameStore?.getCandidateGames?.() ?? [];
        detected = [
            ...(Array.isArray(running) ? running as DetectedGame[] : []),
            ...(Array.isArray(seen) ? seen as DetectedGame[] : []),
            ...(Array.isArray(candidates) ? candidates as DetectedGame[] : [])
        ];
    } catch (error) {
        logger.warn("Could not read Discord's detected games", error);
    }

    for (const item of detected) {
        const fp = item?.executableFingerprint;
        if (typeof fp !== "string" || fp === "") continue;
        if (fallbackFingerprint === "") fallbackFingerprint = fp;
        if (typeof item.id === "string" && item.id !== "" && !fingerprints.has(item.id)) {
            fingerprints.set(item.id, fp);
        }
    }

    return fingerprints.get(gameId) ?? fallbackFingerprint;
}

function buildTelemetry(): ClientTelemetry {
    let raw: Record<string, unknown> = {};
    try {
        raw = SuperProperties?.getSuperProperties?.() ?? {};
    } catch (error) {
        logger.warn("Could not read client super properties", error);
    }

    const text = (value: unknown) => (typeof value === "string" && value !== "" ? value : null);
    const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null);

    const locale = text(raw.system_locale) ?? "en-US";
    const heartbeatSession = text(raw.client_heartbeat_session_id) ?? sessionHeartbeatId;
    const launchSignature = text(raw.launch_signature) ?? sessionLaunchSignature;

    // Force Windows Desktop Client super properties so Linux, macOS, Vesktop, Equibop, and web builds
    // match the win32 executables reported in launch_game and running_game_heartbeat without Discord's
    // superagent interceptor overwriting X-Super-Properties.
    const desktopSuperProps: Record<string, unknown> = {
        os: "Windows",
        browser: "Discord Client",
        release_channel: text(raw.release_channel) ?? "stable",
        client_version: text(raw.client_version)?.match(/^\d+\.\d+/) ? raw.client_version : FALLBACK_CLIENT_VERSION,
        os_version: raw.os === "Windows" && text(raw.os_version) ? raw.os_version : FALLBACK_OS_VERSION,
        os_arch: "x64",
        app_arch: "x64",
        system_locale: locale,
        has_client_mods: false,
        browser_user_agent: FALLBACK_USER_AGENT,
        browser_version: "42.7.1",
        os_sdk_version: "26200",
        client_build_number: num(raw.client_build_number) ?? FALLBACK_BUILD_NUMBER,
        native_build_number: num(raw.native_build_number) ?? FALLBACK_NATIVE_BUILD,
        client_event_source: null,
        client_app_state: "focused",
        client_launch_id: text(raw.client_launch_id) ?? sessionClientLaunchId,
        launch_signature: launchSignature,
        client_heartbeat_session_id: heartbeatSession
    };

    return {
        heartbeatSession,
        launchSignature,
        locale,
        encodedSuperProperties: encodeBase64Utf8(JSON.stringify(desktopSuperProps))
    };
}

function desktopHeaders(telemetry: ClientTelemetry, sessionToken: string): Record<string, string> {
    return {
        authorization: sessionToken,
        "content-type": "application/json",
        "x-discord-locale": telemetry.locale,
        "x-super-properties": telemetry.encodedSuperProperties
    };
}

async function throwHttpError(response: Response): Promise<never> {
    let body: Record<string, unknown> | undefined;
    try {
        body = await response.json() as Record<string, unknown>;
    } catch {
        body = undefined;
    }
    const retryHeader = response.headers.get("retry-after");
    throw {
        status: response.status,
        body,
        headers: retryHeader != null ? { "retry-after": retryHeader } : undefined
    };
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SCIENCE_TIMEOUT_MS);
    try {
        return await fetch(url, { ...init, signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
}

async function getAnalyticsToken(telemetry: ClientTelemetry, sessionToken: string | null): Promise<string> {
    const userId = UserStore?.getCurrentUser?.()?.id;
    if (userId == null) throw new Error("Log in to Discord first.");

    if (cachedToken != null && cachedToken.userId === userId && Date.now() - cachedToken.fetchedAt < TOKEN_MAX_AGE_MS) {
        return cachedToken.token;
    }

    let body: { id?: unknown; analytics_token?: unknown; } | undefined;

    if (sessionToken != null) {
        const res = await fetchWithTimeout(`${apiOrigin()}/api/v9/users/@me?with_analytics_token=true`, {
            method: "GET",
            headers: desktopHeaders(telemetry, sessionToken)
        });
        if (!res.ok) await throwHttpError(res);
        body = await res.json() as { id?: unknown; analytics_token?: unknown; };
    } else {
        const response = await RestAPI.get({
            url: ME_URL,
            query: { with_analytics_token: true }
        });
        body = response?.body as { id?: unknown; analytics_token?: unknown; } | undefined;
    }

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

function buildLaunch(
    game: CreditableGame,
    fingerprint: string,
    telemetry: ClientTelemetry,
    trackTs: number,
    sendTs: number
): Record<string, unknown> {
    const properties: Record<string, unknown> = {
        client_track_timestamp: trackTs,
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
        rendered_locale: telemetry.locale,
        launch_signature: telemetry.launchSignature,
        client_rtc_state: null,
        client_app_state: "focused",
        client_send_timestamp: sendTs
    };

    if (fingerprint !== "") properties.executable_fingerprint = fingerprint;

    return { type: "launch_game", properties };
}

function buildHeartbeat(
    game: CreditableGame,
    durationMs: number,
    gameSession: string,
    initial: boolean,
    telemetry: ClientTelemetry,
    trackTs: number,
    sendTs: number
): Record<string, unknown> {
    return {
        type: "running_game_heartbeat",
        properties: {
            client_track_timestamp: trackTs,
            client_heartbeat_session_id: telemetry.heartbeatSession,
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
            launch_signature: telemetry.launchSignature,
            client_app_state: "focused",
            client_send_timestamp: sendTs
        }
    };
}

function isAuthError(error: unknown): boolean {
    if (error == null || typeof error !== "object") return false;
    const { status } = error as { status?: unknown; };
    return status === 401 || status === 403;
}

/**
 * Posts up to MAX_SESSIONS_PER_BATCH play sessions in one /science request.
 * Uses direct fetch with Windows Desktop X-Super-Properties so Discord's superagent
 * middleware never overwrites the OS header on Linux, macOS, Vesktop, or Equibop.
 */
export async function creditPlaytimeBatch(sessions: readonly PlaytimeSession[]): Promise<BatchResult> {
    if (sessions.length === 0) {
        throw new Error("No sessions to send.");
    }

    const telemetry = buildTelemetry();
    const sessionToken = readSessionToken();
    const token = await getAnalyticsToken(telemetry, sessionToken);
    const now = Date.now();
    const events: Record<string, unknown>[] = [];
    let creditedMs = 0;
    let count = 0;

    for (let index = 0; index < sessions.length; index++) {
        const session = sessions[index];
        const requested = Math.floor(session.durationMs);
        if (!Number.isFinite(requested) || requested < MIN_DURATION_MS) continue;

        const duration = Math.min(requested, MAX_SESSION_MS);
        const endJitter = index * 400 + Math.floor(Math.random() * 350);
        const end = session.startedAt != null
            ? Math.min(Math.max(Math.floor(session.startedAt) + duration, now - MAX_SESSION_MS + MIN_DURATION_MS), now)
            : Math.max(MIN_DURATION_MS, now - endJitter);
        const start = Math.max(0, end - duration);
        const openBeatTs = Math.min(end, start + 50);

        const fingerprint = fingerprintFor(session.game.id);
        const gameSession = crypto.randomUUID();

        events.push(
            buildLaunch(session.game, fingerprint, telemetry, start, now),
            buildHeartbeat(session.game, 0, gameSession, true, telemetry, openBeatTs, now),
            buildHeartbeat(session.game, duration, gameSession, false, telemetry, end, now)
        );

        creditedMs += duration;
        count++;
    }

    if (count === 0) {
        throw new Error("Sessions shorter than a minute do not count.");
    }

    try {
        if (sessionToken != null) {
            const res = await fetchWithTimeout(`${apiOrigin()}/api/v9/science`, {
                method: "POST",
                headers: desktopHeaders(telemetry, sessionToken),
                body: JSON.stringify({ token, events })
            });
            if (!res.ok && res.status !== 204) await throwHttpError(res);
        } else {
            await RestAPI.post({
                url: SCIENCE_URL,
                body: { token, events }
            });
        }
    } catch (error) {
        if (isAuthError(error)) invalidateAnalyticsToken();
        throw error;
    }

    logger.info(`Sent ${count} session${count === 1 ? "" : "s"} (${Math.round(creditedMs / 60_000)} min)`);
    return { creditedMs, sessions: count };
}

/** Convenience wrapper for a single session. */
export async function creditPlaytime(game: CreditableGame, durationMs: number, startedAt?: number): Promise<number> {
    const result = await creditPlaytimeBatch([{ game, durationMs, startedAt }]);
    return result.creditedMs;
}
