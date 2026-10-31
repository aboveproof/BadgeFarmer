/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@components/Button";
import { Heading } from "@components/Heading";
import { Paragraph } from "@components/Paragraph";
import { Logger } from "@utils/Logger";
import { useForceUpdater } from "@utils/react";
import { TextInput, useEffect, useMemo, useState } from "@webpack/common";
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

function tierProgress(value: number, thresholds: ReadonlyArray<{ name: string; at: number; }>): { name: string; next: string | null; nextAt: number | null; pct: number; } {
    let current = "Unranked";
    let next: string | null = thresholds[0].name;
    let nextAt: number | null = thresholds[0].at;
    let floor = 0;
    let ceil = thresholds[0].at;

    for (let index = 0; index < thresholds.length; index++) {
        if (value >= thresholds[index].at) {
            current = thresholds[index].name;
            floor = thresholds[index].at;
            ceil = thresholds[index + 1]?.at ?? thresholds[index].at;
            next = thresholds[index + 1]?.name ?? null;
            nextAt = thresholds[index + 1]?.at ?? null;
        }
    }

    const pct = ceil === floor ? 100 : Math.min(100, Math.round(((value - floor) / (ceil - floor)) * 100));
    return { name: current, next, nextAt, pct };
}

function ProgressBar({ pct }: { pct: number; }) {
    return (
        <div className={cl("progress-track")}>
            <div className={cl("progress-fill")} style={{ width: `${pct}%` }} />
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

function formatHours(hours: number): string {
    return hours >= 10 ? `${Math.round(hours)}h` : `${(Math.round(hours * 10) / 10)}h`;
}

function StatBlock({ label, value, sub }: { label: string; value: string; sub: string | null; }) {
    return (
        <div className={cl("stat")}>
            <span className={cl("stat-label")}>{label}</span>
            <span className={cl("stat-value")}>{value}</span>
            {sub != null && <span className={cl("stat-sub")}>{sub}</span>}
        </div>
    );
}

function ModeCard({
    title,
    steps,
    target,
    targetPlaceholder,
    onTargetChange,
    targetError,
    buttonLabel,
    buttonDisabled,
    onRun,
    progress
}: {
    title: string;
    steps: string[];
    target: string | null;
    targetPlaceholder: string;
    onTargetChange: (value: string) => void;
    targetError: string | null;
    buttonLabel: string;
    buttonDisabled: boolean;
    onRun: () => void;
    progress: { name: string; next: string | null; nextAt: number | null; pct: number; unit: string; credited: string; } | null;
}) {
    return (
        <div className={cl("mode")}>
            <div className={cl("mode-head")}>
                <Heading tag="h4">{title}</Heading>
                {progress != null && (
                    <span className={cl("mode-tier")}>{progress.name}</span>
                )}
            </div>

            {progress != null && (
                <div className={cl("mode-progress")}>
                    <ProgressBar pct={progress.pct} />
                    <span className={cl("mode-progress-copy")}>
                        {progress.credited} this run
                        {progress.next != null && progress.nextAt != null && (
                            <> · next: {progress.next} at {progress.nextAt}{progress.unit}</>
                        )}
                    </span>
                </div>
            )}

            <ol className={cl("mode-steps")}>
                {steps.map(step => <li key={step}>{step}</li>)}
            </ol>

            <div className={cl("mode-run")}>
                {target != null && (
                    <div className={cl("mode-field")}>
                        <TextInput value={target} onChange={onTargetChange} placeholder={targetPlaceholder} />
                        {targetError != null && <span className={cl("mode-error")}>{targetError}</span>}
                    </div>
                )}
                <Button
                    variant="secondary"
                    disabled={buttonDisabled}
                    onClick={onRun}
                >
                    {buttonLabel}
                </Button>
            </div>
        </div>
    );
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

    const busy = status.mode !== "IDLE";
    const catalogueReady = apps != null || catalogueError != null;

    const timeProgress = tierProgress(status.hoursCreditedThisRun, TIME_TIERS.map(t => ({ name: t.name, at: t.hours })));
    const varietyProgress = tierProgress(status.gamesCreditedThisRun, VARIETY_TIERS.map(t => ({ name: t.name, at: t.games })));
    const streamProgress = tierProgress(status.streamHoursCreditedThisRun, TIME_TIERS.map(t => ({ name: t.name, at: t.hours })));

    const timeError = parsedTimeTarget == null ? "Enter hours between 1 and 5000." : null;
    const streamError = parsedStreamTarget == null ? "Enter hours between 1 and 5000." : null;
    const varietyError = parsedVarietyMinutes == null ? "Enter minutes between 1 and 1440." : null;

    function act(action: () => void | Promise<void>) {
        void action();
    }

    function clearSelectedGame() {
        setSelected(null);
        setQuery("");
    }

    const statusLine = busy
        ? status.mode === "STREAM"
            ? `Streaming live · ${formatHours(status.streamHoursCreditedThisRun)} credited`
            : status.mode === "VARIETY"
                ? `Rotating games · ${status.gamesCreditedThisRun}/${status.varietyTotal} done`
                : status.mode === "GAME_TIME"
                    ? `Crediting ${status.activeGame?.name ?? ""} · ${formatHours(status.hoursCreditedThisRun)} done`
                    : `Max All · ${status.gamesCreditedThisRun}/${status.varietyTotal} games, ${formatHours(status.hoursCreditedThisRun)}h, ${formatHours(status.streamHoursCreditedThisRun)} stream`
        : null;

    return (
        <div className={cl("dashboard")}>
            {catalogueError != null && (
                <div className={cl("notice-danger")}>{catalogueError}</div>
            )}

            {busy ? (
                <div className={cl("run-panel")}>
                    <div className={cl("run-status")}>
                        <span className={cl("run-dot")} />
                        <span>{statusLine}</span>
                    </div>
                    {status.streamBatches === 60 && (
                        <span className={cl("run-live")}>minute {status.streamBatch}/60 of the current hour</span>
                    )}
                    {status.lastError != null && (
                        <span className={cl("run-error")}>{status.lastError}</span>
                    )}
                    <div className={cl("run-hint")}>
                        Leave the client open. Badges land on Discord's nightly pass, so check your profile tomorrow.
                    </div>
                    <div>
                        <Button
                            variant="dangerSecondary"
                            onClick={() => act(Farmer.stop)}
                        >
                            Stop
                        </Button>
                    </div>
                </div>
            ) : (
                <>
                    <div className={cl("intro")}>
                        <Heading tag="h3">How this works</Heading>
                        <Paragraph>
                            Pick a mode below, start it, and leave the client open. Sessions report to Discord's
                            analytics in the same format the real client uses, and your badges move on the next
                            nightly pass. Game Time and Variety finish in minutes because their hours go out in
                            backdated chunks. Streaming is different: Discord counts one heartbeat per real minute,
                            so a stream run takes as long as the hours you want.
                        </Paragraph>
                        <Paragraph className={cl("muted")}>
                            Two things must be on for any of this to count: the "use data to personalize" toggle in
                            Settings → Privacy &amp; Safety, and the client staying open while a run is live. NoTrack
                            is fine, farming bypasses it.
                        </Paragraph>
                    </div>

                    <ModeCard
                        title="Game Time badge"
                        steps={[
                            "Search for the game you want credited. Any game Discord can detect works.",
                            "Set how many hours you want, up to 5000 for the Eternal tier.",
                            "Start the run. Hours post in 2-hour chunks and finish in about ten minutes."
                        ]}
                        target={timeTarget}
                        targetPlaceholder="Hours (1-5000)"
                        onTargetChange={setTimeTarget}
                        targetError={timeError}
                        buttonLabel={selected == null ? "Pick a game first" : `Credit ${selected.name}`}
                        buttonDisabled={selected == null || parsedTimeTarget == null || !catalogueReady}
                        onRun={() => {
                            act(() => Farmer.startGameTime(selected!, parsedTimeTarget!));
                            clearSelectedGame();
                        }}
                        progress={status.hoursCreditedThisRun > 0
                            ? { ...timeProgress, unit: "h", credited: formatHours(status.hoursCreditedThisRun) }
                            : null}
                    />

                    <div className={cl("game-search")}>
                        <TextInput
                            value={query}
                            onChange={value => {
                                setQuery(value);
                                setSelected(null);
                            }}
                            disabled={!catalogueReady && catalogueError == null}
                            placeholder={apps == null ? "Loading game list..." : "Search 25,000+ games for the Game Time badge"}
                        />
                        {selected != null && (
                            <div className={cl("game-picked")}>
                                <span>{selected.name}</span>
                                <button
                                    className={cl("game-clear")}
                                    onClick={clearSelectedGame}
                                    aria-label="Clear selected game"
                                >
                                    Clear
                                </button>
                            </div>
                        )}
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
                    </div>

                    <ModeCard
                        title="Game Variety badge"
                        steps={[
                            "100 random games from Discord's catalog get credited, 2 minutes each.",
                            "Raise the minutes per game if you want sessions to look longer.",
                            "Start the run. The full rotation finishes in about five minutes."
                        ]}
                        target={varietyMinutes}
                        targetPlaceholder="Minutes per game"
                        onTargetChange={setVarietyMinutes}
                        targetError={varietyError}
                        buttonLabel="Run variety rotation"
                        buttonDisabled={parsedVarietyMinutes == null || apps == null}
                        onRun={() => act(() => Farmer.startVariety(pickVarietyPool(apps!, 100), parsedVarietyMinutes!))}
                        progress={status.gamesCreditedThisRun > 0
                            ? { ...varietyProgress, unit: " games", credited: `${status.gamesCreditedThisRun} games` }
                            : null}
                    />

                    <ModeCard
                        title="Streaming badge"
                        steps={[
                            "Join a voice channel and go live with any screenshare. A blank 10fps capture is enough.",
                            "Have someone watching. An alt account in the channel counts. Hours only register when a viewer is present.",
                            "Start the run. One heartbeat posts per real minute, so 1 hour of badge credit takes 1 hour of runtime."
                        ]}
                        target={streamTarget}
                        targetPlaceholder="Hours (1-5000)"
                        onTargetChange={setStreamTarget}
                        targetError={streamError}
                        buttonLabel="Start streaming telemetry"
                        buttonDisabled={parsedStreamTarget == null}
                        onRun={() => act(() => Farmer.startStream(parsedStreamTarget!))}
                        progress={status.streamHoursCreditedThisRun > 0
                            ? { ...streamProgress, unit: "h", credited: formatHours(status.streamHoursCreditedThisRun) }
                            : null}
                    />

                    <div className={cl("maxall")}>
                        <div className={cl("maxall-copy")}>
                            <Heading tag="h4">Run everything</Heading>
                            <span className={cl("muted")}>
                                Variety, then Game Time on a random pick, then streaming. The first two finish in
                                about fifteen minutes, then the stream runs for as long as your target.
                            </span>
                        </div>
                        <Button
                            disabled={apps == null}
                            onClick={() => act(() => Farmer.maxAll(apps!))}
                        >
                            Max All Badges
                        </Button>
                    </div>
                </>
            )}

            <div className={cl("footer")}>
                <span className={cl("muted")}>
                    Streaming telemetry ported from lawerth/discord-streamer. Game time approach from
                    Accentaro/gameSessionSpoofer. Hours always count; variety only fully registers for games
                    Discord's telemetry has seen before.
                </span>
            </div>
        </div>
    );
}
