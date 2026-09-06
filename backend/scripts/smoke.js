#!/usr/bin/env node
// smoke.js — full-journey end-to-end smoke test for Solace without a frontend.
//
// Simulates two real socket.io clients (host + guest) and walks the complete
// app surface: connect, room lifecycle, wallpaper, playback, title, chat,
// rtc:config, media flags, and rtc relay. Prints PASS/FAIL per step and exits
// non-zero on any failure — CI-friendly.
//
// Usage:
//   Local (spawns its own server on an ephemeral port):
//     node backend/scripts/smoke.js
//   Against a running stack (docker / remote):
//     node backend/scripts/smoke.js http://localhost:8080
//
// Exit codes: 0 = all steps passed, 1 = one or more failures.

const { io: ioc } = require("socket.io-client");
const { startTestServer, connectClient, waitForEvent, closeSocket, closeServer } = require("../test/helpers/startServer");

const url = process.argv[2] || null;
const STEP_TIMEOUT_MS = Number(process.env.SMOKE_STEP_TIMEOUT_MS || 5000);

const steps = [];
const allSockets = [];
let manager = null;

function portOf() {
    if (!url) return manager.port;
    return Number(new URL(url).port || 80);
}

// rtc:config is emitted during the connect handshake, so the listener must be
// bound BEFORE the connect promise resolves (same race the integration suite
// solves by binding pre-connect).
async function connect(name) {
    const socket = ioc(`http://localhost:${portOf()}`, { transports: ["websocket"] });
    allSockets.push(socket);
    // Never leave a dangling rejection: on connect_error the config promise can
    // only fail by timeout later, so convert that outcome into a sentinel the
    // caller converts into a proper step failure.
    const configP = waitForEvent(socket, "rtc:config", (p) => Array.isArray(p.iceServers), STEP_TIMEOUT_MS)
        .catch((err) => ({ __smokeError: err }));
    await new Promise((resolve, reject) => {
        socket.once("connect", resolve);
        socket.once("connect_error", reject);
    });
    return { socket, configP };
}

// Await a config promise produced by connect(): rethrows as a real failure.
async function configOrThrow(configP, label) {
    const maybe = await configP;
    if (maybe && maybe.__smokeError) {
        throw new Error(`${label}: rtc:config never arrived (${maybe.__smokeError.message})`);
    }
    return maybe;
}

function pass(name, detail = "") {
    steps.push({ name, ok: true, detail });
    console.log(`  ✔ ${name}${detail ? `  (${detail})` : ""}`);
}

function fail(name, err) {
    steps.push({ name, ok: false, detail: err && err.message });
    console.error(`  ✖ ${name}  — ${err && err.message}`);
}

async function waitFor(socket, event, predicate, description) {
    return waitForEvent(socket, event, predicate, STEP_TIMEOUT_MS);
}

async function scenario() {
    console.log(`smoke: connecting two clients${url ? ` -> ${url}` : " (local server)"}`);
    const { socket: A, configP: cfgAP } = await connect("Host");
    const { socket: B, configP: cfgBP } = await connect("Guest");

    try {
        // 1. rtc:config on connect (STUN always present)
        console.log("\n[1] transport readiness");
        const cfgA = await configOrThrow(cfgAP, "Host");
        const cfgB = await configOrThrow(cfgBP, "Guest");
        pass("rtc:config present on connect for both clients",
            `${cfgA.iceServers.length} A + ${cfgB.iceServers.length} B ice servers`);

        // 2. host creates room
        console.log("\n[2] room lifecycle");
        const createdP = waitFor(A, "room:created");
        A.emit("room:create", { displayName: "Host" });
        const created = await createdP;
        const roomId = created.roomId;
        pass("host creates room", `roomId=${roomId}`);
        if (created.members.length !== 1 || !created.members[0].isHost) {
            throw new Error(`creator not reflected as sole host member: ${JSON.stringify(created.members)}`);
        }

        // 3. guest joins and sees host
        const joinedP = waitFor(B, "room:joined", (p) => p.members.length === 2);
        B.emit("room:join", { roomId, displayName: "Guest" });
        const joined = await joinedP;
        const hostInSnapshot = joined.members.some((m) => m.isHost && m.socketId === A.id);
        if (!hostInSnapshot) throw new Error("host missing from guest join snapshot");
        pass("guest joins, snapshot has both members + host flag");

        // 4. host sets wallpaper -> guest receives state
        console.log("\n[3] shared state sync");
        const wallP = waitFor(B, "wallpaper:state", (p) => p.url === "http://smoke/1.png");
        A.emit("wallpaper:set", { url: "http://smoke/1.png" });
        const wall = await wallP;
        pass("wallpaper syncs host -> guest", `changedBy=${String(wall.changedBy).slice(0, 8)}…`);

        // 5. host plays track -> guest receives playback state
        const playP = waitFor(B, "playback:state", (p) => p.status === "playing");
        A.emit("playback:play", { track: { url: "http://smoke/track.m3u8", title: "Smoke Track", artist: "Smoke" } });
        await playP;
        pass("playback syncs host -> guest", "status=playing");

        // 6. host sets room title -> guest receives title_state
        const titleP = waitFor(B, "room:title_state", (p) => p.title === "Smoke Room");
        A.emit("room:set_title", { title: "Smoke Room" });
        const title = await titleP;
        if (title.changedBy !== A.id) throw new Error("title_state changedBy is not the host");
        pass("room title syncs host -> guest", `title="${title.title}"`);

        // 7. guest cannot set title -> NOT_HOST error
        const denyP = waitFor(B, "room:error", (p) => p.code === "NOT_HOST");
        B.emit("room:set_title", { title: "sneaky" });
        await denyP;
        pass("non-host title write rejected", "code=NOT_HOST");

        // 8. guest sends chat -> host receives room:activity with chat entry
        console.log("\n[4] chat");
        const chatP = waitFor(A, "room:activity", (p) => p.entry && p.entry.type === "chat" && p.entry.actor.socketId === B.id && p.entry.detail === "hello from smoke");
        B.emit("activity:send", { text: "hello from smoke" });
        const chatAct = await chatP;
        pass("chat syncs guest -> host", `"${chatAct.entry.detail}"`);

        // 9. media flags broadcast
        console.log("\n[5] presence + rtc relay");
        const mediaP = waitFor(B, "rtc:media_state", (p) => p.socketId === A.id && p.audio && p.video);
        A.emit("rtc:media", { audio: true, video: true });
        await mediaP;
        pass("media flags sync host -> guest", "audio=on video=on");

        // 10. timer: start, pause, reset
        const timerP = waitFor(B, "timer:state", (p) => p.status === "running");
        A.emit("timer:start", { minutes: 25 });
        const timerState = await timerP;
        pass("timer start syncs host -> guest", `duration=${timerState.durationMs}ms`);

        const timerPauseP = waitFor(B, "timer:state", (p) => p.status === "paused");
        A.emit("timer:pause");
        await timerPauseP;
        pass("timer pause syncs host -> guest", "status=paused");

        const timerResetP = waitFor(B, "timer:state", (p) => p.status === "idle");
        A.emit("timer:reset");
        await timerResetP;
        pass("timer reset syncs host -> guest", "status=idle");

        // 11. host relays an offer to guest
        const offerP = waitFor(B, "rtc:offer", (p) => p.from === A.id && p.sdp === "v=0 smoke-offer");
        A.emit("rtc:offer", { to: B.id, sdp: "v=0 smoke-offer" });
        const relayed = await offerP;
        pass("rtc:offer relayed host -> guest", `from=${relayed.from.slice(0, 8)}… sdp=${relayed.sdp}`);

        // 12. late snapshot: get_state reflects title from a third observer
        // (room:get_state round-trip — exercises full state serialization)
        const { socket: observer } = await connect("Observer");
        const obJoinedP = waitFor(observer, "room:joined", (p) => p.state && p.state.title === "Smoke Room");
        observer.emit("room:join", { roomId, displayName: "Observer" });
        await obJoinedP;
        await closeSocket(observer);
        pass("late joiner snapshot carries room title", "state.title=Smoke Room");

        console.log(`\nsmoke: ${steps.filter((s) => s.ok).length}/${steps.length} steps passed`);
        return steps.every((s) => s.ok);
    } finally {
        await closeSocket(A);
        await closeSocket(B);
    }
}

(async () => {
    if (!url) {
        manager = await startTestServer();
    }
    let ok = false;
    try {
        ok = await scenario();
    } catch (err) {
        fail("scenario", err);
        console.error(`\nsmoke: ABORTED after ${steps.filter((s) => s.ok).length} passes — ${err.message}`);
        ok = false;
    } finally {
        for (const s of allSockets) {
            await closeSocket(s);
        }
        if (manager) {
            await closeServer(manager.server);
            if (manager.io) manager.io.close();
        }
    }
    if (ok) {
        console.log("smoke: PASS");
    } else {
        console.error("smoke: FAIL");
        console.error("failed steps:");
        steps.filter((s) => !s.ok).forEach((s) => console.error(`  - ${s.name}`));
        // Force exit: socket.io clients keep reconnect timers alive after a
        // connection failure, which would otherwise hang the process.
        process.exit(1);
    }
})();