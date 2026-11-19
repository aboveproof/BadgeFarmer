/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@components/Button";
import { classNameFactory } from "@utils/css";
import { useForceUpdater } from "@utils/react";
import { useEffect, useMemo, useRef, useState } from "@webpack/common";
import type { JSX, KeyboardEvent, ReactNode } from "react";

import type { DetectableApp, FarmerStatus } from "./farmer";
import * as Farmer from "./farmer";

const cl = classNameFactory("vc-badge-farmer-");

const DETECTABLE_APPS_URL = "https://discord.com/api/v10/applications/detectable";
const MAX_RESULTS = 40;
// Rough cost of one request plus the pause between requests.
const SECONDS_PER_REQUEST = 1;

interface Tier {
    name: string;
    at: number;
}

const TIME_TIERS: Tier[] = [
    { name: "Casual", at: 1 },
    { name: "Recreational", at: 8 },
    { name: "Dedicated", at: 20 },
    { name: "Committed", at: 78 },
    { name: "Veteran", at: 250 },
    { name: "Elite", at: 1_000 },
    { name: "Legendary", at: 2_500 },
    { name: "Eternal", at: 5_000 }
];

const VARIETY_TIERS: Tier[] = [
    { name: "Dabbler", at: 3 },
    { name: "Adventurer", at: 10 },
    { name: "Explorer", at: 25 },
    { name: "Connoisseur", at: 50 },
    { name: "Universalist", at: 100 }
];

type Tab = "time" | "variety" | "stream" | "all";

const TABS: Array<{ id: Tab; label: string; }> = [
    { id: "time", label: "Game Time" },
    { id: "variety", label: "Variety" },
    { id: "stream", label: "Streaming" },
    { id: "all", label: "All three" }
];

let cataloguePromise: Promise<DetectableApp[]> | null = null;

export function loadCatalogue(): Promise<DetectableApp[]> {
    cataloguePromise ??= fetch(DETECTABLE_APPS_URL)
        .then(response => {
            if (!response.ok) throw new Error(`Discord answered with HTTP ${response.status}`);
            return response.json() as Promise<unknown>;
        })
        .then(data => {
            if (!Array.isArray(data)) throw new Error("Discord sent a game list in an unknown format");
            return data.filter((app): app is DetectableApp =>
                app != null && typeof app.id === "string" && typeof app.name === "string" && app.name.trim() !== "");
        })
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
            cause => { if (!cancelled) setError(`Couldn't load Discord's game list. ${cause?.message ?? ""}`.trim()); }
        );
        return () => { cancelled = true; };
    }, []);

    return { apps, error };
}

function useFarmerStatus(): FarmerStatus {
    const forceUpdate = useForceUpdater();
    useEffect(() => Farmer.subscribe(forceUpdate), []);
    return Farmer.getStatus();
}

function parseNumber(value: string, min: number, max: number, integer: boolean): number | null {
    const parsed = Number(value.replace(/[,_\s]/g, ""));
    if (!Number.isFinite(parsed) || parsed < min || parsed > max) return null;
    if (integer && !Number.isInteger(parsed)) return null;
    return parsed;
}

function formatCount(value: number): string {
    return value >= 10 ? Math.floor(value).toLocaleString() : (Math.floor(value * 10) / 10).toString();
}

function formatDuration(seconds: number): string {
    if (seconds < 60) return "under a minute";
    if (seconds < 3_600) return `${Math.ceil(seconds / 60)} min`;
    if (seconds < 172_800) return `${Math.round(seconds / 3_600)} hr`;
    return `${Math.round(seconds / 86_400).toLocaleString()} days`;
}

function reachedTier(value: number, tiers: Tier[]): number {
    let reached = -1;
    tiers.forEach((tier, index) => { if (value >= tier.at) reached = index; });
    return reached;
}

function TierMeter({ value, tiers, unit }: { value: number | null; tiers: Tier[]; unit: string; }) {
    const reached = value == null ? -1 : reachedTier(value, tiers);
    const label = value == null
        ? "Enter a valid number"
        : reached >= 0 ? tiers[reached].name : `Below ${tiers[0].name}`;

    return (
        <div className={cl("tiers")}>
            <div className={cl("tiers-track")}>
                {tiers.map((tier, index) => (
                    <span
                        key={tier.name}
                        className={cl("tier", { "tier-on": index <= reached })}
                        title={`${tier.name}: ${tier.at.toLocaleString()} ${unit}`}
                    />
                ))}
            </div>
            <span className={cl("tiers-label")}>{label}</span>
        </div>
    );
}

function Field({ label, hint, value, onChange, error, suffix }: {
    label: string;
    hint?: string;
    value: string;
    onChange: (value: string) => void;
    error: string | null;
    suffix?: string;
}) {
    return (
        <label className={cl("field")}>
            <span className={cl("field-label")}>{label}</span>
            <span className={cl("input-wrap", { "input-invalid": error != null })}>
                <input
                    className={cl("input")}
                    value={value}
                    inputMode="decimal"
                    spellCheck={false}
                    onChange={event => onChange(event.currentTarget.value)}
                    aria-invalid={error != null}
                />
                {suffix != null && <span className={cl("input-suffix")}>{suffix}</span>}
            </span>
            <span className={cl("field-note", { "field-error": error != null })}>{error ?? hint ?? "\u00a0"}</span>
        </label>
    );
}

function GamePicker({ apps, error, selected, onSelect, disabled }: {
    apps: DetectableApp[] | null;
    error: string | null;
    selected: DetectableApp | null;
    onSelect: (app: DetectableApp | null) => void;
    disabled: boolean;
}) {
    const [query, setQuery] = useState("");
    const [highlight, setHighlight] = useState(0);
    const listRef = useRef<HTMLDivElement>(null);

    const results = useMemo(() => {
        const needle = query.trim().toLowerCase();
        if (apps == null || needle.length < 2) return [];

        return apps
            .filter(app => app.name.toLowerCase().includes(needle))
            .sort((left, right) =>
                Number(right.name.toLowerCase().startsWith(needle)) - Number(left.name.toLowerCase().startsWith(needle))
                || left.name.length - right.name.length
                || left.name.localeCompare(right.name))
            .slice(0, MAX_RESULTS);
    }, [apps, query]);

    const activeIndex = highlight < results.length ? highlight : 0;

    useEffect(() => {
        const row = listRef.current?.children[activeIndex] as HTMLElement | undefined;
        row?.scrollIntoView({ block: "nearest" });
    }, [activeIndex]);

    function choose(app: DetectableApp) {
        onSelect(app);
        setQuery("");
        setHighlight(0);
    }

    function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
        if (results.length === 0) return;
        if (event.key === "ArrowDown") {
            event.preventDefault();
            setHighlight(Math.min(activeIndex + 1, results.length - 1));
        } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setHighlight(Math.max(activeIndex - 1, 0));
        } else if (event.key === "Enter") {
            event.preventDefault();
            const picked = results[activeIndex];
            if (picked != null) choose(picked);
        } else if (event.key === "Escape") {
            setQuery("");
        }
    }

    if (selected != null) {
        return (
            <div className={cl("picked")}>
                <div className={cl("picked-text")}>
                    <span className={cl("picked-name")}>{selected.name}</span>
                    <span className={cl("picked-meta")}>{Farmer.executableFor(selected)}</span>
                </div>
                <button type="button" className={cl("ghost")} onClick={() => onSelect(null)} disabled={disabled}>
                    Change
                </button>
            </div>
        );
    }

    const placeholder = error != null
        ? "Game list unavailable"
        : apps == null ? "Loading Discord's game list" : `Search ${apps.length.toLocaleString()} games`;

    return (
        <div className={cl("search")}>
            <span className={cl("input-wrap")}>
                <input
                    className={cl("input")}
                    value={query}
                    placeholder={placeholder}
                    disabled={disabled || apps == null}
                    spellCheck={false}
                    role="combobox"
                    aria-expanded={results.length > 0}
                    aria-controls="vc-badge-farmer-results"
                    aria-label="Search for a game"
                    onChange={event => {
                        setQuery(event.currentTarget.value);
                        setHighlight(0);
                    }}
                    onKeyDown={onKeyDown}
                />
            </span>
            {results.length > 0 && (
                <div className={cl("results")} id="vc-badge-farmer-results" role="listbox" ref={listRef}>
                    {results.map((app, index) => (
                        <button
                            key={app.id}
                            type="button"
                            role="option"
                            aria-selected={index === activeIndex}
                            className={cl("result", { "result-active": index === activeIndex })}
                            onMouseEnter={() => setHighlight(index)}
                            onClick={() => choose(app)}
                        >
                            <span className={cl("result-name")}>{app.name}</span>
                            <span className={cl("result-meta")}>{Farmer.executableFor(app)}</span>
                        </button>
                    ))}
                </div>
            )}
            {query.trim().length >= 2 && results.length === 0 && apps != null && (
                <span className={cl("field-note")}>No game in Discord's list matches that name.</span>
            )}
        </div>
    );
}

interface LiveView {
    title: string;
    detail: string | null;
    current: number;
    target: number;
    unit: string;
}

function liveView(status: FarmerStatus): LiveView {
    const game = status.activeGame?.name ?? null;
    const viewers = status.streamViewers == null
        ? "Starting Go Live"
        : status.streamViewers === 1 ? "1 person watching" : `${status.streamViewers} people watching`;

    const time: LiveView = { title: "Game Time", detail: game, current: status.hoursCredited, target: status.hoursTarget, unit: "hours" };
    const variety: LiveView = { title: "Variety", detail: game, current: status.gamesCredited, target: status.gamesTarget, unit: "games" };
    const stream: LiveView = { title: "Streaming", detail: viewers, current: status.streamHours, target: status.streamTarget, unit: "hours" };

    switch (status.mode) {
        case "GAME_TIME": return time;
        case "VARIETY": return variety;
        case "STREAM": return stream;
        default: {
            const [step, view] = status.streamTarget > 0 ? [3, stream] : status.hoursTarget > 0 ? [2, time] : [1, variety];
            return { ...view, title: `Step ${step} of 3 · ${view.title}` };
        }
    }
}

function LiveCard({ status }: { status: FarmerStatus; }) {
    const view = liveView(status);
    const pct = view.target > 0 ? Math.min(100, (view.current / view.target) * 100) : 0;

    return (
        <section className={cl("live")} aria-live="polite">
            <div className={cl("live-head")}>
                <div className={cl("live-title")}>
                    <span className={cl("pulse")} />
                    <span>{view.title}</span>
                </div>
                <Button variant="dangerSecondary" size="small" onClick={Farmer.stop}>Stop</Button>
            </div>

            <div className={cl("live-figure")}>
                <span className={cl("live-number")}>{formatCount(view.current)}</span>
                <span className={cl("live-target")}>of {view.target.toLocaleString()} {view.unit}</span>
            </div>

            <div className={cl("bar")}>
                <div className={cl("bar-fill")} style={{ width: `${pct}%` }} />
            </div>

            <div className={cl("live-foot")}>
                <span className={cl("live-detail")}>{view.detail ?? "Getting ready"}</span>
                {status.errors > 0 && (
                    <span className={cl("live-detail")}>{status.errors} failed {status.errors === 1 ? "request" : "requests"}</span>
                )}
            </div>

            {status.lastError != null && <div className={cl("callout", "callout-warn")}>{status.lastError}</div>}
        </section>
    );
}

function DoneCard({ message, error }: { message: string | null; error: string | null; }) {
    if (message == null && error == null) return null;
    const failed = message == null;

    return (
        <section className={cl("done", { "done-failed": failed })}>
            <span className={cl("done-mark")} aria-hidden="true">{failed ? "!" : "\u2713"}</span>
            <span className={cl("done-text")}>{message ?? error}</span>
            <button type="button" className={cl("ghost")} onClick={Farmer.dismissFinished}>Dismiss</button>
        </section>
    );
}

function Tabs({ value, onChange }: { value: Tab; onChange: (tab: Tab) => void; }) {
    const index = TABS.findIndex(tab => tab.id === value);

    function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
        const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
        if (step === 0) return;
        event.preventDefault();
        onChange(TABS[(index + step + TABS.length) % TABS.length].id);
    }

    return (
        <div className={cl("tabs")} role="tablist" onKeyDown={onKeyDown}>
            <span
                className={cl("tabs-thumb")}
                style={{ width: `calc((100% - 8px) / ${TABS.length})`, transform: `translateX(${index * 100}%)` }}
            />
            {TABS.map(tab => (
                <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={tab.id === value}
                    tabIndex={tab.id === value ? 0 : -1}
                    className={cl("tab", { "tab-on": tab.id === value })}
                    onClick={() => onChange(tab.id)}
                >
                    {tab.label}
                </button>
            ))}
        </div>
    );
}

function Panel({ intro, children, action }: { intro: string; children?: ReactNode; action: ReactNode; }) {
    return (
        <div className={cl("panel")} role="tabpanel">
            <p className={cl("intro")}>{intro}</p>
            {children}
            <div className={cl("action")}>{action}</div>
        </div>
    );
}

function StartButton({ label, eta, disabled, onClick }: { label: string; eta: string | null; disabled: boolean; onClick: () => void; }) {
    return (
        <>
            <Button className={cl("start")} disabled={disabled} onClick={onClick}>{label}</Button>
            {eta != null && <span className={cl("eta")}>{eta}</span>}
        </>
    );
}

export function BadgeFarmerDashboard(): JSX.Element {
    const { apps, error: catalogueError } = useCatalogue();
    const status = useFarmerStatus();

    const [tab, setTab] = useState<Tab>("time");
    const [selected, setSelected] = useState<DetectableApp | null>(null);
    const [timeTarget, setTimeTarget] = useState(String(Farmer.ETERNAL_HOURS));
    const [chunkHours, setChunkHours] = useState(String(Farmer.DEFAULT_CHUNK_HOURS));
    const [varietyCount, setVarietyCount] = useState(String(Farmer.UNIVERSALIST_GAMES));
    const [varietyMinutes, setVarietyMinutes] = useState(String(Farmer.DEFAULT_VARIETY_MINUTES));
    const [streamTarget, setStreamTarget] = useState("1");

    const busy = status.mode !== "IDLE";

    const hours = parseNumber(timeTarget, 1, Farmer.MAX_TARGET_HOURS, false);
    const chunk = parseNumber(chunkHours, 1, Farmer.MAX_CHUNK_HOURS, true);
    const games = parseNumber(varietyCount, 1, apps?.length ?? 1_000, true);
    const minutes = parseNumber(varietyMinutes, 1, 1_440, false);
    const streamHours = parseNumber(streamTarget, 0.1, Farmer.MAX_TARGET_HOURS, false);

    const allEta = Farmer.UNIVERSALIST_GAMES * SECONDS_PER_REQUEST
        + Math.ceil(Farmer.ETERNAL_HOURS / Farmer.DEFAULT_CHUNK_HOURS) * SECONDS_PER_REQUEST;

    return (
        <div className={cl("root")}>
            <header className={cl("header")}>
                <div>
                    <h2 className={cl("title")}>Badge Farmer</h2>
                    <p className={cl("subtitle")}>Pick a badge and leave Discord open while it runs.</p>
                </div>
                <span className={cl("status", { "status-on": busy })}>{busy ? "Running" : "Idle"}</span>
            </header>

            {busy && <LiveCard status={status} />}
            {!busy && <DoneCard message={status.finishedMessage} error={status.finishedMessage == null ? status.lastError : null} />}
            {catalogueError != null && <div className={cl("callout", "callout-danger")}>{catalogueError}</div>}

            <Tabs value={tab} onChange={setTab} />

            {tab === "time" && (
                <Panel
                    key="time"
                    intro="Sends finished play sessions for one game. Eternal, the top tier, starts at 5,000 hours."
                    action={
                        <StartButton
                            label={selected == null ? "Pick a game first" : `Start ${selected.name}`}
                            eta={hours != null && chunk != null ? `About ${formatDuration(Math.ceil(hours / chunk) * SECONDS_PER_REQUEST)}` : null}
                            disabled={busy || selected == null || hours == null || chunk == null}
                            onClick={() => void Farmer.startGameTime(selected!, hours!, chunk!)}
                        />
                    }
                >
                    <GamePicker apps={apps} error={catalogueError} selected={selected} onSelect={setSelected} disabled={busy} />
                    <div className={cl("row")}>
                        <Field label="Target" suffix="hours" value={timeTarget} onChange={setTimeTarget}
                            error={hours == null ? `Use 1 to ${Farmer.MAX_TARGET_HOURS.toLocaleString()}` : null} />
                        <Field label="Per request" suffix="hours" value={chunkHours} onChange={setChunkHours}
                            hint="Bigger chunks finish sooner"
                            error={chunk == null ? `Whole number, 1 to ${Farmer.MAX_CHUNK_HOURS}` : null} />
                    </div>
                    <TierMeter value={hours} tiers={TIME_TIERS} unit="hours" />
                </Panel>
            )}

            {tab === "variety" && (
                <Panel
                    key="variety"
                    intro="Sends one short session each for random games from Discord's catalog. Universalist needs 100."
                    action={
                        <StartButton
                            label="Start Variety"
                            eta={games != null ? `About ${formatDuration(games * SECONDS_PER_REQUEST)}` : null}
                            disabled={busy || apps == null || games == null || minutes == null}
                            onClick={() => void Farmer.startVariety(Farmer.shuffled(apps!, games!), minutes!)}
                        />
                    }
                >
                    <div className={cl("row")}>
                        <Field label="Games" value={varietyCount} onChange={setVarietyCount}
                            error={games == null ? `Whole number, 1 to ${(apps?.length ?? 1_000).toLocaleString()}` : null} />
                        <Field label="Each session" suffix="min" value={varietyMinutes} onChange={setVarietyMinutes}
                            hint="Two minutes works"
                            error={minutes == null ? "Use 1 to 1,440" : null} />
                    </div>
                    <TierMeter value={games} tiers={VARIETY_TIERS} unit="games" />
                </Panel>
            )}

            {tab === "stream" && (
                <Panel
                    key="stream"
                    intro="Goes live in your current voice channel with Discord's own Go Live and keeps the stream up. Hours count in real time, one per hour live."
                    action={
                        <StartButton
                            label="Go live"
                            eta={streamHours != null ? `Takes ${formatDuration(streamHours * 3_600)}` : null}
                            disabled={busy || streamHours == null}
                            onClick={() => void Farmer.startStreamFarm(streamHours!)}
                        />
                    }
                >
                    <div className={cl("callout", "callout-warn")}>
                        Go Live shares your main screen with the voice channel. Close private windows before you start.
                    </div>
                    <Field label="Target" suffix="hours" value={streamTarget} onChange={setStreamTarget}
                        hint="Someone has to watch. An alt account in the channel works."
                        error={streamHours == null ? `Use 0.1 to ${Farmer.MAX_TARGET_HOURS.toLocaleString()}` : null} />
                    <TierMeter value={streamHours} tiers={TIME_TIERS} unit="hours" />
                </Panel>
            )}

            {tab === "all" && (
                <Panel
                    key="all"
                    intro="Runs the badges back to back with the top-tier targets. You can close this page once it starts."
                    action={
                        <StartButton
                            label="Start all three"
                            eta={`First two take about ${formatDuration(allEta)}`}
                            disabled={busy || apps == null}
                            onClick={() => void Farmer.maxAll(apps!)}
                        />
                    }
                >
                    <ol className={cl("flow")}>
                        <li className={cl("flow-step")}>
                            <span className={cl("flow-name")}>Variety</span>
                            <span className={cl("flow-note")}>100 random games, two minutes each</span>
                        </li>
                        <li className={cl("flow-step")}>
                            <span className={cl("flow-name")}>Game Time</span>
                            <span className={cl("flow-note")}>5,000 hours on the first of those games</span>
                        </li>
                        <li className={cl("flow-step")}>
                            <span className={cl("flow-name")}>Streaming</span>
                            <span className={cl("flow-note")}>Goes live if you're in a voice channel by then, otherwise it stops after step two</span>
                        </li>
                    </ol>
                </Panel>
            )}

            <p className={cl("footnote")}>
                Discord drops these sessions while "Use data to personalize my Discord experience" is off. You'll find it under Data &amp; Privacy. Badges show up after Discord's overnight update.
            </p>
        </div>
    );
}
