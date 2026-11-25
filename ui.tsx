/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@components/Button";
import ErrorBoundary from "@components/ErrorBoundary";
import { classNameFactory } from "@utils/css";
import { useForceUpdater } from "@utils/react";
import type { RenderModalProps } from "@vencord/discord-types";
import {
    closeModal,
    Modal,
    openModal,
    ReactDOM,
    SelectedChannelStore,
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
// Average cost of one batched /science POST plus the pacing pause.
const SECONDS_PER_BATCH = 0.9;

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
        if (event.key === "Escape") {
            setQuery("");
            return;
        }
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
                {query !== "" && !disabled && (
                    <button
                        type="button"
                        className={cl("clear")}
                        aria-label="Clear search"
                        onClick={() => setQuery("")}
                    >
                        ×
                    </button>
                )}
            </span>
            {results.length > 0 && (
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
            {query.trim().length >= 2 && results.length === 0 && apps != null && (
                <span className={cl("field-note")}>No game in Discord's catalog matches that name.</span>
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
}

function liveView(status: FarmerStatus): LiveView {
    const game = status.activeGame?.name ?? null;
    const viewers = status.streamViewers == null
        ? "Starting Go Live"
        : status.streamPaused
            ? "Paused · waiting for a viewer"
            : status.streamViewers === 1 ? "1 viewer" : `${status.streamViewers} viewers`;

    const time: LiveView = { title: "Game Time", detail: game, current: status.hoursCredited, target: status.hoursTarget, unit: "hours", paused: false };
    const variety: LiveView = { title: "Variety", detail: game, current: status.gamesCredited, target: status.gamesTarget, unit: "games", paused: false };
    const stream: LiveView = { title: "Streaming", detail: viewers, current: status.streamHours, target: status.streamTarget, unit: "hours", paused: status.streamPaused };

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
                    <span className={cl("pulse", { "pulse-paused": view.paused })} />
                    <span>{view.title}</span>
                </div>
                <Button variant="dangerSecondary" size="small" onClick={Farmer.stop}>Stop</Button>
            </div>

            <div className={cl("live-figure")}>
                <span className={cl("live-number")}>{formatCount(view.current)}</span>
                <span className={cl("live-target")}>of {view.target.toLocaleString()} {view.unit}</span>
                <span className={cl("live-pct")}>{Math.floor(pct)}%</span>
            </div>

            <div className={cl("bar")}>
                <div className={cl("bar-fill", { "bar-fill-active": pct > 0 })} style={{ width: `${pct}%` }} />
            </div>

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
        } else if (event.key === "Enter" && open) {
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
    const status = useFarmerStatus();

    const [tab, setTab] = useState<Tab>("time");
    const [selected, setSelected] = useState<DetectableApp | null>(null);
    const [timeTarget, setTimeTarget] = useState(String(Farmer.ETERNAL_HOURS));
    const [chunkHours, setChunkHours] = useState(String(Farmer.DEFAULT_CHUNK_HOURS));
    const [varietyCount, setVarietyCount] = useState(String(Farmer.UNIVERSALIST_GAMES));
    const [varietyMinutes, setVarietyMinutes] = useState(String(Farmer.DEFAULT_VARIETY_MINUTES));
    const [streamTarget, setStreamTarget] = useState("1");
    const [selectedSourceId, setSelectedSourceId] = useState("");

    const busy = status.mode !== "IDLE";
    const personalization = isPersonalizationEnabled();
    const noTrackBlocksStream = Farmer.isNoTrackBlockingStream();
    const voice = useVoiceReadiness(tab === "stream" || tab === "all");
    const streamSources = useStreamSources(tab === "stream");

    const hours = parseNumber(timeTarget, 1, Farmer.MAX_TARGET_HOURS, false);
    const chunk = parseNumber(chunkHours, 1, Farmer.MAX_CHUNK_HOURS, true);
    const games = parseNumber(varietyCount, 1, apps?.length ?? 1_000, true);
    const minutes = parseNumber(varietyMinutes, 1, 1_440, false);
    const streamHours = parseNumber(streamTarget, 0.1, Farmer.MAX_TARGET_HOURS, false);

    const activeSource = streamSources.sources.find(item => item.id === selectedSourceId) ?? null;
    const sharingFullScreen = activeSource == null || activeSource.kind === "screen";

    const timeBatches = hours != null && chunk != null
        ? Math.ceil(Math.ceil(hours / chunk) / Farmer.BATCH_SIZE)
        : null;
    const varietyBatches = games != null ? Math.ceil(games / Farmer.BATCH_SIZE) : null;
    const allBatches = Math.ceil(Farmer.UNIVERSALIST_GAMES / Farmer.BATCH_SIZE)
        + Math.ceil(Math.ceil(Farmer.ETERNAL_HOURS / Farmer.DEFAULT_CHUNK_HOURS) / Farmer.BATCH_SIZE);

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
                    intro="Posts batched play sessions for one game. Click any tier bar to set the target."
                    action={
                        <StartButton
                            label={selected == null ? "Pick a game" : `Start ${selected.name}`}
                            eta={timeBatches != null ? formatDuration(timeBatches * SECONDS_PER_BATCH) : null}
                            disabled={busy || selected == null || hours == null || chunk == null}
                            onClick={() => void Farmer.startGameTime(selected!, hours!, chunk!)}
                        />
                    }
                >
                    <GamePicker apps={apps} error={catalogueError} selected={selected} onSelect={setSelected} disabled={busy} />
                    <div className={cl("row")}>
                        <Field
                            label="Target"
                            suffix="hours"
                            value={timeTarget}
                            disabled={busy}
                            onChange={setTimeTarget}
                            error={hours == null ? `Use 1 to ${Farmer.MAX_TARGET_HOURS.toLocaleString()}` : null}
                        />
                        <Field
                            label="Hours per session"
                            suffix="hours"
                            value={chunkHours}
                            disabled={busy}
                            onChange={setChunkHours}
                            hint={`Batches up to ${Farmer.BATCH_SIZE} sessions per request`}
                            error={chunk == null ? `Whole number, 1 to ${Farmer.MAX_CHUNK_HOURS}` : null}
                        />
                    </div>
                    <TierMeter
                        value={hours}
                        tiers={TIME_TIERS}
                        unit="hours"
                        disabled={busy}
                        onPick={target => setTimeTarget(String(target))}
                    />
                </Panel>
            )}

            {tab === "variety" && (
                <Panel
                    key="variety"
                    intro="Posts one short session each for random games from Discord's catalog. Universalist needs 100."
                    action={
                        <StartButton
                            label="Start Variety"
                            eta={varietyBatches != null ? formatDuration(varietyBatches * SECONDS_PER_BATCH) : null}
                            disabled={busy || apps == null || games == null || minutes == null}
                            onClick={() => void Farmer.startVariety(Farmer.shuffled(apps!, games!), minutes!)}
                        />
                    }
                >
                    <div className={cl("row")}>
                        <Field
                            label="Games"
                            value={varietyCount}
                            disabled={busy}
                            onChange={setVarietyCount}
                            error={games == null ? `Whole number, 1 to ${(apps?.length ?? 1_000).toLocaleString()}` : null}
                        />
                        <Field
                            label="Each session"
                            suffix="min"
                            value={varietyMinutes}
                            disabled={busy}
                            onChange={setVarietyMinutes}
                            hint="Two minutes is enough"
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
                    intro="Starts Go Live in your current voice channel and restarts at the 4-hour mark. Hours count in real time while at least one viewer watches."
                    action={
                        <StartButton
                            label="Go live"
                            eta={streamHours != null ? `Takes ${formatDuration(streamHours * 3_600)}` : null}
                            disabled={busy || streamHours == null || voice.problem != null}
                            onClick={() => void Farmer.startStreamFarm(streamHours!, selectedSourceId || undefined)}
                        />
                    }
                >
                    <div className={cl("voice-bar", { "voice-bar-ok": voice.problem == null })}>
                        <span className={cl("voice-dot")} />
                        <span className={cl("voice-text")}>
                            {voice.problem ?? `Connected to ${voice.channelName}`}
                        </span>
                    </div>

                    {noTrackBlocksStream && (
                        <div className={cl("callout", "callout-danger")}>
                            NoTrack has badge tracking turned off. Enable "Allow badge tracking" in NoTrack settings and restart Discord so Go Live hours count.
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
                            hint="An alt watching your stream counts"
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
                    intro="Runs all three badges to their top tiers in order. You can close this window once the run starts."
                    action={
                        <StartButton
                            label="Start all three"
                            eta={`First two take ${formatDuration(allBatches * SECONDS_PER_BATCH)}`}
                            disabled={busy || apps == null}
                            onClick={() => void Farmer.maxAll(apps!, selectedSourceId || undefined)}
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
                            <span className={cl("flow-note")}>5,000 hours on the first game from that batch</span>
                        </li>
                        <li className={cl("flow-step")}>
                            <span className={cl("flow-name")}>Streaming</span>
                            <span className={cl("flow-note")}>
                                {voice.problem == null
                                    ? `Goes live in ${voice.channelName} after step two`
                                    : "Skipped unless you join a voice channel before step two finishes"}
                            </span>
                        </li>
                    </ol>
                </Panel>
            )}

            <p className={cl("footnote")}>
                Discord refreshes Game Time and Variety badges overnight, and Streaming within 48 hours. Keep "Use data to personalize my Discord experience" on under Data &amp; Privacy.
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
