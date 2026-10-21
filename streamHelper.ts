/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import { Logger } from "@utils/Logger";
import {
    ApplicationStreamingStore,
    ChannelStore,
    FluxDispatcher,
    SelectedChannelStore,
    UserStore,
    VoiceStateStore
} from "@webpack/common";

import { showBadgeToast } from "./toast";

const logger = new Logger("BadgeFarmer:StreamHelper");
const DATASTORE_KEY_STREAM_TIME = "BadgeFarmer_totalStreamSeconds";
const DATASTORE_KEY_ANTI_AFK = "BadgeFarmer_antiAfkEnabled";

export interface StreamSessionInfo {
    isStreaming: boolean;
    isInVoice: boolean;
    channelName: string | null;
    channelId: string | null;
    viewerCount: number;
    hasOtherUsers: boolean;
    sessionDurationSeconds: number;
    totalStreamSeconds: number;
}

class StreamHelperManager {
    public isStreaming: boolean = false;
    public streamStartedAt: number | null = null;
    public sessionDurationSeconds: number = 0;
    public totalStreamSeconds: number = 0;
    public antiAfkEnabled: boolean = true;

    private intervalTimer: ReturnType<typeof setInterval> | null = null;
    private keepAliveTimer: ReturnType<typeof setInterval> | null = null;
    private listeners: Set<() => void> = new Set();

    public subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    private notify() {
        for (const listener of this.listeners) {
            listener();
        }
    }

    public async initialize() {
        try {
            const savedTime = await DataStore.get(DATASTORE_KEY_STREAM_TIME);
            if (typeof savedTime === "number") {
                this.totalStreamSeconds = savedTime;
            }

            const savedAfk = await DataStore.get(DATASTORE_KEY_ANTI_AFK);
            if (typeof savedAfk === "boolean") {
                this.antiAfkEnabled = savedAfk;
            }
        } catch (e) {
            logger.warn("Failed to load stream state from DataStore", e);
        }

        this.startLoop();
    }

    public async toggleAntiAfk() {
        this.antiAfkEnabled = !this.antiAfkEnabled;
        try {
            await DataStore.set(DATASTORE_KEY_ANTI_AFK, this.antiAfkEnabled);
        } catch (e) {
            logger.warn("Failed to persist antiAfk state", e);
        }
        this.notify();
    }

    private async persistTime() {
        try {
            await DataStore.set(DATASTORE_KEY_STREAM_TIME, this.totalStreamSeconds);
        } catch (e) {
            logger.warn("Failed to persist stream time", e);
        }
    }

    public getInfo(): StreamSessionInfo {
        const currentUser = UserStore?.getCurrentUser();
        const currentUserId = currentUser?.id;
        const channelId = SelectedChannelStore?.getVoiceChannelId() ?? null;
        const channel = channelId ? ChannelStore?.getChannel(channelId) : null;

        let activeStream = false;
        try {
            if (currentUserId && ApplicationStreamingStore) {
                const store = ApplicationStreamingStore as any;
                activeStream = Boolean(store.getCurrentUserActiveStream?.() || store.getStreamForUser?.(currentUserId));
            }
        } catch {
            activeStream = false;
        }

        let viewerCount = 0;
        let hasOtherUsers = false;

        if (channelId && VoiceStateStore) {
            try {
                const voiceStore = VoiceStateStore as any;
                const states = voiceStore.getVoiceStatesForChannel?.(channelId) ?? {};
                const users = Object.keys(states);
                viewerCount = Math.max(0, users.length - 1);
                hasOtherUsers = viewerCount > 0;
            } catch {
                viewerCount = 0;
            }
        }

        return {
            isStreaming: activeStream,
            isInVoice: Boolean(channelId),
            channelName: channel?.name ?? (channelId ? "Voice Channel" : null),
            channelId,
            viewerCount,
            hasOtherUsers,
            sessionDurationSeconds: this.sessionDurationSeconds,
            totalStreamSeconds: this.totalStreamSeconds
        };
    }

    private startLoop() {
        if (this.intervalTimer) return;

        this.intervalTimer = setInterval(() => {
            const info = this.getInfo();

            if (info.isStreaming) {
                if (!this.isStreaming) {
                    this.isStreaming = true;
                    this.streamStartedAt = Date.now();
                    this.sessionDurationSeconds = 0;
                    showBadgeToast("Active stream detected. Logging streaming hours.", "success");
                }

                this.sessionDurationSeconds += 1;
                // Only count towards badge if streamed to others!
                if (info.hasOtherUsers) {
                    this.totalStreamSeconds += 1;
                    if (this.totalStreamSeconds % 60 === 0) {
                        this.persistTime();
                    }
                }
            } else if (this.isStreaming) {
                this.isStreaming = false;
                this.streamStartedAt = null;
                this.sessionDurationSeconds = 0;
                this.persistTime();
                showBadgeToast("Stream ended.", "default");
            }

            this.notify();
        }, 1000);

        // Anti-AFK Keep-Alive loop (dispatches subtle voice activity to avoid AFK disconnects)
        this.keepAliveTimer = setInterval(() => {
            if (!this.antiAfkEnabled) return;
            const info = this.getInfo();
            if (info.isInVoice && info.isStreaming) {
                // Ping Discord internal voice state to avoid inactivity timeout
                FluxDispatcher.dispatch({
                    type: "IDLE",
                    idle: false
                });
            }
        }, 60000); // Once every minute
    }

    public resetStreamTime() {
        this.totalStreamSeconds = 0;
        this.persistTime();
        showBadgeToast("Stream farmed time reset.", "default");
        this.notify();
    }

    public cleanup() {
        if (this.intervalTimer) {
            clearInterval(this.intervalTimer);
            this.intervalTimer = null;
        }
        if (this.keepAliveTimer) {
            clearInterval(this.keepAliveTimer);
            this.keepAliveTimer = null;
        }
        this.listeners.clear();
    }
}

export const StreamHelper = new StreamHelperManager();
