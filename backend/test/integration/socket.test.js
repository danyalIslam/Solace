const { test, afterEach, describe } = require("node:test");
const assert = require("node:assert/strict");
const { io: ioc } = require("socket.io-client");
const {
    startTestServer,
    connectClient,
    waitForEvent,
    closeSocket,
    closeServer
} = require("../helpers/startServer");

const state = {
    server: null,
    sockets: []
};

async function boot() {
    const { server, port, io } = await startTestServer();
    state.server = { server, io };
    return { server, port, io };
}

function track(socket) {
    state.sockets.push(socket);
    return socket;
}

async function createRoom(port, name = "Host") {
    const client = track(await connectClient(port));
    const createdPromise = waitForEvent(client, "room:created");
    client.emit("room:create", { displayName: name });
    const created = await createdPromise;
    state.lastRoomId = created.roomId;
    return { client, roomId: created.roomId, created };
}

async function joinRoom(port, roomId, name = "Guest") {
    const client = track(await connectClient(port));
    const joinedPromise = waitForEvent(client, "room:joined");
    client.emit("room:join", { roomId, displayName: name });
    const joined = await joinedPromise;
    return { client, joined };
}

afterEach(async () => {
    for (const s of state.sockets) {
        await closeSocket(s);
    }
    state.sockets = [];
    if (state.server) {
        await closeServer(state.server.server);
        if (state.server.io) state.server.io.close();
        state.server = null;
    }
});

test("create room -> room:created with valid 6-char roomId and creator in members", async () => {
    const { port } = await boot();
    const { roomId, created } = await createRoom(port);
    assert.equal(roomId.length, 6);
    assert.ok(!/[01IO]/.test(roomId), `roomId '${roomId}' contains ambiguous char`);
    assert.equal(created.members.length, 1);
    assert.equal(created.members[0].displayName, "Host");
    assert.equal(created.members[0].isHost, true);
    assert.equal(created.state.playback.status, "paused");
});

test("second client joins -> room:joined with 2 members and creator gets room:member_joined", async () => {
    const { port } = await boot();
    const { client: host, roomId } = await createRoom(port, "Host");
    const { client: guest, joined } = await joinRoom(port, roomId, "Guest");

    assert.equal(joined.members.length, 2);
    const names = joined.members.map((m) => m.displayName).sort();
    assert.deepEqual(names, ["Guest", "Host"]);

    const memberJoined = await waitForEvent(host, "room:member_joined", (p) => p.member && p.member.displayName === "Guest");
    assert.equal(memberJoined.member.isHost, false);
});

test("wallpaper:set -> member receives wallpaper:state with url and changedBy", async () => {
    const { port } = await boot();
    const { client: host, roomId } = await createRoom(port, "Host");
    const { client: guest } = await joinRoom(port, roomId, "Guest");

    const wallpaperPromise = waitForEvent(guest, "wallpaper:state", (p) => p.url === "http://wall/1.png");
    host.emit("wallpaper:set", { url: "http://wall/1.png" });
    const ws = await wallpaperPromise;
    assert.equal(ws.url, "http://wall/1.png");
    assert.equal(typeof ws.changedBy, "string");
});

test("playback:play with track -> member receives playback:state playing", async () => {
    const { port } = await boot();
    const { client: host, roomId } = await createRoom(port, "Host");
    const { client: guest } = await joinRoom(port, roomId, "Guest");

    const statePromise = waitForEvent(guest, "playback:state", (p) => p.status === "playing");
    host.emit("playback:play", { track: { url: "http://track/1" } });
    const ps = await statePromise;
    assert.equal(ps.status, "playing");
    assert.deepEqual(ps.track, { url: "http://track/1" });
    assert.equal(typeof ps.changedBy, "string");
    assert.ok(ps.updatedAt > 0);
});

test("playback:pause -> member receives paused", async () => {
    const { port } = await boot();
    const { client: host, roomId } = await createRoom(port, "Host");
    const { client: guest } = await joinRoom(port, roomId, "Guest");

    host.emit("playback:play", { track: { url: "http://t" } });
    await waitForEvent(host, "playback:state", (p) => p.status === "playing");

    const pausedPromise = waitForEvent(guest, "playback:state", (p) => p.status === "paused");
    host.emit("playback:pause");
    const ps = await pausedPromise;
    assert.equal(ps.status, "paused");
});

test("playback:seek -> member receives position", async () => {
    const { port } = await boot();
    const { client: host, roomId } = await createRoom(port, "Host");
    const { client: guest } = await joinRoom(port, roomId, "Guest");

    host.emit("playback:play", { track: { url: "http://t" } });
    await waitForEvent(host, "playback:state", (p) => p.status === "playing");

    const seekPromise = waitForEvent(guest, "playback:state", (p) => p.position === 73);
    host.emit("playback:seek", { position: 73 });
    const ps = await seekPromise;
    assert.equal(ps.position, 73);
    assert.equal(ps.status, "playing");
});

test("playback:set_track -> stays paused", async () => {
    const { port } = await boot();
    const { client: host, roomId } = await createRoom(port, "Host");
    const { client: guest } = await joinRoom(port, roomId, "Guest");

    const setTrackPromise = waitForEvent(guest, "playback:state", (p) => p.track && p.track.url === "http://t2");
    host.emit("playback:set_track", { track: { url: "http://t2" } });
    const ps = await setTrackPromise;
    assert.equal(ps.status, "paused");
});

test("5th client join -> room:error ROOM_FULL", async () => {
    const { port } = await boot();
    await createRoom(port, "Host");
    const roomId = state.lastRoomId;
    for (let i = 1; i <= 3; i++) {
        await joinRoom(port, roomId, "G" + i);
    }
    const fifth = track(await connectClient(port));
    const errPromise = waitForEvent(fifth, "room:error", (p) => p.code === "ROOM_FULL");
    fifth.emit("room:join", { roomId, displayName: "Full" });
    const err = await errPromise;
    assert.equal(err.code, "ROOM_FULL");
});

test("non-member mutation -> NOT_IN_ROOM", async () => {
    const { port } = await boot();
    const stranger = track(await connectClient(port));
    const errPromise = waitForEvent(stranger, "room:error", (p) => p.code === "NOT_IN_ROOM");
    stranger.emit("playback:play", { track: { url: "http://t" } });
    const err = await errPromise;
    assert.equal(err.code, "NOT_IN_ROOM");
});

test("invalid payload (seek -5) -> INVALID_PAYLOAD", async () => {
    const { port } = await boot();
    const { client: host } = await createRoom(port, "Host");
    const errPromise = waitForEvent(host, "room:error", (p) => p.code === "INVALID_PAYLOAD");
    host.emit("playback:seek", { position: -5 });
    const err = await errPromise;
    assert.equal(err.code, "INVALID_PAYLOAD");
});

test("disconnect -> remaining member receives room:member_left", async () => {
    const { port } = await boot();
    const { client: host, roomId } = await createRoom(port, "Host");
    const { client: guest } = await joinRoom(port, roomId, "Guest");
    const guestId = guest.id;

    const leftPromise = waitForEvent(host, "room:member_left", (p) => p.socketId === guestId);
    guest.disconnect();
    const left = await leftPromise;
    assert.equal(left.socketId, guestId);
});

test("room:get_state -> full snapshot", async () => {
    const { port } = await boot();
    const { roomId } = await createRoom(port, "Host");
    const { client: guest } = await joinRoom(port, roomId, "Guest");

    const statePromise = waitForEvent(guest, "room:joined", (p) => p.members && p.members.length === 2);
    guest.emit("room:get_state");
    const snap = await statePromise;
    assert.equal(snap.roomId, roomId);
    assert.equal(snap.members.length, 2);
    assert.equal(snap.state.playback.status, "paused");
    assert.ok(Array.isArray(snap.state.activity));
    assert.ok(snap.state.activity.length >= 2, "activity has system entries from create + join");
});

test("activity:send from member B -> A receives room:activity with chat entry and text", async () => {
    const { port } = await boot();
    const { client: host, roomId } = await createRoom(port, "Host");
    const { client: guest } = await joinRoom(port, roomId, "Bob");

    const msgPromise = waitForEvent(host, "room:activity", (p) => p.entry && p.entry.type === "chat" && p.entry.detail === "hey bob");
    guest.emit("activity:send", { text: "hey bob" });
    const msg = await msgPromise;
    assert.equal(msg.entry.actor.socketId, guest.id);
    assert.equal(msg.entry.actor.displayName, "Bob");
    assert.equal(msg.entry.detail, "hey bob");
    assert.equal(typeof msg.entry.id, "string");
    assert.equal(typeof msg.entry.at, "number");
});

test("activity:send -> sender B also receives own room:activity", async () => {
    const { port } = await boot();
    const { client: host, roomId } = await createRoom(port, "Host");
    const { client: guest } = await joinRoom(port, roomId, "Bob");

    const selfPromise = waitForEvent(guest, "room:activity", (p) => p.entry && p.entry.type === "chat" && p.entry.detail === "self");
    guest.emit("activity:send", { text: "self" });
    const msg = await selfPromise;
    assert.equal(msg.entry.actor.socketId, guest.id);
    assert.equal(msg.entry.detail, "self");
});

test("new joiner after chat -> room:joined state.activity contains earlier chat entry", async () => {
    const { port } = await boot();
    const { roomId } = await createRoom(port, "Host");
    const { client: guest } = await joinRoom(port, roomId, "Bob");
    guest.emit("activity:send", { text: "before join" });
    await waitForEvent(guest, "room:activity", (p) => p.entry && p.entry.type === "chat" && p.entry.detail === "before join");

    const { joined } = await joinRoom(port, roomId, "Carol");
    const act = joined.state.activity;
    const chatEntry = act.find((e) => e.type === "chat");
    assert.ok(chatEntry, "chat entry present in activity");
    assert.equal(chatEntry.detail, "before join");
});

test("activity:send invalid empty text -> room:error INVALID_PAYLOAD", async () => {
    const { port } = await boot();
    const { client: host } = await createRoom(port, "Host");
    const errPromise = waitForEvent(host, "room:error", (p) => p.code === "INVALID_PAYLOAD");
    host.emit("activity:send", { text: "   " });
    const err = await errPromise;
    assert.equal(err.code, "INVALID_PAYLOAD");
});

test("non-member activity:send -> room:error NOT_IN_ROOM", async () => {
    const { port } = await boot();
    const stranger = track(await connectClient(port));
    const errPromise = waitForEvent(stranger, "room:error", (p) => p.code === "NOT_IN_ROOM");
    stranger.emit("activity:send", { text: "hi" });
    const err = await errPromise;
    assert.equal(err.code, "NOT_IN_ROOM");
});

describe("WebRTC relay + media presence", () => {
    test("rtc:config arrives with STUN on connect", async () => {
        const { port } = await boot();
        const socket = ioc(`http://localhost:${port}`, { transports: ["websocket"] });
        const cfgP = new Promise((resolve) => socket.once("rtc:config", resolve));
        await new Promise((resolve, reject) => {
            const onConnect = () => {
                socket.off("connect_error", onError);
                resolve();
            };
            const onError = (e) => {
                socket.off("connect", onConnect);
                reject(e);
            };
            socket.once("connect_error", onError);
            socket.once("connect", onConnect);
        });
        track(socket);
        const cfg = await cfgP;
        assert.ok(cfg.iceServers.length >= 1);
        assert.match(cfg.iceServers[0].urls[0], /^stun:/);
    });

    test("offer relays A -> B with from envelope", async () => {
        const { port } = await boot();
        const { client: A, roomId } = await createRoom(port, "Host");
        const { client: B } = await joinRoom(port, roomId, "Bravo");
        const offerP = waitForEvent(B, "rtc:offer");
        A.emit("rtc:offer", { to: B.id, sdp: "v=0 fake-offer" });
        const env = await offerP;
        assert.equal(env.from, A.id);
        assert.equal(env.sdp, "v=0 fake-offer");
    });

    test("answer relays B -> A", async () => {
        const { port } = await boot();
        const { client: A, roomId } = await createRoom(port, "Host");
        const { client: B } = await joinRoom(port, roomId, "Bravo");
        const answerP = waitForEvent(A, "rtc:answer");
        B.emit("rtc:answer", { to: A.id, sdp: "v=0 fake-answer" });
        const env = await answerP;
        assert.equal(env.from, B.id);
        assert.equal(env.sdp, "v=0 fake-answer");
    });

    test("ice relays candidate", async () => {
        const { port } = await boot();
        const { client: A, roomId } = await createRoom(port, "Host");
        const { client: B } = await joinRoom(port, roomId, "Bravo");
        const iceP = waitForEvent(B, "rtc:ice");
        A.emit("rtc:ice", { to: B.id, candidate: "candidate:1 1 udp 2122260223 1.2.3.4 5000 typ host" });
        const env = await iceP;
        assert.equal(env.from, A.id);
        assert.match(env.candidate, /^candidate:/);
    });

    test("relay to non-member target -> TARGET_NOT_IN_ROOM", async () => {
        const { port } = await boot();
        const { client: A, roomId } = await createRoom(port, "Host");
        await joinRoom(port, roomId, "Bravo");
        const errP = waitForEvent(A, "room:error", (p) => p.code === "TARGET_NOT_IN_ROOM");
        A.emit("rtc:offer", { to: "ghost-socket", sdp: "v=0" });
        const err = await errP;
        assert.equal(err.code, "TARGET_NOT_IN_ROOM");
    });

    test("media broadcast reaches room incl. flags", async () => {
        const { port } = await boot();
        const { client: A, roomId } = await createRoom(port, "Host");
        const { client: B } = await joinRoom(port, roomId, "Bravo");
        const mediaP = waitForEvent(B, "rtc:media_state");
        A.emit("rtc:media", { audio: true, video: true });
        const st = await mediaP;
        assert.equal(st.socketId, A.id);
        assert.equal(st.audio, true);
        assert.equal(st.video, true);
    });

    test("media flags visible in room:joined snapshot for late joiner", async () => {
        const { port } = await boot();
        const { client: A, roomId } = await createRoom(port, "Host");
        A.emit("rtc:media", { audio: true, video: false });
        await waitForEvent(A, "rtc:media_state");
        const { joined } = await joinRoom(port, roomId, "Bravo");
        const host = joined.members.find((m) => m.socketId === A.id);
        assert.equal(host.audioOn, true);
        assert.equal(host.videoOn, false);
    });
});

describe("activity", () => {
    test("activity:send -> room:activity broadcast with chat entry to both members", async () => {
        const { port } = await boot();
        const { client: host, roomId } = await createRoom(port, "Host");
        const { client: guest } = await joinRoom(port, roomId, "Guest");

        const guestP = waitForEvent(guest, "room:activity", (p) => p.entry && p.entry.type === "chat");
        const hostP = waitForEvent(host, "room:activity", (p) => p.entry && p.entry.type === "chat");
        host.emit("activity:send", { text: "hey room" });
        const g = await guestP;
        const h = await hostP;
        assert.equal(g.entry.detail, "hey room");
        assert.equal(g.entry.actor.displayName, "Host");
        assert.equal(h.entry.detail, "hey room");
    });

    test("join produces system entry visible to late joiner snapshot", async () => {
        const { port } = await boot();
        const { client: host, roomId } = await createRoom(port, "Host");
        const { client: guest, joined } = await joinRoom(port, roomId, "Guest");
        const sys = await waitForEvent(host, "room:activity", (p) => p.entry && p.entry.type === "system");
        assert.ok(sys.entry.detail.length > 0);
        assert.ok(joined.state.activity.length >= 1, "late joiner sees prior activity");
    });
});

describe("timer", () => {
    test("timer:start -> timer:state broadcast with status running", async () => {
        const { port } = await boot();
        const { client: host, roomId } = await createRoom(port, "Host");
        const { client: guest } = await joinRoom(port, roomId, "Guest");

        const stP = waitForEvent(guest, "timer:state", (p) => p.status === "running");
        host.emit("timer:start", { minutes: 25 });
        const st = await stP;
        assert.equal(st.durationMs, 25 * 60_000);
        assert.equal(typeof st.endsAt, "number");

        // Never leave an armed timer behind: the service schedules a real
        // setTimeout for the countdown, which would keep the event loop alive
        // (and the test process hanging) after the suite finishes.
        const resetP = waitForEvent(host, "timer:state", (p) => p.status === "idle");
        host.emit("timer:reset");
        await resetP;
    });

    test("timer:start invalid minutes -> room:error INVALID_PAYLOAD", async () => {
        const { port } = await boot();
        const { client: host } = await createRoom(port, "Host");
        const errP = waitForEvent(host, "room:error", (p) => p.code === "INVALID_PAYLOAD");
        host.emit("timer:start", { minutes: 999 });
        const err = await errP;
        assert.equal(err.code, "INVALID_PAYLOAD");
    });

    test("timer:start from a socket not in any room -> room:error NOT_IN_ROOM", async () => {
        const { port } = await boot();
        const standalone = track(await connectClient(port));
        const errP = waitForEvent(standalone, "room:error", (p) => p.code === "NOT_IN_ROOM");
        standalone.emit("timer:start", { minutes: 5 });
        const err = await errP;
        assert.equal(err.code, "NOT_IN_ROOM");
    });
});

describe("room title", () => {
    test("host sets title -> room:title_state broadcast to guest with changedBy", async () => {
        const { port } = await boot();
        const { client: host, roomId } = await createRoom(port, "Host");
        const { client: guest } = await joinRoom(port, roomId, "Guest");

        const titleP = waitForEvent(guest, "room:title_state");
        host.emit("room:set_title", { title: "Cozy Corner" });
        const st = await titleP;
        assert.equal(st.title, "Cozy Corner");
        assert.equal(st.changedBy, host.id);
        assert.equal(typeof st.updatedAt, "number");
    });

    test("title visible in late joiner room:joined snapshot", async () => {
        const { port } = await boot();
        const { client: host, roomId } = await createRoom(port, "Host");
        host.emit("room:set_title", { title: "Lofi Night" });
        await waitForEvent(host, "room:title_state");
        const { joined } = await joinRoom(port, roomId, "Guest");
        assert.equal(joined.state.title, "Lofi Night");
    });

    test("non-host set_title -> room:error NOT_HOST", async () => {
        const { port } = await boot();
        const { client: host, roomId } = await createRoom(port, "Host");
        const { client: guest } = await joinRoom(port, roomId, "Guest");

        const errP = waitForEvent(guest, "room:error", (p) => p.code === "NOT_HOST");
        guest.emit("room:set_title", { title: "sneaky" });
        const err = await errP;
        assert.equal(err.code, "NOT_HOST");
        assert.equal(host.connected, true);
    });
});

describe("activity entries from actions", () => {
    test("wallpaper set produces a wallpaper-type entry", async () => {
        const { port } = await boot();
        const { client: host, roomId } = await createRoom(port, "Host");
        host.emit("wallpaper:set", { url: "http://w/1.png" });
        await waitForEvent(host, "wallpaper:state");
        const { joined } = await joinRoom(port, roomId, "Obs");
        const entry = joined.state.activity.find((e) => e.type === "wallpaper");
        assert.ok(entry, "wallpaper entry present");
        assert.match(entry.detail, /wallpaper/i);
    });

    test("title set produces a title-type entry", async () => {
        const { port } = await boot();
        const { client: host, roomId } = await createRoom(port, "Host");
        host.emit("room:set_title", { title: "My Room" });
        await waitForEvent(host, "room:title_state");
        const { joined } = await joinRoom(port, roomId, "Obs");
        const entry = joined.state.activity.find((e) => e.type === "title");
        assert.ok(entry, "title entry present");
        assert.match(entry.detail, /My Room/);
    });

    test("media change produces a media-type entry", async () => {
        const { port } = await boot();
        const { client: host, roomId } = await createRoom(port, "Host");
        host.emit("rtc:media", { audio: true, video: false });
        await waitForEvent(host, "rtc:media_state");
        const { joined } = await joinRoom(port, roomId, "Obs");
        const entry = joined.state.activity.find((e) => e.type === "media");
        assert.ok(entry, "media entry present");
    });

    test("playback play produces a playback-type entry", async () => {
        const { port } = await boot();
        const { client: host, roomId } = await createRoom(port, "Host");
        host.emit("playback:play", { track: { url: "http://t/x.m3u8", title: "T", artist: "A" } });
        await waitForEvent(host, "playback:state", (p) => p.status === "playing");
        const { joined } = await joinRoom(port, roomId, "Obs");
        const entry = joined.state.activity.find((e) => e.type === "playback");
        assert.ok(entry, "playback entry present");
    });

    test("set_track with null track does not crash (produces playback entry)", async () => {
        const { port } = await boot();
        const { client: host, roomId } = await createRoom(port, "Host");
        host.emit("playback:set_track", { track: null });
        await waitForEvent(host, "playback:state");
        const { joined } = await joinRoom(port, roomId, "Obs");
        const entry = joined.state.activity.find((e) => e.type === "playback");
        assert.ok(entry, "playback entry present");
        assert.equal(entry.detail, "cleared track");
    });
});

describe("wallpaper kind + upload library wire", () => {
    test("wallpaper:set with kind video broadcasts kind to both members", async () => {
        const { port } = await boot();
        const { client: host, roomId } = await createRoom(port, "Host");
        const { client: guest } = await joinRoom(port, roomId, "Guest");
        const hostP = waitForEvent(host, "wallpaper:state", (p) => p.url === "http://smoke/live.webm");
        const guestP = waitForEvent(guest, "wallpaper:state", (p) => p.url === "http://smoke/live.webm");
        host.emit("wallpaper:set", { url: "http://smoke/live.webm", kind: "video" });
        const [h, g] = [await hostP, await guestP];
        assert.equal(h.kind, "video");
        assert.equal(g.kind, "video");
        assert.equal(typeof h.updatedAt, "number");
    });

    test("activity entry detail is video-aware", async () => {
        const { port } = await boot();
        const { client: host } = await createRoom(port, "Host");
        const actP = waitForEvent(host, "room:activity", (p) => p.entry && p.entry.type === "wallpaper");
        host.emit("wallpaper:set", { url: "http://smoke/live.webm", kind: "video" });
        const act = await actP;
        assert.equal(act.entry.detail, "set video wallpaper http://smoke/live.webm");
    });
});
