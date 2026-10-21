/**
 * BadgeFarmer Console Edition
 * Paste this script directly into Discord DevTools Console (Ctrl + Shift + I -> Console).
 * Works on Discord Desktop Client and Discord Web (https://discord.com/app).
 */
(() => {
    // 0. Clean up any previous instance
    if (window.BadgeFarmer && typeof window.BadgeFarmer.destroy === "function") {
        window.BadgeFarmer.destroy();
    }

    // 1. Hook Webpack
    let wpRequire;
    try {
        if (typeof webpackChunkdiscord_app !== "undefined") {
            window.webpackChunkdiscord_app.push([[Symbol()], {}, (req) => { wpRequire = req; }]);
            window.webpackChunkdiscord_app.pop();
        }
    } catch (e) {
        console.error("[BadgeFarmer] Webpack hook error:", e);
    }

    if (!wpRequire || !wpRequire.c) {
        console.error("%c[BadgeFarmer] Error: Unable to locate Discord webpack cache. Make sure Discord is fully loaded.", "color: #f23f43; font-weight: bold;");
        return;
    }

    const modules = Object.values(wpRequire.c);

    function findModule(filter) {
        for (const m of modules) {
            if (!m?.exports) continue;
            const exp = m.exports;
            if (filter(exp)) return exp;
            if (exp.default && filter(exp.default)) return exp.default;
            if (exp.Z && filter(exp.Z)) return exp.Z;
        }
        return null;
    }

    function findByProps(...props) {
        return findModule(m => typeof m === "object" && m !== null && props.every(p => m[p] !== undefined));
    }

    const FluxDispatcher = findByProps("dispatch", "subscribe", "register");
    const RunningGameStore = findByProps("getRunningGames", "getGameForPID");
    const AuthStore = findByProps("getToken", "getId");

    function getAuthToken() {
        return AuthStore?.getToken?.() || window.localStorage.getItem("token")?.replace(/^"(.*)"$/, "$1") || null;
    }

    function getGatewaySocket() {
        for (const m of modules) {
            if (!m?.exports) continue;
            const exp = m.exports.default || m.exports;
            if (exp && typeof exp.getSocket === "function") {
                const s = exp.getSocket();
                if (s && typeof s.send === "function") return s;
            }
        }
        return null;
    }

    function sendGatewayPresence(activity) {
        try {
            const socket = getGatewaySocket();
            if (socket && typeof socket.send === "function") {
                socket.send(3, {
                    status: "online",
                    since: 0,
                    activities: activity ? [activity] : [],
                    afk: false
                });
            }
        } catch (_) {}
    }

    // 2. Database of 130 Verified PC Games
    const GAMES = [
        {"id":"356875221078245376","name":"Overwatch","exe":"overwatch.exe"},
        {"id":"356875762940379136","name":"World of Warcraft","exe":"_ptr_/wow.exe"},
        {"id":"356875890958925834","name":"Hearthstone","exe":"hearthstone.app"},
        {"id":"356875988589740042","name":"Dota 2","exe":"dota2.exe"},
        {"id":"356876590342340608","name":"Rainbow Six Siege","exe":"tom clancy's rainbow six siege/rainbowsix.exe"},
        {"id":"356877880938070016","name":"Rocket League","exe":"rocketleague.exe"},
        {"id":"356878860190613504","name":"Heroes of the Storm","exe":"heroesofthestorm.exe"},
        {"id":"356879032584896512","name":"Garry's Mod","exe":"garrysmod/hl2.exe"},
        {"id":"356881342321000448","name":"Z1: Battle Royale","exe":"h1z1 king of the kill/h1z1.exe"},
        {"id":"356887282982191114","name":"ARK: Survival Evolved","exe":"shootergame_be.exe"},
        {"id":"356888453796986880","name":"Path of Exile","exe":"path of exile taiwan/pathofexile.exe"},
        {"id":"356888577310851072","name":"Team Fortress 2","exe":"hl2.exe"},
        {"id":"356889262362329098","name":"FINAL FANTASY XIV ONLINE","exe":"final fantasy xiv.app"},
        {"id":"356942674672091136","name":"Geometry Dash","exe":"geometry dash/geometrydash.exe"},
        {"id":"356943187589201930","name":"Dolphin","exe":"dolphin.exe"},
        {"id":"356944273133928458","name":"Brawlhalla","exe":"brawlhalla/brawlhallagame.exe"},
        {"id":"356953358952562688","name":"The Walking Dead","exe":"walkingdead101.exe"},
        {"id":"356953520278339584","name":"Sonic Mania","exe":"sonicmania.exe"},
        {"id":"356954034701205504","name":"Golf With Your Friends","exe":"golf with your friends.exe"},
        {"id":"356954111901433856","name":"Cities: Skylines","exe":"cities.exe"},
        {"id":"356954176338788352","name":"Arma 3","exe":"arma3.exe"},
        {"id":"356954277803065354","name":"Left 4 Dead 2","exe":"left4dead2.exe"},
        {"id":"357606193918771210","name":"Project 64","exe":"project64.exe"},
        {"id":"357606832899883008","name":"RuneScape","exe":"swiftkit-rs.exe"},
        {"id":"357607133254254632","name":"Dead by Daylight","exe":"dead by daylight/deadbydaylight.exe"},
        {"id":"357607478105604096","name":"War Thunder","exe":"aces.exe"},
        {"id":"358417041981571082","name":"Battlefield 1","exe":"bf1.exe"},
        {"id":"358420454764969994","name":"The Binding of Isaac: Rebirth","exe":"isaac-ng.exe"},
        {"id":"358421399670358026","name":"Black Squad","exe":"steam/steamapps/common/black squad/binaries/win32/steamlauncher.exe"},
        {"id":"358421573071536128","name":"HIVESWAP: Act 1","exe":"hiveswap-act1.exe"},
        {"id":"358421669603311616","name":"Hearts of Iron IV","exe":"hearts of iron iv/hoi4.exe"},
        {"id":"358421781398421514","name":"Blade & Soul","exe":"bns/bin64/client.exe"},
        {"id":"358421904601776138","name":"Sid Meier's Civilization V","exe":"civilizationv_dx11.exe"},
        {"id":"358422012990849024","name":"SMITE","exe":"smite.exe"},
        {"id":"358422126602223616","name":"Factorio","exe":"factorio.app"},
        {"id":"358425751197974528","name":"Diablo III","exe":"diablo iii64.exe"},
        {"id":"358425800766128128","name":"StarCraft II: Battle Chest","exe":"sc2_x64.exe"},
        {"id":"359507724196773888","name":"The Elder Scrolls V: Skyrim","exe":"tesv_original.exe"},
        {"id":"359507798930751488","name":"Tom Clancy's The Division","exe":"thedivision.exe"},
        {"id":"359508004078616586","name":"Don't Starve Together","exe":"don't starve together/bin/dontstarve.exe"},
        {"id":"359508342571401216","name":"ShellShock Live","exe":"shellshocklive.exe"},
        {"id":"359508404034600990","name":"Space Engineers","exe":"spaceengineers.exe"},
        {"id":"359508941782122496","name":"Portal 2","exe":"portal2.exe"},
        {"id":"359509007423242240","name":"The Sims 4","exe":"the sims 4.app"},
        {"id":"359509332490059776","name":"Call of Duty: Black Ops III","exe":"call of duty black ops iii/boiii.exe"},
        {"id":"359509387670192128","name":"Stardew Valley","exe":"stardew valley/stardew valley.exe"},
        {"id":"359509500199436288","name":"DARK SOULS III","exe":"game/darksoulsiii.exe"},
        {"id":"359509666876751872","name":"Counter-Strike: Source","exe":"counter-strike source/hl2.exe"},
        {"id":"359509759642042378","name":"Fallout 4","exe":"fallout4.exe"},
        {"id":"359509858728542208","name":"Fallout: New Vegas","exe":"falloutnv.exe"},
        {"id":"359510095811444736","name":"MapleStory","exe":"maplestory.exe"},
        {"id":"359510249486417920","name":"The Witcher 3: Wild Hunt","exe":"witcher3.exe"},
        {"id":"359510373361254400","name":"Half-Life 2","exe":"hl2.exe"},
        {"id":"359510680459673610","name":"Battlefield 4","exe":"bf4cte.exe"},
        {"id":"359510740878491658","name":"XCOM 2","exe":"xcom2.exe"},
        {"id":"359511228445491200","name":"Guild Wars 2","exe":"gw2.app"},
        {"id":"359801269008859136","name":"The Elder Scrolls V: Skyrim - Special Edition","exe":"skyrim special edition/skyrimse.exe"},
        {"id":"363408634568376320","name":"Outlast","exe":"olgame.exe"},
        {"id":"363408709495291934","name":"Depth","exe":"depthgame.exe"},
        {"id":"363408834095742976","name":"Tabletop Simulator","exe":"tabletop simulator.exe"},
        {"id":"363408909962182683","name":"Stellaris","exe":"stellaris.exe"},
        {"id":"363409000399634432","name":"Trove","exe":"trove.exe"},
        {"id":"363409129643180032","name":"Gang Beasts","exe":"gang beasts.exe"},
        {"id":"363409179668512788","name":"The Forest","exe":"theforest.exe"},
        {"id":"363409417632481280","name":"Europa Universalis IV","exe":"eu4.exe"},
        {"id":"363409453699170304","name":"Town of Salem","exe":"townofsalem.exe"},
        {"id":"363409532480913408","name":"Robocraft","exe":"robocraft.exe"},
        {"id":"363409575321403402","name":"Golf It!","exe":"golfit-win64-shipping.exe"},
        {"id":"363409615620407316","name":"Shadowverse","exe":"shadowverse.exe"},
        {"id":"363409643973771264","name":"7 Days to Die","exe":"7daystodie.exe"},
        {"id":"363409749175173120","name":"Killing Floor 2","exe":"kfgame.exe"},
        {"id":"363409793119158272","name":"StarCraft","exe":"starcraft.exe"},
        {"id":"363409849859571722","name":"UNDERTALE","exe":"undertale.app"},
        {"id":"363411278527594516","name":"Business Tour - Online Multiplayer Board Game","exe":"business tour/businesstour.exe"},
        {"id":"363411364552638464","name":"Fallout Shelter","exe":"falloutshelter.exe"},
        {"id":"363411395854991400","name":"Slime Rancher","exe":"slimerancher.exe"},
        {"id":"363411421553360896","name":"Last Man Standing","exe":"lms.exe"},
        {"id":"363411468441354240","name":"Titanfall 2","exe":"titanfall2.exe"},
        {"id":"363412167934083072","name":"Star Wars Battlefront","exe":"starwarsbattlefront.exe"},
        {"id":"363412302998929418","name":"Mount & Blade: Warband","exe":"mountblade warband/mb_warband.exe"},
        {"id":"363412489599188992","name":"Star Wars: The Old Republic","exe":"swtor.exe"},
        {"id":"363412528308682752","name":"PlanetSide 2","exe":"planetside2_x64.exe"},
        {"id":"363412675650125825","name":"Psychonauts","exe":"psychonauts.exe"},
        {"id":"363412728888557568","name":"Call of Duty: World at War","exe":"codwaw.exe"},
        {"id":"363412799117852672","name":"Crossout","exe":"crossout.exe"},
        {"id":"363412841862266880","name":"Dofus","exe":"dofus.exe"},
        {"id":"363413176605212682","name":"Comedy Night","exe":"comedy night.exe"},
        {"id":"363413202090065920","name":"Enter the Gungeon","exe":"enter the gungeon/etg.exe"},
        {"id":"363413225578037248","name":"Elite: Dangerous","exe":"elitedangerous32.exe"},
        {"id":"363413310474813450","name":"Wizard101","exe":"wizardgraphicalclient.exe"},
        {"id":"363413365667921930","name":"AdVenture Capitalist","exe":"adventure-capitalist.exe"},
        {"id":"363413389021675530","name":"Age of Empires II: HD Edition","exe":"age2_x1.exe"},
        {"id":"363413402300710912","name":"EVE Online","exe":"evelauncher.exe"},
        {"id":"363413452976553984","name":"Heat Signature","exe":"heat_signature.exe"},
        {"id":"363413465584500737","name":"RimWorld","exe":"rimworldwin.exe"},
        {"id":"363413743335374859","name":"BeamNG.drive","exe":"beamng.drive.exe"},
        {"id":"363413834301571072","name":"Sid Meier's Civilization VI","exe":"civilizationvi.exe"},
        {"id":"363413894602948608","name":"The Elder Scrolls Online","exe":"game/client/eso64.exe"},
        {"id":"363413961967927306","name":"DOOM","exe":"doomx64.exe"},
        {"id":"363414030188150801","name":"FTL: Faster Than Light","exe":"ftlgame.exe"},
        {"id":"363414084542005258","name":"Realm of the Mad God","exe":"realm of the mad god.exe"},
        {"id":"363414140502671360","name":"Just Cause 3","exe":"justcause3.exe"},
        {"id":"363414173457186826","name":"Portal","exe":"portal/hl2.exe"},
        {"id":"363414398129274890","name":"FIFA 17","exe":"fifa17.exe"},
        {"id":"363414443129831444","name":"Dragon Ball: Xenoverse 2","exe":"db xenoverse 2/xv2skilcreat.exe"},
        {"id":"363414482615271434","name":"Friday the 13th: The Game","exe":"summercamp.exe"},
        {"id":"363414635812093962","name":"Prison Architect","exe":"prison architect.exe"},
        {"id":"363414667797725184","name":"Tekken 7","exe":"tekkengame-win64-shipping.exe"},
        {"id":"363414712186306560","name":"The Escapists 2","exe":"theescapists2.exe"},
        {"id":"363414742661988352","name":"Crusader Kings II","exe":"ck2game.exe"},
        {"id":"363414852410015744","name":"Microtransaction Simulator","exe":"microtransaction_simulator/microsimulator.exe"},
        {"id":"363424997080956928","name":"Middle-earth: Shadow of Mordor","exe":"shadowofmordor.exe"},
        {"id":"363425113879609344","name":"Metal Gear Solid V: The Phantom Pain","exe":"mgsvmgo.exe"},
        {"id":"363425133274333214","name":"Idle Champions of the Forgotten Realms","exe":"idledragons.exe"},
        {"id":"363425169051615262","name":"HuniePop","exe":"huniepop.exe"},
        {"id":"363425213905371146","name":"Ultimate Chicken Horse","exe":"ultimatechickenhorse.exe"},
        {"id":"363425276300099584","name":"NieR: Automata","exe":"nierautomata.exe"},
        {"id":"363426741269692416","name":"DARK SOULS II: Scholar of the First Sin","exe":"darksoulsii.exe"},
        {"id":"363426802640617482","name":"Total War: Warhammer II","exe":"warhammer2.exe"},
        {"id":"363426862363574272","name":"Skullgirls","exe":"skullgirls.exe"},
        {"id":"363426921612181504","name":"Farming Simulator 17","exe":"farmingsimulator2017game.exe"},
        {"id":"363427044333191169","name":"100% Orange Juice","exe":"100orange.exe"},
        {"id":"363427270024626176","name":"Call of Duty: Black Ops II","exe":"t6mp.exe"},
        {"id":"363427419249442816","name":"Sonic Adventure 2","exe":"sonic adventure 2/sa2modmanager.exe"},
        {"id":"363427574707257354","name":"Dishonored","exe":"dishonored.exe"},
        {"id":"363427674309263360","name":"Sven Co-op","exe":"svencoop.exe"},
        {"id":"363427800088313856","name":"Tower Unite","exe":"tower-win64-shipping.exe"},
        {"id":"363427839137153024","name":"Dying Light","exe":"dyinglightgame.exe"},
        {"id":"363427969324023808","name":"Chivalry: Medieval Warfare","exe":"cmw.exe"},
        {"id":"363428011980357632","name":"Squad","exe":"squad/squadgame/binaries/win64/squadgame.exe"}
    ];

    // 3. State & Storage
    const LS_KEY_UNIQUE = "BadgeFarmer_uniqueGames";
    const LS_KEY_TOTAL = "BadgeFarmer_totalSeconds";
    const LS_KEY_SELECTED = "BadgeFarmer_selectedGameId";

    let uniqueGames = new Set();
    try {
        const stored = JSON.parse(window.localStorage.getItem(LS_KEY_UNIQUE) || "[]");
        if (Array.isArray(stored)) uniqueGames = new Set(stored);
    } catch (_) {}

    let totalSeconds = parseInt(window.localStorage.getItem(LS_KEY_TOTAL) || "0", 10);
    let selectedGameId = window.localStorage.getItem(LS_KEY_SELECTED) || GAMES[3].id; // Dota 2

    let currentMode = "IDLE"; // "IDLE" | "GAME_TIME" | "VARIETY"
    let activeGame = null;
    let sessionStart = null;
    let rotationIntervalSec = 75;
    let rotationIndex = 0;
    let antiAfkActive = false;

    let heartbeatTimer = null;
    let rotationTimer = null;
    let tickerTimer = null;
    let antiAfkTimer = null;

    let originalStoreMethods = {};

    function saveState() {
        try {
            window.localStorage.setItem(LS_KEY_UNIQUE, JSON.stringify(Array.from(uniqueGames)));
            window.localStorage.setItem(LS_KEY_TOTAL, String(totalSeconds));
            window.localStorage.setItem(LS_KEY_SELECTED, selectedGameId);
        } catch (_) {}
    }

    function log(msg) {
        console.log(`%c[BadgeFarmer]%c ${msg}`, "color: #5865f2; font-weight: bold;", "color: #dbdee1;");
    }

    // 4. Store Patching
    function patchRunningGameStore() {
        if (!RunningGameStore || originalStoreMethods.getRunningGames) return;
        originalStoreMethods = {
            getRunningGames: RunningGameStore.getRunningGames,
            getGameForPID: RunningGameStore.getGameForPID,
            getVisibleGame: RunningGameStore.getVisibleGame,
            getVisibleRunningGames: RunningGameStore.getVisibleRunningGames,
            getCandidateGames: RunningGameStore.getCandidateGames,
            getRunningDiscordApplicationIds: RunningGameStore.getRunningDiscordApplicationIds,
            getRunningVerifiedApplicationIds: RunningGameStore.getRunningVerifiedApplicationIds
        };

        RunningGameStore.getRunningGames = () => (activeGame ? [activeGame] : (originalStoreMethods.getRunningGames?.() || []));
        RunningGameStore.getVisibleGame = () => (activeGame || originalStoreMethods.getVisibleGame?.());
        RunningGameStore.getVisibleRunningGames = () => (activeGame ? [activeGame] : (originalStoreMethods.getVisibleRunningGames?.() || []));
        RunningGameStore.getCandidateGames = () => (activeGame ? [activeGame] : (originalStoreMethods.getCandidateGames?.() || []));
        RunningGameStore.getRunningDiscordApplicationIds = () => (activeGame?.id ? [activeGame.id] : (originalStoreMethods.getRunningDiscordApplicationIds?.() || []));
        RunningGameStore.getRunningVerifiedApplicationIds = () => (activeGame?.id ? [activeGame.id] : (originalStoreMethods.getRunningVerifiedApplicationIds?.() || []));
        RunningGameStore.getGameForPID = (pid) => (activeGame && activeGame.pid === pid ? activeGame : originalStoreMethods.getGameForPID?.(pid));
    }

    function unpatchRunningGameStore() {
        if (!RunningGameStore || !originalStoreMethods.getRunningGames) return;
        for (const [k, fn] of Object.entries(originalStoreMethods)) {
            RunningGameStore[k] = fn;
        }
        originalStoreMethods = {};
    }

    // 5. Game Dispatching
    function buildGame(game, startTime) {
        const start = startTime || Date.now();
        const pid = 48000 + Math.floor(Math.random() * 5000);
        const exeClean = (game.exe || "").replace(/^>/, "");
        const exePath = `C:\\Program Files (x86)\\Steam\\steamapps\\common\\${game.name}\\${exeClean}`;
        return {
            id: game.id,
            name: game.name,
            pid,
            pidPath: [pid],
            processName: game.name,
            start,
            lastFocused: Date.now(),
            lastLaunched: start,
            distributor: "steam",
            nativeProcessObserverId: 1,
            exeName: exeClean,
            exePath,
            cmdLine: exePath,
            executables: [{ os: "win32", name: exeClean, is_launcher: false }],
            windowHandle: 1001,
            fullscreenType: 0,
            overlay: true,
            elevated: false,
            sandboxed: false,
            hidden: false,
            isLauncher: false
        };
    }

    function announceGame(game) {
        if (!FluxDispatcher || !game) return;
        FluxDispatcher.dispatch({
            type: "RUNNING_GAMES_CHANGE",
            added: [game],
            removed: [],
            games: [game]
        });

        const activity = {
            application_id: game.id,
            name: game.name,
            type: 0,
            details: null,
            state: null,
            timestamps: { start: game.start },
            assets: null,
            flags: 1
        };

        FluxDispatcher.dispatch({
            type: "LOCAL_ACTIVITY_UPDATE",
            socketId: "BadgeFarmer",
            pid: game.pid,
            activity
        });

        sendGatewayPresence(activity);
    }

    function clearGame(game) {
        if (!FluxDispatcher || !game) return;
        FluxDispatcher.dispatch({
            type: "RUNNING_GAMES_CHANGE",
            added: [],
            removed: [game],
            games: []
        });
        FluxDispatcher.dispatch({
            type: "LOCAL_ACTIVITY_UPDATE",
            socketId: "BadgeFarmer",
            pid: game.pid,
            activity: null
        });
        sendGatewayPresence(null);
    }

    // 6. Farming Controllers
    function startGameTimeFarm(gameId) {
        stopAllFarming(false);
        const target = GAMES.find(g => g.id === (gameId || selectedGameId)) || GAMES[3];
        selectedGameId = target.id;
        currentMode = "GAME_TIME";
        sessionStart = Date.now();
        activeGame = buildGame(target, sessionStart);

        patchRunningGameStore();
        announceGame(activeGame);

        heartbeatTimer = setInterval(() => {
            if (activeGame) announceGame(activeGame);
        }, 30000);

        log(`Farming Game Time: ${target.name}`);
        saveState();
        updateUI();
    }

    function startVarietyRotation(intervalSec) {
        stopAllFarming(false);
        if (typeof intervalSec === "number" && intervalSec >= 5) {
            rotationIntervalSec = intervalSec;
        }
        currentMode = "VARIETY";
        sessionStart = Date.now();
        rotationIndex = 0;

        patchRunningGameStore();
        log(`Started Game Variety rotation (${rotationIntervalSec}s interval)`);
        scheduleNextVariety();
        updateUI();
    }

    function scheduleNextVariety() {
        if (currentMode !== "VARIETY") return;
        const game = GAMES[rotationIndex % GAMES.length];
        activeGame = buildGame(game, Date.now());
        announceGame(activeGame);

        uniqueGames.add(game.id);
        saveState();

        if (uniqueGames.size === 100) {
            log("100 unique games logged. Variety Badge unlocked.");
        }

        rotationIndex = (rotationIndex + 1) % GAMES.length;
        updateUI();

        rotationTimer = setTimeout(scheduleNextVariety, rotationIntervalSec * 1000);
    }

    function stopAllFarming(notify = true) {
        if (rotationTimer) {
            clearTimeout(rotationTimer);
            rotationTimer = null;
        }
        if (heartbeatTimer) {
            clearInterval(heartbeatTimer);
            heartbeatTimer = null;
        }
        if (activeGame) {
            clearGame(activeGame);
            activeGame = null;
        }
        unpatchRunningGameStore();
        currentMode = "IDLE";
        sessionStart = null;
        if (notify) log("Farming stopped.");
        updateUI();
    }

    function startAntiAfk() {
        if (antiAfkTimer) return;
        antiAfkActive = true;
        antiAfkTimer = setInterval(() => {
            if (FluxDispatcher) {
                FluxDispatcher.dispatch({ type: "IDLE", idle: false });
            }
        }, 60000);
        log("Anti-AFK voice keep-alive started.");
        updateUI();
    }

    function stopAntiAfk() {
        if (antiAfkTimer) {
            clearInterval(antiAfkTimer);
            antiAfkTimer = null;
        }
        antiAfkActive = false;
        log("Anti-AFK voice keep-alive stopped.");
        updateUI();
    }

    async function setHypeSquadHouse(houseId) {
        const token = getAuthToken();
        if (!token) {
            log("No auth token available. Log into Discord first.");
            return false;
        }
        try {
            const res = await fetch("/api/v9/hypesquad/online", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": token
                },
                body: JSON.stringify({ house_id: houseId })
            });
            const houseNames = { 1: "House of Bravery", 2: "House of Brilliance", 3: "House of Balance" };
            if (res.ok) {
                log(`Joined ${houseNames[houseId] || "House " + houseId}. Badge updated.`);
                return true;
            } else {
                const err = await res.json().catch(() => ({}));
                log(`Failed to update HypeSquad: ${res.status} ${err.message || ""}`);
                return false;
            }
        } catch (e) {
            log(`Network error updating HypeSquad: ${e.message}`);
            return false;
        }
    }

    async function leaveHypeSquad() {
        const token = getAuthToken();
        if (!token) return false;
        try {
            const res = await fetch("/api/v9/hypesquad/online", {
                method: "DELETE",
                headers: { "Authorization": token }
            });
            if (res.ok) {
                log("Left HypeSquad.");
                return true;
            }
        } catch (e) {
            log(`Error leaving HypeSquad: ${e.message}`);
        }
        return false;
    }

    // Second Ticker
    tickerTimer = setInterval(() => {
        if (currentMode !== "IDLE") {
            totalSeconds += 1;
            if (totalSeconds % 30 === 0) saveState();
            updateLiveTimes();
        }
    }, 1000);

    // 7. In-DOM Floating HUD UI
    const HUD_ID = "badge-farmer-hud";
    let isCollapsed = false;

    function createUI() {
        const existing = document.getElementById(HUD_ID);
        if (existing) existing.remove();

        const container = document.createElement("div");
        container.id = HUD_ID;
        container.style.cssText = `
            position: fixed;
            top: 24px;
            right: 24px;
            width: 320px;
            background: #1e1f22;
            border: 1px solid #313338;
            border-radius: 8px;
            box-shadow: 0 8px 24px rgba(0,0,0,0.5);
            z-index: 1000000;
            font-family: 'gg sans', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            color: #dbdee1;
            font-size: 13px;
            line-height: 1.4;
            user-select: none;
            overflow: hidden;
        `;

        container.innerHTML = `
            <div id="${HUD_ID}-header" style="
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 10px 14px;
                background: #2b2d31;
                border-bottom: 1px solid #383a40;
                cursor: grab;
            ">
                <div style="font-weight: 700; font-size: 11px; letter-spacing: 0.5px; text-transform: uppercase; color: #f2f3f5;">
                    BadgeFarmer
                </div>
                <div style="display: flex; gap: 8px;">
                    <button id="${HUD_ID}-btn-collapse" style="background: none; border: none; color: #949ba4; cursor: pointer; font-size: 12px; padding: 0 4px;">_</button>
                    <button id="${HUD_ID}-btn-close" style="background: none; border: none; color: #949ba4; cursor: pointer; font-size: 12px; padding: 0 4px;">✕</button>
                </div>
            </div>

            <div id="${HUD_ID}-body" style="padding: 14px; display: flex; flex-direction: column; gap: 14px; max-height: 80vh; overflow-y: auto;">
                <!-- Mode & Live Status -->
                <div style="background: #111214; border-radius: 6px; padding: 10px 12px; border: 1px solid #2b2d31;">
                    <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                        <span style="color: #949ba4; font-size: 11px; text-transform: uppercase;">Status</span>
                        <span id="${HUD_ID}-status-mode" style="font-weight: 600; font-size: 11px; color: #f2f3f5;">IDLE</span>
                    </div>
                    <div id="${HUD_ID}-active-game-row" style="display: none; justify-content: space-between; margin-bottom: 4px;">
                        <span style="color: #949ba4; font-size: 11px; text-transform: uppercase;">Game</span>
                        <span id="${HUD_ID}-active-game-name" style="font-weight: 500; font-size: 12px; color: #f2f3f5; text-align: right; max-width: 170px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">-</span>
                    </div>
                    <div style="display: flex; justify-content: space-between;">
                        <span style="color: #949ba4; font-size: 11px; text-transform: uppercase;">Total Farmed</span>
                        <span id="${HUD_ID}-total-farmed" style="font-variant-numeric: tabular-nums; font-weight: 600; font-size: 12px; color: #f2f3f5;">0h 0m</span>
                    </div>
                </div>

                <!-- Section: Game Variety -->
                <div style="display: flex; flex-direction: column; gap: 6px;">
                    <div style="display: flex; justify-content: space-between; align-items: baseline;">
                        <span style="font-size: 12px; font-weight: 600; color: #f2f3f5;">Game Variety (100 Games)</span>
                        <span id="${HUD_ID}-variety-count" style="font-size: 11px; color: #949ba4;">0 / 100</span>
                    </div>
                    <div style="width: 100%; height: 6px; background: #111214; border-radius: 3px; overflow: hidden;">
                        <div id="${HUD_ID}-variety-bar" style="width: 0%; height: 100%; background: #dbdee1; transition: width 0.3s ease;"></div>
                    </div>
                    <div style="display: flex; gap: 8px; margin-top: 4px;">
                        <input id="${HUD_ID}-variety-interval" type="number" min="5" value="${rotationIntervalSec}" title="Rotation Interval (seconds)" style="
                            width: 65px;
                            background: #111214;
                            border: 1px solid #383a40;
                            border-radius: 4px;
                            color: #f2f3f5;
                            padding: 6px;
                            font-size: 12px;
                            text-align: center;
                        "/>
                        <button id="${HUD_ID}-btn-variety" style="
                            flex: 1;
                            background: #2b2d31;
                            border: 1px solid #383a40;
                            border-radius: 4px;
                            color: #f2f3f5;
                            font-weight: 600;
                            font-size: 12px;
                            padding: 6px 12px;
                            cursor: pointer;
                        ">Start Variety</button>
                    </div>
                </div>

                <!-- Section: Game Time -->
                <div style="display: flex; flex-direction: column; gap: 6px;">
                    <span style="font-size: 12px; font-weight: 600; color: #f2f3f5;">Game Time Farming</span>
                    <select id="${HUD_ID}-game-select" style="
                        width: 100%;
                        background: #111214;
                        border: 1px solid #383a40;
                        border-radius: 4px;
                        color: #f2f3f5;
                        padding: 6px;
                        font-size: 12px;
                        cursor: pointer;
                    ">
                        ${GAMES.map(g => `<option value="${g.id}" ${g.id === selectedGameId ? "selected" : ""}>${g.name}</option>`).join("")}
                    </select>
                    <button id="${HUD_ID}-btn-gametime" style="
                        width: 100%;
                        background: #2b2d31;
                        border: 1px solid #383a40;
                        border-radius: 4px;
                        color: #f2f3f5;
                        font-weight: 600;
                        font-size: 12px;
                        padding: 6px 12px;
                        cursor: pointer;
                    ">Start Game Time</button>
                </div>

                <!-- Section: HypeSquad Houses -->
                <div style="display: flex; flex-direction: column; gap: 6px;">
                    <span style="font-size: 12px; font-weight: 600; color: #f2f3f5;">HypeSquad House</span>
                    <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px;">
                        <button id="${HUD_ID}-btn-house-1" style="background: #111214; border: 1px solid #9c84ef; color: #9c84ef; border-radius: 4px; font-size: 11px; padding: 6px 2px; cursor: pointer; font-weight: 600;">Bravery</button>
                        <button id="${HUD_ID}-btn-house-2" style="background: #111214; border: 1px solid #f47b67; color: #f47b67; border-radius: 4px; font-size: 11px; padding: 6px 2px; cursor: pointer; font-weight: 600;">Brilliance</button>
                        <button id="${HUD_ID}-btn-house-3" style="background: #111214; border: 1px solid #45ddc0; color: #45ddc0; border-radius: 4px; font-size: 11px; padding: 6px 2px; cursor: pointer; font-weight: 600;">Balance</button>
                    </div>
                </div>

                <!-- Section: Streaming Anti-AFK -->
                <div style="display: flex; justify-content: space-between; align-items: center; padding-top: 4px; border-top: 1px solid #2b2d31;">
                    <span style="font-size: 12px; color: #f2f3f5;">Anti-AFK Voice Ping</span>
                    <button id="${HUD_ID}-btn-antiafk" style="
                        background: ${antiAfkActive ? "#248046" : "#2b2d31"};
                        border: 1px solid #383a40;
                        border-radius: 4px;
                        color: #f2f3f5;
                        font-size: 11px;
                        padding: 4px 10px;
                        cursor: pointer;
                        font-weight: 600;
                    ">${antiAfkActive ? "ACTIVE" : "OFF"}</button>
                </div>

                <!-- Stop Button (Visible when farming) -->
                <button id="${HUD_ID}-btn-stop" style="
                    display: none;
                    width: 100%;
                    background: #da373c;
                    border: none;
                    border-radius: 4px;
                    color: #fff;
                    font-weight: 600;
                    font-size: 12px;
                    padding: 8px 12px;
                    cursor: pointer;
                ">Stop Farming</button>
            </div>
        `;

        document.body.appendChild(container);

        // Dragging Logic
        const header = document.getElementById(`${HUD_ID}-header`);
        let isDragging = false;
        let startX, startY, initialLeft, initialTop;

        header.addEventListener("mousedown", (e) => {
            if (e.target.tagName === "BUTTON") return;
            isDragging = true;
            header.style.cursor = "grabbing";
            startX = e.clientX;
            startY = e.clientY;
            const rect = container.getBoundingClientRect();
            initialLeft = rect.left;
            initialTop = rect.top;
            container.style.right = "auto";
            container.style.left = `${initialLeft}px`;
            container.style.top = `${initialTop}px`;
        });

        window.addEventListener("mousemove", (e) => {
            if (!isDragging) return;
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            container.style.left = `${Math.max(10, Math.min(window.innerWidth - 330, initialLeft + dx))}px`;
            container.style.top = `${Math.max(10, Math.min(window.innerHeight - 60, initialTop + dy))}px`;
        });

        window.addEventListener("mouseup", () => {
            if (isDragging) {
                isDragging = false;
                header.style.cursor = "grab";
            }
        });

        // Event Listeners
        document.getElementById(`${HUD_ID}-btn-close`).addEventListener("click", () => {
            container.style.display = "none";
            log("HUD hidden. Run BadgeFarmer.showUI() in console to open it.");
        });

        document.getElementById(`${HUD_ID}-btn-collapse`).addEventListener("click", () => {
            const body = document.getElementById(`${HUD_ID}-body`);
            isCollapsed = !isCollapsed;
            body.style.display = isCollapsed ? "none" : "flex";
            document.getElementById(`${HUD_ID}-btn-collapse`).textContent = isCollapsed ? "+" : "_";
        });

        document.getElementById(`${HUD_ID}-btn-variety`).addEventListener("click", () => {
            if (currentMode === "VARIETY") {
                stopAllFarming();
            } else {
                const sec = parseInt(document.getElementById(`${HUD_ID}-variety-interval`).value, 10) || 75;
                startVarietyRotation(sec);
            }
        });

        document.getElementById(`${HUD_ID}-btn-gametime`).addEventListener("click", () => {
            if (currentMode === "GAME_TIME") {
                stopAllFarming();
            } else {
                const gameId = document.getElementById(`${HUD_ID}-game-select`).value;
                startGameTimeFarm(gameId);
            }
        });

        document.getElementById(`${HUD_ID}-game-select`).addEventListener("change", (e) => {
            selectedGameId = e.target.value;
            saveState();
        });

        document.getElementById(`${HUD_ID}-btn-stop`).addEventListener("click", () => {
            stopAllFarming();
        });

        document.getElementById(`${HUD_ID}-btn-antiafk`).addEventListener("click", () => {
            if (antiAfkActive) stopAntiAfk();
            else startAntiAfk();
        });

        document.getElementById(`${HUD_ID}-btn-house-1`).addEventListener("click", () => setHypeSquadHouse(1));
        document.getElementById(`${HUD_ID}-btn-house-2`).addEventListener("click", () => setHypeSquadHouse(2));
        document.getElementById(`${HUD_ID}-btn-house-3`).addEventListener("click", () => setHypeSquadHouse(3));

        updateUI();
    }

    function updateLiveTimes() {
        const totalElem = document.getElementById(`${HUD_ID}-total-farmed`);
        if (totalElem) {
            const hrs = Math.floor(totalSeconds / 3600);
            const mins = Math.floor((totalSeconds % 3600) / 60);
            const secs = totalSeconds % 60;
            totalElem.textContent = hrs > 0 ? `${hrs}h ${mins}m ${secs}s` : `${mins}m ${secs}s`;
        }
    }

    function updateUI() {
        const modeElem = document.getElementById(`${HUD_ID}-status-mode`);
        if (!modeElem) return;

        modeElem.textContent = currentMode;
        modeElem.style.color = currentMode === "IDLE" ? "#949ba4" : "#23a55a";

        const gameRow = document.getElementById(`${HUD_ID}-active-game-row`);
        const gameName = document.getElementById(`${HUD_ID}-active-game-name`);
        if (activeGame) {
            gameRow.style.display = "flex";
            gameName.textContent = activeGame.name;
        } else {
            gameRow.style.display = "none";
        }

        const varietyCount = document.getElementById(`${HUD_ID}-variety-count`);
        const varietyBar = document.getElementById(`${HUD_ID}-variety-bar`);
        if (varietyCount && varietyBar) {
            const count = Math.min(uniqueGames.size, 100);
            varietyCount.textContent = `${uniqueGames.size} / 100`;
            varietyBar.style.width = `${Math.min(100, count)}%`;
        }

        const btnVariety = document.getElementById(`${HUD_ID}-btn-variety`);
        if (btnVariety) {
            btnVariety.textContent = currentMode === "VARIETY" ? "Stop Variety" : "Start Variety";
            btnVariety.style.background = currentMode === "VARIETY" ? "#da373c" : "#2b2d31";
        }

        const btnGameTime = document.getElementById(`${HUD_ID}-btn-gametime`);
        if (btnGameTime) {
            btnGameTime.textContent = currentMode === "GAME_TIME" ? "Stop Game Time" : "Start Game Time";
            btnGameTime.style.background = currentMode === "GAME_TIME" ? "#da373c" : "#2b2d31";
        }

        const btnStop = document.getElementById(`${HUD_ID}-btn-stop`);
        if (btnStop) {
            btnStop.style.display = currentMode !== "IDLE" ? "block" : "none";
        }

        const btnAntiAfk = document.getElementById(`${HUD_ID}-btn-antiafk`);
        if (btnAntiAfk) {
            btnAntiAfk.textContent = antiAfkActive ? "ACTIVE" : "OFF";
            btnAntiAfk.style.background = antiAfkActive ? "#248046" : "#2b2d31";
        }

        updateLiveTimes();
    }

    // 8. Public API for Console Power Users
    window.BadgeFarmer = {
        startVariety: (sec) => startVarietyRotation(sec),
        startGameTime: (identifier) => startGameTimeFarm(identifier),
        stop: () => stopAllFarming(),
        startAntiAfk,
        stopAntiAfk,
        setHypeSquad: (house) => {
            const map = { bravery: 1, brilliance: 2, balance: 3 };
            const id = typeof house === "number" ? house : map[String(house).toLowerCase()] || 1;
            return setHypeSquadHouse(id);
        },
        leaveHypeSquad,
        resetUniqueGames: () => {
            uniqueGames.clear();
            saveState();
            log("Unique games progress reset.");
            updateUI();
        },
        resetTotalTime: () => {
            totalSeconds = 0;
            saveState();
            log("Total farmed time reset.");
            updateUI();
        },
        status: () => ({
            mode: currentMode,
            activeGame: activeGame?.name || null,
            totalSeconds,
            uniqueGamesCount: uniqueGames.size,
            antiAfkActive
        }),
        showUI: () => {
            const container = document.getElementById(HUD_ID);
            if (container) container.style.display = "block";
            else createUI();
        },
        hideUI: () => {
            const container = document.getElementById(HUD_ID);
            if (container) container.style.display = "none";
        },
        destroy: () => {
            stopAllFarming(false);
            stopAntiAfk();
            if (tickerTimer) clearInterval(tickerTimer);
            const container = document.getElementById(HUD_ID);
            if (container) container.remove();
            delete window.BadgeFarmer;
            log("BadgeFarmer destroyed.");
        },
        help: () => {
            console.log(`
BadgeFarmer Console Commands:
  BadgeFarmer.startVariety(intervalSec)  - Rotate verified games (default: 75s)
  BadgeFarmer.startGameTime(gameId/name) - Farm hours on a specific game
  BadgeFarmer.stop()                    - Stop active farming
  BadgeFarmer.startAntiAfk()            - Prevent voice idle disconnects
  BadgeFarmer.stopAntiAfk()             - Stop anti-afk
  BadgeFarmer.setHypeSquad("bravery"|"brilliance"|"balance") - Join house
  BadgeFarmer.leaveHypeSquad()          - Leave house
  BadgeFarmer.resetUniqueGames()        - Reset unique games count
  BadgeFarmer.resetTotalTime()          - Reset tracked time
  BadgeFarmer.showUI() / hideUI()       - Toggle floating HUD
  BadgeFarmer.destroy()                 - Stop all and remove HUD
            `);
        }
    };

    // Initialize UI
    createUI();
    log("Initialized. HUD docked at top-right. Run BadgeFarmer.help() in console for CLI commands.");
})();
