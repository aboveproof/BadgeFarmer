/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType, ApplicationCommandOptionType, findOption, sendBotMessage } from "@api/Commands";
import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";

import { GameFarmer } from "./gameFarmer";
import { StreamHelper } from "./streamHelper";
import "./styles.css";
import { BadgeFarmerDashboard } from "./ui";

const settings = definePluginSettings({
    dashboard: {
        type: OptionType.COMPONENT,
        description: "",
        component: BadgeFarmerDashboard
    },
    autoStartOnLaunch: {
        type: OptionType.BOOLEAN,
        description: "Automatically start Game Time badge farming when Discord starts up",
        default: false
    }
});

export default definePlugin({
    name: "BadgeFarmer",
    description: "Farm Discord profile badges: Game Time (up to 5,000h), Game Variety (100 unique games), Streaming (up to 5,000h), and HypeSquad.",
    authors: [{
        name: "rico",
        id: 1361736124858630274n
    }],
    tags: ["Activity", "Customisation", "Utility"],
    searchTerms: ["badges", "farm", "game time", "game variety", "streaming badge", "hypesquad"],
    dependencies: ["CommandsAPI"],
    settings,

    async start() {
        await GameFarmer.initialize();
        await StreamHelper.initialize();

        if (settings.store.autoStartOnLaunch) {
            GameFarmer.startGameTimeFarm();
        }
    },

    stop() {
        GameFarmer.cleanup();
        StreamHelper.cleanup();
    },

    commands: [
        {
            name: "badgefarm",
            description: "Manage badge farming and inspect progress",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [
                {
                    name: "action",
                    description: "Action to perform",
                    type: ApplicationCommandOptionType.STRING,
                    required: false,
                    choices: [
                        { name: "Status Overview", label: "Status Overview", value: "status" },
                        { name: "Start Game Time Farm", label: "Start Game Time Farm", value: "gametime" },
                        { name: "Start Game Variety Rotation", label: "Start Game Variety Rotation", value: "variety_rotate" },
                        { name: "Next Game in Rotation", label: "Next Game in Rotation", value: "next" },
                        { name: "Stop All Farming", label: "Stop All Farming", value: "stop" }
                    ]
                }
            ],
            execute(args, ctx) {
                const action = findOption<string>(args, "action", "status");

                switch (action) {
                    case "gametime":
                        GameFarmer.startGameTimeFarm();
                        sendBotMessage(ctx.channel.id, {
                            content: `Farming Game Time. Active game: **${GameFarmer.activeGame?.name ?? "Game"}**.`
                        });
                        break;
                    case "variety_rotate":
                        GameFarmer.startVarietyRotation();
                        sendBotMessage(ctx.channel.id, {
                            content: `Variety rotation active. Rotating games every ${GameFarmer.rotationIntervalSeconds} seconds.`
                        });
                        break;
                    case "next":
                        GameFarmer.manualNextGame();
                        sendBotMessage(ctx.channel.id, {
                            content: `Switched to **${GameFarmer.activeGame?.name ?? "Next Game"}**.`
                        });
                        break;
                    case "stop":
                        GameFarmer.stopAllFarming();
                        sendBotMessage(ctx.channel.id, {
                            content: "**All Badge Farming Stopped.** RunningGameStore restored."
                        });
                        break;
                    case "status":
                    default: {
                        const totalHours = Math.round((GameFarmer.totalFarmedSeconds / 3600) * 10) / 10;
                        const uniqueCount = GameFarmer.uniqueGamesDispatched.size;
                        const streamInfo = StreamHelper.getInfo();
                        const streamHours = Math.round((streamInfo.totalStreamSeconds / 3600) * 10) / 10;

                        sendBotMessage(ctx.channel.id, {
                            content: [
                                "**Badge Farmer Status**",
                                `• Mode: \`${GameFarmer.currentMode}\``,
                                `• Active Game: ${GameFarmer.activeGame?.name ?? "None"}`,
                                `• Game Time Farmed: ${totalHours} hours`,
                                `• Unique Games Registered: ${uniqueCount} / 100`,
                                `• Streamed to Others: ${streamHours} hours (${streamInfo.isStreaming ? "Live" : "Offline"})`,
                                "",
                                "Open Settings > Plugins > BadgeFarmer for the dashboard."
                            ].join("\n")
                        });
                        break;
                    }
                }
            }
        }
    ]
});
