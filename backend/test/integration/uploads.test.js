const { test, afterEach, describe } = require("node:test");
const assert = require("node:assert/strict");
const {
    startTestServer,
    connectClient,
    waitForEvent,
    closeSocket,
    closeServer
} = require("../helpers/startServer");

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
const MP4 = Buffer.concat([Buffer.alloc(4), Buffer.from("ftypmp42"), Buffer.alloc(128)]);
const TEXT = Buffer.from("definitely not media");
const BIG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(20 * 1024 * 1024)]);

async function upload(port, roomId, fileBuffer, fileName) {
    const form = new FormData();
    form.append("roomId", roomId);
    form.append("file", new Blob([fileBuffer]), fileName);
    const res = await fetch(`http://127.0.0.1:${port}/uploads`, { method: "POST", body: form });
    let body = null;
    try { body = await res.json(); } catch {}
    return { status: res.status, body };
}

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

describe("uploads", () => {
    test("uploads an image and broadcasts library to the room", async () => {
        const { port } = await boot();
        const { client: host, roomId } = await createRoom(port, "Host");
        const libP = waitForEvent(host, "wallpaper:uploads", (p) => p.uploads && p.uploads.length === 1);
        const res = await upload(port, roomId, PNG, "wall.png");
        const lib = await libP;
        assert.equal(res.status, 201);
        assert.equal(res.body.kind, "image");
        assert.ok(res.body.url.startsWith("/uploads/"));
        assert.equal(lib.uploads[0].url, res.body.url);
        assert.equal(lib.uploads[0].originalName, "wall.png");
    });

    test("uploads a video file", async () => {
        const { port } = await boot();
        const { roomId } = await createRoom(port, "Host");
        const res = await upload(port, roomId, MP4, "loop.mp4");
        assert.equal(res.status, 201);
        assert.equal(res.body.kind, "video");
    });

    test("rejects non-media bytes with 415", async () => {
        const { port } = await boot();
        const { roomId } = await createRoom(port, "Host");
        const res = await upload(port, roomId, TEXT, "fake.png");
        assert.equal(res.status, 415);
    });

    test("rejects oversized file with 413", async () => {
        const { port } = await boot();
        const { roomId } = await createRoom(port, "Host");
        const res = await upload(port, roomId, BIG, "big.png");
        assert.equal(res.status, 413);
    });

    test("rejects unknown room with 404", async () => {
        const { port } = await boot();
        await createRoom(port, "Host");
        const res = await upload(port, "ZZZZZZ", PNG, "nope.png");
        assert.equal(res.status, 404);
    });

    test("evicts oldest non-active upload on 4th entry", async () => {
        const { port } = await boot();
        const { client: host, roomId } = await createRoom(port, "Host");
        const a = await upload(port, roomId, PNG, "a.png");
        await upload(port, roomId, PNG, "b.png");
        await upload(port, roomId, PNG, "c.png");
        const waitP = waitForEvent(host, "wallpaper:uploads", (p) => p.uploads && p.uploads.length === 3 && !p.uploads.some((u) => u.url === a.body.url));
        const d = await upload(port, roomId, PNG, "d.png");
        const lib = await waitP;
        assert.equal(d.status, 201);
        assert.equal(lib.uploads.length, 3);
        assert.ok(!lib.uploads.some((u) => u.url === a.body.url), "oldest evicted");
    });

    test("keeps active wallpaper upload during eviction", async () => {
        const { port } = await boot();
        const { client: host, roomId } = await createRoom(port, "Host");
        const active = await upload(port, roomId, PNG, "active.png");
        const wsP = waitForEvent(host, "wallpaper:state", (p) => p.url === active.body.url);
        host.emit("wallpaper:set", { url: active.body.url, kind: "image" });
        await wsP;
        await upload(port, roomId, PNG, "b.png");
        await upload(port, roomId, PNG, "c.png");
        await upload(port, roomId, PNG, "d.png");
        await upload(port, roomId, PNG, "e.png");
        const { joined } = await joinRoom(port, roomId, "Obs");
        assert.ok(joined.state.wallpapers.some((w) => w.url === active.body.url), "active wallpaper survives eviction");
    });

    test("snapshot carries wallpapers library", async () => {
        const { port } = await boot();
        const { roomId } = await createRoom(port, "Host");
        await upload(port, roomId, PNG, "wall.png");
        const { joined } = await joinRoom(port, roomId, "Obs");
        assert.equal(joined.state.wallpapers.length, 1);
    });

    test("serves an uploaded file back with cache headers", async () => {
        const { port } = await boot();
        const { client: host, roomId } = await createRoom(port, "Host");
        const { body } = await upload(port, roomId, PNG, "served.png");
        const res = await fetch(`http://127.0.0.1:${port}${body.url}`);
        assert.equal(res.status, 200);
        assert.match(res.headers.get("content-type"), /image\/png/);
        assert.match(res.headers.get("cache-control"), /immutable/);
        const bytes = Buffer.from(await res.arrayBuffer());
        assert.ok(bytes.subarray(0, 8).equals(PNG.subarray(0, 8)), "served same file bytes");
    });

    test("GET unknown upload 404s", async () => {
        const { port } = await boot();
        const res = await fetch(`http://127.0.0.1:${port}/uploads/NOPE/nope.png`);
        assert.equal(res.status, 404);
    });

    test("GET traversal attempt does not escape uploads root", async () => {
        const { port } = await boot();
        const res = await fetch(`http://127.0.0.1:${port}/uploads/%2E%2E/%2E%2E/package.json`);
        assert.equal(res.status, 404);
    });
});
