/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { ProfileBadge } from "@vencord/discord-types";

export type BadgeTrack = "time" | "variety" | "stream";

export interface BadgeTier {
    level: number;
    name: string;
    aliases?: readonly string[];
    at: number;
    hash: string;
}

const DISCORD_CONTENT_CDN = "https://cdn.discordapp.com/assets/content";
const DISCORD_BADGE_CDN = "https://cdn.discordapp.com/badge-icons";

export const TIME_TIERS: readonly BadgeTier[] = [
    { level: 1, name: "Casual", at: 1, hash: "b75fcc4dd1c65dfd4169a203e21023453fd6fe853c9b5c1fd839781fda98e80d" },
    { level: 2, name: "Recreational", at: 5, hash: "f0f32cb2a0003475e443b76a7a2baf454356953ecb84195c7a08c3ce2fd95b70" },
    { level: 3, name: "Dedicated", at: 20, hash: "e0c82f41bcad94a2a52713800fbef7687d0d2c6a6066b09d5e5876156d086e1a" },
    { level: 4, name: "Committed", at: 75, hash: "16f2aeb7465c99efce4d67d9333e3ddcf7435d6e60d2f5f93dc0c07bc7c5a69b" },
    { level: 5, name: "Serious", at: 150, hash: "ba26e83fa68189b41837184e38706f41c288dd29ffba266035d1a5ad9adbae22" },
    { level: 6, name: "Devoted", at: 300, hash: "851b194288f1913ece6c8d99976519e48210580d6f42d994f21e37801611ad54" },
    { level: 7, name: "Seasoned", at: 500, hash: "8b10f5c0c30abbd521be5afc2e0dd4ec6da18bfbc689f06d93a51d06577cd84a" },
    { level: 8, name: "Ironclad", at: 1_000, hash: "d705628490898f2cc22d669cf8b415bc03fed1ddaf98a2a8cbd97442a509293c" },
    { level: 9, name: "Unshakeable", aliases: ["unshakable"], at: 2_000, hash: "2bddcbc9f9959dab805eb7196c8112ce9dc68b09766c8193ab499b1870e44ac7" },
    { level: 10, name: "Eternal", at: 5_000, hash: "457ce4e657f0ced23197891cc3d75b7de29cafa065cdb8cbb81060ac0e63b07f" }
];

export const VARIETY_TIERS: readonly BadgeTier[] = [
    { level: 1, name: "Sampler", at: 2, hash: "ed18d5976c01a4ea19f5a13af08f0547582405cbe48b098b0822e352b8e0a822" },
    { level: 2, name: "Dabbler", at: 5, hash: "e450d5279537db06ee47a104af520b884adaa7ffc3ef2627157526bf1c58e840" },
    { level: 3, name: "Enthusiast", at: 10, hash: "158a9d91b8ca9e96d4afeee38cd640fc51483a8196edb9af0c26e44727acafae" },
    { level: 4, name: "Ranger", at: 15, hash: "9e491942070007f64011ae4fc478926b96433698c07621fc43bafdd5efe83912" },
    { level: 5, name: "Explorer", at: 20, hash: "e25fc55814262150e154ddb1a2b55fc5ed8ed5ba2ff1a22a33d4a41e651e370a" },
    { level: 6, name: "Adventurer", at: 30, hash: "542d5277e0001ea738d5eb57b247dcab9ce6e0c29493d5892203f6258fde55b9" },
    { level: 7, name: "Voyager", at: 40, hash: "082e693cb9ce98b81af618978d449409efc6522b061bc0eac6e88a949fd888c6" },
    { level: 8, name: "Maverick", at: 60, hash: "6fc242e9e8259c471a5e4599cd09af5476e622a572ff235883173913bf506103" },
    { level: 9, name: "Polymath", at: 80, hash: "be9a4d119b8e0d7fc1df7e5a12081332637cb9c978a90377cb9c930500b2fbe6" },
    { level: 10, name: "Universalist", at: 100, hash: "fcc34d343451505c642f3397cec2669a2de3a4a410fb968f794b3a1a0dcd1728" }
];

export const STREAM_TIERS: readonly BadgeTier[] = [
    { level: 1, name: "Newcomer", at: 1, hash: "c56b451e3bf04181182c2529e9bd3659e569ea80f582858090007f0752401b38" },
    { level: 2, name: "Fledgling", at: 5, hash: "2e25ba794f6f371ea0f52eb2d3c8fb2b04094a56f388515e13a9bd6d7949a018" },
    { level: 3, name: "Breakout", at: 20, hash: "4e847b4dca20fbf1c56d3a47cac3c9204f02113c9d5a270ebebdf12909c75848" },
    { level: 4, name: "Standout", at: 75, hash: "27d0e6939f13dcf113243fc9eac642b15e9764ad891e06c5ed78d45a17678582" },
    { level: 5, name: "Trendsetter", at: 150, hash: "af681483be2035f14b0f2bfe2e25a8944c97149172938888ca1008edbe037aad" },
    { level: 6, name: "Headliner", at: 300, hash: "e69a0c86a476c9782ea1d3e7b5ba308eec3d9d6a3eae6ab8af3180f67d16b468" },
    { level: 7, name: "Star", at: 500, hash: "06b6206db966635cf626651bdb94eacce5a23ab05dc7f600f7d31aa482b2058c" },
    { level: 8, name: "Sensation", at: 1_000, hash: "1a3b9120ecd64c342083c37980b225d29ebf4544da6ab546c9268f87904c9dfe" },
    { level: 9, name: "Visionary", at: 2_000, hash: "85f714b90ed3ceb1e00e1f2069bf3ebd564962fa940c92540061537a045e54ab" },
    { level: 10, name: "Phenomenon", at: 5_000, hash: "61331d04b7a9542b38bfa59583360c0b9b93c6496a04f99c0ab37fa1d83ec58a" }
];

export const TRACK_TIERS: Record<BadgeTrack, readonly BadgeTier[]> = {
    time: TIME_TIERS,
    variety: VARIETY_TIERS,
    stream: STREAM_TIERS
};

export interface DetectedTrackBadge {
    tierIndex: number;
    tier: BadgeTier;
    parsedFloor: number;
    iconUrl: string;
    rawDescription: string;
}

export interface ParsedProfileBadges {
    tracks: Record<BadgeTrack, DetectedTrackBadge | null>;
    otherBadges: ProfileBadge[];
}

interface HashMatch {
    track: BadgeTrack;
    tierIndex: number;
}

const HASH_INDEX = new Map<string, HashMatch>();
for (const track of ["time", "variety", "stream"] as const) {
    const tiers = TRACK_TIERS[track];
    for (let index = 0; index < tiers.length; index++) {
        HASH_INDEX.set(tiers[index].hash, { track, tierIndex: index });
    }
}

export function tierIconUrl(tier: BadgeTier): string {
    return `${DISCORD_CONTENT_CDN}/${tier.hash}.svg`;
}

export function resolveBadgeIconUrl(rawIcon: string | undefined, fallbackTier: BadgeTier): string {
    if (typeof rawIcon === "string" && rawIcon.trim() !== "") {
        const trimmed = rawIcon.trim();
        if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
        if (trimmed.startsWith("assets/content/")) return `https://cdn.discordapp.com/${trimmed}`;
        if (/^[a-f0-9]{64}$/i.test(trimmed)) return `${DISCORD_CONTENT_CDN}/${trimmed}.svg`;
        if (/^[a-f0-9]{32}$/i.test(trimmed)) return `${DISCORD_BADGE_CDN}/${trimmed}.png`;
    }
    return tierIconUrl(fallbackTier);
}

export function reachedTierIndex(value: number, tiers: readonly BadgeTier[]): number {
    let reached = -1;
    for (let index = 0; index < tiers.length; index++) {
        if (value >= tiers[index].at) reached = index;
    }
    return reached;
}

export function nextTierFor(value: number, tiers: readonly BadgeTier[]): BadgeTier | null {
    for (const tier of tiers) {
        if (value < tier.at) return tier;
    }
    return null;
}

function parseDigits(raw: string | undefined): number | null {
    if (typeof raw !== "string") return null;
    const num = Number(raw.replace(/,/g, ""));
    return Number.isFinite(num) && num > 0 ? num : null;
}

function escapeRegex(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsWholeWord(haystack: string, word: string): boolean {
    return new RegExp(`\\b${escapeRegex(word.toLowerCase())}\\b`, "i").test(haystack);
}

function matchSingleBadge(raw: Record<string, unknown>): {
    track: BadgeTrack;
    tierIndex: number;
    parsedFloor: number;
    iconRaw: string;
    description: string;
} | null {
    const id = typeof raw.id === "string" ? raw.id.trim() : "";
    const description = typeof raw.description === "string" ? raw.description.trim() : "";
    const title = typeof raw.name === "string" ? raw.name.trim() : typeof raw.title === "string" ? raw.title.trim() : "";
    const iconCandidates = [raw.icon, raw.icon_asset, raw.asset, raw.image]
        .filter((item): item is string => typeof item === "string" && item.trim() !== "");
    const iconJoined = iconCandidates.join(" ").toLowerCase();
    const iconRaw = iconCandidates[0] ?? "";

    // 1. Exact SHA-256 content asset match across all 30 official evolving badge icons.
    for (const [hash, hit] of HASH_INDEX) {
        if (iconJoined.includes(hash)) {
            const tier = TRACK_TIERS[hit.track][hit.tierIndex];
            return {
                track: hit.track,
                tierIndex: hit.tierIndex,
                parsedFloor: tier.at,
                iconRaw,
                description: description || tier.name
            };
        }
    }

    const combined = `${id} ${title} ${description}`.toLowerCase();

    // 2. Explicit numbered IDs such as game_time_7, evolving_badge_game_variety_10, streaming_3.
    const idLevelMatch = id.toLowerCase().match(/(?:^|_)(game_time|game_variety|streaming)[_-](\d{1,2})(?:$|_)/);
    if (idLevelMatch != null) {
        const track: BadgeTrack = idLevelMatch[1] === "game_time"
            ? "time"
            : idLevelMatch[1] === "game_variety" ? "variety" : "stream";
        const level = Number(idLevelMatch[2]);
        const tiers = TRACK_TIERS[track];
        if (level >= 1 && level <= tiers.length) {
            const tierIndex = level - 1;
            return {
                track,
                tierIndex,
                parsedFloor: tiers[tierIndex].at,
                iconRaw,
                description: description || tiers[tierIndex].name
            };
        }
    }

    // 3. Official Discord Earned-By tooltip sentences (extracts exact numeric progress when present).
    const streamDescMatch = description.match(/stream(?:ed|ing)?(?:\s+to\s+other\s+users)?\s+(?:for\s+)?(\d[\d,]*)\+?\s*(?:hours?|hrs?)/i);
    if (streamDescMatch != null) {
        const hours = parseDigits(streamDescMatch[1]);
        if (hours != null) {
            const idx = Math.max(0, reachedTierIndex(hours, STREAM_TIERS));
            return { track: "stream", tierIndex: idx, parsedFloor: hours, iconRaw, description };
        }
    }

    const timeDescMatch = description.match(/play(?:ed)?\s+(\d[\d,]*)\+?\s*(?:hours?|hrs?)\s+of\s+(?:detectable\s+)?(?:pc\s+)?games/i);
    if (timeDescMatch != null) {
        const hours = parseDigits(timeDescMatch[1]);
        if (hours != null) {
            const idx = Math.max(0, reachedTierIndex(hours, TIME_TIERS));
            return { track: "time", tierIndex: idx, parsedFloor: hours, iconRaw, description };
        }
    }

    const varietyDescMatch = description.match(/play(?:ed)?\s+(\d[\d,]*)\+?\s*(?:unique\s+|different\s+)?(?:detectable\s+)?(?:pc\s+)?games/i);
    if (varietyDescMatch != null && !/hours?|hrs?/i.test(varietyDescMatch[0])) {
        const games = parseDigits(varietyDescMatch[1]);
        if (games != null) {
            const idx = Math.max(0, reachedTierIndex(games, VARIETY_TIERS));
            return { track: "variety", tierIndex: idx, parsedFloor: games, iconRaw, description };
        }
    }

    // 4. Exact tier title matching (with context guard for "Star" so unrelated badges never collide).
    const hasStreamContext = /stream|go live|broadcast/i.test(combined);
    const hasGameContext = /game|play|detectable|activity|evolving/i.test(combined);

    for (const track of ["time", "variety", "stream"] as const) {
        const tiers = TRACK_TIERS[track];
        for (let index = tiers.length - 1; index >= 0; index--) {
            const tier = tiers[index];
            const names = [tier.name, ...(tier.aliases ?? [])];
            const matched = names.some(candidate => containsWholeWord(combined, candidate));
            if (!matched) continue;

            if (tier.name === "Star" && !hasStreamContext && !id.toLowerCase().includes("stream")) {
                continue;
            }
            if ((tier.name === "Casual" || tier.name === "Serious" || tier.name === "Explorer")
                && !hasGameContext
                && !id.toLowerCase().includes("game")) {
                continue;
            }

            return {
                track,
                tierIndex: index,
                parsedFloor: tier.at,
                iconRaw,
                description: description || tier.name
            };
        }
    }

    return null;
}

export function parseProfileBadges(rawBadges: readonly ProfileBadge[] | readonly unknown[]): ParsedProfileBadges {
    const tracks: Record<BadgeTrack, DetectedTrackBadge | null> = {
        time: null,
        variety: null,
        stream: null
    };
    const otherBadges: ProfileBadge[] = [];

    if (!Array.isArray(rawBadges)) return { tracks, otherBadges };

    for (const entry of rawBadges) {
        if (entry == null || typeof entry !== "object") continue;
        const hit = matchSingleBadge(entry as Record<string, unknown>);
        if (hit == null) {
            const b = entry as ProfileBadge;
            if (typeof b.id === "string" && b.id !== "") otherBadges.push(b);
            continue;
        }

        const tier = TRACK_TIERS[hit.track][hit.tierIndex];
        const prev = tracks[hit.track];
        const floor = Math.max(tier.at, hit.parsedFloor);

        if (prev == null || hit.tierIndex > prev.tierIndex || floor > prev.parsedFloor) {
            tracks[hit.track] = {
                tierIndex: hit.tierIndex,
                tier,
                parsedFloor: floor,
                iconUrl: resolveBadgeIconUrl(hit.iconRaw, tier),
                rawDescription: hit.description
            };
        }
    }

    return { tracks, otherBadges };
}
