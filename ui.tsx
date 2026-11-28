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
import type { ProfileBadge, RenderModalProps } from "@vencord/discord-types";
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

import type { DesktopSource, DetectableApp, FarmerStatus, VoiceReadiness } from "./farmer";
import * as Farmer from "./farmer";
import { isPersonalizationEnabled } from "./science";

const cl = classNameFactory("vc-badge-farmer-");

const MODAL_KEY = "vc-badge-farmer-modal";
const MAX_RESULTS = 40;
const SECONDS_PER_BATCH = 0.7;

interface Tier {
    name: string;
    at: number;
}

const TIME_TIERS: Tier[] = [
    { name: "Casual", at: 1 },
    { name: "Recreational", at: 5 },
    { name: "Dedicated", at: 20 },
    { name: "Committed", at: 75 },
    { name: "Serious", at: 150 },
    { name: "Devoted", at: 300 },
    { name: "Seasoned", at: 500 },
    { name: "Ironclad", at: 1_000 },
    { name: "Unshakable", at: 2_000 },
    { name: "Eternal", at: 5_000 }
];

const VARIETY_TIERS: Tier[] = [
    { name: "Sampler", at: 2 },
    { name: "Dabbler", at: 5 },
    { name: "Enthusiast", at: 10 },
    { name: "Ranger", at: 15 },
    { name: "Explorer", at: 20 },
    { name: "Adventurer", at: 30 },
    { name: "Voyager", at: 40 },
    { name: "Maverick", at: 60 },
    { name: "Polymath", at: 80 },
    { name: "Universalist", at: 100 }
];

const STREAM_TIERS: Tier[] = [
    { name: "Newcomer", at: 1 },
    { name: "Fledgling", at: 5 },
    { name: "Breakout", at: 20 },
    { name: "Standout", at: 75 },
    { name: "Trendsetter", at: 150 },
    { name: "Headliner", at: 300 },
    { name: "Star", at: 500 },
    { name: "Sensation", at: 1_000 },
    { name: "Visionary", at: 2_000 },
    { name: "Phenomenon", at: 5_000 }
];

type Tab = "time" | "variety" | "stream" | "all";
type TimeStrategy = "spread" | "single";

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

function useProfileBadges(): { badges: ProfileBadge[]; loading: boolean; refresh: () => void; } {
    const [badges, setBadges] = useState<ProfileBadge[]>([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        let cancelled = false;
        Farmer.fetchMyBadges(false).then(list => {
            if (!cancelled) setBadges(list);
        });
        return () => { cancelled = true; };
    }, []);

    function refresh() {
        setLoading(true);
        Farmer.fetchMyBadges(true)
            .then(list => setBadges(list))
            .finally(() => setLoading(false));
    }

    return { badges, loading, refresh };
}

function useFarmerStatus(): FarmerStatus {
    const forceUpdate = useForceUpdater();
    useEffect(() => Farmer.subscribe(forceUpdate), [forceUpdate]);
    return Farmer.getStatus();
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

function formatCount(value: number): string {
    return value >= 10 ? Math.floor(value).toLocaleString() : (Math.floor(value * 10) / 10).toString();
}

function formatDuration(seconds: number): string {
    if (seconds < 60) return `about ${Math.max(1, Math.ceil(seconds))} sec`;
    if (seconds < 3_600) return `about ${Math.ceil(seconds / 60)} min`;
    if (seconds < 172_800) return `about ${Math.round(seconds / 3_600)} hr`;
    return `about ${Math.round(seconds / 86_400).toLocaleString()} days`;
}

function reachedTier(value: number, tiers: Tier[]): number {
    let reached = -1;
    for (let index = 0; index < tiers.length; index++) {
        if (value >= tiers[index].at) reached = index;
    }
    return reached;
}

function TierMeter({ value, tiers, unit, onPick, disabled }: {
    value: number | null;
    tiers: Tier[];
    unit: string;
    onPick: (target: number) => void;
    disabled: boolean;
}) {
    const reached = value == null ? -1 : reachedTier(value, tiers);
    const label = value == null
        ? "Invalid target"
        : reached >= 0 ? tiers[reached].name : `Below ${tiers[0].name}`;

    return (
        <div className={cl("tiers")}>
            <div className={cl("tiers-track")} role="group" aria-label="Badge tier presets">
                {tiers.map((tier, index) => (
                    <button
                        key={tier.name}
                        type="button"
                        disabled={disabled}
                        className={cl("tier", { "tier-on": index <= reached })}
                        title={`${tier.name}: ${tier.at.toLocaleString()} ${unit}`}
                        aria-label={`Set target to ${tier.name} (${tier.at.toLocaleString()} ${unit})`}
                        onClick={() => onPick(tier.at)}
                    />
                ))}
            </div>
            <span className={cl("tiers-label")}>{label}</span>
        </div>
    );
}

function Field({ label, hint, value, onChange, error, suffix, disabled }: {
    label: string;
    hint?: string;
    value: string;
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
                    disabled={disabled}
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
            current: 0,
            target: 0,
            unit: "",
            paused: !active,
            viewerMode: true
        };
    }

    const game = status.activeGame?.name ?? null;
    const gameDetail = status.gamesTarget > 0 && status.mode !== "VARIETY"
        ? `${status.gamesCredited}/${status.gamesTarget} games · ${game ?? "Starting"}`
        : game;

    const viewers = status.streamViewers == null
        ? "Starting Go Live"
        : status.streamPaused
            ? "Paused · waiting for a viewer"
            : status.streamViewers === 1 ? "1 viewer · unpaused" : `${status.streamViewers} viewers · unpaused`;

    const time: LiveView = { title: "Game Time", detail: gameDetail, current: status.hoursCredited, target: status.hoursTarget, unit: "hours", paused: false };
    const variety: LiveView = { title: "Variety", detail: game, current: status.gamesCredited, target: status.gamesTarget, unit: "games", paused: false };
    const stream: LiveView = { title: "Streaming", detail: viewers, current: status.streamHours, target: status.streamTarget, unit: "hours", paused: status.streamPaused };

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
    const profileBadges = useProfileBadges();
    const status = useFarmerStatus();
    const refreshView = useForceUpdater();

    const [tab, setTab] = useState<Tab>("time");
    const [timeStrategy, setTimeStrategy] = useState<TimeStrategy>("spread");
    const [selected, setSelected] = useState<DetectableApp | null>(null);
    const [spreadTarget, setSpreadTarget] = useState(String(Farmer.ETERNAL_HOURS));
    const [hoursPerGame, setHoursPerGame] = useState(String(Farmer.DEFAULT_HOURS_PER_GAME));
    const [singleTarget, setSingleTarget] = useState(String(Farmer.DEFAULT_SINGLE_GAME_HOURS));
    const [singleChunk, setSingleChunk] = useState(String(Farmer.MAX_CHUNK_HOURS));
    const [varietyCount, setVarietyCount] = useState(String(Farmer.UNIVERSALIST_GAMES));
    const [varietyMinutes, setVarietyMinutes] = useState(String(Farmer.DEFAULT_VARIETY_MINUTES));
    const [streamTarget, setStreamTarget] = useState("1");
    const [selectedSourceId, setSelectedSourceId] = useState("");
    const [lowPower, setLowPower] = useState(true);
    const [checkpoint, setCheckpoint] = useState(false);
    const [copiedAlt, setCopiedAlt] = useState(false);

    const busy = status.mode !== "IDLE";
    const personalization = isPersonalizationEnabled();
    const noTrackState = Farmer.getNoTrackStreamState();
    const voice = useVoiceReadiness(tab === "stream" || tab === "all");
    const streamSources = useStreamSources(tab === "stream");

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

    const spreadGamesCount = spreadHours != null && perGame != null
        ? Math.min(apps?.length ?? Infinity, Math.max(1, Math.ceil(spreadHours / perGame)))
        : null;
    const spreadBatches = spreadGamesCount != null ? Math.ceil(spreadGamesCount / Farmer.BATCH_SIZE) : null;
    const singleBatches = singleHours != null && chunk != null
        ? Math.ceil(Math.ceil(singleHours / chunk) / Farmer.BATCH_SIZE)
        : null;
    const varietyBatches = games != null ? Math.ceil(games / Farmer.BATCH_SIZE) : null;
    const allBatches = Math.ceil(Math.ceil(Farmer.ETERNAL_HOURS / Farmer.DEFAULT_HOURS_PER_GAME) / Farmer.BATCH_SIZE);

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

    const activeTimeValue = timeStrategy === "spread" ? spreadHours : singleHours;

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

            <div className={cl("badges-bar")}>
                <div className={cl("badges-list")}>
                    <span className={cl("badges-label")}>Equipped badges:</span>
                    {profileBadges.badges.length === 0 ? (
                        <span className={cl("badges-empty")}>None shown yet</span>
                    ) : (
                        profileBadges.badges.map(badge => (
                            <span key={badge.id} className={cl("badge-chip")} title={badge.id}>
                                {badge.description || badge.id}
                            </span>
                        ))
                    )}
                </div>
                <button
                    type="button"
                    className={cl("ghost")}
                    disabled={profileBadges.loading}
                    onClick={profileBadges.refresh}
                >
                    {profileBadges.loading ? "..." : "Check"}
                </button>
            </div>

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
                            ? "Discord caps playtime per single game at 24 hours a day and sums across titles. Spreading hours across unique Windows games reaches 5,000 hours in one sync."
                            : "Logs sessions on one chosen game. Discord caps credit per game at about 24 hours per day."
                    }
                    action={
                        timeStrategy === "spread" ? (
                            <StartButton
                                label="Start Game Time"
                                eta={
                                    spreadBatches != null && spreadGamesCount != null
                                        ? `${spreadGamesCount.toLocaleString()} games · ${formatDuration(spreadBatches * SECONDS_PER_BATCH)}`
                                        : null
                                }
                                disabled={busy || apps == null || spreadHours == null || perGame == null}
                                onClick={() => void Farmer.startSpreadGameTime(apps!, spreadHours!, perGame!)}
                            />
                        ) : (
                            <StartButton
                                label={selected == null ? "Pick a game" : `Start ${selected.name}`}
                                eta={singleBatches != null ? formatDuration(singleBatches * SECONDS_PER_BATCH) : null}
                                disabled={busy || selected == null || singleHours == null || chunk == null}
                                onClick={() => void Farmer.startSingleGameTime(selected!, singleHours!, chunk!)}
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
                        <div className={cl("row")}>
                            <Field
                                label="Total target"
                                suffix="hours"
                                value={spreadTarget}
                                disabled={busy}
                                onChange={setSpreadTarget}
                                hint={
                                    spreadGamesCount != null
                                        ? `Uses ${spreadGamesCount.toLocaleString()} unique Windows games`
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
                                hint="Keep at 24 or under so every hour counts"
                                error={perGame == null ? `Whole number, 1 to ${Farmer.MAX_CHUNK_HOURS}` : null}
                            />
                        </div>
                    ) : (
                        <>
                            <GamePicker apps={apps} error={catalogueError} selected={selected} onSelect={setSelected} disabled={busy} />
                            {singleHours != null && singleHours > 24 && (
                                <div className={cl("callout", "callout-warn")}>
                                    Discord discards extra overlapping hours past ~24 hours per game per day. Switch to "Spread across catalog" above to unlock Eternal in one night.
                                </div>
                            )}
                            <div className={cl("row")}>
                                <Field
                                    label="Target"
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
                        tiers={TIME_TIERS}
                        unit="hours"
                        disabled={busy}
                        onPick={target => {
                            if (timeStrategy === "spread") setSpreadTarget(String(target));
                            else setSingleTarget(String(target));
                        }}
                    />
                </Panel>
            )}

            {tab === "variety" && (
                <Panel
                    key="variety"
                    intro="Posts one session each for fresh, verified Windows games from Discord's catalog. Universalist needs 100."
                    action={
                        <StartButton
                            label="Start Variety"
                            eta={varietyBatches != null ? formatDuration(varietyBatches * SECONDS_PER_BATCH) : null}
                            disabled={busy || apps == null || games == null || minutes == null}
                            onClick={() => void Farmer.startVariety(apps!, games!, minutes!)}
                        />
                    }
                >
                    <div className={cl("row")}>
                        <Field
                            label="Games"
                            value={varietyCount}
                            disabled={busy}
                            onChange={setVarietyCount}
                            hint="Prefers games you have not claimed yet"
                            error={games == null ? `Whole number, 1 to ${(apps?.length ?? 1_000).toLocaleString()}` : null}
                        />
                        <Field
                            label="Each session"
                            suffix="min"
                            value={varietyMinutes}
                            disabled={busy}
                            onChange={setVarietyMinutes}
                            hint="Five minutes is plenty"
                            error={minutes == null ? "Use 1 to 1,440" : null}
                        />
                    </div>
                    <TierMeter
                        value={games}
                        tiers={VARIETY_TIERS}
                        unit="games"
                        disabled={busy}
                        onPick={target => setVarietyCount(String(target))}
                    />
                </Panel>
            )}

            {tab === "stream" && (
                <Panel
                    key="stream"
                    intro="Discord verifies streaming hours against live media servers and an active viewer, so fake telemetry earns nothing. BadgeFarmer keeps Go Live unpaused at low GPU cost so real hours count."
                    action={
                        <StartButton
                            label="Go live"
                            eta={streamHours != null ? `Takes ${formatDuration(streamHours * 3_600)}` : null}
                            disabled={busy || streamHours == null || voice.problem != null || noTrackState !== "ok"}
                            onClick={() => void Farmer.startStreamFarm(streamHours!, {
                                sourceId: selectedSourceId || undefined,
                                lowPower,
                                checkpoint
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
                            <span>NoTrack has badge tracking off, which blocks Discord's stream badge events.</span>
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

                    <div className={cl("row")}>
                        <Field
                            label="Target"
                            suffix="hours"
                            value={streamTarget}
                            disabled={busy}
                            onChange={setStreamTarget}
                            hint="Counts while at least one viewer watches"
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
                        value={streamHours}
                        tiers={STREAM_TIERS}
                        unit="hours"
                        disabled={busy}
                        onPick={target => setStreamTarget(String(target))}
                    />
                </Panel>
            )}

            {tab === "all" && (
                <Panel
                    key="all"
                    intro="Unlocks Eternal and Universalist in one pass, then starts Streaming if you sit in a voice channel."
                    action={
                        <StartButton
                            label="Start all three"
                            eta={`First two take ${formatDuration(allBatches * SECONDS_PER_BATCH)}`}
                            disabled={busy || apps == null}
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
                                250 unique Windows games at 20 hours each (5,000 total hours + Universalist in one run)
                            </span>
                        </li>
                        <li className={cl("flow-step")}>
                            <span className={cl("flow-name")}>Streaming</span>
                            <span className={cl("flow-note")}>
                                {voice.problem == null && noTrackState === "ok"
                                    ? `Goes live in ${voice.channelName} right after step one`
                                    : "Skipped unless you join a voice channel (with NoTrack badge tracking on) before step one finishes"}
                            </span>
                        </li>
                    </ol>
                </Panel>
            )}

            <p className={cl("footnote")}>
                Discord syncs Game Time and Variety badges within 24 to 48 hours, and Streaming within 48 hours. Keep "Use data to personalize my Discord experience" on under Data &amp; Privacy.
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
