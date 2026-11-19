/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { definePluginSettings } from "@api/Settings";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType } from "@utils/types";
import { onceReady } from "@webpack";

import { maxAll, stop as stopFarmer } from "./farmer";
import { BadgeFarmerDashboard, loadCatalogue } from "./ui";

const logger = new Logger("BadgeFarmer");

let enabled = false;

const settings = definePluginSettings({
    dashboard: {
        type: OptionType.COMPONENT,
        description: "Badge Farmer dashboard",
        component: BadgeFarmerDashboard
    },
    autoStartMaxAll: {
        type: OptionType.BOOLEAN,
        description: "Run All three each time Discord starts",
        default: false
    }
});

export default definePlugin({
    name: "BadgeFarmer",
    description: "Earns Discord's activity badges for you. Pick a game and a target, then leave the client open.",
    authors: [{
        name: "rico",
        id: 1361736124858630274n
    }],
    tags: ["Activity", "Customisation", "Utility"],
    searchTerms: ["badges", "farm", "game time", "game variety", "streaming"],
    settings,

    start() {
        enabled = true;
        if (!settings.store.autoStartMaxAll) return;
        onceReady
            .then(loadCatalogue)
            // The plugin may have been turned off while the game list loaded.
            .then(apps => enabled ? maxAll(apps) : undefined)
            .catch(error => logger.error("All three couldn't start on launch", error));
    },

    stop() {
        enabled = false;
        stopFarmer();
    }
});
