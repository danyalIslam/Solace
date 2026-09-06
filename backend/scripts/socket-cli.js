#!/usr/bin/env node
// socket-cli.js — manual interactive socket.io tester for the Solace backend.
//
// Usage:
//   Local dev (backend on port 8080):
//     node backend/scripts/socket-cli.js
//     node backend/scripts/socket-cli.js http://localhost:8080 Alice
//
//   From repo root, with a fresh server:
//     PORT=8080 node backend/src/server.js &
//     node backend/scripts/socket-cli.js http://localhost:8080
//
//   Docker (container publishes 8080):
//     node backend/scripts/socket-cli.js http://localhost:8080
//     docker exec -it <backend-container> node scripts/socket-cli.js

const readline = require("readline");

let io;
try {
    ({ io } = require("socket.io-client"));
} catch (e) {
    ({ io } = require("../node_modules/socket.io-client"));
}

const url = process.argv[2] || "http://localhost:8080";
const displayName = process.argv[3] || `Tester-${Math.floor(1000 + Math.random() * 9000)}`;

const socket = io(url);

const SERVER_EVENTS = [
    "room:created",
    "room:joined",
    "room:member_joined",
    "room:member_left",
    "room:error",
    "room:title_state",
    "playback:state",
    "wallpaper:state",
    "chat:message",
    "rtc:config",
    "rtc:media_state",
    "rtc:offer",
    "rtc:answer",
    "rtc:ice",
];

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "solace> ",
});

let connected = false;
let cmdQueue = [];
let quitting = false;
let exitTimer = null;

const EXIT_SETTLE_MS = 600;

function safePrompt() {
    if (!quitting && !rl.closed) rl.prompt();
}

// Piped stdout writes are async; process.exit() would drop them. Wait until
// the stream is flushed before exiting.
function endWhenFlushed() {
    if (process.stdout.writableLength === 0) process.exit(0);
    setTimeout(endWhenFlushed, 20);
}

// Close after a settle window so responses to already-emitted events land.
function closeAfterSettle() {
    socket.close();
    endWhenFlushed();
}

function quitGraceful() {
    quitting = true;
    rl.close();
    // If not connected yet, the connect handler drains the queue, then
    // schedules closeAfterSettle. Fallback in case the server never answers.
    if (!connected) {
        exitTimer = setTimeout(closeAfterSettle, 2000);
        return;
    }
    setTimeout(closeAfterSettle, EXIT_SETTLE_MS);
}

// Print every inbound server event.
SERVER_EVENTS.forEach((event) => {
    socket.on(event, (data) => {
        console.log(`[${event}] ${JSON.stringify(data, null, 2)}`);
        safePrompt();
    });
});

socket.on("connect", () => {
    connected = true;
    console.log(`Connected as ${displayName} :: ${socket.id}`);
    while (cmdQueue.length > 0) handleCommand(cmdQueue.shift());
    if (quitting) {
        clearTimeout(exitTimer);
        setTimeout(closeAfterSettle, EXIT_SETTLE_MS);
        return;
    }
    safePrompt();
});

socket.on("connect_error", (err) => {
    console.log(`[connect_error] ${err.message}`);
    safePrompt();
});

function emit(event, payload = {}) {
    console.log(`→ ${event} ${JSON.stringify(payload)}`);
    socket.emit(event, payload);
}

function handleCommand(line) {
    const trimmed = line.trim();
    if (!trimmed) {
        safePrompt();
        return;
    }

    const [cmd, ...rest] = trimmed.split(/\s+/);
    const arg0 = rest[0];

    switch (cmd) {
        case "help":
            console.log(
                [
                    "Commands:",
                    "  help                 — show this list",
                    "  create               — room:create",
                    "  join <roomId>        — room:join",
                    "  leave                — room:leave",
                    "  state                — room:get_state",
                    "  play [trackUrl]      — playback:play (resume if no url)",
                    "  pause                — playback:pause",
                    "  seek <seconds>       — playback:seek",
                    "  track <trackUrl>     — playback:set_track",
                    "  wall <url>           — wallpaper:set",
                    "  title <text>         — room:set_title (host only)",
                    "  say <text>           — chat:send",
                    "  media <on|off>       — rtc:media { audio, video }",
                    "  offer <targetId> <sdp> — rtc:offer relay",
                    "  quit / exit          — disconnect + exit",
                ].join("\n")
            );
            break;

        case "create":
            emit("room:create", { displayName });
            break;

        case "join":
            if (!arg0) {
                console.log("Usage: join <roomId>");
                break;
            }
            emit("room:join", { roomId: arg0, displayName });
            break;

        case "leave":
            emit("room:leave");
            break;

        case "state":
            emit("room:get_state");
            break;

        case "play":
            if (arg0) {
                emit("playback:play", {
                    track: { url: arg0, title: "Lofi " + arg0.slice(-8), artist: "Tester" },
                });
            } else {
                emit("playback:play", {});
            }
            break;

        case "pause":
            emit("playback:pause");
            break;

        case "seek":
            if (!arg0 || Number.isNaN(Number(arg0))) {
                console.log("Usage: seek <seconds>");
                break;
            }
            emit("playback:seek", { position: Number(arg0) });
            break;

        case "track":
            if (!arg0) {
                console.log("Usage: track <trackUrl>");
                break;
            }
            emit("playback:set_track", { track: { url: arg0 } });
            break;

        case "wall":
            if (!arg0) {
                console.log("Usage: wall <url>");
                break;
            }
            emit("wallpaper:set", { url: arg0 });
            break;

        case "title":
            if (rest.length === 0) {
                console.log("Usage: title <text>");
                break;
            }
            emit("room:set_title", { title: rest.join(" ") });
            break;

        case "say":
            if (rest.length === 0) {
                console.log("Usage: say <text>");
                break;
            }
            emit("chat:send", { text: rest.join(" ") });
            break;

        case "media": {
            const arg = rest[0];
            if (arg !== "on" && arg !== "off") {
                console.log("Usage: media <on|off>");
                break;
            }
            const v = arg === "on";
            emit("rtc:media", { audio: v, video: v });
            break;
        }

        case "offer": {
            const to = rest[1];
            const sdp = rest[2];
            if (!to || !sdp) {
                console.log("Usage: offer <targetId> <sdp>");
                break;
            }
            emit("rtc:offer", { to, sdp });
            break;
        }

        case "quit":
        case "exit":
            quitGraceful();
            return;

        default:
            console.log("Unknown. Try 'help'.");
    }

    safePrompt();
}

rl.on("line", (line) => {
    const trimmed = line.trim();
    if (trimmed === "quit" || trimmed === "exit") {
        quitGraceful();
        return;
    }
    if (!connected) {
        cmdQueue.push(trimmed);
        return;
    }
    handleCommand(trimmed);
});

rl.on("SIGINT", () => {
    quitGraceful();
});

rl.prompt();