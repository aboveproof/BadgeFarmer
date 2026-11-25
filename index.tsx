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
import { FluxDispatcher, useEffect, UserStore } from "@webpack/common";

import { getStatus, loadCatalogue, maxAll, stop as stopFarmer, subscribe } from "./farmer";
import { BadgeFarmerDashboard, BadgeIcon, closeBadgeFarmerModal, openBadgeFarmerModal } from "./ui";

const logger = new Logger("BadgeFarmer");

let enabled = false;
let pendingConnectionHandler: (() => void) | null = null;

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
        description: "Run All three on Discord startup",
        default: false
    }
});

function detachConnectionWaiter(): void {
    if (pendingConnectionHandler == null) return;
    FluxDispatcher.unsubscribe("CONNECTION_OPEN", pendingConnectionHandler);
    pendingConnectionHandler = null;
}

function launchAutoMaxAll(): void {
    if (!enabled) return;
    loadCatalogue()
        .then(apps => (enabled ? maxAll(apps) : undefined))
        .catch(error => logger.error("Could not start All three on launch", error));
}

function HeaderBadgeButton() {
    const { headerButton } = settings.use(["headerButton"]);
    const forceUpdate = useForceUpdater();
    useEffect(() => subscribe(forceUpdate), [forceUpdate]);
    const status = getStatus();
    const busy = status.mode !== "IDLE";

    if (!headerButton) return null;

    return (
        <HeaderBarButton
            className={`vc-badge-farmer-header-btn ${busy ? "vc-badge-farmer-header-btn-busy" : ""}`}
            onClick={() => openBadgeFarmerModal()}
            tooltip={busy ? "Badge Farmer (Running)" : "Badge Farmer"}
            icon={BadgeIcon}
            selected={busy}
        />
    );
}

export default definePlugin({
    name: "BadgeFarmer",
    description: "Earns Discord's Game Time, Variety, and Streaming badges while you keep the client open.",
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
            .then(() => {
                if (!enabled) return;
                if (UserStore?.getCurrentUser?.() != null) {
                    launchAutoMaxAll();
                    return;
                }
                pendingConnectionHandler = () => {
                    detachConnectionWaiter();
                    launchAutoMaxAll();
                };
                FluxDispatcher.subscribe("CONNECTION_OPEN", pendingConnectionHandler);
            })
            .catch(error => logger.error("Failed waiting for Discord startup", error));
    },

    stop() {
        enabled = false;
        detachConnectionWaiter();
        closeBadgeFarmerModal();
        stopFarmer();
    }
});
