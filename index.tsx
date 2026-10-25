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

const settings = definePluginSettings({
    dashboard: {
        type: OptionType.COMPONENT,
        description: "Farming dashboard",
        component: BadgeFarmerDashboard
    },
    autoStartMaxAll: {
        type: OptionType.BOOLEAN,
        description: "Run Max All on client start",
        default: false
    }
});

export default definePlugin({
    name: "BadgeFarmer",
    description: "Credited Game Time, Game Variety, and Streaming hours straight to Discord's analytics. One click, every tier.",
    authors: [{
        name: "rico",
        id: 1361736124858630274n
    }],
    tags: ["Activity", "Customisation", "Utility"],
    searchTerms: ["badges", "farm", "game time", "game variety", "streaming"],
    settings,

    start() {
        if (!settings.store.autoStartMaxAll) return;
        onceReady.then(() =>
            loadCatalogue().then(
                apps => void maxAll(apps),
                error => logger.error("Auto max-all could not load the game list", error)
            ));
    },

    stop() {
        stopFarmer();
    }
});
