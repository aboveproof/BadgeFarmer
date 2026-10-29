/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@components/Button";
import { Flex } from "@components/Flex";
import { Heading } from "@components/Heading";
import { Notice } from "@components/Notice";
import { Paragraph } from "@components/Paragraph";
import { Logger } from "@utils/Logger";
import { useForceUpdater } from "@utils/react";
import { TextInput,useEffect, useMemo, useState } from "@webpack/common";
import type { JSX } from "react";

import type { DetectableApp } from "./farmer";
import * as Farmer from "./farmer";

const cl = (name: string) => `vc-badge-farmer-${name}`;

const DETECTABLE_APPS_URL = "https://discord.com/api/v10/applications/detectable";
const MAX_RESULTS = 30;

const logger = new Logger("BadgeFarmer:Dashboard");

let cataloguePromise: Promise<DetectableApp[]> | null = null;

export function loadCatalogue(): Promise<DetectableApp[]> {
    cataloguePromise ??= fetch(DETECTABLE_APPS_URL)
        .then(response => {
            if (!response.ok) throw new Error(`Discord returned ${response.status}`);
            return response.json() as Promise<DetectableApp[]>;
        })
        .then(apps => apps.filter(app => app.id != null && app.name != null))
        .catch(error => {
            cataloguePromise = null;
            throw error;
        });

    return cataloguePromise;
}

function useCatalogue(): { apps: DetectableApp[] | null; error: string | null; } {
    const [apps, setApps] = useState<DetectableApp[] | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        loadCatalogue().then(
            loaded => { if (!cancelled) setApps(loaded); },
            cause => { if (!cancelled) setError(`Could not load the game list: ${cause.message}`); }
        );
        return () => { cancelled = true; };
    }, []);

    return { apps, error };
}

function useFarmerStatus() {
    const forceUpdate = useForceUpdater();

    useEffect(() => Farmer.subscribe(forceUpdate), []);

    return Farmer.getStatus();
}

const TIME_TIERS = [
    { name: "Casual", hours: 1 },
    { name: "Recreational", hours: 8 },
    { name: "Dedicated", hours: 20 },
    { name: "Committed", hours: 78 },
    { name: "Veteran", hours: 250 },
    { name: "Elite", hours: 1000 },
    { name: "Legendary", hours: 2500 },
    { name: "Eternal", hours: 5000 }
] as const;

const VARIETY_TIERS = [
    { name: "Dabbler", games: 3 },
    { name: "Adventurer", games: 10 },
    { name: "Explorer", games: 25 },
    { name: "Connoisseur", games: 50 },
    { name: "Universalist", games: 100 }
] as const;

function tierProgress(hours: number, tiers: ReadonlyArray<{ name: string; hours: number; }>): { name: string; next: string | null; pct: number; } {
    let current = "Unranked";
    let next: string | null = tiers[0].name;
    let floor = 0;
    let ceil = tiers[0].hours;

    for (let index = 0; index < tiers.length; index++) {
        if (hours >= tiers[index].hours) {
            current = tiers[index].name;
            floor = tiers[index].hours;
            ceil = tiers[index + 1]?.hours ?? tiers[index].hours;
            next = tiers[index + 1]?.name ?? null;
        }
    }

    const pct = ceil === floor ? 100 : Math.min(100, Math.round(((hours - floor) / (ceil - floor)) * 100));
    return { name: current, next, pct };
}

function tierProgressGames(count: number, tiers: ReadonlyArray<{ name: string; games: number; }>): { name: string; next: string | null; pct: number; } {
    let current = "Unranked";
    let next: string | null = tiers[0].name;
    let floor = 0;
    let ceil = tiers[0].games;

    for (let index = 0; index < tiers.length; index++) {
        if (count >= tiers[index].games) {
            current = tiers[index].name;
            floor = tiers[index].games;
            ceil = tiers[index + 1]?.games ?? tiers[index].games;
            next = tiers[index + 1]?.name ?? null;
        }
    }

    const pct = ceil === floor ? 100 : Math.min(100, Math.round(((count - floor) / (ceil - floor)) * 100));
    return { name: current, next, pct };
}

function ProgressBar({ pct }: { pct: number; }) {
    return (
        <div className={cl("progress-track")}>
            <div className={cl("progress-fill")} style={{ width: `${pct}%` }} />
        </div>
    );
}

function TierRow({ label, tier }: { label: string; tier: { name: string; next: string | null; pct: number; }; }) {
    return (
        <div className={cl("tier-row")}>
            <div className={cl("tier-copy")}>
                <span className={cl("tier-label")}>{label}</span>
                <span className={cl("tier-value")}>
                    {tier.name}{tier.next != null && <span className={cl("muted")}> → {tier.next}</span>}
                </span>
            </div>
            <ProgressBar pct={tier.pct} />
        </div>
    );
}

function parseHours(value: string): number | null {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 && parsed <= 5000 ? parsed : null;
}

function parseMinutes(value: string): number | null {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 1 && parsed <= 1440 ? parsed : null;
}

function pickVarietyPool(apps: DetectableApp[], count: number): DetectableApp[] {
    const pool = [...apps];
    for (let index = 0; index < count && index < pool.length; index++) {
        const picked = index + Math.floor(Math.random() * (pool.length - index));
        [pool[index], pool[picked]] = [pool[picked], pool[index]];
    }
    return pool.slice(0, count);
}

export function BadgeFarmerDashboard(): JSX.Element {
    const { apps, error: catalogueError } = useCatalogue();
    const status = useFarmerStatus();
    const [query, setQuery] = useState("");
    const [selected, setSelected] = useState<DetectableApp | null>(null);
    const [timeTarget, setTimeTarget] = useState("5000");
    const [varietyMinutes, setVarietyMinutes] = useState("2");
    const [streamTarget, setStreamTarget] = useState("5000");

    const results = useMemo(() => {
        const needle = query.trim().toLowerCase();
        if (apps == null || needle.length < 2 || selected != null) return [];

        return apps
            .filter(app => app.name.toLowerCase().includes(needle))
            .sort((left, right) =>
                Number(right.name.toLowerCase().startsWith(needle)) - Number(left.name.toLowerCase().startsWith(needle))
                || left.name.localeCompare(right.name))
            .slice(0, MAX_RESULTS);
    }, [apps, query, selected]);

    const parsedTimeTarget = parseHours(timeTarget);
    const parsedVarietyMinutes = parseMinutes(varietyMinutes);
    const parsedStreamTarget = parseHours(streamTarget);

    const timeTier = tierProgress(status.hoursCreditedThisRun, TIME_TIERS);
    const varietyTier = tierProgressGames(status.gamesCreditedThisRun, VARIETY_TIERS);
    const streamTier = tierProgress(status.streamHoursCreditedThisRun, TIME_TIERS);

    const busy = status.mode !== "IDLE";

    function act(action: () => void | Promise<void>) {
        void action();
    }

    return (
        <div className={cl("dashboard")}>
            {status.notrackBlocked && (
                <Notice.Warning>
                    NoTrack is on and will eat the requests this plugin sends. Turn it off (plus the data sharing
                    toggles in Discord's privacy settings) until the badges land. You can switch it back after.
                </Notice.Warning>
            )}

            {catalogueError != null && <Notice.Danger>{catalogueError}</Notice.Danger>}

            <Heading tag="h3">Badge targets</Heading>

            <TierRow label="Game Time" tier={timeTier} />
            <TierRow label="Game Variety" tier={varietyTier} />
            <TierRow label="Streaming" tier={streamTier} />

            {busy && (
                <Notice.Positive>
                    <span className={cl("status-line")}>
                        Running <strong>{status.mode}</strong>
                        {status.activeGame != null && <> · playing <strong>{status.activeGame.name}</strong></>}
                    </span>
                    <span className={cl("status-line")}>
                        {status.mode === "VARIETY" || status.mode === "MAX_ALL"
                            ? <>Games credited: {status.gamesCreditedThisRun} / {status.varietyTotal} · </>
                            : null}
                        Hours credited: {status.hoursCreditedThisRun}h · Stream hours: {status.streamHoursCreditedThisRun}h
                        {status.streamBatches > 0 && <> · batch {status.streamBatch}/{status.streamBatches}</>}
                        {status.errors > 0 && <> · {status.errors} errors</>}
                    </span>
                </Notice.Positive>
            )}

            {busy && status.lastError != null && (
                <Notice.Warning>
                    <span className={cl("status-line")}>Last error: {status.lastError}</span>
                </Notice.Warning>
            )}

            <Heading tag="h3">Games</Heading>

                <TextInput
                    value={query}
                    onChange={value => {
                        setQuery(value);
                        setSelected(null);
                    }}
                    disabled={apps == null && catalogueError == null}
                    placeholder={apps == null ? "Loading game list..." : "Search a game to farm"}
                />

            {selected == null && results.length > 0 && (
                <div className={cl("results")}>
                    {results.map(app => (
                        <button
                            key={app.id}
                            className={cl("result")}
                            onClick={() => {
                                setSelected(app);
                                setQuery(app.name);
                            }}
                        >
                            <span className={cl("result-name")}>{app.name}</span>
                            <span className={cl("result-meta")}>{Farmer.executableFor(app)} · {app.id}</span>
                        </button>
                    ))}
                </div>
            )}

            <div className={cl("grid")}>
                <div className={cl("field")}>
                    <Heading tag="h5">Game Time hours</Heading>
                    <TextInput value={timeTarget} onChange={setTimeTarget} />
                    <span className={cl("muted")}>Target hours, 1–5000.</span>
                </div>
                <div className={cl("field")}>
                    <Heading tag="h5">Variety minutes/game</Heading>
                    <TextInput value={varietyMinutes} onChange={setVarietyMinutes} />
                    <span className={cl("muted")}>Minutes per unique game, 1–1440.</span>
                </div>
                <div className={cl("field")}>
                    <Heading tag="h5">Streaming hours</Heading>
                    <TextInput value={streamTarget} onChange={setStreamTarget} />
                    <span className={cl("muted")}>Target stream hours, 1–5000.</span>
                </div>
            </div>

            <Flex className={cl("actions")}>
                <Button
                    variant="secondary"
                    disabled={busy || selected == null || parsedTimeTarget == null}
                    onClick={() => act(() => Farmer.startGameTime(selected!, parsedTimeTarget!))}
                >
                    Farm Game Time
                </Button>
                <Button
                    variant="secondary"
                    disabled={busy || apps == null || parsedVarietyMinutes == null}
                    onClick={() => act(() => Farmer.startVariety(pickVarietyPool(apps!, 100), parsedVarietyMinutes!))}
                >
                    Farm Variety
                </Button>
                <Button
                    variant="secondary"
                    disabled={busy || parsedStreamTarget == null}
                    onClick={() => act(() => Farmer.startStream(parsedStreamTarget!))}
                >
                    Farm Streaming
                </Button>
            </Flex>

            <Flex className={cl("actions")}>
                <Button
                    disabled={busy || apps == null}
                    onClick={() => act(() => Farmer.maxAll(apps!))}
                >
                    Max All Badges
                </Button>
                <Button
                    variant="dangerSecondary"
                    disabled={!busy}
                    onClick={() => act(Farmer.stop)}
                >
                    Stop
                </Button>
            </Flex>

            <Paragraph className={cl("muted")}>
                Sessions go to Discord's science endpoint in chunks, backdated up to 24 hours. Badges move on
                Discord's daily analytics pass, so check the next day. Keep the client open while a run is going.
            </Paragraph>
        </div>
    );
}
