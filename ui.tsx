/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@components/Button";
import { Flex } from "@components/Flex";
import { Heading } from "@components/Heading";
import { Paragraph } from "@components/Paragraph";
import { React, useEffect, useState } from "@webpack/common";

import {
    GameTimeBadge,
    GameVarietyBadge,
    HypeSquadBalanceBadge,
    HypeSquadBraveryBadge,
    HypeSquadBrillianceBadge,
    StreamingBadge
} from "./badgeIcons";
import {
    HypeSquadHouse,
    leaveHypeSquad,
    setHypeSquadHouse
} from "./extraBadges";
import { GameFarmer } from "./gameFarmer";
import { DETECTABLE_GAMES } from "./games";
import { StreamHelper } from "./streamHelper";

function formatDurationSeconds(sec: number): string {
    const hours = Math.floor(sec / 3600);
    const mins = Math.floor((sec % 3600) / 60);
    const seconds = sec % 60;
    if (hours > 0) {
        return `${hours}h ${mins}m`;
    }
    if (mins > 0) {
        return `${mins}m ${seconds}s`;
    }
    return `${seconds}s`;
}

function getGameTimeTier(hours: number): { current: string; next: string; nextHours: number; progress: number } {
    const tiers = [
        { name: "Unranked", hours: 0 },
        { name: "Casual", hours: 1 },
        { name: "Recreational", hours: 8 },
        { name: "Dedicated", hours: 20 },
        { name: "Committed", hours: 78 },
        { name: "Veteran", hours: 250 },
        { name: "Elite", hours: 1000 },
        { name: "Legendary", hours: 2500 },
        { name: "Eternal (Max)", hours: 5000 }
    ];

    let currentTier = tiers[0];
    let nextTier = tiers[1];

    for (let i = 0; i < tiers.length; i++) {
        if (hours >= tiers[i].hours) {
            currentTier = tiers[i];
            nextTier = tiers[i + 1] ?? tiers[i];
        } else {
            break;
        }
    }

    const range = nextTier.hours - currentTier.hours;
    const progress = range > 0 ? Math.min(100, Math.round(((hours - currentTier.hours) / range) * 100)) : 100;

    return {
        current: currentTier.name,
        next: nextTier.name,
        nextHours: nextTier.hours,
        progress
    };
}

function getVarietyTier(count: number): { current: string; next: string; nextCount: number; progress: number } {
    const tiers = [
        { name: "Locked", count: 0 },
        { name: "Sampler", count: 2 },
        { name: "Explorer", count: 10 },
        { name: "Collector", count: 25 },
        { name: "Enthusiast", count: 50 },
        { name: "Connoisseur", count: 75 },
        { name: "Universalist (Max)", count: 100 }
    ];

    let currentTier = tiers[0];
    let nextTier = tiers[1];

    for (let i = 0; i < tiers.length; i++) {
        if (count >= tiers[i].count) {
            currentTier = tiers[i];
            nextTier = tiers[i + 1] ?? tiers[i];
        } else {
            break;
        }
    }

    const range = nextTier.count - currentTier.count;
    const progress = range > 0 ? Math.min(100, Math.round(((count - currentTier.count) / range) * 100)) : 100;

    return {
        current: currentTier.name,
        next: nextTier.name,
        nextCount: nextTier.count,
        progress
    };
}

function getStreamingTier(hours: number): { current: string; next: string; nextHours: number; progress: number } {
    const tiers = [
        { name: "Novice", hours: 1 },
        { name: "Fledgling", hours: 10 },
        { name: "Breakout", hours: 20 },
        { name: "Performer", hours: 50 },
        { name: "Broadcaster", hours: 100 },
        { name: "Star", hours: 500 },
        { name: "Icon", hours: 1000 },
        { name: "Legend (Max)", hours: 5000 }
    ];

    let currentTier = tiers[0];
    let nextTier = tiers[1];

    for (let i = 0; i < tiers.length; i++) {
        if (hours >= tiers[i].hours) {
            currentTier = tiers[i];
            nextTier = tiers[i + 1] ?? tiers[i];
        } else {
            break;
        }
    }

    const range = nextTier.hours - currentTier.hours;
    const progress = range > 0 ? Math.min(100, Math.round(((hours - currentTier.hours) / range) * 100)) : 100;

    return {
        current: currentTier.name,
        next: nextTier.name,
        nextHours: nextTier.hours,
        progress
    };
}

type TabKey = "overview" | "game_farmer" | "streaming" | "hypesquad";

export function BadgeFarmerDashboard() {
    const [tab, setTab] = useState<TabKey>("overview");
    const [, setTick] = useState(0);

    useEffect(() => {
        const unsubFarmer = GameFarmer.subscribe(() => setTick(t => t + 1));
        const unsubStream = StreamHelper.subscribe(() => setTick(t => t + 1));
        return () => {
            unsubFarmer();
            unsubStream();
        };
    }, []);

    const totalFarmedHours = Math.round((GameFarmer.totalFarmedSeconds / 3600) * 10) / 10;
    const gameTimeTier = getGameTimeTier(totalFarmedHours);

    const uniqueGamesCount = GameFarmer.uniqueGamesDispatched.size;
    const varietyTier = getVarietyTier(uniqueGamesCount);

    const streamInfo = StreamHelper.getInfo();
    const totalStreamHours = Math.round((streamInfo.totalStreamSeconds / 3600) * 10) / 10;
    const streamingTier = getStreamingTier(totalStreamHours);

    return (
        <div className="vc-badgefarm-container">
            <div className="vc-badgefarm-nav">
                <button
                    className={`vc-badgefarm-tab-btn ${tab === "overview" ? "active" : ""}`}
                    onClick={() => setTab("overview")}
                >
                    <GameTimeBadge width={18} height={18} />
                    All Badges
                </button>
                <button
                    className={`vc-badgefarm-tab-btn ${tab === "game_farmer" ? "active" : ""}`}
                    onClick={() => setTab("game_farmer")}
                >
                    <GameVarietyBadge width={18} height={18} />
                    Game Badges
                </button>
                <button
                    className={`vc-badgefarm-tab-btn ${tab === "streaming" ? "active" : ""}`}
                    onClick={() => setTab("streaming")}
                >
                    <StreamingBadge width={18} height={18} />
                    Streaming
                </button>
                <button
                    className={`vc-badgefarm-tab-btn ${tab === "hypesquad" ? "active" : ""}`}
                    onClick={() => setTab("hypesquad")}
                >
                    <HypeSquadBraveryBadge width={18} height={18} />
                    HypeSquad
                </button>
            </div>

            {tab === "overview" && (
                <>
                    <div className="vc-badgefarm-card">
                        <div className="vc-badgefarm-card-header">
                            <div className="vc-badgefarm-title-wrap">
                                <div className="vc-badgefarm-icon">
                                    <GameTimeBadge width={26} height={26} />
                                </div>
                                <div>
                                    <Heading tag="h3" className="vc-badgefarm-title">Badge Overview</Heading>
                                    <Paragraph className="vc-badgefarm-subtitle">
                                        Monitor progression across your Discord profile badges.
                                    </Paragraph>
                                </div>
                            </div>
                        </div>

                        <div className="vc-badgefarm-stats-grid">
                            <div className="vc-badgefarm-stat-box">
                                <span className="vc-badgefarm-stat-label">Game Time</span>
                                <span className="vc-badgefarm-stat-value">{formatDurationSeconds(GameFarmer.totalFarmedSeconds)}</span>
                                <span className="vc-badgefarm-badge-tier">{gameTimeTier.current}</span>
                            </div>
                            <div className="vc-badgefarm-stat-box">
                                <span className="vc-badgefarm-stat-label">Game Variety</span>
                                <span className="vc-badgefarm-stat-value">{uniqueGamesCount} / 100</span>
                                <span className="vc-badgefarm-badge-tier">{varietyTier.current}</span>
                            </div>
                            <div className="vc-badgefarm-stat-box">
                                <span className="vc-badgefarm-stat-label">Streamed to Others</span>
                                <span className="vc-badgefarm-stat-value">{formatDurationSeconds(streamInfo.totalStreamSeconds)}</span>
                                <span className="vc-badgefarm-badge-tier">{streamingTier.current}</span>
                            </div>
                            <div className="vc-badgefarm-stat-box">
                                <span className="vc-badgefarm-stat-label">Current State</span>
                                <span className="vc-badgefarm-stat-value">{GameFarmer.currentMode.replace(/_/g, " ")}</span>
                                <span className="vc-badgefarm-badge-tier">{GameFarmer.activeGame?.name ?? "No Game Active"}</span>
                            </div>
                        </div>
                    </div>

                    <div className="vc-badgefarm-badge-grid">
                        <div className="vc-badgefarm-badge-card">
                            <div className="vc-badgefarm-badge-icon">
                                <GameTimeBadge width={36} height={36} />
                            </div>
                            <span className="vc-badgefarm-badge-name">Game Time</span>
                            <span className="vc-badgefarm-badge-tier">{gameTimeTier.current}</span>
                            <div className="vc-badgefarm-progress-bar-bg">
                                <div className="vc-badgefarm-progress-bar-fill" style={{ width: `${gameTimeTier.progress}%` }} />
                            </div>
                            <Button
                                size="small"
                                variant={GameFarmer.currentMode === "GAME_TIME" ? "dangerPrimary" : "primary"}
                                onClick={() => {
                                    if (GameFarmer.currentMode === "GAME_TIME") GameFarmer.stopAllFarming();
                                    else GameFarmer.startGameTimeFarm();
                                }}
                            >
                                {GameFarmer.currentMode === "GAME_TIME" ? "Stop Farm" : "Farm Time"}
                            </Button>
                        </div>

                        <div className="vc-badgefarm-badge-card">
                            <div className="vc-badgefarm-badge-icon">
                                <GameVarietyBadge width={36} height={36} />
                            </div>
                            <span className="vc-badgefarm-badge-name">Game Variety</span>
                            <span className="vc-badgefarm-badge-tier">{varietyTier.current} ({uniqueGamesCount}/100)</span>
                            <div className="vc-badgefarm-progress-bar-bg">
                                <div className="vc-badgefarm-progress-bar-fill" style={{ width: `${Math.min(100, uniqueGamesCount)}%` }} />
                            </div>
                            <Button
                                size="small"
                                variant={GameFarmer.currentMode === "VARIETY_ROTATION" ? "dangerPrimary" : "primary"}
                                onClick={() => {
                                    if (GameFarmer.currentMode === "VARIETY_ROTATION") GameFarmer.stopAllFarming();
                                    else GameFarmer.startVarietyRotation();
                                }}
                            >
                                {GameFarmer.currentMode === "VARIETY_ROTATION" ? "Stop Rotation" : "Rotate Games"}
                            </Button>
                        </div>

                        <div className="vc-badgefarm-badge-card">
                            <div className="vc-badgefarm-badge-icon">
                                <StreamingBadge width={36} height={36} />
                            </div>
                            <span className="vc-badgefarm-badge-name">Streaming</span>
                            <span className="vc-badgefarm-badge-tier">{streamingTier.current} ({totalStreamHours}h)</span>
                            <div className="vc-badgefarm-progress-bar-bg">
                                <div className="vc-badgefarm-progress-bar-fill" style={{ width: `${streamingTier.progress}%` }} />
                            </div>
                            <Button
                                size="small"
                                variant="secondary"
                                onClick={() => setTab("streaming")}
                            >
                                Stream Assistant
                            </Button>
                        </div>

                        <div className="vc-badgefarm-badge-card">
                            <div className="vc-badgefarm-badge-icon">
                                <HypeSquadBraveryBadge width={36} height={36} />
                            </div>
                            <span className="vc-badgefarm-badge-name">HypeSquad</span>
                            <span className="vc-badgefarm-badge-tier">Instant Select</span>
                            <Button
                                size="small"
                                variant="secondary"
                                onClick={() => setTab("hypesquad")}
                            >
                                Pick House
                            </Button>
                        </div>
                    </div>
                </>
            )}

            {tab === "game_farmer" && (
                <>
                    <div className="vc-badgefarm-card">
                        <div className="vc-badgefarm-card-header">
                            <div className="vc-badgefarm-title-wrap">
                                <div className="vc-badgefarm-icon">
                                    <GameTimeBadge width={26} height={26} />
                                </div>
                                <div>
                                    <Heading tag="h3" className="vc-badgefarm-title">Game Time Badge</Heading>
                                    <Paragraph className="vc-badgefarm-subtitle">
                                        Simulate running detectable PC games to accumulate playtime hours toward profile tiers.
                                    </Paragraph>
                                </div>
                            </div>
                        </div>

                        <div className="vc-badgefarm-stats-grid">
                            <div className="vc-badgefarm-stat-box">
                                <span className="vc-badgefarm-stat-label">Active Game</span>
                                <span className="vc-badgefarm-stat-value">{GameFarmer.activeGame?.name ?? "None"}</span>
                            </div>
                            <div className="vc-badgefarm-stat-box">
                                <span className="vc-badgefarm-stat-label">Current Tier</span>
                                <span className="vc-badgefarm-stat-value">{gameTimeTier.current}</span>
                            </div>
                            <div className="vc-badgefarm-stat-box">
                                <span className="vc-badgefarm-stat-label">Total Time Farmed</span>
                                <span className="vc-badgefarm-stat-value">{formatDurationSeconds(GameFarmer.totalFarmedSeconds)}</span>
                            </div>
                            <div className="vc-badgefarm-stat-box">
                                <span className="vc-badgefarm-stat-label">Next Milestone ({gameTimeTier.next})</span>
                                <span className="vc-badgefarm-stat-value">{gameTimeTier.nextHours} Hours</span>
                            </div>
                        </div>

                        <div>
                            <Flex justifyContent="space-between" style={{ marginBottom: 4 }}>
                                <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Progress to {gameTimeTier.next}:</span>
                                <span style={{ fontSize: 12, fontWeight: 600 }}>{gameTimeTier.progress}%</span>
                            </Flex>
                            <div className="vc-badgefarm-progress-bar-bg">
                                <div className="vc-badgefarm-progress-bar-fill" style={{ width: `${gameTimeTier.progress}%` }} />
                            </div>
                        </div>

                        <div className="vc-badgefarm-actions">
                            <select
                                className="vc-badgefarm-select"
                                value={GameFarmer.selectedGameId}
                                onChange={e => {
                                    GameFarmer.selectedGameId = e.target.value;
                                    if (GameFarmer.currentMode === "GAME_TIME") {
                                        GameFarmer.startGameTimeFarm(e.target.value);
                                    }
                                    setTick(t => t + 1);
                                }}
                            >
                                {DETECTABLE_GAMES.map(g => (
                                    <option key={g.id} value={g.id}>
                                        {g.name}
                                    </option>
                                ))}
                            </select>

                            <Button
                                variant={GameFarmer.currentMode === "GAME_TIME" ? "dangerPrimary" : "primary"}
                                onClick={() => {
                                    if (GameFarmer.currentMode === "GAME_TIME") {
                                        GameFarmer.stopAllFarming();
                                    } else {
                                        GameFarmer.startGameTimeFarm();
                                    }
                                }}
                            >
                                {GameFarmer.currentMode === "GAME_TIME" ? "Stop Game Time Farm" : "Start Game Time Farm"}
                            </Button>

                            <Button
                                variant="secondary"
                                onClick={() => GameFarmer.resetTotalTime()}
                            >
                                Reset Timer
                            </Button>
                        </div>

                        <div className="vc-badgefarm-tip">
                            Discord unlocks the Casual tier after 1 cumulative hour (60 minutes) of active game detection with Discord open. Ensure "Display current activity as a status message" is enabled in User Settings under Activity Privacy.
                        </div>
                    </div>

                    <div className="vc-badgefarm-card">
                        <div className="vc-badgefarm-card-header">
                            <div className="vc-badgefarm-title-wrap">
                                <div className="vc-badgefarm-icon">
                                    <GameVarietyBadge width={26} height={26} />
                                </div>
                                <div>
                                    <Heading tag="h3" className="vc-badgefarm-title">Game Variety Badge</Heading>
                                    <Paragraph className="vc-badgefarm-subtitle">
                                        Cycle through detectable games to unlock the Universalist tier.
                                    </Paragraph>
                                </div>
                            </div>
                        </div>

                        <div className="vc-badgefarm-stats-grid">
                            <div className="vc-badgefarm-stat-box">
                                <span className="vc-badgefarm-stat-label">Unique Games Logged</span>
                                <span className="vc-badgefarm-stat-value">{uniqueGamesCount} / 100</span>
                            </div>
                            <div className="vc-badgefarm-stat-box">
                                <span className="vc-badgefarm-stat-label">Current Tier</span>
                                <span className="vc-badgefarm-stat-value">{varietyTier.current}</span>
                            </div>
                            <div className="vc-badgefarm-stat-box">
                                <span className="vc-badgefarm-stat-label">Rotation Delay</span>
                                <span className="vc-badgefarm-stat-value">{GameFarmer.rotationIntervalSeconds}s</span>
                            </div>
                            <div className="vc-badgefarm-stat-box">
                                <span className="vc-badgefarm-stat-label">Game Catalog</span>
                                <span className="vc-badgefarm-stat-value">{DETECTABLE_GAMES.length} Titles</span>
                            </div>
                        </div>

                        <div>
                            <Flex justifyContent="space-between" style={{ marginBottom: 4 }}>
                                <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Progress to Universalist (100 Games):</span>
                                <span style={{ fontSize: 12, fontWeight: 600 }}>{Math.min(100, uniqueGamesCount)}%</span>
                            </Flex>
                            <div className="vc-badgefarm-progress-bar-bg">
                                <div className="vc-badgefarm-progress-bar-fill" style={{ width: `${Math.min(100, uniqueGamesCount)}%` }} />
                            </div>
                        </div>

                        <div className="vc-badgefarm-actions">
                            <select
                                className="vc-badgefarm-select"
                                style={{ maxWidth: 200 }}
                                value={GameFarmer.rotationIntervalSeconds}
                                onChange={e => {
                                    const val = parseInt(e.target.value, 10);
                                    GameFarmer.rotationIntervalSeconds = val;
                                    setTick(t => t + 1);
                                }}
                            >
                                <option value={60}>60 Seconds per Game</option>
                                <option value={75}>75 Seconds (Recommended)</option>
                                <option value={90}>90 Seconds per Game</option>
                                <option value={120}>120 Seconds per Game</option>
                            </select>

                            <Button
                                variant={GameFarmer.currentMode === "VARIETY_ROTATION" ? "dangerPrimary" : "primary"}
                                onClick={() => {
                                    if (GameFarmer.currentMode === "VARIETY_ROTATION") {
                                        GameFarmer.stopAllFarming();
                                    } else {
                                        GameFarmer.startVarietyRotation();
                                    }
                                }}
                            >
                                {GameFarmer.currentMode === "VARIETY_ROTATION" ? "Stop Rotation" : "Start Rotation"}
                            </Button>

                            <Button
                                variant="secondary"
                                onClick={() => GameFarmer.manualNextGame()}
                            >
                                Next Game
                            </Button>

                            <Button
                                variant="secondary"
                                onClick={() => GameFarmer.resetUniqueGames()}
                            >
                                Reset Counter
                            </Button>
                        </div>

                        <div className="vc-badgefarm-tip">
                            Discord registers unique games only when a session meets the backend dwell threshold (at least 60 to 90 seconds per title). Rapid switching under 60 seconds is dropped by Discord telemetry.
                        </div>
                    </div>
                </>
            )}

            {tab === "streaming" && (
                <div className="vc-badgefarm-card">
                    <div className="vc-badgefarm-card-header">
                        <div className="vc-badgefarm-title-wrap">
                            <div className="vc-badgefarm-icon">
                                <StreamingBadge width={26} height={26} />
                            </div>
                            <div>
                                <Heading tag="h3" className="vc-badgefarm-title">Streaming Badge</Heading>
                                <Paragraph className="vc-badgefarm-subtitle">
                                    Monitor your stream and track hours toward the Streamed to Others badge requirement.
                                </Paragraph>
                            </div>
                        </div>
                    </div>

                    <div className="vc-badgefarm-stats-grid">
                        <div className="vc-badgefarm-stat-box">
                            <span className="vc-badgefarm-stat-label">Voice Channel</span>
                            <span className="vc-badgefarm-stat-value">{streamInfo.channelName ?? "Not in Voice"}</span>
                        </div>
                        <div className="vc-badgefarm-stat-box">
                            <span className="vc-badgefarm-stat-label">Current Tier</span>
                            <span className="vc-badgefarm-stat-value">{streamingTier.current}</span>
                        </div>
                        <div className="vc-badgefarm-stat-box">
                            <span className="vc-badgefarm-stat-label">Session Duration</span>
                            <span className="vc-badgefarm-stat-value">{formatDurationSeconds(streamInfo.sessionDurationSeconds)}</span>
                        </div>
                        <div className="vc-badgefarm-stat-box">
                            <span className="vc-badgefarm-stat-label">Total Streamed Hours</span>
                            <span className="vc-badgefarm-stat-value">{formatDurationSeconds(streamInfo.totalStreamSeconds)}</span>
                        </div>
                    </div>

                    <div className="vc-badgefarm-notice-box">
                        <div className="vc-badgefarm-notice-title">
                            {streamInfo.hasOtherUsers
                                ? `Stream duration logging. ${streamInfo.viewerCount} participant(s) in channel.`
                                : "Channel has no other users."}
                        </div>
                        <div className="vc-badgefarm-notice-desc">
                            {streamInfo.hasOtherUsers
                                ? "Discord is recording your streaming hours."
                                : "Discord requires at least one other user in the channel for hours to count. Connect another account to the call."}
                        </div>
                    </div>

                    <div>
                        <Flex justifyContent="space-between" style={{ marginBottom: 4 }}>
                            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Progress to {streamingTier.next} ({streamingTier.nextHours}h):</span>
                            <span style={{ fontSize: 12, fontWeight: 600 }}>{streamingTier.progress}%</span>
                        </Flex>
                        <div className="vc-badgefarm-progress-bar-bg">
                            <div className="vc-badgefarm-progress-bar-fill" style={{ width: `${streamingTier.progress}%` }} />
                        </div>
                    </div>

                    <div className="vc-badgefarm-actions">
                        <Button
                            variant={StreamHelper.antiAfkEnabled ? "primary" : "secondary"}
                            onClick={() => StreamHelper.toggleAntiAfk()}
                        >
                            {StreamHelper.antiAfkEnabled ? "Anti-AFK: Enabled" : "Anti-AFK: Disabled"}
                        </Button>

                        <Button
                            variant="secondary"
                            onClick={() => StreamHelper.resetStreamTime()}
                        >
                            Reset Timer
                        </Button>
                    </div>

                    <div className="vc-badgefarm-tip">
                        Join an empty server voice channel with a secondary account on your phone or browser. Share a window with Anti-AFK enabled. Hours accumulate while Discord remains open.
                    </div>
                </div>
            )}

            {tab === "hypesquad" && (
                <div className="vc-badgefarm-card">
                    <div className="vc-badgefarm-card-header">
                        <div className="vc-badgefarm-title-wrap">
                            <div className="vc-badgefarm-icon">
                                <HypeSquadBraveryBadge width={26} height={26} />
                            </div>
                            <div>
                                <Heading tag="h3" className="vc-badgefarm-title">HypeSquad Houses</Heading>
                                <Paragraph className="vc-badgefarm-subtitle">
                                    Select your HypeSquad House badge without taking the personality quiz.
                                </Paragraph>
                            </div>
                        </div>
                    </div>

                    <div className="vc-badgefarm-actions">
                        <Button
                            style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
                            onClick={() => setHypeSquadHouse(HypeSquadHouse.BRAVERY)}
                        >
                            <HypeSquadBraveryBadge width={18} height={18} />
                            House of Bravery
                        </Button>
                        <Button
                            style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
                            onClick={() => setHypeSquadHouse(HypeSquadHouse.BRILLIANCE)}
                        >
                            <HypeSquadBrillianceBadge width={18} height={18} />
                            House of Brilliance
                        </Button>
                        <Button
                            style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
                            onClick={() => setHypeSquadHouse(HypeSquadHouse.BALANCE)}
                        >
                            <HypeSquadBalanceBadge width={18} height={18} />
                            House of Balance
                        </Button>
                        <Button
                            variant="dangerPrimary"
                            onClick={leaveHypeSquad}
                        >
                            Leave HypeSquad
                        </Button>
                    </div>
                </div>
            )}
        </div>
    );
}
