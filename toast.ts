/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { showToast } from "@webpack/common";

export type ToastVariant = "default" | "success" | "critical";

/**
 * Display a user notification safely across various Vencord / Equicord versions.
 * Newer Vencord versions removed the `Toasts` export and use: showToast({ text, variant }).
 * Older Vencord versions define: showToast(message, type, options).
 */
export function showBadgeToast(message: string, variant: ToastVariant = "default") {
    if (typeof showToast !== "function") return;

    const legacyType = variant === "critical" ? "failure" : variant === "success" ? "success" : "message";

    try {
        const fnStr = Function.prototype.toString.call(showToast);
        if (fnStr.includes("Toasts") || fnStr.includes("create")) {
            (showToast as any)(message, legacyType);
            return;
        }

        (showToast as any)({ text: message, variant });
    } catch {
        try {
            (showToast as any)({ text: message, variant });
        } catch {
            try {
                (showToast as any)(message, legacyType);
            } catch {
                // Silently fallback if host environment lacks toast capability
            }
        }
    }
}
