/*
Made with ❤️ by rico
I am not responsible for any damage caused by this plugin; use at your own risk
Vencord/Equicord does not endorse/support this plugin (Works with Equicord as well)
dm @wkcp if u need help or have any questions
https://github.com/aboveproof/BadgeFarmer
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
    tier: BadgeTier | null;
    parsedFloor: number;
    iconUrl: string;
    rawDescription: string;
}

export interface ParsedProfileBadges {
    tracks: Record<BadgeTrack, DetectedTrackBadge | null>;
    otherBadges: ProfileBadge[];
}

export interface DirectoryBadgeInput {
    badge: Record<string, unknown>;
    currentTier?: Record<string, unknown> | null;
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

function parseLocaleNumber(raw: string | undefined, minExpectedTierAt = 0): number | null {
    if (typeof raw !== "string") return null;
    const trimmed = raw.trim();
    if (trimmed === "") return null;

    let normalized = trimmed;
    if (/^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(trimmed)) {
        normalized = trimmed.replace(/,/g, "");
    } else if (/^\d{1,3}(?:\.\d{3})+$/.test(trimmed) && minExpectedTierAt >= 1_000) {
        normalized = trimmed.replace(/\./g, "");
    } else {
        normalized = trimmed.replace(/,/g, "");
    }

    const num = Number(normalized);
    return Number.isFinite(num) && num >= 0 ? num : null;
}

function escapeRegex(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsWholeWord(haystack: string, word: string): boolean {
    return new RegExp(`\\b${escapeRegex(word.toLowerCase())}\\b`, "i").test(haystack);
}

function findHashHit(candidates: readonly unknown[]): HashMatch | null {
    const joined = candidates
        .filter((item): item is string => typeof item === "string" && item !== "")
        .join(" ")
        .toLowerCase();
    if (joined === "") return null;
    for (const [hash, hit] of HASH_INDEX) {
        if (joined.includes(hash)) return hit;
    }
    return null;
}

function matchTierNameInTrack(text: string, track: BadgeTrack): number {
    if (text === "") return -1;
    const tiers = TRACK_TIERS[track];
    for (let index = tiers.length - 1; index >= 0; index--) {
        const tier = tiers[index];
        const names = [tier.name, ...(tier.aliases ?? [])];
        if (names.some(candidate => containsWholeWord(text, candidate))) {
            return index;
        }
    }
    return -1;
}

function identifyDirectoryTrack(
    badge: Record<string, unknown>,
    currentTier: Record<string, unknown> | null | undefined
): BadgeTrack | null {
    const id = String(badge.badge_id ?? badge.id ?? badge.key ?? "").toLowerCase();
    const name = String(badge.name ?? badge.title ?? badge.category ?? "").toLowerCase();
    const infoLabel = String(badge.info_label ?? badge.infoLabel ?? badge.progress_label ?? "").toLowerCase();

    if (id.includes("variety") || id.includes("unique_game") || id.includes("games_played") || name === "game variety") {
        return "variety";
    }
    if (id.includes("stream") || id.includes("go_live") || id.includes("golive") || name === "streaming") {
        return "stream";
    }
    if (id.includes("game_time") || id.includes("gametime") || id.includes("playtime") || id.includes("play_time") || name === "game time") {
        return "time";
    }

    const tiersArr = Array.isArray(badge.tiers) ? badge.tiers as Record<string, unknown>[] : [];
    const hashCandidates: unknown[] = [
        badge.simple_icon_url,
        badge.complex_icon_static_url,
        badge.icon,
        badge.iconSrc,
        currentTier?.simple_icon_url,
        currentTier?.complex_icon_static_url
    ];
    for (const t of tiersArr) {
        if (t != null && typeof t === "object") {
            hashCandidates.push(t.simple_icon_url, t.complex_icon_static_url, t.icon);
        }
    }
    const hashHit = findHashHit(hashCandidates);
    if (hashHit != null) return hashHit.track;

    if (/\bgames?\s+played\b/i.test(infoLabel) && !/\b(?:hours?|hrs?|minutes?|mins?)\b/i.test(infoLabel)) {
        return "variety";
    }
    if (/\b(?:hours?|hrs?|minutes?|mins?)\s+of\s+games?\s+played\b/i.test(infoLabel)) {
        return "time";
    }
    if (/\bstream(?:ed|ing)\b/i.test(infoLabel)) {
        return "stream";
    }

    const tierNamesJoined = [
        currentTier?.name,
        badge.name,
        ...tiersArr.map(t => (t != null && typeof t === "object" ? t.name : ""))
    ]
        .filter((v): v is string => typeof v === "string")
        .join(" ");

    if (containsWholeWord(tierNamesJoined, "Universalist") || containsWholeWord(tierNamesJoined, "Sampler")) {
        return "variety";
    }
    if (containsWholeWord(tierNamesJoined, "Eternal") || containsWholeWord(tierNamesJoined, "Unshakeable") || containsWholeWord(tierNamesJoined, "Unshakable")) {
        return "time";
    }
    if (containsWholeWord(tierNamesJoined, "Phenomenon") || containsWholeWord(tierNamesJoined, "Fledgling") || containsWholeWord(tierNamesJoined, "Newcomer")) {
        return "stream";
    }

    return null;
}

function extractProgressFromLabel(label: string, track: BadgeTrack, expectedFloor: number): number | null {
    const trimmed = label.trim();
    if (trimmed === "") return null;

    if (track === "variety") {
        const gamesHit = trimmed.match(/(\d[\d,.]*)\+?\s*(?:unique\s+|different\s+)?(?:detectable\s+)?(?:pc\s+)?games?/i)
            ?? trimmed.match(/^(\d[\d,.]*)\b/);
        return gamesHit != null ? parseLocaleNumber(gamesHit[1], expectedFloor) : null;
    }

    const hoursHit = trimmed.match(/(\d[\d,.]*)\+?\s*(?:hours?|hrs?)/i);
    if (hoursHit != null) {
        return parseLocaleNumber(hoursHit[1], expectedFloor);
    }

    const minsHit = trimmed.match(/(\d[\d,.]*)\+?\s*(?:minutes?|mins?)/i);
    if (minsHit != null) {
        const mins = parseLocaleNumber(minsHit[1], 0);
        return mins != null ? Math.round((mins / 60) * 100) / 100 : null;
    }

    const leading = trimmed.match(/^(\d[\d,.]*)\b/);
    if (leading != null) {
        return parseLocaleNumber(leading[1], expectedFloor);
    }

    return null;
}

function parseSingleDirectoryEntry(entry: DirectoryBadgeInput): { track: BadgeTrack; detected: DetectedTrackBadge; } | null {
    const { badge, currentTier } = entry;
    const track = identifyDirectoryTrack(badge, currentTier);
    if (track == null) return null;

    const tiers = TRACK_TIERS[track];
    const explicitlyUnowned = badge.owned === false && currentTier == null;

    let tierIndex = -1;
    if (!explicitlyUnowned) {
        if (currentTier != null) {
            const lvl = typeof currentTier.tier === "number"
                ? currentTier.tier
                : typeof currentTier.level === "number" ? currentTier.level : NaN;
            if (Number.isInteger(lvl) && lvl >= 1 && lvl <= tiers.length) {
                tierIndex = Math.max(tierIndex, lvl - 1);
            }
            const byCurName = matchTierNameInTrack(String(currentTier.name ?? currentTier.title ?? ""), track);
            tierIndex = Math.max(tierIndex, byCurName);
            const curHash = findHashHit([currentTier.complex_icon_static_url, currentTier.simple_icon_url, currentTier.icon]);
            if (curHash != null && curHash.track === track) {
                tierIndex = Math.max(tierIndex, curHash.tierIndex);
            }
        }

        const badgeLvl = typeof badge.current_tier === "number"
            ? badge.current_tier
            : typeof badge.tier === "number" ? badge.tier : NaN;
        if (Number.isInteger(badgeLvl) && badgeLvl >= 1 && badgeLvl <= tiers.length) {
            tierIndex = Math.max(tierIndex, badgeLvl - 1);
        }

        const byBadgeName = matchTierNameInTrack(String(badge.name ?? badge.title ?? ""), track);
        tierIndex = Math.max(tierIndex, byBadgeName);

        const ownHash = findHashHit([badge.complex_icon_static_url, badge.simple_icon_url, badge.icon]);
        if (ownHash != null && ownHash.track === track) {
            tierIndex = Math.max(tierIndex, ownHash.tierIndex);
        }

        if (Array.isArray(badge.tiers)) {
            const list = badge.tiers as Record<string, unknown>[];
            for (let idx = 0; idx < list.length && idx < tiers.length; idx++) {
                const item = list[idx];
                if (item != null && typeof item === "object") {
                    const unlocked = item.obtained === true
                        || item.owned === true
                        || item.unlocked === true
                        || item.is_unlocked === true
                        || (typeof item.obtained_at === "string" && item.obtained_at !== "");
                    if (unlocked) tierIndex = Math.max(tierIndex, idx);
                }
            }
        }
    }

    const expectedAt = tierIndex >= 0 ? tiers[tierIndex].at : 0;
    const infoLabels = [
        currentTier?.info_label,
        currentTier?.infoLabel,
        badge.info_label,
        badge.infoLabel,
        badge.progress_label
    ].filter((v): v is string => typeof v === "string" && v.trim() !== "");

    let parsedAmount: number | null = null;
    for (const label of infoLabels) {
        const val = extractProgressFromLabel(label, track, expectedAt);
        if (val != null && (parsedAmount == null || val > parsedAmount)) {
            parsedAmount = val;
        }
    }

    if (parsedAmount != null) {
        const fromAmountIdx = reachedTierIndex(parsedAmount, tiers);
        if (!explicitlyUnowned || fromAmountIdx >= 0) {
            tierIndex = Math.max(tierIndex, fromAmountIdx);
        }
    }

    if (badge.owned === true && tierIndex < 0) {
        tierIndex = 0;
    }

    const tier = tierIndex >= 0 ? tiers[tierIndex] : null;
    const floor = Math.max(tier?.at ?? 0, parsedAmount ?? 0);

    if (tier == null && floor <= 0) return null;

    const rawIcon = [
        currentTier?.simple_icon_url,
        badge.simple_icon_url,
        currentTier?.complex_icon_static_url,
        badge.complex_icon_static_url,
        badge.iconSrc,
        badge.icon
    ].find((v): v is string => typeof v === "string" && v.trim() !== "");

    return {
        track,
        detected: {
            tierIndex,
            tier,
            parsedFloor: floor,
            iconUrl: resolveBadgeIconUrl(rawIcon, tier ?? tiers[0]),
            rawDescription: infoLabels[0] ?? tier?.name ?? ""
        }
    };
}

function matchSingleProfileBadge(raw: Record<string, unknown>): {
    track: BadgeTrack;
    tierIndex: number;
    parsedFloor: number;
    iconRaw: string;
    description: string;
} | null {
    const id = typeof raw.id === "string" ? raw.id.trim() : "";
    const description = typeof raw.description === "string" ? raw.description.trim() : "";
    const infoLabel = typeof raw.infoLabel === "string"
        ? raw.infoLabel.trim()
        : typeof raw.info_label === "string" ? raw.info_label.trim() : "";
    const title = typeof raw.name === "string" ? raw.name.trim() : typeof raw.title === "string" ? raw.title.trim() : "";
    const iconCandidates = [raw.simple_icon_url, raw.iconSrc, raw.icon, raw.largeIconSrc, raw.icon_asset, raw.asset, raw.image]
        .filter((item): item is string => typeof item === "string" && item.trim() !== "");
    const iconRaw = iconCandidates[0] ?? "";

    const hashHit = findHashHit(iconCandidates);
    if (hashHit != null) {
        const tier = TRACK_TIERS[hashHit.track][hashHit.tierIndex];
        const labelVal = extractProgressFromLabel(infoLabel || description, hashHit.track, tier.at);
        return {
            track: hashHit.track,
            tierIndex: hashHit.tierIndex,
            parsedFloor: Math.max(tier.at, labelVal ?? 0),
            iconRaw,
            description: infoLabel || description || tier.name
        };
    }

    const idLevelMatch = id.toLowerCase().match(/(?:^|_)(game_time|playtime|game_variety|streaming)[_-](\d{1,2})(?:$|_)/);
    if (idLevelMatch != null) {
        const track: BadgeTrack = idLevelMatch[1] === "game_variety"
            ? "variety"
            : idLevelMatch[1] === "streaming" ? "stream" : "time";
        const level = Number(idLevelMatch[2]);
        const tiers = TRACK_TIERS[track];
        if (level >= 1 && level <= tiers.length) {
            const tierIndex = level - 1;
            const labelVal = extractProgressFromLabel(infoLabel || description, track, tiers[tierIndex].at);
            return {
                track,
                tierIndex,
                parsedFloor: Math.max(tiers[tierIndex].at, labelVal ?? 0),
                iconRaw,
                description: infoLabel || description || tiers[tierIndex].name
            };
        }
    }

    const textSample = `${infoLabel} ${description}`.trim();

    // Matches both "5 hours streamed" and "Stream to other users for 5 hours".
    const streamMatch = textSample.match(/(\d[\d,.]*)\+?\s*(?:hours?|hrs?)\s+(?:of\s+)?stream(?:ed|ing)/i)
        ?? textSample.match(/stream(?:ed|ing)?(?:\s+to\s+other\s+users)?\s+(?:for\s+)?(\d[\d,.]*)\+?\s*(?:hours?|hrs?)/i);
    if (streamMatch != null) {
        const hours = parseLocaleNumber(streamMatch[1], 0);
        if (hours != null && hours > 0) {
            const idx = Math.max(0, reachedTierIndex(hours, STREAM_TIERS));
            return { track: "stream", tierIndex: idx, parsedFloor: hours, iconRaw, description: textSample };
        }
    }

    // Matches both "10,065 hours of games played" and "Play 500 hours of detectable PC games".
    const timeMatch = textSample.match(/(\d[\d,.]*)\+?\s*(?:hours?|hrs?)\s+of\s+(?:detectable\s+)?(?:pc\s+)?games?(?:\s+played)?/i)
        ?? textSample.match(/play(?:ed)?\s+(\d[\d,.]*)\+?\s*(?:hours?|hrs?)\s+of\s+(?:detectable\s+)?(?:pc\s+)?games?/i);
    if (timeMatch != null) {
        const hours = parseLocaleNumber(timeMatch[1], 0);
        if (hours != null && hours > 0) {
            const idx = Math.max(0, reachedTierIndex(hours, TIME_TIERS));
            return { track: "time", tierIndex: idx, parsedFloor: hours, iconRaw, description: textSample };
        }
    }

    // Matches both "640 games played" and "Play 100+ detectable PC games".
    const varietyMatch = textSample.match(/(\d[\d,.]*)\+?\s*(?:unique\s+|different\s+)?(?:detectable\s+)?(?:pc\s+)?games?\s+played/i)
        ?? textSample.match(/play(?:ed)?\s+(\d[\d,.]*)\+?\s*(?:unique\s+|different\s+)?(?:detectable\s+)?(?:pc\s+)?games?/i);
    if (varietyMatch != null && !/hours?|hrs?/i.test(varietyMatch[0])) {
        const games = parseLocaleNumber(varietyMatch[1], 0);
        if (games != null && games > 0) {
            const idx = Math.max(0, reachedTierIndex(games, VARIETY_TIERS));
            return { track: "variety", tierIndex: idx, parsedFloor: games, iconRaw, description: textSample };
        }
    }

    const combined = `${id} ${title} ${infoLabel} ${description}`.toLowerCase();
    const hasStreamContext = /stream|go live|broadcast/i.test(combined);
    const hasGameContext = /game|play|detectable|activity|evolving/i.test(combined);

    for (const track of ["time", "variety", "stream"] as const) {
        const tiers = TRACK_TIERS[track];
        for (let index = tiers.length - 1; index >= 0; index--) {
            const tier = tiers[index];
            const names = [tier.name, ...(tier.aliases ?? [])];
            if (!names.some(candidate => containsWholeWord(combined, candidate))) continue;

            if (tier.name === "Star" && !hasStreamContext) continue;
            if ((tier.name === "Casual" || tier.name === "Serious" || tier.name === "Explorer") && !hasGameContext) {
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

function mergeTrack(prev: DetectedTrackBadge | null, next: DetectedTrackBadge): DetectedTrackBadge {
    if (prev == null) return next;
    const tierIndex = Math.max(prev.tierIndex, next.tierIndex);
    const parsedFloor = Math.max(prev.parsedFloor, next.parsedFloor);
    const preferNextIcon = next.tierIndex >= prev.tierIndex && next.iconUrl !== "";
    return {
        tierIndex,
        tier: next.tierIndex >= prev.tierIndex ? (next.tier ?? prev.tier) : (prev.tier ?? next.tier),
        parsedFloor,
        iconUrl: preferNextIcon ? next.iconUrl : (prev.iconUrl || next.iconUrl),
        rawDescription: next.parsedFloor >= prev.parsedFloor && next.rawDescription !== ""
            ? next.rawDescription
            : prev.rawDescription
    };
}

export function parseAllUserBadges(
    rawProfileBadges: readonly ProfileBadge[] | readonly unknown[],
    directoryEntries: readonly DirectoryBadgeInput[] = []
): ParsedProfileBadges {
    const tracks: Record<BadgeTrack, DetectedTrackBadge | null> = {
        time: null,
        variety: null,
        stream: null
    };
    const otherBadges: ProfileBadge[] = [];

    for (const entry of directoryEntries) {
        if (entry?.badge == null || typeof entry.badge !== "object") continue;
        const parsed = parseSingleDirectoryEntry(entry);
        if (parsed != null) {
            tracks[parsed.track] = mergeTrack(tracks[parsed.track], parsed.detected);
        }
    }

    if (Array.isArray(rawProfileBadges)) {
        for (const entry of rawProfileBadges) {
            if (entry == null || typeof entry !== "object") continue;
            const hit = matchSingleProfileBadge(entry as Record<string, unknown>);
            if (hit == null) {
                const b = entry as ProfileBadge;
                if (typeof b.id === "string" && b.id !== "") otherBadges.push(b);
                continue;
            }

            const tier = TRACK_TIERS[hit.track][hit.tierIndex];
            tracks[hit.track] = mergeTrack(tracks[hit.track], {
                tierIndex: hit.tierIndex,
                tier,
                parsedFloor: Math.max(tier.at, hit.parsedFloor),
                iconUrl: resolveBadgeIconUrl(hit.iconRaw, tier),
                rawDescription: hit.description
            });
        }
    }

    return { tracks, otherBadges };
}
