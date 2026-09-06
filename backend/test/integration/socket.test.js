const { test, afterEach } = require("node:test");
const assert = require("node:assert/strict");
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
    assert.deepEqual(snap.state.chat, []);
});

test("chat:send from member B -> A receives chat:message with sender and text", async () => {
    const { port } = await boot();
    const { client: host, roomId } = await createRoom(port, "Host");
    const { client: guest } = await joinRoom(port, roomId, "Bob");

    const msgPromise = waitForEvent(host, "chat:message", (p) => p.senderId === guest.id && p.text === "hey bob");
    guest.emit("chat:send", { text: "hey bob" });
    const msg = await msgPromise;
    assert.equal(msg.senderId, guest.id);
    assert.equal(msg.displayName, "Bob");
    assert.equal(msg.text, "hey bob");
    assert.equal(typeof msg.id, "string");
    assert.equal(typeof msg.sentAt, "number");
});

test("chat:send -> sender B also receives own chat:message", async () => {
    const { port } = await boot();
    const { client: host, roomId } = await createRoom(port, "Host");
    const { client: guest } = await joinRoom(port, roomId, "Bob");

    const selfPromise = waitForEvent(guest, "chat:message", (p) => p.text === "self");
    guest.emit("chat:send", { text: "self" });
    const msg = await selfPromise;
    assert.equal(msg.senderId, guest.id);
    assert.equal(msg.text, "self");
});

test("new joiner after chat -> room:joined state.chat contains earlier message", async () => {
    const { port } = await boot();
    const { roomId } = await createRoom(port, "Host");
    const { client: guest } = await joinRoom(port, roomId, "Bob");
    guest.emit("chat:send", { text: "before join" });
    await waitForEvent(guest, "chat:message", (p) => p.text === "before join");

    const { joined } = await joinRoom(port, roomId, "Carol");
    const chat = joined.state.chat;
    assert.ok(chat.length >= 1);
    assert.equal(chat[0].text, "before join");
});

test("chat:send invalid empty text -> room:error INVALID_PAYLOAD", async () => {
    const { port } = await boot();
    const { client: host } = await createRoom(port, "Host");
    const errPromise = waitForEvent(host, "room:error", (p) => p.code === "INVALID_PAYLOAD");
    host.emit("chat:send", { text: "   " });
    const err = await errPromise;
    assert.equal(err.code, "INVALID_PAYLOAD");
});

test("non-member chat:send -> room:error NOT_IN_ROOM", async () => {
    const { port } = await boot();
    const stranger = track(await connectClient(port));
    const errPromise = waitForEvent(stranger, "room:error", (p) => p.code === "NOT_IN_ROOM");
    stranger.emit("chat:send", { text: "hi" });
    const err = await errPromise;
    assert.equal(err.code, "NOT_IN_ROOM");
});
