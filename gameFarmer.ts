/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import { Logger } from "@utils/Logger";
import { FluxDispatcher, RunningGameStore } from "@webpack/common";

import { showBadgeToast } from "./toast";

import { DETECTABLE_GAMES, DetectableGame, findGameById } from "./games";

const logger = new Logger("BadgeFarmer:GameFarmer");

const DATASTORE_KEY_UNIQUE = "BadgeFarmer_uniqueGames";
const DATASTORE_KEY_TOTAL_TIME = "BadgeFarmer_totalFarmedTime";
const DATASTORE_KEY_SELECTED_GAME = "BadgeFarmer_selectedGame";
const DATASTORE_KEY_ROTATION_INTERVAL = "BadgeFarmer_rotationInterval";

export interface RunningGame {
    id: string | null;
    name: string;
    pid: number;
    pidPath?: number[];
    processName: string;
    start: number;
    exeName: string;
    exePath: string;
    cmdLine?: string;
    executables?: Array<{ os: string; name: string; is_launcher: boolean }>;
    windowHandle?: number;
    fullscreenType?: number;
    overlay?: boolean;
    sandboxed?: boolean;
    hidden?: boolean;
    isLauncher?: boolean;
    lastFocused?: number;
    lastLaunched?: number;
    distributor?: string;
    nativeProcessObserverId?: number;
    elevated?: boolean;
}

interface RunningGameStoreType {
    getRunningGames(): RunningGame[];
    getGameForPID(pid: number): RunningGame | undefined;
    getVisibleGame?(): RunningGame | undefined;
    getVisibleRunningGames?(): RunningGame[];
    getCandidateGames?(): RunningGame[];
    getRunningDiscordApplicationIds?(): string[];
    getRunningVerifiedApplicationIds?(): string[];
    getCurrentGameForAnalytics?(): RunningGame | null;
    getGamesSeen?(includeHidden?: boolean): RunningGame[];
    isGameSeen?(id: string): boolean;
    isDetectionEnabled?(game: RunningGame): boolean;
    getGameForName?(name: string): RunningGame | null;
    getSeenGameByName?(name: string): RunningGame | null;
}

export type FarmerMode = "IDLE" | "GAME_TIME" | "VARIETY_ROTATION";

const FARMER_SOCKET_ID = "BadgeFarmer";

class GameFarmerManager {
    public activeGame: RunningGame | null = null;
    public currentMode: FarmerMode = "IDLE";
    public sessionStartTime: number | null = null;
    public totalFarmedSeconds: number = 0;
    public uniqueGamesDispatched: Set<string> = new Set();
    public selectedGameId: string = "356875988589740042"; // Default: Dota 2
    public rotationIntervalSeconds: number = 75; // Default: 75s safe threshold for Discord telemetry
    public currentRotationIndex: number = 0;

    private storeOriginals: Partial<RunningGameStoreType> = {};
    private isPatched: boolean = false;
    private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    private rotationTimer: ReturnType<typeof setTimeout> | null = null;
    private secondTickTimer: ReturnType<typeof setInterval> | null = null;
    private listeners: Set<() => void> = new Set();

    private currentPid: number = 48000 + Math.floor(Math.random() * 5000);

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
            const savedUnique = await DataStore.get(DATASTORE_KEY_UNIQUE);
            if (Array.isArray(savedUnique)) {
                this.uniqueGamesDispatched = new Set(savedUnique);
            }

            const savedTime = await DataStore.get(DATASTORE_KEY_TOTAL_TIME);
            if (typeof savedTime === "number") {
                this.totalFarmedSeconds = savedTime;
            }

            const savedGame = await DataStore.get(DATASTORE_KEY_SELECTED_GAME);
            if (typeof savedGame === "string" && findGameById(savedGame)) {
                this.selectedGameId = savedGame;
            }

            const savedInterval = await DataStore.get(DATASTORE_KEY_ROTATION_INTERVAL);
            if (typeof savedInterval === "number" && savedInterval >= 30) {
                this.rotationIntervalSeconds = savedInterval;
            }
        } catch (e) {
            logger.warn("Failed to load saved state from DataStore", e);
        }

        this.startSecondTicker();
    }

    private async persistState() {
        try {
            await DataStore.set(DATASTORE_KEY_UNIQUE, Array.from(this.uniqueGamesDispatched));
            await DataStore.set(DATASTORE_KEY_TOTAL_TIME, this.totalFarmedSeconds);
            await DataStore.set(DATASTORE_KEY_SELECTED_GAME, this.selectedGameId);
            await DataStore.set(DATASTORE_KEY_ROTATION_INTERVAL, this.rotationIntervalSeconds);
        } catch (e) {
            logger.warn("Failed to persist state", e);
        }
    }

    private startSecondTicker() {
        if (this.secondTickTimer) return;
        this.secondTickTimer = setInterval(() => {
            if (this.currentMode !== "IDLE") {
                this.totalFarmedSeconds += 1;
                if (this.totalFarmedSeconds % 60 === 0) {
                    this.persistState();
                }
                this.notify();
            }
        }, 1000);
    }

    public patchRunningGameStore() {
        if (this.isPatched) return;
        const store = RunningGameStore as unknown as RunningGameStoreType;
        if (!store || typeof store.getRunningGames !== "function") {
            logger.warn("RunningGameStore not ready to patch");
            return;
        }

        this.storeOriginals.getRunningGames = store.getRunningGames.bind(store);
        this.storeOriginals.getGameForPID = store.getGameForPID.bind(store);
        if (store.getVisibleGame) this.storeOriginals.getVisibleGame = store.getVisibleGame.bind(store);
        if (store.getVisibleRunningGames) this.storeOriginals.getVisibleRunningGames = store.getVisibleRunningGames.bind(store);
        if (store.getCandidateGames) this.storeOriginals.getCandidateGames = store.getCandidateGames.bind(store);
        if (store.getRunningDiscordApplicationIds) this.storeOriginals.getRunningDiscordApplicationIds = store.getRunningDiscordApplicationIds.bind(store);
        if (store.getRunningVerifiedApplicationIds) this.storeOriginals.getRunningVerifiedApplicationIds = store.getRunningVerifiedApplicationIds.bind(store);
        if (store.getCurrentGameForAnalytics) this.storeOriginals.getCurrentGameForAnalytics = store.getCurrentGameForAnalytics.bind(store);
        if (store.getGamesSeen) this.storeOriginals.getGamesSeen = store.getGamesSeen.bind(store);
        if (store.isGameSeen) this.storeOriginals.isGameSeen = store.isGameSeen.bind(store);
        if (store.isDetectionEnabled) this.storeOriginals.isDetectionEnabled = store.isDetectionEnabled.bind(store);
        if (store.getGameForName) this.storeOriginals.getGameForName = store.getGameForName.bind(store);
        if (store.getSeenGameByName) this.storeOriginals.getSeenGameByName = store.getSeenGameByName.bind(store);

        const self = this;
        const withoutOurs = (games: RunningGame[] | undefined) =>
            (games ?? []).filter(g => g.pid !== self.currentPid);

        store.getRunningGames = () => {
            const original = self.storeOriginals.getRunningGames?.() ?? [];
            const filtered = withoutOurs(original);
            return self.activeGame ? [...filtered, self.activeGame] : filtered;
        };

        store.getGameForPID = (pid: number) => {
            if (self.activeGame && pid === self.currentPid) return self.activeGame;
            return self.storeOriginals.getGameForPID?.(pid);
        };

        if (this.storeOriginals.getVisibleGame) {
            store.getVisibleGame = () => {
                if (self.activeGame) return self.activeGame;
                return self.storeOriginals.getVisibleGame?.();
            };
        }

        if (this.storeOriginals.getVisibleRunningGames) {
            store.getVisibleRunningGames = () => {
                const original = self.storeOriginals.getVisibleRunningGames?.() ?? [];
                const filtered = withoutOurs(original);
                return self.activeGame ? [...filtered, self.activeGame] : filtered;
            };
        }

        if (this.storeOriginals.getCandidateGames) {
            store.getCandidateGames = () => {
                const original = self.storeOriginals.getCandidateGames?.() ?? [];
                const filtered = withoutOurs(original);
                return self.activeGame ? [...filtered, self.activeGame] : filtered;
            };
        }

        if (this.storeOriginals.getRunningDiscordApplicationIds) {
            store.getRunningDiscordApplicationIds = () => {
                const original = self.storeOriginals.getRunningDiscordApplicationIds?.() ?? [];
                return self.activeGame?.id ? Array.from(new Set([...original, self.activeGame.id])) : original;
            };
        }

        if (this.storeOriginals.getRunningVerifiedApplicationIds) {
            store.getRunningVerifiedApplicationIds = () => {
                const original = self.storeOriginals.getRunningVerifiedApplicationIds?.() ?? [];
                return self.activeGame?.id ? Array.from(new Set([...original, self.activeGame.id])) : original;
            };
        }

        if (this.storeOriginals.getCurrentGameForAnalytics) {
            store.getCurrentGameForAnalytics = () => {
                if (self.activeGame) return self.activeGame;
                return self.storeOriginals.getCurrentGameForAnalytics?.() ?? null;
            };
        }

        if (this.storeOriginals.getGamesSeen) {
            store.getGamesSeen = (includeHidden?: boolean) => {
                const original = self.storeOriginals.getGamesSeen?.(includeHidden) ?? [];
                const filtered = withoutOurs(original);
                return self.activeGame ? [...filtered, self.activeGame] : filtered;
            };
        }

        if (this.storeOriginals.isGameSeen) {
            store.isGameSeen = (id: string) => {
                if (self.activeGame?.id === id) return true;
                return self.storeOriginals.isGameSeen?.(id) ?? false;
            };
        }

        if (this.storeOriginals.isDetectionEnabled) {
            store.isDetectionEnabled = (game: RunningGame) => {
                if (self.activeGame && (game.pid === self.currentPid || game.id === self.activeGame.id)) return true;
                return self.storeOriginals.isDetectionEnabled?.(game) ?? true;
            };
        }

        if (this.storeOriginals.getGameForName) {
            store.getGameForName = (name: string) => {
                if (self.activeGame && self.activeGame.name.toLowerCase() === name.toLowerCase()) return self.activeGame;
                return self.storeOriginals.getGameForName?.(name) ?? null;
            };
        }

        if (this.storeOriginals.getSeenGameByName) {
            store.getSeenGameByName = (name: string) => {
                if (self.activeGame && self.activeGame.name.toLowerCase() === name.toLowerCase()) return self.activeGame;
                return self.storeOriginals.getSeenGameByName?.(name) ?? null;
            };
        }

        this.isPatched = true;
        logger.info("RunningGameStore successfully patched.");
    }

    public unpatchRunningGameStore() {
        if (!this.isPatched) return;
        const store = RunningGameStore as unknown as RunningGameStoreType;
        if (store) {
            if (this.storeOriginals.getRunningGames) store.getRunningGames = this.storeOriginals.getRunningGames;
            if (this.storeOriginals.getGameForPID) store.getGameForPID = this.storeOriginals.getGameForPID;
            if (this.storeOriginals.getVisibleGame) store.getVisibleGame = this.storeOriginals.getVisibleGame;
            if (this.storeOriginals.getVisibleRunningGames) store.getVisibleRunningGames = this.storeOriginals.getVisibleRunningGames;
            if (this.storeOriginals.getCandidateGames) store.getCandidateGames = this.storeOriginals.getCandidateGames;
            if (this.storeOriginals.getRunningDiscordApplicationIds) store.getRunningDiscordApplicationIds = this.storeOriginals.getRunningDiscordApplicationIds;
            if (this.storeOriginals.getRunningVerifiedApplicationIds) store.getRunningVerifiedApplicationIds = this.storeOriginals.getRunningVerifiedApplicationIds;
            if (this.storeOriginals.getCurrentGameForAnalytics) store.getCurrentGameForAnalytics = this.storeOriginals.getCurrentGameForAnalytics;
            if (this.storeOriginals.getGamesSeen) store.getGamesSeen = this.storeOriginals.getGamesSeen;
            if (this.storeOriginals.isGameSeen) store.isGameSeen = this.storeOriginals.isGameSeen;
            if (this.storeOriginals.isDetectionEnabled) store.isDetectionEnabled = this.storeOriginals.isDetectionEnabled;
            if (this.storeOriginals.getGameForName) store.getGameForName = this.storeOriginals.getGameForName;
            if (this.storeOriginals.getSeenGameByName) store.getSeenGameByName = this.storeOriginals.getSeenGameByName;
        }
        this.storeOriginals = {};
        this.isPatched = false;
        logger.info("RunningGameStore restored.");
    }

    private buildGame(game: DetectableGame, startTime?: number): RunningGame {
        const isLinux = typeof navigator !== "undefined" && /Linux/i.test(navigator.userAgent);
        const start = startTime ?? Date.now();
        const exeClean = game.exe.replace(/^>/, "");
        const exePath = isLinux
            ? `/usr/games/${exeClean}`
            : `C:\\Program Files (x86)\\Steam\\steamapps\\common\\${game.name}\\${exeClean}`;

        return {
            id: game.id,
            name: game.name,
            pid: this.currentPid,
            pidPath: [this.currentPid],
            processName: game.name,
            start,
            lastFocused: Date.now(),
            lastLaunched: start,
            distributor: "steam",
            nativeProcessObserverId: 1,
            exeName: exeClean,
            exePath,
            cmdLine: exePath,
            executables: [{
                os: isLinux ? "linux" : "win32",
                name: exeClean,
                is_launcher: false
            }],
            windowHandle: 1001,
            fullscreenType: 0,
            overlay: true,
            elevated: false,
            sandboxed: false,
            hidden: false,
            isLauncher: false
        };
    }

    private announceGame(game: RunningGame) {
        const store = RunningGameStore as unknown as RunningGameStoreType;
        const currentGames = store?.getRunningGames?.() ?? [game];

        FluxDispatcher.dispatch({
            type: "RUNNING_GAMES_CHANGE",
            added: [game],
            removed: [],
            games: currentGames
        });

        FluxDispatcher.dispatch({
            type: "LOCAL_ACTIVITY_UPDATE",
            socketId: FARMER_SOCKET_ID,
            pid: game.pid,
            activity: {
                application_id: game.id ?? undefined,
                name: game.name,
                type: 0,
                details: null,
                state: null,
                timestamps: { start: game.start },
                assets: null,
                flags: 1
            }
        });
    }

    private removeCurrentGame() {
        if (!this.activeGame) return;
        const prev = this.activeGame;
        this.activeGame = null;

        const store = RunningGameStore as unknown as RunningGameStoreType;
        const remaining = store?.getRunningGames?.() ?? [];

        FluxDispatcher.dispatch({
            type: "RUNNING_GAMES_CHANGE",
            added: [],
            removed: [prev],
            games: remaining
        });

        FluxDispatcher.dispatch({
            type: "LOCAL_ACTIVITY_UPDATE",
            socketId: FARMER_SOCKET_ID,
            pid: prev.pid,
            activity: null
        });
    }

    public startGame(game: DetectableGame, preserveStart: boolean = false) {
        this.patchRunningGameStore();

        const previous = this.activeGame;
        const start = preserveStart && previous?.start ? previous.start : Date.now();

        if (previous && previous.id !== game.id) {
            this.removeCurrentGame();
        }

        this.activeGame = this.buildGame(game, start);
        this.uniqueGamesDispatched.add(game.id);
        this.persistState();

        this.announceGame(this.activeGame);
        this.startHeartbeat();
        this.notify();
    }

    private startHeartbeat() {
        if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = setInterval(() => {
            if (this.activeGame) {
                this.announceGame(this.activeGame);
            }
        }, 30000);
    }

    private stopTimers() {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
        if (this.rotationTimer) {
            clearTimeout(this.rotationTimer);
            this.rotationTimer = null;
        }
    }

    // --- Mode 1: Game Time Farming ---
    public startGameTimeFarm(gameId?: string) {
        this.stopAllFarming(false);
        const targetId = gameId || this.selectedGameId;
        const game = findGameById(targetId) || DETECTABLE_GAMES[0];

        this.selectedGameId = game.id;
        this.currentMode = "GAME_TIME";
        this.sessionStartTime = Date.now();

        this.startGame(game, false);
        showBadgeToast(`Farming Game Time: ${game.name}`, "success");
        this.notify();
    }

    // --- Mode 2: Variety Rotation ---
    public startVarietyRotation(intervalSec?: number) {
        this.stopAllFarming(false);
        if (intervalSec && intervalSec >= 30) {
            this.rotationIntervalSeconds = intervalSec;
        }

        this.currentMode = "VARIETY_ROTATION";
        this.sessionStartTime = Date.now();
        this.currentRotationIndex = 0;

        showBadgeToast(`Started Game Variety rotation (${this.rotationIntervalSeconds}s interval)`, "success");
        this.scheduleNextRotationStep();
        this.notify();
    }

    private scheduleNextRotationStep() {
        if (this.currentMode !== "VARIETY_ROTATION") return;

        const game = DETECTABLE_GAMES[this.currentRotationIndex % DETECTABLE_GAMES.length];
        this.startGame(game, false);

        const currentCount = this.uniqueGamesDispatched.size;
        if (currentCount >= 100) {
            showBadgeToast("100 unique games logged for Game Variety.", "success");
        }

        this.currentRotationIndex = (this.currentRotationIndex + 1) % DETECTABLE_GAMES.length;

        this.rotationTimer = setTimeout(() => {
            this.scheduleNextRotationStep();
        }, this.rotationIntervalSeconds * 1000);

        this.notify();
    }

    public manualNextGame() {
        this.currentRotationIndex = (this.currentRotationIndex + 1) % DETECTABLE_GAMES.length;
        const game = DETECTABLE_GAMES[this.currentRotationIndex];
        this.startGame(game, false);
        showBadgeToast(`Switched to: ${game.name}`, "success");
        this.notify();
    }

    public stopAllFarming(notifyUser: boolean = true) {
        this.stopTimers();
        this.currentMode = "IDLE";
        this.sessionStartTime = null;
        this.removeCurrentGame();
        this.unpatchRunningGameStore();
        this.persistState();

        if (notifyUser) {
            showBadgeToast("Badge farming stopped.", "default");
        }
        this.notify();
    }

    public resetUniqueGames() {
        this.uniqueGamesDispatched.clear();
        this.persistState();
        showBadgeToast("Unique games progress reset.", "default");
        this.notify();
    }

    public resetTotalTime() {
        this.totalFarmedSeconds = 0;
        this.persistState();
        showBadgeToast("Total farmed time reset.", "default");
        this.notify();
    }

    public cleanup() {
        this.stopAllFarming(false);
        if (this.secondTickTimer) {
            clearInterval(this.secondTickTimer);
            this.secondTickTimer = null;
        }
        this.listeners.clear();
    }
}

export const GameFarmer = new GameFarmerManager();
