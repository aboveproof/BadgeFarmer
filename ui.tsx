/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@components/Button";
import ErrorBoundary from "@components/ErrorBoundary";
import { copyToClipboard } from "@utils/clipboard";
import { classNameFactory } from "@utils/css";
import { useForceUpdater } from "@utils/react";
import type { RenderModalProps } from "@vencord/discord-types";
import {
    closeModal,
    Modal,
    openModal,
    ReactDOM,
    SelectedChannelStore,
    showToast,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    VoiceStateStore
} from "@webpack/common";
import type { JSX, KeyboardEvent, ReactNode } from "react";

import {
    type BadgeTier,
    reachedTierIndex,
    STREAM_TIERS,
    TIME_TIERS,
    VARIETY_TIERS
} from "./badges";
import type {
    AccountProgress,
    DesktopSource,
    DetectableApp,
    FarmerStatus,
    TrackProgress,
    VoiceReadiness
} from "./farmer";
import * as Farmer from "./farmer";
import { isPersonalizationEnabled } from "./science";

const cl = classNameFactory("vc-badge-farmer-");

const MODAL_KEY = "vc-badge-farmer-modal";
const MAX_RESULTS = 40;
const SECONDS_PER_BATCH = 0.7;

type Tab = "time" | "variety" | "stream" | "all";
type TimeStrategy = "spread" | "single";
type GoalMode = "delta" | "add";

const TABS: Array<{ id: Tab; label: string; }> = [
    { id: "time", label: "Game Time" },
    { id: "variety", label: "Variety" },
    { id: "stream", label: "Streaming" },
    { id: "all", label: "All three" }
];

interface IndexedApp {
    app: DetectableApp;
    lower: string;
    aliases: string[];
    exe: string;
}

function useCatalogue(): { apps: DetectableApp[] | null; error: string | null; retry: () => void; } {
    const [apps, setApps] = useState<DetectableApp[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [attempt, setAttempt] = useState(0);

    useEffect(() => {
        let cancelled = false;
        setError(null);
        Farmer.loadCatalogue().then(
            loaded => { if (!cancelled) setApps(loaded); },
            cause => {
                if (!cancelled) {
                    const detail = cause instanceof Error ? cause.message : String(cause ?? "");
                    setError(`Could not load Discord's game list. ${detail}`.trim());
                }
            }
        );
        return () => { cancelled = true; };
    }, [attempt]);

    function retry() {
        Farmer.clearCatalogueCache();
        setApps(null);
        setAttempt(count => count + 1);
    }

    return { apps, error, retry };
}

function useFarmerState(): { status: FarmerStatus; progress: AccountProgress; } {
    const forceUpdate = useForceUpdater();
    useEffect(() => {
        const unsub = Farmer.subscribe(forceUpdate);
        void Farmer.syncAccountProgress(false);
        return unsub;
    }, [forceUpdate]);
    return {
        status: Farmer.getStatus(),
        progress: Farmer.getAccountProgress()
    };
}

function useVoiceReadiness(active: boolean): VoiceReadiness {
    const [voice, setVoice] = useState<VoiceReadiness>(() => Farmer.getVoiceState());

    useEffect(() => {
        if (!active) return;
        const refresh = () => setVoice(Farmer.getVoiceState());
        refresh();
        SelectedChannelStore?.addChangeListener?.(refresh);
        VoiceStateStore?.addChangeListener?.(refresh);
        return () => {
            SelectedChannelStore?.removeChangeListener?.(refresh);
            VoiceStateStore?.removeChangeListener?.(refresh);
        };
    }, [active]);

    return voice;
}

function useStreamSources(active: boolean): {
    sources: DesktopSource[];
    loading: boolean;
    refresh: () => void;
} {
    const [sources, setSources] = useState<DesktopSource[]>([]);
    const [loading, setLoading] = useState(false);
    const [tick, setTick] = useState(0);

    useEffect(() => {
        if (!active) return;
        let cancelled = false;
        setLoading(true);
        Farmer.listStreamSources()
            .then(list => { if (!cancelled) setSources(list); })
            .catch(() => { if (!cancelled) setSources([]); })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [active, tick]);

    return {
        sources,
        loading,
        refresh: () => setTick(value => value + 1)
    };
}

function parseNumber(value: string, min: number, max: number, integer: boolean): number | null {
    const trimmed = value.trim();
    if (trimmed === "") return null;
    const parsed = Number(trimmed.replace(/[,_\s]/g, ""));
    if (!Number.isFinite(parsed) || parsed < min || parsed > max) return null;
    if (integer && !Number.isInteger(parsed)) return null;
    return parsed;
}

function parseOptionalBaseline(value: string, max: number, integer: boolean): { ok: boolean; num: number | null; } {
    const trimmed = value.trim();
    if (trimmed === "") return { ok: true, num: null };
    const parsed = Number(trimmed.replace(/[,_\s]/g, ""));
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > max) return { ok: false, num: null };
    if (integer && !Number.isInteger(parsed)) return { ok: false, num: null };
    return { ok: true, num: parsed };
}

function formatCount(value: number): string {
    return value >= 10 ? Math.floor(value).toLocaleString() : (Math.round(value * 10) / 10).toString();
}

function formatDuration(seconds: number): string {
    if (seconds < 60) return `about ${Math.max(1, Math.ceil(seconds))} sec`;
    if (seconds < 3_600) return `about ${Math.ceil(seconds / 60)} min`;
    if (seconds < 172_800) {
        const hrs = Math.floor(seconds / 3_600);
        const mins = Math.round((seconds % 3_600) / 60);
        return mins > 0 && hrs < 12 ? `about ${hrs}h ${mins}m` : `about ${Math.round(seconds / 3_600)} hr`;
    }
    return `about ${Math.round(seconds / 86_400).toLocaleString()} days`;
}

function TrackIcon({ src, earned }: { src: string; earned: boolean; }) {
    const [broken, setBroken] = useState(false);

    useEffect(() => {
        setBroken(false);
    }, [src]);

    if (broken) {
        return (
            <span className={cl("track-fallback", { "track-fallback-dim": !earned })}>
                <BadgeIcon width={20} height={20} />
            </span>
        );
    }

    return (
        <img
            src={src}
            alt=""
            width={28}
            height={28}
            className={cl("track-img", { "track-img-dim": !earned })}
            onError={() => setBroken(true)}
        />
    );
}

function ProgressOverview({
    progress,
    activeTab,
    busy,
    onSelectTab
}: {
    progress: AccountProgress;
    activeTab: Tab;
    busy: boolean;
    onSelectTab: (tab: Tab) => void;
}) {
    const [editing, setEditing] = useState(false);
    const [baseTime, setBaseTime] = useState("");
    const [baseVariety, setBaseVariety] = useState("");
    const [baseStream, setBaseStream] = useState("");

    function openEditor() {
        setBaseTime(progress.time.manualBaseline != null ? String(progress.time.manualBaseline) : "");
        setBaseVariety(progress.variety.manualBaseline != null ? String(progress.variety.manualBaseline) : "");
        setBaseStream(progress.stream.manualBaseline != null ? String(progress.stream.manualBaseline) : "");
        setEditing(prev => !prev);
    }

    const parsedTime = parseOptionalBaseline(baseTime, Farmer.MAX_TARGET_HOURS, false);
    const parsedVariety = parseOptionalBaseline(baseVariety, 20_000, true);
    const parsedStream = parseOptionalBaseline(baseStream, Farmer.MAX_TARGET_HOURS, false);
    const canSave = parsedTime.ok && parsedVariety.ok && parsedStream.ok;

    function saveBaselines() {
        if (!canSave) return;
        void Farmer.updateManualBaselines({
            timeHours: parsedTime.num,
            varietyGames: parsedVariety.num,
            streamHours: parsedStream.num
        }).then(() => {
            setEditing(false);
            showToast({ text: "Saved your starting progress baseline.", variant: "success" });
        });
    }

    function resetCache() {
        void Farmer.resetLocalProgressCache().then(() => {
            setBaseTime("");
            setBaseVariety("");
            setBaseStream("");
            setEditing(false);
            showToast({ text: "Cleared local BadgeFarmer progress cache.", variant: "success" });
        });
    }

    const cards: Array<{ tab: Tab; title: string; unit: string; data: TrackProgress; maxAt: number; }> = [
        { tab: "time", title: "Game Time", unit: "hrs", data: progress.time, maxAt: Farmer.ETERNAL_HOURS },
        { tab: "variety", title: "Variety", unit: "games", data: progress.variety, maxAt: Farmer.UNIVERSALIST_GAMES },
        { tab: "stream", title: "Streaming", unit: "hrs", data: progress.stream, maxAt: Farmer.ETERNAL_HOURS }
    ];

    return (
        <section className={cl("overview")} aria-label="Account badge progress">
            <div className={cl("overview-head")}>
                <span className={cl("overview-title")}>Your badge progress</span>
                <div className={cl("overview-actions")}>
                    <button
                        type="button"
                        className={cl("ghost", "ghost-sm")}
                        disabled={busy}
                        onClick={openEditor}
                    >
                        {editing ? "Close" : "Set baseline"}
                    </button>
                    <button
                        type="button"
                        className={cl("ghost", "ghost-sm")}
                        disabled={progress.loading}
                        onClick={() => void Farmer.syncAccountProgress(true)}
                    >
                        {progress.loading ? "Syncing..." : "Sync profile"}
                    </button>
                </div>
            </div>

            <div className={cl("tracks")}>
                {cards.map(({ tab, title, unit, data, maxAt }) => {
                    const tierLabel = data.currentTier != null
                        ? `${data.currentTier.name} · T${data.currentTier.level}/10`
                        : "Unranked · T0/10";
                    const ceiling = data.nextTier?.at ?? maxAt;
                    const pct = ceiling > 0 ? Math.min(100, (data.current / ceiling) * 100) : 100;
                    const subline = data.nextTier != null
                        ? `Next: ${data.nextTier.name} (${data.nextTier.at.toLocaleString()} ${unit})`
                        : "Max tier reached";

                    return (
                        <button
                            key={tab}
                            type="button"
                            className={cl("track-card", { "track-card-active": activeTab === tab })}
                            onClick={() => onSelectTab(tab)}
                        >
                            <div className={cl("track-top")}>
                                <TrackIcon src={data.iconUrl} earned={data.currentTier != null} />
                                <div className={cl("track-meta")}>
                                    <span className={cl("track-name")}>{title}</span>
                                    <span className={cl("track-tier")}>{tierLabel}</span>
                                </div>
                            </div>

                            <div className={cl("track-stat")}>
                                <span className={cl("track-value")}>{formatCount(data.current)}</span>
                                <span className={cl("track-unit")}>/ {maxAt.toLocaleString()} {unit}</span>
                            </div>

                            <div className={cl("track-bar")}>
                                <div className={cl("track-bar-fill")} style={{ width: `${pct}%` }} />
                            </div>

                            <div className={cl("track-foot")}>
                                <span className={cl("track-next")}>{subline}</span>
                                {data.pendingSync > 0 && (
                                    <span className={cl("track-pending")} title="Sent by BadgeFarmer and awaiting Discord's 24 to 48 hour badge sync">
                                        +{formatCount(data.pendingSync)} queued
                                    </span>
                                )}
                            </div>
                        </button>
                    );
                })}
            </div>

            {editing && (
                <div className={cl("baseline-box")}>
                    <p className={cl("baseline-note")}>
                        Discord profiles expose your unlocked badge tier (for example Seasoned = 500+ hrs) rather than exact minutes. Enter exact totals if you played or streamed more on another PC, or reset BadgeFarmer's local ledger.
                    </p>
                    <div className={cl("baseline-grid")}>
                        <Field
                            label="Game Time floor"
                            suffix="hrs"
                            value={baseTime}
                            disabled={busy}
                            placeholder={String(progress.time.profileFloor)}
                            onChange={setBaseTime}
                            error={parsedTime.ok ? null : "Invalid hours"}
                        />
                        <Field
                            label="Variety floor"
                            suffix="games"
                            value={baseVariety}
                            disabled={busy}
                            placeholder={String(Math.max(progress.variety.profileFloor, progress.variety.clientSeenGames))}
                            onChange={setBaseVariety}
                            error={parsedVariety.ok ? null : "Whole number"}
                        />
                        <Field
                            label="Stream floor"
                            suffix="hrs"
                            value={baseStream}
                            disabled={busy}
                            placeholder={String(progress.stream.profileFloor)}
                            onChange={setBaseStream}
                            error={parsedStream.ok ? null : "Invalid hours"}
                        />
                    </div>
                    <div className={cl("baseline-actions")}>
                        <button
                            type="button"
                            className={cl("ghost", "ghost-danger")}
                            disabled={busy}
                            onClick={resetCache}
                        >
                            Reset local cache
                        </button>
                        <Button size="small" disabled={busy || !canSave} onClick={saveBaselines}>
                            Save baseline
                        </Button>
                    </div>
                </div>
            )}
        </section>
    );
}

function TierMeter({ value, current, tiers, unit, onPick, disabled }: {
    value: number | null;
    current: number;
    tiers: readonly BadgeTier[];
    unit: string;
    onPick: (target: number) => void;
    disabled: boolean;
}) {
    const earnedIdx = reachedTierIndex(current, tiers);
    const targetIdx = value == null ? -1 : reachedTierIndex(value, tiers);
    const label = value == null
        ? "Invalid target"
        : targetIdx >= 0 ? tiers[targetIdx].name : `Below ${tiers[0].name}`;

    return (
        <div className={cl("tiers")}>
            <div className={cl("tiers-track")} role="group" aria-label="Badge tier presets">
                {tiers.map((tier, index) => {
                    const isEarned = index <= earnedIdx;
                    const isPlanned = !isEarned && index <= targetIdx;
                    const stateNote = isEarned ? " (already reached)" : "";
                    return (
                        <button
                            key={tier.name}
                            type="button"
                            disabled={disabled}
                            className={cl("tier", { "tier-earned": isEarned, "tier-on": isPlanned })}
                            title={`${tier.name}: ${tier.at.toLocaleString()} ${unit}${stateNote}`}
                            aria-label={`Set target to ${tier.name} (${tier.at.toLocaleString()} ${unit})`}
                            onClick={() => onPick(tier.at)}
                        />
                    );
                })}
            </div>
            <span className={cl("tiers-label")}>{label}</span>
        </div>
    );
}

function Field({ label, hint, value, placeholder, onChange, error, suffix, disabled }: {
    label: string;
    hint?: string;
    value: string;
    placeholder?: string;
    onChange: (value: string) => void;
    error: string | null;
    suffix?: string;
    disabled?: boolean;
}) {
    return (
        <label className={cl("field")}>
            <span className={cl("field-label")}>{label}</span>
            <span className={cl("input-wrap", { "input-invalid": error != null })}>
                <input
                    className={cl("input")}
                    value={value}
                    placeholder={placeholder}
                    disabled={disabled}
                    inputMode="decimal"
                    spellCheck={false}
                    onChange={event => onChange(event.currentTarget.value)}
                    aria-invalid={error != null}
                />
                {suffix != null && <span className={cl("input-suffix")}>{suffix}</span>}
            </span>
            {(error != null || hint != null) && (
                <span className={cl("field-note", { "field-error": error != null })}>{error ?? hint}</span>
            )}
        </label>
    );
}

function ToggleOption({ checked, disabled, title, note, onChange }: {
    checked: boolean;
    disabled: boolean;
    title: string;
    note: string;
    onChange: (next: boolean) => void;
}) {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={checked}
            disabled={disabled}
            className={cl("toggle", { "toggle-on": checked })}
            onClick={() => onChange(!checked)}
        >
            <div className={cl("toggle-copy")}>
                <span className={cl("toggle-title")}>{title}</span>
                <span className={cl("toggle-note")}>{note}</span>
            </div>
            <span className={cl("switch", { "switch-on": checked })} aria-hidden="true">
                <span className={cl("switch-knob")} />
            </span>
        </button>
    );
}

function ModePills<T extends string>({ options, value, disabled, onChange }: {
    options: Array<{ id: T; label: string; }>;
    value: T;
    disabled: boolean;
    onChange: (next: T) => void;
}) {
    return (
        <div className={cl("subtabs")} role="radiogroup">
            {options.map(option => (
                <button
                    key={option.id}
                    type="button"
                    role="radio"
                    disabled={disabled}
                    aria-checked={option.id === value}
                    className={cl("subtab", { "subtab-on": option.id === value })}
                    onClick={() => onChange(option.id)}
                >
                    {option.label}
                </button>
            ))}
        </div>
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
    const [open, setOpen] = useState(false);
    const [highlight, setHighlight] = useState(0);
    const wrapRef = useRef<HTMLDivElement>(null);
    const listRef = useRef<HTMLDivElement>(null);

    const indexed = useMemo<IndexedApp[]>(() => {
        if (apps == null) return [];
        return apps.map(app => ({
            app,
            lower: app.name.toLowerCase(),
            aliases: (app.aliases ?? []).map(alias => alias.toLowerCase()),
            exe: Farmer.executableFor(app)
        }));
    }, [apps]);

    const results = useMemo(() => {
        const needle = query.trim().toLowerCase();
        if (indexed.length === 0 || needle.length < 2) return [];

        const matches: IndexedApp[] = [];
        for (const item of indexed) {
            if (item.lower.includes(needle) || item.aliases.some(alias => alias.includes(needle))) {
                matches.push(item);
            }
        }

        matches.sort((left, right) => {
            const leftExact = Number(left.lower === needle);
            const rightExact = Number(right.lower === needle);
            if (leftExact !== rightExact) return rightExact - leftExact;

            const leftPrefix = Number(left.lower.startsWith(needle));
            const rightPrefix = Number(right.lower.startsWith(needle));
            if (leftPrefix !== rightPrefix) return rightPrefix - leftPrefix;

            return left.app.name.length - right.app.name.length || left.app.name.localeCompare(right.app.name);
        });

        return matches.slice(0, MAX_RESULTS);
    }, [indexed, query]);

    const showResults = open && results.length > 0;
    const activeIndex = highlight < results.length ? highlight : 0;

    useEffect(() => {
        if (!showResults) return;
        const row = listRef.current?.children[activeIndex] as HTMLElement | undefined;
        row?.scrollIntoView({ block: "nearest" });
    }, [showResults, activeIndex]);

    useEffect(() => {
        if (!showResults) return;
        function onMouseDown(event: MouseEvent) {
            if (!wrapRef.current?.contains(event.target as Node | null)) setOpen(false);
        }
        document.addEventListener("mousedown", onMouseDown);
        return () => document.removeEventListener("mousedown", onMouseDown);
    }, [showResults]);

    function choose(app: DetectableApp) {
        onSelect(app);
        setQuery("");
        setOpen(false);
        setHighlight(0);
    }

    function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
        if (event.key === "Escape") {
            setOpen(false);
            setQuery("");
            return;
        }
        if (results.length === 0) return;
        if (event.key === "ArrowDown") {
            event.preventDefault();
            setOpen(true);
            setHighlight(Math.min(activeIndex + 1, results.length - 1));
        } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
            setHighlight(Math.max(activeIndex - 1, 0));
        } else if (event.key === "Enter" && showResults) {
            event.preventDefault();
            const picked = results[activeIndex];
            if (picked != null) choose(picked.app);
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
        : apps == null ? "Loading Discord's game list" : `Search ${apps.length.toLocaleString()} Windows games`;

    return (
        <div className={cl("search")} ref={wrapRef}>
            <span className={cl("input-wrap")}>
                <input
                    className={cl("input")}
                    value={query}
                    placeholder={placeholder}
                    disabled={disabled || apps == null}
                    spellCheck={false}
                    role="combobox"
                    aria-expanded={showResults}
                    aria-controls="vc-badge-farmer-results"
                    aria-label="Search for a game"
                    onFocus={() => setOpen(true)}
                    onChange={event => {
                        setQuery(event.currentTarget.value);
                        setOpen(true);
                        setHighlight(0);
                    }}
                    onKeyDown={onKeyDown}
                />
                {query !== "" && !disabled && (
                    <button
                        type="button"
                        className={cl("clear")}
                        aria-label="Clear search"
                        onClick={() => {
                            setQuery("");
                            setOpen(false);
                        }}
                    >
                        ×
                    </button>
                )}
            </span>
            {showResults && (
                <div className={cl("results")} id="vc-badge-farmer-results" role="listbox" ref={listRef}>
                    {results.map((item, index) => (
                        <button
                            key={item.app.id}
                            type="button"
                            role="option"
                            aria-selected={index === activeIndex}
                            className={cl("result", { "result-active": index === activeIndex })}
                            onMouseEnter={() => setHighlight(index)}
                            onMouseDown={event => event.preventDefault()}
                            onClick={() => choose(item.app)}
                        >
                            <span className={cl("result-name")}>{item.app.name}</span>
                            <span className={cl("result-meta")}>{item.exe}</span>
                        </button>
                    ))}
                </div>
            )}
            {open && query.trim().length >= 2 && results.length === 0 && apps != null && (
                <span className={cl("field-note")}>No Windows game in Discord's catalog matches that name.</span>
            )}
        </div>
    );
}

interface LiveView {
    title: string;
    detail: string | null;
    rightNote: string | null;
    current: number;
    target: number;
    unit: string;
    paused: boolean;
    viewerMode?: boolean;
}

function liveView(status: FarmerStatus): LiveView {
    if (status.mode === "VIEWER") {
        const active = status.watchingOwner != null;
        return {
            title: "Viewer Helper",
            detail: active ? "Keeping incoming stream active and unpaused" : "Standing by for a Go Live stream in this call",
            rightNote: null,
            current: 0,
            target: 0,
            unit: "",
            paused: !active,
            viewerMode: true
        };
    }

    const game = status.activeGame?.name ?? null;
    const gameDetail = status.gamesTarget > 0 && status.mode !== "VARIETY"
        ? `${status.gamesCredited}/${status.gamesTarget} batch games · ${game ?? "Starting"}`
        : game;

    const streamRemainingSec = Math.max(0, (status.streamTarget - status.streamHours) * 3_600);
    const streamRightNote = !status.streamPaused && (status.streamViewers ?? 0) > 0 && streamRemainingSec > 0
        ? `${formatDuration(streamRemainingSec).replace(/^about /, "~")} left`
        : null;

    const viewers = status.streamViewers == null
        ? "Starting Go Live"
        : status.streamPaused
            ? "Paused · waiting for a viewer"
            : status.streamViewers === 1 ? "1 viewer · unpaused" : `${status.streamViewers} viewers · unpaused`;

    const errorNote = status.errors > 0
        ? `${status.errors} failed ${status.errors === 1 ? "request" : "requests"}`
        : null;

    const time: LiveView = {
        title: "Game Time",
        detail: gameDetail,
        rightNote: errorNote,
        current: status.hoursCredited,
        target: status.hoursTarget,
        unit: "hours",
        paused: false
    };
    const variety: LiveView = {
        title: "Variety",
        detail: game,
        rightNote: errorNote,
        current: status.gamesCredited,
        target: status.gamesTarget,
        unit: "games",
        paused: false
    };
    const stream: LiveView = {
        title: "Streaming",
        detail: viewers,
        rightNote: streamRightNote ?? errorNote,
        current: status.streamHours,
        target: status.streamTarget,
        unit: "hours",
        paused: status.streamPaused
    };

    switch (status.mode) {
        case "GAME_TIME": return time;
        case "VARIETY": return variety;
        case "STREAM": return stream;
        default: {
            if (status.streamTarget > 0) {
                return { ...stream, title: "Step 2 of 2 · Streaming" };
            }
            return { ...time, title: "Step 1 of 2 · Game Time & Variety" };
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
                    <span className={cl("pulse", { "pulse-paused": view.paused })} />
                    <span>{view.title}</span>
                </div>
                <Button variant="dangerSecondary" size="small" onClick={Farmer.stop}>Stop</Button>
            </div>

            {view.viewerMode ? (
                <div className={cl("live-figure")}>
                    <span className={cl("live-status-text")}>
                        {status.watchingOwner != null ? "Watching live" : "Waiting for stream"}
                    </span>
                </div>
            ) : (
                <>
                    <div className={cl("live-figure")}>
                        <span className={cl("live-number")}>{formatCount(view.current)}</span>
                        <span className={cl("live-target")}>of {view.target.toLocaleString()} {view.unit}</span>
                        <span className={cl("live-pct")}>{Math.floor(pct)}%</span>
                    </div>

                    <div className={cl("bar")}>
                        <div className={cl("bar-fill", { "bar-fill-active": pct > 0 })} style={{ width: `${pct}%` }} />
                    </div>
                </>
            )}

            <div className={cl("live-foot")}>
                <span className={cl("live-detail")}>{view.detail ?? "Starting"}</span>
                {view.rightNote != null && <span className={cl("live-detail", "live-right-note")}>{view.rightNote}</span>}
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
    const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);

    function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
        const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
        if (step === 0) return;
        event.preventDefault();
        const nextIndex = (index + step + TABS.length) % TABS.length;
        onChange(TABS[nextIndex].id);
        buttonRefs.current[nextIndex]?.focus();
    }

    return (
        <div className={cl("tabs")} role="tablist" onKeyDown={onKeyDown}>
            <span
                className={cl("tabs-thumb")}
                style={{ width: `calc((100% - 8px) / ${TABS.length})`, transform: `translateX(${index * 100}%)` }}
            />
            {TABS.map((tab, tabIndex) => (
                <button
                    key={tab.id}
                    ref={el => { buttonRefs.current[tabIndex] = el; }}
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

interface SourceOption {
    id: string;
    label: string;
    tag: string;
}

interface PopoverCoords {
    top?: number;
    bottom?: number;
    left: number;
    width: number;
    maxHeight: number;
}

function SourcePicker({ sources, value, loading, disabled, onChange }: {
    sources: DesktopSource[];
    value: string;
    loading: boolean;
    disabled: boolean;
    onChange: (id: string) => void;
}) {
    const [open, setOpen] = useState(false);
    const [highlight, setHighlight] = useState(0);
    const [coords, setCoords] = useState<PopoverCoords | null>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);

    const options = useMemo<SourceOption[]>(() => [
        { id: "", label: "Main screen", tag: "Auto" },
        ...sources.map(source => ({
            id: source.id,
            label: source.name,
            tag: source.kind === "screen" ? "Screen" : "Window"
        }))
    ], [sources]);

    const selectedIndex = Math.max(0, options.findIndex(option => option.id === value));
    const current = options[selectedIndex] ?? options[0];
    const activeIndex = highlight < options.length ? highlight : selectedIndex;

    function updatePosition() {
        const button = triggerRef.current;
        if (button == null) return;
        const rect = button.getBoundingClientRect();
        const margin = 12;
        const gap = 6;
        const width = Math.min(Math.max(rect.width, 260), window.innerWidth - margin * 2);
        const left = Math.min(Math.max(margin, rect.left), window.innerWidth - width - margin);
        const spaceBelow = window.innerHeight - rect.bottom - margin - gap;
        const spaceAbove = rect.top - margin - gap;
        const desired = Math.min(240, options.length * 36 + 12);

        if (spaceBelow < desired && spaceAbove > spaceBelow) {
            setCoords({
                bottom: window.innerHeight - rect.top + gap,
                left,
                width,
                maxHeight: Math.max(120, Math.min(260, spaceAbove))
            });
        } else {
            setCoords({
                top: rect.bottom + gap,
                left,
                width,
                maxHeight: Math.max(120, Math.min(260, spaceBelow))
            });
        }
    }

    useLayoutEffect(() => {
        if (!open) return;
        updatePosition();
    }, [open, options.length]);

    useEffect(() => {
        if (!open) return;

        function onMouseDown(event: MouseEvent) {
            const target = event.target as Node | null;
            if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
            setOpen(false);
        }

        function onKey(event: globalThis.KeyboardEvent) {
            if (event.key === "Escape") {
                event.preventDefault();
                setOpen(false);
                triggerRef.current?.focus();
            }
        }

        function onViewportChange(event: Event) {
            if (event.type === "scroll" && menuRef.current?.contains(event.target as Node | null)) return;
            updatePosition();
        }

        document.addEventListener("mousedown", onMouseDown);
        document.addEventListener("keydown", onKey);
        window.addEventListener("resize", onViewportChange);
        window.addEventListener("scroll", onViewportChange, true);
        return () => {
            document.removeEventListener("mousedown", onMouseDown);
            document.removeEventListener("keydown", onKey);
            window.removeEventListener("resize", onViewportChange);
            window.removeEventListener("scroll", onViewportChange, true);
        };
    }, [open, options.length]);

    useEffect(() => {
        if (!open) return;
        const row = menuRef.current?.children[activeIndex] as HTMLElement | undefined;
        row?.scrollIntoView({ block: "nearest" });
    }, [open, activeIndex]);

    useEffect(() => {
        if (disabled) setOpen(false);
    }, [disabled]);

    function pick(option: SourceOption) {
        onChange(option.id);
        setOpen(false);
        triggerRef.current?.focus();
    }

    function toggle() {
        if (disabled || loading) return;
        setHighlight(selectedIndex);
        setOpen(prev => !prev);
    }

    function onTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
        if (disabled || loading) return;
        if (event.key === "ArrowDown") {
            event.preventDefault();
            if (!open) {
                setHighlight(selectedIndex);
                setOpen(true);
            } else {
                setHighlight(Math.min(activeIndex + 1, options.length - 1));
            }
        } else if (event.key === "ArrowUp") {
            event.preventDefault();
            if (!open) {
                setHighlight(selectedIndex);
                setOpen(true);
            } else {
                setHighlight(Math.max(activeIndex - 1, 0));
            }
        } else if ((event.key === "Enter" || event.key === " ") && open) {
            event.preventDefault();
            const chosen = options[activeIndex];
            if (chosen != null) pick(chosen);
        } else if (event.key === "Escape" && open) {
            event.preventDefault();
            setOpen(false);
        }
    }

    const menu = open && coords != null && typeof document !== "undefined"
        ? ReactDOM.createPortal(
            <div
                ref={menuRef}
                role="listbox"
                aria-label="Stream capture source"
                className={cl("popover")}
                style={{
                    top: coords.top,
                    bottom: coords.bottom,
                    left: coords.left,
                    width: coords.width,
                    maxHeight: coords.maxHeight
                }}
            >
                {options.map((option, index) => {
                    const isSelected = option.id === value;
                    const isActive = index === activeIndex;
                    return (
                        <button
                            key={option.id || "__auto__"}
                            type="button"
                            role="option"
                            aria-selected={isSelected}
                            className={cl("option", { "option-active": isActive, "option-selected": isSelected })}
                            onMouseEnter={() => setHighlight(index)}
                            onMouseDown={event => event.preventDefault()}
                            onClick={() => pick(option)}
                        >
                            <span className={cl("option-label")}>{option.label}</span>
                            <span className={cl("option-right")}>
                                <span className={cl("option-tag")}>{option.tag}</span>
                                {isSelected && <span className={cl("option-check")} aria-hidden="true">{"\u2713"}</span>}
                            </span>
                        </button>
                    );
                })}
            </div>,
            document.body
        )
        : null;

    return (
        <>
            <button
                ref={triggerRef}
                type="button"
                role="combobox"
                aria-expanded={open}
                aria-haspopup="listbox"
                aria-label="Stream capture source"
                disabled={disabled || loading}
                className={cl("picker-btn", { "picker-btn-open": open })}
                onClick={toggle}
                onKeyDown={onTriggerKeyDown}
            >
                <span className={cl("picker-label")}>
                    {loading ? "Loading sources..." : current.label}
                </span>
                <svg
                    className={cl("picker-chevron", { "picker-chevron-open": open })}
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    aria-hidden="true"
                >
                    <path
                        d="M6 9L12 15L18 9"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    />
                </svg>
            </button>
            {menu}
        </>
    );
}

export function BadgeFarmerDashboard({ isModal = false }: { isModal?: boolean; } = {}): JSX.Element {
    const { apps, error: catalogueError, retry: retryCatalogue } = useCatalogue();
    const { status, progress } = useFarmerState();
    const refreshView = useForceUpdater();

    const [tab, setTab] = useState<Tab>("time");
    const [timeStrategy, setTimeStrategy] = useState<TimeStrategy>("spread");
    const [goalMode, setGoalMode] = useState<GoalMode>("delta");
    const [selected, setSelected] = useState<DetectableApp | null>(null);
    const [spreadTarget, setSpreadTarget] = useState(String(Farmer.ETERNAL_HOURS));
    const [hoursPerGame, setHoursPerGame] = useState(String(Farmer.DEFAULT_HOURS_PER_GAME));
    const [singleTarget, setSingleTarget] = useState(String(Farmer.DEFAULT_SINGLE_GAME_HOURS));
    const [singleChunk, setSingleChunk] = useState(String(Farmer.MAX_CHUNK_HOURS));
    const [varietyCount, setVarietyCount] = useState(String(Farmer.UNIVERSALIST_GAMES));
    const [varietyMinutes, setVarietyMinutes] = useState(String(Farmer.DEFAULT_VARIETY_MINUTES));
    const [streamTarget, setStreamTarget] = useState("1");
    const [streamTouched, setStreamTouched] = useState(false);
    const [selectedSourceId, setSelectedSourceId] = useState("");
    const [lowPower, setLowPower] = useState(true);
    const [checkpoint, setCheckpoint] = useState(false);
    const [copiedAlt, setCopiedAlt] = useState(false);

    const busy = status.mode !== "IDLE";
    const subtractExisting = goalMode === "delta";
    const personalization = isPersonalizationEnabled();
    const noTrackState = Farmer.getNoTrackStreamState();
    const voice = useVoiceReadiness(tab === "stream" || tab === "all");
    const streamSources = useStreamSources(tab === "stream");

    // Advance default Stream target to the user's next unearned tier once progress syncs.
    useEffect(() => {
        if (streamTouched || progress.stream.current <= 0) return;
        const nextAt = progress.stream.nextTier?.at ?? Farmer.ETERNAL_HOURS;
        setStreamTarget(String(nextAt));
    }, [progress.stream.current, progress.stream.nextTier, streamTouched]);

    useEffect(() => {
        if (selectedSourceId === "" || streamSources.loading || streamSources.sources.length === 0) return;
        if (!streamSources.sources.some(item => item.id === selectedSourceId)) {
            setSelectedSourceId("");
        }
    }, [selectedSourceId, streamSources.loading, streamSources.sources]);

    const perGame = parseNumber(hoursPerGame, 1, Farmer.MAX_CHUNK_HOURS, true);
    const maxSpreadHours = apps != null && perGame != null ? apps.length * perGame : Farmer.MAX_TARGET_HOURS;
    const spreadHours = parseNumber(spreadTarget, 1, Math.max(1, maxSpreadHours), false);

    const singleHours = parseNumber(singleTarget, 1, Farmer.MAX_TARGET_HOURS, false);
    const chunk = parseNumber(singleChunk, 1, Farmer.MAX_CHUNK_HOURS, true);

    const games = parseNumber(varietyCount, 1, apps?.length ?? 1_000, true);
    const minutes = parseNumber(varietyMinutes, 1, 1_440, false);
    const streamHours = parseNumber(streamTarget, 0.1, Farmer.MAX_TARGET_HOURS, false);

    const activeSource = streamSources.sources.find(item => item.id === selectedSourceId) ?? null;
    const sharingFullScreen = activeSource == null || activeSource.kind === "screen";

    const spreadNeededHours = spreadHours == null
        ? null
        : subtractExisting ? Math.max(0, spreadHours - progress.time.current) : spreadHours;
    const spreadGamesCount = spreadNeededHours != null && perGame != null && spreadNeededHours > 0
        ? Math.min(apps?.length ?? Infinity, Math.max(1, Math.ceil(spreadNeededHours / perGame)))
        : 0;
    const spreadBatches = spreadGamesCount > 0 ? Math.ceil(spreadGamesCount / Farmer.BATCH_SIZE) : 0;

    const singleBatches = singleHours != null && chunk != null
        ? Math.ceil(Math.ceil(singleHours / chunk) / Farmer.BATCH_SIZE)
        : null;
    const todaySingleSent = selected != null ? Farmer.getTodaySingleGameHours(selected.id) : 0;

    const varietyNeeded = games == null
        ? null
        : subtractExisting ? Math.max(0, games - progress.variety.current) : games;
    const varietyBatches = varietyNeeded != null && varietyNeeded > 0
        ? Math.ceil(varietyNeeded / Farmer.BATCH_SIZE)
        : 0;

    const streamNeeded = streamHours == null
        ? null
        : subtractExisting ? Math.max(0, streamHours - progress.stream.current) : streamHours;

    const allMissingHours = Math.max(0, Farmer.ETERNAL_HOURS - progress.time.current);
    const allMissingGames = Math.max(0, Farmer.UNIVERSALIST_GAMES - progress.variety.current);
    const allMissingStream = Math.max(0, Farmer.ETERNAL_HOURS - progress.stream.current);
    const allStepOneGames = allMissingHours > 0
        ? Math.max(Math.ceil(allMissingHours / Farmer.DEFAULT_HOURS_PER_GAME), allMissingGames)
        : allMissingGames;
    const allBatches = allStepOneGames > 0 ? Math.ceil(allStepOneGames / Farmer.BATCH_SIZE) : 0;

    function copyAltScript() {
        copyToClipboard(Farmer.ALT_WATCH_SNIPPET)
            .then(() => {
                setCopiedAlt(true);
                showToast({ text: "Copied alt auto-watch script. Paste it into your alt's DevTools console.", variant: "success" });
                setTimeout(() => setCopiedAlt(false), 2_500);
            })
            .catch(() => {
                showToast({ text: "Could not copy script to clipboard.", variant: "critical" });
            });
    }

    function fixNoTrack() {
        if (Farmer.enableNoTrackBadgeTracking()) {
            refreshView();
            showToast({ text: "Enabled badge tracking in NoTrack. Reload Discord to apply.", variant: "success" });
        }
    }

    const voiceStatusText = voice.problem != null
        ? voice.problem
        : voice.peersInChannel > 0
            ? `Connected to ${voice.channelName} · ${voice.peersInChannel} other ${voice.peersInChannel === 1 ? "person" : "people"} in call`
            : `Connected to ${voice.channelName} · alone in call (bring an alt so hours count)`;

    const activeTimeValue = timeStrategy === "spread"
        ? (spreadHours != null && !subtractExisting ? progress.time.current + spreadHours : spreadHours)
        : (singleHours != null ? progress.time.current + singleHours : null);

    const spreadAlreadyMet = spreadNeededHours != null && spreadNeededHours * 3_600_000 < 60_000;
    const varietyAlreadyMet = varietyNeeded != null && varietyNeeded <= 0;
    const streamAlreadyMet = streamNeeded != null && streamNeeded * 3_600_000 < 30_000;
    const allAlreadyMet = allMissingHours < 1 && allMissingGames <= 0 && allMissingStream < 0.1;

    return (
        <div className={cl("root", { "root-modal": isModal })}>
            {!isModal && (
                <header className={cl("header")}>
                    <div>
                        <h2 className={cl("title")}>Badge Farmer</h2>
                        <p className={cl("subtitle")}>Pick a badge, start a run, and keep Discord open.</p>
                    </div>
                    <span className={cl("status", { "status-on": busy })}>{busy ? "Running" : "Idle"}</span>
                </header>
            )}

            <ProgressOverview
                progress={progress}
                activeTab={tab}
                busy={busy}
                onSelectTab={setTab}
            />

            {personalization === false && (
                <div className={cl("callout", "callout-danger")}>
                    Data personalization is off. Turn on "Use data to personalize my Discord experience" under Data &amp; Privacy or Discord will drop these sessions.
                </div>
            )}

            {busy && <LiveCard status={status} />}
            {!busy && <DoneCard message={status.finishedMessage} error={status.finishedMessage == null ? status.lastError : null} />}

            {catalogueError != null && (
                <div className={cl("callout", "callout-danger", "callout-row")}>
                    <span>{catalogueError}</span>
                    <button type="button" className={cl("ghost")} onClick={retryCatalogue}>Retry</button>
                </div>
            )}

            <Tabs value={tab} onChange={setTab} />

            {tab === "time" && (
                <Panel
                    key="time"
                    intro={
                        timeStrategy === "spread"
                            ? "Discord caps playtime per single game at 24 hours a day and sums across titles. BadgeFarmer subtracts your existing hours and spreads the remainder across unused Windows games."
                            : "Logs sessions on one chosen game. Discord caps credit per game at about 24 hours per day."
                    }
                    action={
                        timeStrategy === "spread" ? (
                            <StartButton
                                label={spreadAlreadyMet ? "Target reached" : "Start Game Time"}
                                eta={
                                    spreadAlreadyMet
                                        ? `At ${formatCount(progress.time.current)}h · switch Goal mode to add more`
                                        : spreadNeededHours != null && spreadGamesCount > 0
                                            ? `+${formatCount(spreadNeededHours)}h across ${spreadGamesCount.toLocaleString()} games · ${formatDuration(spreadBatches * SECONDS_PER_BATCH)}`
                                            : null
                                }
                                disabled={busy || apps == null || spreadHours == null || perGame == null || spreadAlreadyMet}
                                onClick={() => void Farmer.startSpreadGameTime(apps!, spreadHours!, perGame!, subtractExisting)}
                            />
                        ) : (
                            <StartButton
                                label={selected == null ? "Pick a game" : `Start ${selected.name}`}
                                eta={singleBatches != null ? `+${singleHours}h · ${formatDuration(singleBatches * SECONDS_PER_BATCH)}` : null}
                                disabled={busy || selected == null || singleHours == null || chunk == null}
                                onClick={() => void Farmer.startSingleGameTime(selected!, singleHours!, chunk!, false)}
                            />
                        )
                    }
                >
                    <ModePills
                        options={[
                            { id: "spread", label: "Spread across catalog (Recommended)" },
                            { id: "single", label: "Single game (24h/day cap)" }
                        ]}
                        value={timeStrategy}
                        disabled={busy}
                        onChange={setTimeStrategy}
                    />

                    {timeStrategy === "spread" ? (
                        <>
                            <ModePills
                                options={[
                                    { id: "delta", label: `Reach target (subtracts ${formatCount(progress.time.current)}h)` },
                                    { id: "add", label: "Add full amount on top" }
                                ]}
                                value={goalMode}
                                disabled={busy}
                                onChange={setGoalMode}
                            />
                            <div className={cl("row")}>
                                <Field
                                    label={subtractExisting ? "Target milestone" : "Hours to add"}
                                    suffix="hours"
                                    value={spreadTarget}
                                    disabled={busy}
                                    onChange={setSpreadTarget}
                                    hint={
                                        spreadNeededHours != null
                                            ? (spreadAlreadyMet
                                                ? `Already at ${formatCount(progress.time.current)} hours`
                                                : `Sends ${formatCount(spreadNeededHours)}h across ${spreadGamesCount.toLocaleString()} fresh games`)
                                            : undefined
                                    }
                                    error={spreadHours == null ? `Use 1 to ${maxSpreadHours.toLocaleString()}` : null}
                                />
                                <Field
                                    label="Hours per game"
                                    suffix="hours"
                                    value={hoursPerGame}
                                    disabled={busy}
                                    onChange={setHoursPerGame}
                                    hint="Keep at 24 or under so each hour counts"
                                    error={perGame == null ? `Whole number, 1 to ${Farmer.MAX_CHUNK_HOURS}` : null}
                                />
                            </div>
                        </>
                    ) : (
                        <>
                            <GamePicker apps={apps} error={catalogueError} selected={selected} onSelect={setSelected} disabled={busy} />
                            {selected != null && todaySingleSent > 0 && (
                                <div className={cl("callout", "callout-warn")}>
                                    Already sent {todaySingleSent}h on {selected.name} today (UTC). Discord caps single-game credit around 24 hours per day.
                                </div>
                            )}
                            {singleHours != null && singleHours > 24 && (
                                <div className={cl("callout", "callout-warn")}>
                                    Discord discards extra overlapping hours past ~24 hours per game per day. Switch to "Spread across catalog" above to unlock Eternal in one run.
                                </div>
                            )}
                            <div className={cl("row")}>
                                <Field
                                    label="Hours to send today"
                                    suffix="hours"
                                    value={singleTarget}
                                    disabled={busy}
                                    onChange={setSingleTarget}
                                    hint="24 hours max credited per day on one title"
                                    error={singleHours == null ? `Use 1 to ${Farmer.MAX_TARGET_HOURS.toLocaleString()}` : null}
                                />
                                <Field
                                    label="Hours per session"
                                    suffix="hours"
                                    value={singleChunk}
                                    disabled={busy}
                                    onChange={setSingleChunk}
                                    hint={`Batches up to ${Farmer.BATCH_SIZE} sessions per request`}
                                    error={chunk == null ? `Whole number, 1 to ${Farmer.MAX_CHUNK_HOURS}` : null}
                                />
                            </div>
                        </>
                    )}

                    <TierMeter
                        value={activeTimeValue}
                        current={progress.time.current}
                        tiers={TIME_TIERS}
                        unit="hours"
                        disabled={busy}
                        onPick={target => {
                            if (timeStrategy === "spread") {
                                setGoalMode("delta");
                                setSpreadTarget(String(target));
                            } else {
                                setSingleTarget(String(Math.min(24, Math.max(1, Math.ceil(target - progress.time.current)))));
                            }
                        }}
                    />
                </Panel>
            )}

            {tab === "variety" && (
                <Panel
                    key="variety"
                    intro="Posts one session per unused Windows game, skipping games Discord already saw you play on this PC and titles claimed in prior runs."
                    action={
                        <StartButton
                            label={varietyAlreadyMet ? "Target reached" : "Start Variety"}
                            eta={
                                varietyAlreadyMet
                                    ? `At ${progress.variety.current} games · switch Goal mode to claim more`
                                    : varietyNeeded != null
                                        ? `+${varietyNeeded.toLocaleString()} new games · ${formatDuration(varietyBatches * SECONDS_PER_BATCH)}`
                                        : null
                            }
                            disabled={busy || apps == null || games == null || minutes == null || varietyAlreadyMet}
                            onClick={() => void Farmer.startVariety(apps!, games!, minutes!, subtractExisting)}
                        />
                    }
                >
                    <ModePills
                        options={[
                            { id: "delta", label: `Reach target (subtracts ${progress.variety.current} games)` },
                            { id: "add", label: "Add full amount on top" }
                        ]}
                        value={goalMode}
                        disabled={busy}
                        onChange={setGoalMode}
                    />
                    <div className={cl("row")}>
                        <Field
                            label={subtractExisting ? "Target milestone" : "New games to add"}
                            value={varietyCount}
                            disabled={busy}
                            onChange={setVarietyCount}
                            hint={
                                varietyNeeded != null
                                    ? (varietyAlreadyMet
                                        ? `Already at ${progress.variety.current} unique games`
                                        : `Claims ${varietyNeeded.toLocaleString()} unused games (${progress.variety.clientSeenGames} seen on this PC)`)
                                    : undefined
                            }
                            error={games == null ? `Whole number, 1 to ${(apps?.length ?? 1_000).toLocaleString()}` : null}
                        />
                        <Field
                            label="Each session"
                            suffix="min"
                            value={varietyMinutes}
                            disabled={busy}
                            onChange={setVarietyMinutes}
                            hint="Five minutes per game is plenty"
                            error={minutes == null ? "Use 1 to 1,440" : null}
                        />
                    </div>
                    <TierMeter
                        value={games != null && !subtractExisting ? progress.variety.current + games : games}
                        current={progress.variety.current}
                        tiers={VARIETY_TIERS}
                        unit="games"
                        disabled={busy}
                        onPick={target => {
                            setGoalMode("delta");
                            setVarietyCount(String(target));
                        }}
                    />
                </Panel>
            )}

            {tab === "stream" && (
                <Panel
                    key="stream"
                    intro="Discord verifies streaming hours against live media servers and an active viewer. BadgeFarmer resumes from your saved hours and keeps Go Live unpaused at low GPU cost."
                    action={
                        <StartButton
                            label={streamAlreadyMet ? "Target reached" : "Go live"}
                            eta={
                                streamAlreadyMet
                                    ? `At ${formatCount(progress.stream.current)}h · pick a higher tier`
                                    : streamNeeded != null
                                        ? `${formatCount(streamNeeded)}h remaining · ${formatDuration(streamNeeded * 3_600)}`
                                        : null
                            }
                            disabled={busy || streamHours == null || voice.problem != null || noTrackState !== "ok" || streamAlreadyMet}
                            onClick={() => void Farmer.startStreamFarm(streamHours!, {
                                sourceId: selectedSourceId || undefined,
                                lowPower,
                                checkpoint,
                                subtractExisting
                            })}
                        />
                    }
                >
                    <div className={cl("voice-bar", {
                        "voice-bar-ok": voice.problem == null && voice.peersInChannel > 0,
                        "voice-bar-warn": voice.problem == null && voice.peersInChannel === 0
                    })}>
                        <span className={cl("voice-dot")} />
                        <span className={cl("voice-text")}>{voiceStatusText}</span>
                    </div>

                    {noTrackState === "disabled_in_settings" && (
                        <div className={cl("callout", "callout-danger", "callout-row")}>
                            <span>NoTrack has badge tracking off, blocking Discord's stream badge events.</span>
                            <button type="button" className={cl("ghost")} onClick={fixNoTrack}>Enable in NoTrack</button>
                        </div>
                    )}

                    {noTrackState === "needs_restart" && (
                        <div className={cl("callout", "callout-warn", "callout-row")}>
                            <span>Reload Discord once so NoTrack's badge tracking change takes effect.</span>
                            <button type="button" className={cl("ghost")} onClick={() => location.reload()}>Reload</button>
                        </div>
                    )}

                    {sharingFullScreen && (
                        <div className={cl("callout", "callout-warn")}>
                            Default capture shares your main screen. Pick a single window below or close private tabs before you go live.
                        </div>
                    )}

                    <ModePills
                        options={[
                            { id: "delta", label: `Reach target (resumes from ${formatCount(progress.stream.current)}h)` },
                            { id: "add", label: "Stream full duration on top" }
                        ]}
                        value={goalMode}
                        disabled={busy}
                        onChange={setGoalMode}
                    />

                    <div className={cl("row")}>
                        <Field
                            label={subtractExisting ? "Target milestone" : "Hours to stream"}
                            suffix="hours"
                            value={streamTarget}
                            disabled={busy}
                            onChange={val => {
                                setStreamTouched(true);
                                setStreamTarget(val);
                            }}
                            hint="Saves live progress across restarts while a viewer watches"
                            error={streamHours == null ? `Use 0.1 to ${Farmer.MAX_TARGET_HOURS.toLocaleString()}` : null}
                        />
                        <div className={cl("field")}>
                            <span className={cl("field-label")}>Capture source</span>
                            <div className={cl("select-row")}>
                                <SourcePicker
                                    sources={streamSources.sources}
                                    value={selectedSourceId}
                                    loading={streamSources.loading}
                                    disabled={busy}
                                    onChange={setSelectedSourceId}
                                />
                                <button
                                    type="button"
                                    className={cl("ghost")}
                                    disabled={busy || streamSources.loading}
                                    onClick={streamSources.refresh}
                                >
                                    {streamSources.loading ? "..." : "Refresh"}
                                </button>
                            </div>
                            <span className={cl("field-note")}>Pick a blank window to avoid sharing your desktop</span>
                        </div>
                    </div>

                    <div className={cl("toggles")}>
                        <ToggleOption
                            checked={lowPower}
                            disabled={busy}
                            title="Low-power 480p / 15 FPS"
                            note="Cuts GPU and upload load while farming, then restores your stream quality on Stop"
                            onChange={setLowPower}
                        />
                        <ToggleOption
                            checked={checkpoint}
                            disabled={busy}
                            title="2-hour checkpoints"
                            note="Restarts Go Live every 2 hours (avoids Discord's 10h stream cap). Pair with alt auto-watch"
                            onChange={setCheckpoint}
                        />
                    </div>

                    <div className={cl("alt-box")}>
                        <div className={cl("alt-copy")}>
                            <span className={cl("alt-title")}>Alt viewer auto-watch</span>
                            <span className={cl("alt-note")}>
                                Keeps your alt watching and unpaused across reconnects, background tabs, and checkpoints.
                            </span>
                        </div>
                        <div className={cl("alt-actions")}>
                            <button
                                type="button"
                                className={cl("ghost")}
                                disabled={busy || voice.problem != null}
                                onClick={() => void Farmer.startViewerWatch()}
                            >
                                Watch this call
                            </button>
                            <button
                                type="button"
                                className={cl("ghost")}
                                onClick={copyAltScript}
                            >
                                {copiedAlt ? "Copied" : "Copy alt script"}
                            </button>
                        </div>
                    </div>

                    <TierMeter
                        value={streamHours != null && !subtractExisting ? progress.stream.current + streamHours : streamHours}
                        current={progress.stream.current}
                        tiers={STREAM_TIERS}
                        unit="hours"
                        disabled={busy}
                        onPick={target => {
                            setStreamTouched(true);
                            setGoalMode("delta");
                            setStreamTarget(String(target));
                        }}
                    />
                </Panel>
            )}

            {tab === "all" && (
                <Panel
                    key="all"
                    intro="Calculates the missing hours and games from your current progress, completes Eternal and Universalist first, and transitions into Streaming."
                    action={
                        <StartButton
                            label={allAlreadyMet ? "All three reached" : "Start all three"}
                            eta={
                                allAlreadyMet
                                    ? "Max tier reached on each track"
                                    : allBatches > 0
                                        ? `Step 1 takes ${formatDuration(allBatches * SECONDS_PER_BATCH)}`
                                        : "Step 1 done · starts Streaming"
                            }
                            disabled={busy || apps == null || allAlreadyMet}
                            onClick={() => void Farmer.maxAll(apps!, {
                                sourceId: selectedSourceId || undefined,
                                lowPower,
                                checkpoint
                            })}
                        />
                    }
                >
                    <ol className={cl("flow")}>
                        <li className={cl("flow-step")}>
                            <span className={cl("flow-name")}>Game Time + Variety</span>
                            <span className={cl("flow-note")}>
                                {allMissingHours <= 0 && allMissingGames <= 0
                                    ? "Eternal (5,000h) and Universalist (100 games) are already reached; step skipped"
                                    : `Sends +${Math.ceil(allMissingHours).toLocaleString()}h and claims ${allStepOneGames.toLocaleString()} unused Windows games to reach 5,000h + 100 games`}
                            </span>
                        </li>
                        <li className={cl("flow-step")}>
                            <span className={cl("flow-name")}>Streaming</span>
                            <span className={cl("flow-note")}>
                                {allMissingStream <= 0
                                    ? "Phenomenon (5,000h) is already reached"
                                    : voice.problem == null && noTrackState === "ok"
                                        ? `Goes live in ${voice.channelName} for the remaining ${Math.ceil(allMissingStream).toLocaleString()} hours`
                                        : `Skipped unless you join a voice channel (with NoTrack badge tracking on) for the remaining ${Math.ceil(allMissingStream).toLocaleString()} hours`}
                            </span>
                        </li>
                    </ol>
                </Panel>
            )}

            <p className={cl("footnote")}>
                Discord syncs Game Time and Variety badges within 24 to 48 hours, and Streaming within 48 hours. Runs stay hidden from your public status unless enabled in plugin settings.
            </p>
        </div>
    );
}

export function BadgeIcon({
    width = 20,
    height = 20,
    className,
    size: _size,
    color: _color,
    ...props
}: {
    width?: number;
    height?: number;
    className?: string;
    size?: string;
    color?: string;
    [key: string]: unknown;
}) {
    return (
        <svg
            width={width}
            height={height}
            viewBox="0 0 24 24"
            fill="none"
            className={className}
            {...props}
        >
            <path
                d="M12 2L4.5 5.5V11.5C4.5 16.5 7.7 20.8 12 22C16.3 20.8 19.5 16.5 19.5 11.5V5.5L12 2Z"
                fill="currentColor"
                fillOpacity="0.2"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
            <path
                d="M12 6.8L13.4 9.6L16.5 10.1L14.2 12.3L14.8 15.4L12 13.9L9.2 15.4L9.8 12.3L7.5 10.1L10.6 9.6L12 6.8Z"
                fill="currentColor"
            />
        </svg>
    );
}

export function closeBadgeFarmerModal(): void {
    try {
        closeModal(MODAL_KEY);
    } catch {
        // Ignore if modal is not open.
    }
}

export function openBadgeFarmerModal(): string {
    return openModal(
        (props: RenderModalProps) => (
            <ErrorBoundary>
                <Modal
                    {...props}
                    size="lg"
                    title="Badge Farmer"
                    subtitle="Pick a badge, start a run, and keep Discord open."
                >
                    <div className={cl("modal-body")}>
                        <BadgeFarmerDashboard isModal />
                    </div>
                </Modal>
            </ErrorBoundary>
        ),
        { modalKey: MODAL_KEY }
    );
}
