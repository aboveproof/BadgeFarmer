/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { HeaderBarButton } from "@api/HeaderBar";
import { definePluginSettings } from "@api/Settings";
import { Logger } from "@utils/Logger";
import { useForceUpdater } from "@utils/react";
import definePlugin, { OptionType } from "@utils/types";
import { onceReady } from "@webpack";
import { useEffect } from "@webpack/common";

import { getStatus, maxAll, stop as stopFarmer, subscribe } from "./farmer";
import { BadgeFarmerDashboard, BadgeIcon, loadCatalogue, openBadgeFarmerModal } from "./ui";

const logger = new Logger("BadgeFarmer");

let enabled = false;

const settings = definePluginSettings({
    dashboard: {
        type: OptionType.COMPONENT,
        description: "Badge Farmer dashboard",
        component: () => <BadgeFarmerDashboard />
    },
    headerButton: {
        type: OptionType.BOOLEAN,
        description: "Show a badge button in the top right header bar",
        default: true
    },
    autoStartMaxAll: {
        type: OptionType.BOOLEAN,
        description: "Run All three each time Discord starts",
        default: false
    }
});

function HeaderBadgeButton() {
    const { headerButton } = settings.use(["headerButton"]);
    const forceUpdate = useForceUpdater();
    useEffect(() => subscribe(forceUpdate), [forceUpdate]);
    const status = getStatus();
    const busy = status.mode !== "IDLE";

    if (!headerButton) return null;

    return (
        <HeaderBarButton
            className="vc-badge-farmer-header-btn"
            onClick={() => void openBadgeFarmerModal()}
            tooltip={busy ? "Badge Farmer (Running)" : "Badge Farmer"}
            icon={BadgeIcon}
            selected={busy}
        />
    );
}

export default definePlugin({
    name: "BadgeFarmer",
    description: "Earns Discord's activity badges for you. Pick a game and a target, then leave the client open.",
    authors: [{
        name: "rico",
        id: 1361736124858630274n
    }],
    tags: ["Activity", "Customisation", "Utility"],
    searchTerms: ["badges", "farm", "game time", "game variety", "streaming"],
    dependencies: ["HeaderBarAPI"],
    settings,

    headerBarButton: {
        icon: BadgeIcon,
        render: HeaderBadgeButton,
        priority: 50
    },

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
