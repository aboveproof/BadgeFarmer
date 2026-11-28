/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { definePluginSettings } from "@api/Settings";
import { Logger } from "@utils/Logger";
import { classes } from "@utils/misc";
import { useForceUpdater } from "@utils/react";
import definePlugin, { OptionType } from "@utils/types";
import { findCssClassesLazy, onceReady } from "@webpack";
import { Clickable, FluxDispatcher, Tooltip, useEffect, UserStore } from "@webpack/common";

import { endOwnedStream, getStatus, loadCatalogue, maxAll, stop as stopFarmer, subscribe } from "./farmer";
import { BadgeFarmerDashboard, BadgeIcon, closeBadgeFarmerModal, openBadgeFarmerModal } from "./ui";

const logger = new Logger("BadgeFarmer");
const HeaderBarClasses = findCssClassesLazy("clickable", "selected", "badge", "badgeContainer");

let enabled = false;
let pendingConnectionHandler: (() => void) | null = null;

function handleBeforeUnload(): void {
    endOwnedStream();
}

const settings = definePluginSettings({
    dashboard: {
        type: OptionType.COMPONENT,
        description: "Badge Farmer dashboard",
        component: () => <BadgeFarmerDashboard />
    },
    headerButton: {
        type: OptionType.BOOLEAN,
        description: "Show a badge button in the top right header bar (Equicord)",
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

    const label = busy ? "Badge Farmer (Running)" : "Badge Farmer";
    const className = classes("vc-badge-farmer-header-btn", busy && "vc-badge-farmer-header-btn-busy");

    return (
        <Tooltip text={label} position="bottom">
            {({ onMouseEnter, onMouseLeave }) => (
                <Clickable
                    className={classes(HeaderBarClasses?.clickable, className)}
                    style={{ width: 24, height: 24, boxSizing: "content-box", justifyContent: "center" }}
                    onClick={() => openBadgeFarmerModal()}
                    onMouseEnter={onMouseEnter}
                    onMouseLeave={onMouseLeave}
                    role="button"
                    tabIndex={0}
                    aria-label={label}
                    aria-expanded={busy}
                >
                    <BadgeIcon width={18} height={18} />
                </Clickable>
            )}
        </Tooltip>
    );
}

// Spread onto definePlugin so upstream Vencord compiles without Equicord's HeaderBarAPI types.
const equicordHeaderBar = {
    headerBarButton: {
        icon: BadgeIcon,
        render: HeaderBadgeButton,
        priority: 50
    }
};

export default definePlugin({
    name: "BadgeFarmer",
    description: "Earns Discord's Game Time, Variety, and Streaming badges while you keep the client open.",
    authors: [{
        name: "rico",
        id: 1361736124858630274n
    }],
    tags: ["Activity", "Customisation", "Utility"],
    searchTerms: ["badges", "farm", "game time", "game variety", "streaming"],
    settings,

    toolboxActions: {
        "Open Badge Farmer"() {
            openBadgeFarmerModal();
        }
    },

    ...equicordHeaderBar,

    start() {
        enabled = true;
        window.addEventListener("beforeunload", handleBeforeUnload);

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
        window.removeEventListener("beforeunload", handleBeforeUnload);
        detachConnectionWaiter();
        closeBadgeFarmerModal();
        stopFarmer();
    }
});
