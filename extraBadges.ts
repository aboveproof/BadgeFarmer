/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Logger } from "@utils/Logger";
import { RestAPI } from "@webpack/common";

import { showBadgeToast } from "./toast";

const logger = new Logger("BadgeFarmer:HypeSquad");

export const HypeSquadHouse = {
    BRAVERY: 1,
    BRILLIANCE: 2,
    BALANCE: 3
} as const;

export type HypeSquadHouseType = typeof HypeSquadHouse[keyof typeof HypeSquadHouse];

export const HYPESQUAD_DETAILS = {
    1: { name: "House of Bravery", color: "#9c84ef" },
    2: { name: "House of Brilliance", color: "#f47b67" },
    3: { name: "House of Balance", color: "#45ddc0" }
} as const;

export async function setHypeSquadHouse(house: HypeSquadHouseType): Promise<boolean> {
    try {
        await RestAPI.post({
            url: "/hypesquad/online",
            body: { house_id: house }
        });
        const details = HYPESQUAD_DETAILS[house];
        showBadgeToast(`Joined ${details.name}. Badge updated.`, "success");
        return true;
    } catch (e) {
        logger.error("Failed to set HypeSquad house", e);
        showBadgeToast("Failed to update HypeSquad house. Try again in a moment.", "critical");
        return false;
    }
}

export async function leaveHypeSquad(): Promise<boolean> {
    try {
        await RestAPI.del({
            url: "/hypesquad/online"
        });
        showBadgeToast("Left HypeSquad.", "default");
        return true;
    } catch (e) {
        logger.error("Failed to leave HypeSquad", e);
        showBadgeToast("Failed to leave HypeSquad.", "critical");
        return false;
    }
}
