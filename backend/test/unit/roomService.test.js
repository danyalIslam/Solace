const { test, describe, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const RoomService = require("../../src/rooms/RoomService");
const storeSingleton = require("../../src/rooms/MemoryRoomStore");
const {
    RoomNotFoundError,
    RoomFullError,
    AlreadyInRoomError,
    NotInRoomError,
    InvalidPayloadError,
    TargetNotInRoomError,
    NotHostError,
    MAX_ROOM_MEMBERS,
    MAX_ACTIVITY_HISTORY
} = require("../../src/rooms/RoomService");

function freshStore() {
    return new storeSingleton.constructor();
}

describe("RoomService", () => {
    let service;
    let socketId;

    beforeEach(() => {
        service = new RoomService(freshStore());
        socketId = "socket-" + Math.random().toString(36).slice(2);
    });

    describe("createRoom", () => {
        test("valid creates room with host member", () => {
            const { roomId, room } = service.createRoom("Alice", socketId);
            assert.equal(typeof roomId, "string");
            assert.equal(room.id, roomId);
            assert.equal(room.members.size, 1);
            const host = room.members.get(socketId);
            assert.equal(host.displayName, "Alice");
            assert.equal(host.isHost, true);
        });

        test("missing displayName -> InvalidPayloadError", () => {
            assert.throws(() => service.createRoom(undefined, socketId), InvalidPayloadError);
            assert.throws(() => service.createRoom(null, socketId), InvalidPayloadError);
        });

        test("empty displayName -> InvalidPayloadError", () => {
            assert.throws(() => service.createRoom("", socketId), InvalidPayloadError);
            assert.throws(() => service.createRoom("   ", socketId), InvalidPayloadError);
        });

        test("too long displayName -> InvalidPayloadError", () => {
            assert.throws(() => service.createRoom("a".repeat(25), socketId), InvalidPayloadError);
        });
    });

    describe("joinRoom", () => {
        test("success adds member", () => {
            const { roomId } = service.createRoom("Host", socketId);
            const joiner = "joiner-1";
            const room = service.joinRoom(roomId, joiner, "Bob");
            assert.equal(room.members.size, 2);
            assert.equal(room.members.get(joiner).displayName, "Bob");
            assert.equal(room.members.get(joiner).isHost, false);
        });

        test("missing room -> RoomNotFoundError", () => {
            assert.throws(() => service.joinRoom("NOPE", "s-x", "Bob"), RoomNotFoundError);
        });

        test("full room -> RoomFullError", () => {
            const { roomId, room } = service.createRoom("H", socketId);
            for (let i = 1; i < MAX_ROOM_MEMBERS; i++) {
                service.joinRoom(roomId, "m" + i, "M" + i);
            }
            assert.equal(room.members.size, MAX_ROOM_MEMBERS);
            assert.throws(() => service.joinRoom(roomId, "m-full", "Full"), RoomFullError);
        });

        test("same socket id twice -> AlreadyInRoomError", () => {
            const { roomId } = service.createRoom("H", socketId);
            assert.throws(() => service.joinRoom(roomId, socketId, "Again"), AlreadyInRoomError);
        });
    });

    describe("leaveRoom", () => {
        test("success removes member", () => {
            const { roomId } = service.createRoom("H", socketId);
            const joiner = "j1";
            service.joinRoom(roomId, joiner, "Bob");
            service.leaveRoom(roomId, joiner);
            assert.equal(service.getState(roomId).members.length, 1);
        });

        test("missing room -> RoomNotFoundError", () => {
            assert.throws(() => service.leaveRoom("NOPE", socketId), RoomNotFoundError);
        });

        test("non-member -> NotInRoomError", () => {
            const { roomId } = service.createRoom("H", socketId);
            assert.throws(() => service.leaveRoom(roomId, "stranger"), NotInRoomError);
        });
    });

    describe("getState", () => {
        test("returns snapshot shape", () => {
            const { roomId } = service.createRoom("H", socketId);
            const state = service.getState(roomId);
            assert.equal(typeof state.id, "string");
            assert.ok(Array.isArray(state.members));
            assert.equal(state.members.length, 1);
            assert.ok("state" in state);
            assert.ok("playback" in state.state);
            assert.ok("wallpaper" in state.state);
        });

        test("missing room -> RoomNotFoundError", () => {
            assert.throws(() => service.getState("NOPE"), RoomNotFoundError);
        });
    });

    describe("setPlayback", () => {
        test("status validation", () => {
            const { roomId } = service.createRoom("H", socketId);
            assert.throws(() => service.setPlayback(roomId, socketId, { status: "invalid" }), InvalidPayloadError);
            assert.doesNotThrow(() => service.setPlayback(roomId, socketId, { status: "playing" }));
            assert.doesNotThrow(() => service.setPlayback(roomId, socketId, { status: "paused" }));
        });

        test("track validation requires url", () => {
            const { roomId } = service.createRoom("H", socketId);
            assert.throws(() => service.setPlayback(roomId, socketId, { track: {} }), InvalidPayloadError);
            assert.throws(() => service.setPlayback(roomId, socketId, { track: { title: "no url" } }), InvalidPayloadError);
            assert.throws(() => service.setPlayback(roomId, socketId, { track: "not-an-object" }), InvalidPayloadError);
        });

        test("position validation", () => {
            const { roomId } = service.createRoom("H", socketId);
            assert.throws(() => service.setPlayback(roomId, socketId, { position: -5 }), InvalidPayloadError);
            assert.throws(() => service.setPlayback(roomId, socketId, { position: NaN }), InvalidPayloadError);
            assert.throws(() => service.setPlayback(roomId, socketId, { position: Infinity }), InvalidPayloadError);
        });

        test("partial updates preserve other fields", () => {
            const { roomId } = service.createRoom("H", socketId);
            service.setPlayback(roomId, socketId, {
                status: "playing",
                track: { url: "http://t" },
                position: 100
            });
            const { change } = service.setPlayback(roomId, socketId, { position: 50 });
            assert.equal(change.status, "playing");
            assert.deepEqual(change.track, { url: "http://t" });
            assert.equal(change.position, 50);
        });

        test("updatedAt stamped", () => {
            const { roomId } = service.createRoom("H", socketId);
            const before = Date.now();
            const { change } = service.setPlayback(roomId, socketId, { status: "playing" });
            assert.ok(change.updatedAt >= before);
        });

        test("non-member -> NotInRoomError", () => {
            const { roomId } = service.createRoom("H", socketId);
            assert.throws(() => service.setPlayback(roomId, "stranger", { status: "playing" }), NotInRoomError);
        });

        test("missing room -> RoomNotFoundError", () => {
            assert.throws(() => service.setPlayback("NOPE", socketId, { status: "playing" }), RoomNotFoundError);
        });
    });

    describe("setWallpaper", () => {
        test("empty url -> InvalidPayloadError", () => {
            const { roomId } = service.createRoom("H", socketId);
            assert.throws(() => service.setWallpaper(roomId, socketId, ""), InvalidPayloadError);
            assert.throws(() => service.setWallpaper(roomId, socketId, undefined), InvalidPayloadError);
        });

        test("too long url -> InvalidPayloadError", () => {
            const { roomId } = service.createRoom("H", socketId);
            assert.throws(() => service.setWallpaper(roomId, socketId, "a".repeat(2049)), InvalidPayloadError);
        });

        test("valid url updates", () => {
            const { roomId } = service.createRoom("H", socketId);
            const { room, url } = service.setWallpaper(roomId, socketId, "http://wall/1.png");
            assert.equal(url, "http://wall/1.png");
            assert.equal(room.state.wallpaper.url, "http://wall/1.png");
        });

        test("accepts video kind and records changedBy + updatedAt", () => {
            const { roomId } = service.createRoom("H", socketId);
            const { room, url, kind } = service.setWallpaper(roomId, socketId, "http://x/w.webm", "video");
            assert.equal(room.state.wallpaper.url, "http://x/w.webm");
            assert.equal(room.state.wallpaper.kind, "video");
            assert.equal(room.state.wallpaper.changedBy, socketId);
            assert.ok(Number.isFinite(room.state.wallpaper.updatedAt));
            assert.equal(url, "http://x/w.webm");
            assert.equal(kind, "video");
        });

        test("defaults kind to image when omitted", () => {
            const { roomId } = service.createRoom("H", socketId);
            const { kind } = service.setWallpaper(roomId, socketId, "http://x/i.png");
            assert.equal(kind, "image");
        });

        test("rejects unknown kind", () => {
            const { roomId } = service.createRoom("H", socketId);
            assert.throws(() => service.setWallpaper(roomId, socketId, "http://x/i.png", "hologram"), /kind/i);
        });

        test("keeps existing kind on plain url set", () => {
            const { roomId } = service.createRoom("H", socketId);
            service.setWallpaper(roomId, socketId, "http://x/v.mp4", "video");
            service.setWallpaper(roomId, socketId, "http://x/v2.mp4");
            assert.equal(service.getState(roomId).state.wallpaper.kind, "video");
        });
    });

    describe("addUpload", () => {
        test("appends to library and returns uploads + evicted null", () => {
            const { roomId } = service.createRoom("H", socketId);
            for (let i = 0; i < 3; i++) {
                const meta = { id: `id${i}`, url: `/uploads/${roomId}/f${i}.png`, kind: "image", size: 10, originalName: `f${i}.png`, uploadedBy: socketId, uploadedAt: i };
                const { evicted } = service.addUpload(roomId, meta);
                assert.equal(evicted, null);
            }
            assert.equal(service.getState(roomId).state.wallpapers.length, 3);
        });

        test("evicts oldest non-active when library exceeds 3", () => {
            const { roomId } = service.createRoom("H", socketId);
            const metaFor = (i, url = `/uploads/${roomId}/f${i}.png`) => ({ id: `id${i}`, url, kind: "image", size: 10, originalName: `f${i}.png`, uploadedBy: socketId, uploadedAt: i });
            service.addUpload(roomId, metaFor(0));
            service.addUpload(roomId, metaFor(1));
            service.addUpload(roomId, metaFor(2));
            const r3 = service.addUpload(roomId, metaFor(3));
            assert.equal(r3.evicted.url, `/uploads/${roomId}/f0.png`);
            const room = service.getState(roomId);
            assert.equal(room.state.wallpapers.length, 3);
            assert.ok(!room.state.wallpapers.some((w) => w.url === `/uploads/${roomId}/f0.png`), "oldest evicted");
        });

        test("never evicts the active wallpaper", () => {
            const { roomId } = service.createRoom("H", socketId);
            const activeUrl = `/uploads/${roomId}/f0.png`;
            service.setWallpaper(roomId, socketId, activeUrl, "image");
            for (let i = 0; i < 4; i++) {
                service.addUpload(roomId, { id: `id${i}`, url: i === 0 ? activeUrl : `/uploads/${roomId}/f${i}.png`, kind: "image", size: 10, originalName: `f${i}.png`, uploadedBy: socketId, uploadedAt: i });
            }
            const room = service.getState(roomId);
            assert.equal(room.state.wallpapers.length, 3);
            assert.ok(room.state.wallpapers.some((w) => w.url === activeUrl), "active wallpaper survives eviction");
        });
    });

    describe("sendActivity (chat type)", () => {
        test("valid text -> returns chat entry with id, type, actor, detail, at", () => {
            const { roomId } = service.createRoom("Host", socketId);
            const { entry } = service.sendActivity(roomId, socketId, "hello");
            assert.equal(typeof entry.id, "string");
            assert.ok(entry.id.length > 0);
            assert.equal(entry.type, "chat");
            assert.equal(entry.detail, "hello");
            assert.equal(entry.actor.socketId, socketId);
            assert.equal(entry.actor.displayName, "Host");
            assert.equal(typeof entry.at, "number");
        });

        test("appends message to state.activity", () => {
            const { roomId } = service.createRoom("Host", socketId);
            service.sendActivity(roomId, socketId, "first");
            service.sendActivity(roomId, socketId, "second");
            const act = service.getState(roomId).state.activity;
            assert.equal(act.length, 2);
            assert.equal(act[0].detail, "first");
            assert.equal(act[1].detail, "second");
        });

        test("trims whitespace", () => {
            const { roomId } = service.createRoom("Host", socketId);
            const { entry } = service.sendActivity(roomId, socketId, "  hi  ");
            assert.equal(entry.detail, "hi");
        });

        test("empty text -> InvalidPayloadError", () => {
            const { roomId } = service.createRoom("H", socketId);
            assert.throws(() => service.sendActivity(roomId, socketId, ""), InvalidPayloadError);
            assert.throws(() => service.sendActivity(roomId, socketId, "   "), InvalidPayloadError);
        });

        test("non-string text -> InvalidPayloadError", () => {
            const { roomId } = service.createRoom("H", socketId);
            assert.throws(() => service.sendActivity(roomId, socketId, undefined), InvalidPayloadError);
            assert.throws(() => service.sendActivity(roomId, socketId, null), InvalidPayloadError);
            assert.throws(() => service.sendActivity(roomId, socketId, 42), InvalidPayloadError);
        });

        test("too long text -> InvalidPayloadError", () => {
            const { roomId } = service.createRoom("H", socketId);
            assert.throws(() => service.sendActivity(roomId, socketId, "a".repeat(501)), InvalidPayloadError);
            assert.doesNotThrow(() => service.sendActivity(roomId, socketId, "a".repeat(500)));
        });

        test("missing room -> RoomNotFoundError", () => {
            assert.throws(() => service.sendActivity("NOPE", socketId, "hi"), RoomNotFoundError);
        });

        test("non-member -> NotInRoomError", () => {
            const { roomId } = service.createRoom("H", socketId);
            assert.throws(() => service.sendActivity(roomId, "stranger", "hi"), NotInRoomError);
        });

        test("cap at MAX_ACTIVITY_HISTORY drops oldest", () => {
            const { roomId } = service.createRoom("H", socketId);
            for (let i = 0; i < 55; i++) service.sendActivity(roomId, socketId, "msg-" + i);
            const act = service.getState(roomId).state.activity;
            assert.equal(act.length, MAX_ACTIVITY_HISTORY);
            assert.ok(!act.some((e) => e.detail === "msg-0"), "oldest dropped");
            assert.equal(act[act.length - 1].detail, "msg-54");
        });
    });

    describe("setMedia", () => {
        const mediaArgs = { audio: true, video: false };

        test("updates member flags and returns updated member", () => {
            const { roomId } = service.createRoom("H", socketId);
            const updated = service.setMedia(roomId, socketId, mediaArgs);
            assert.equal(updated.socketId, socketId);
            assert.equal(updated.displayName, "H");
            assert.equal(updated.audioOn, true);
            assert.equal(updated.videoOn, false);
        });

        test("Boolean coercion: 'false' string and falsy values do not become true", () => {
            const { roomId } = service.createRoom("H", socketId);
            const updated = service.setMedia(roomId, socketId, { audio: "false", video: 0 });
            assert.equal(updated.audioOn, false);
            assert.equal(updated.videoOn, false);
            const updated2 = service.setMedia(roomId, socketId, { audio: 1, video: "true" });
            assert.equal(updated2.audioOn, true);
            assert.equal(updated2.videoOn, true);
        });

        test("partial update keeps omitted flag", () => {
            const { roomId } = service.createRoom("H", socketId);
            service.setMedia(roomId, socketId, { audio: true, video: true });
            const updated = service.setMedia(roomId, socketId, { audio: false });
            assert.equal(updated.audioOn, false);
            assert.equal(updated.videoOn, true);
            const updated2 = service.setMedia(roomId, socketId, { video: false });
            assert.equal(updated2.audioOn, false);
            assert.equal(updated2.videoOn, false);
        });

        test("invalid type -> InvalidPayloadError with code INVALID_PAYLOAD", () => {
            const { roomId } = service.createRoom("H", socketId);
            try {
                service.setMedia(roomId, socketId, { audio: "banana", video: true });
                assert.fail("expected InvalidPayloadError");
            } catch (err) {
                assert.ok(err instanceof InvalidPayloadError);
                assert.equal(err.code, "INVALID_PAYLOAD");
            }
            assert.throws(() => service.setMedia(roomId, socketId, { video: {} }), InvalidPayloadError);
            assert.throws(() => service.setMedia(roomId, socketId, { audio: [], video: true }), InvalidPayloadError);
        });

        test("undefined value treated as omitted and skips validation", () => {
            const { roomId } = service.createRoom("H", socketId);
            service.setMedia(roomId, socketId, { audio: true, video: true });
            const updated = service.setMedia(roomId, socketId, { audio: true, video: undefined });
            assert.equal(updated.videoOn, true);
            assert.equal(updated.audioOn, true);
        });

        test("snapshot reflects updated flags", () => {
            const { roomId } = service.createRoom("H", socketId);
            service.setMedia(roomId, socketId, { audio: false, video: true });
            const member = service.getState(roomId).members.find((m) => m.socketId === socketId);
            assert.equal(member.audioOn, false);
            assert.equal(member.videoOn, true);
        });

        test("missing room -> RoomNotFoundError", () => {
            assert.throws(() => service.setMedia("NOPE", socketId, mediaArgs), RoomNotFoundError);
        });

        test("non-member -> TargetNotInRoomError", () => {
            const { roomId } = service.createRoom("H", socketId);
            try {
                service.setMedia(roomId, "stranger", mediaArgs);
                assert.fail("expected TargetNotInRoomError");
            } catch (err) {
                assert.ok(err instanceof TargetNotInRoomError);
                assert.equal(err.code, "TARGET_NOT_IN_ROOM");
            }
        });
    });

    describe("setTitle", () => {
        test("host sets title -> state updates and snapshot carries it", () => {
            const { roomId } = service.createRoom("H", socketId);
            const result = service.setTitle(roomId, socketId, { title: "Cozy Corner" });
            assert.equal(result.title, "Cozy Corner");
            assert.equal(typeof result.updatedAt, "number");
            const pub = service.getState(roomId);
            assert.equal(pub.state.title, "Cozy Corner");
        });

        test("missing room -> RoomNotFoundError", () => {
            assert.throws(
                () => service.setTitle("NOPE", socketId, { title: "x" }),
                RoomNotFoundError
            );
        });

        test("non-host -> NotHostError with code NOT_HOST", () => {
            const { roomId } = service.createRoom("H", socketId);
            service.joinRoom(roomId, "joiner-1", "Bob");
            try {
                service.setTitle(roomId, "joiner-1", { title: "x" });
                assert.fail("expected NotHostError");
            } catch (err) {
                assert.ok(err instanceof NotHostError);
                assert.equal(err.code, "NOT_HOST");
            }
        });

        test("missing, empty, non-string, too long -> InvalidPayloadError", () => {
            const { roomId } = service.createRoom("H", socketId);
            assert.throws(() => service.setTitle(roomId, socketId, {}), InvalidPayloadError);
            assert.throws(() => service.setTitle(roomId, socketId, { title: "" }), InvalidPayloadError);
            assert.throws(() => service.setTitle(roomId, socketId, { title: "   " }), InvalidPayloadError);
            assert.throws(() => service.setTitle(roomId, socketId, { title: 42 }), InvalidPayloadError);
            assert.throws(
                () => service.setTitle(roomId, socketId, { title: "a".repeat(61) }),
                InvalidPayloadError
            );
        });
    });

    describe("activity log", () => {
        test("sendActivity appends a chat-type entry with actor displayName", () => {
            const { roomId, room } = service.createRoom("Host", socketId);
            const res = service.sendActivity(roomId, socketId, "hello");
            assert.equal(res.entry.type, "chat");
            assert.equal(res.entry.detail, "hello");
            assert.equal(res.entry.actor.socketId, socketId);
            assert.equal(res.entry.actor.displayName, "Host");
            assert.equal(typeof res.entry.id, "string");
            assert.equal(typeof res.entry.at, "number");
        });

        test("appendActivity caps at MAX_ACTIVITY_HISTORY and drops oldest", () => {
            const { roomId } = service.createRoom("Host", socketId);
            for (let i = 0; i < MAX_ACTIVITY_HISTORY + 5; i++) {
                service.appendActivity(roomId, { type: "system", actor: null, detail: "e" + i });
            }
            const act = service.getState(roomId).state.activity;
            assert.equal(act.length, MAX_ACTIVITY_HISTORY);
            assert.equal(act[0].detail, "e5");
            assert.equal(act[act.length - 1].detail, "e" + (MAX_ACTIVITY_HISTORY + 4));
        });

        test("sendActivity rejects empty text with InvalidPayloadError", () => {
            const { roomId } = service.createRoom("Host", socketId);
            assert.throws(() => service.sendActivity(roomId, socketId, "   "), InvalidPayloadError);
            assert.throws(() => service.sendActivity(roomId, socketId, "a".repeat(501)), InvalidPayloadError);
        });

        test("sendActivity from non-member -> NotInRoomError", () => {
            const { roomId } = service.createRoom("Host", socketId);
            assert.throws(() => service.sendActivity(roomId, "stranger", "hi"), NotInRoomError);
        });
    });

    describe("timer", () => {
        const Room = require("../../src/rooms/Room");

        function makeTimerService() {
            let now = 1_000_000;
            let pending = null; // { fn, ms } — the armed scheduler callback
            const clock = { now: () => now, advance: (ms) => { now += ms; } };
            const schedule = (fn, ms) => { pending = { fn, ms }; return 1; };
            const cancel = () => { pending = null; };
            const s = new RoomService(undefined, { now: clock.now, schedule, cancel });
            const rooms = new Map();
            s.store = {
                all: () => Array.from(rooms.values()),
                get: (id) => rooms.get(id) || null,
                create: () => { const r = new Room("R" + (rooms.size + 1)); rooms.set(r.id, r); return r; }
            };
            return { s, clock, sp: () => pending, fire: () => { if (pending) { const p = pending; pending = null; p.fn(); } } };
        }

        test("transition start -> running with computed endsAt", () => {
            const { s, clock, sp } = makeTimerService();
            const { roomId } = s.createRoom("H", socketId);
            const st = s.startTimer(roomId, socketId, 25);
            assert.equal(st.timer.status, "running");
            assert.equal(st.timer.durationMs, 25 * 60_000);
            assert.equal(st.timer.remainingMs, 25 * 60_000);
            assert.equal(st.timer.endsAt, clock.now() + 25 * 60_000);
            assert.equal(st.timer.startedBy, socketId);
            assert.ok(sp(), "scheduler must be armed");
        });

        test("pause freezes remaining and transitions to paused", () => {
            const { s, clock } = makeTimerService();
            const { roomId } = s.createRoom("H", socketId);
            s.startTimer(roomId, socketId, 25);
            clock.advance(10_000);
            const st = s.pauseTimer(roomId, socketId);
            assert.equal(st.timer.status, "paused");
            assert.equal(st.timer.remainingMs, 25 * 60_000 - 10_000);
            assert.equal(st.timer.endsAt, null);
        });

        test("reset clears timer to idle", () => {
            const { s } = makeTimerService();
            const { roomId } = s.createRoom("H", socketId);
            s.startTimer(roomId, socketId, 25);
            const st = s.resetTimer(roomId, socketId);
            assert.equal(st.timer.status, "idle");
            assert.equal(st.timer.endsAt, null);
            assert.equal(st.timer.durationMs, 0);
        });

        test("minutes out of range -> InvalidPayloadError", () => {
            const { s } = makeTimerService();
            const { roomId } = s.createRoom("H", socketId);
            assert.throws(() => s.startTimer(roomId, socketId, 0), InvalidPayloadError);
            assert.throws(() => s.startTimer(roomId, socketId, 181), InvalidPayloadError);
            assert.throws(() => s.startTimer(roomId, socketId, "25"), InvalidPayloadError);
        });

        test("non-member timer control -> NotInRoomError", () => {
            const { s } = makeTimerService();
            const { roomId } = s.createRoom("H", socketId);
            assert.throws(() => s.startTimer(roomId, "stranger", 25), NotInRoomError);
            assert.throws(() => s.pauseTimer(roomId, "stranger"), NotInRoomError);
        });

        test("completing the timer via injected scheduler produces completion result", () => {
            const { s, fire } = makeTimerService();
            const { roomId } = s.createRoom("H", socketId);
            s.startTimer(roomId, socketId, 1);
            let called = false;
            let result = null;
            s.startTimer(roomId, socketId, 1, (r) => { called = true; result = r; });
            fire();
            assert.equal(called, true, "onComplete must fire on schedule");
            assert.equal(result.status, "idle");
            assert.equal(result.timer.status, "idle");
            assert.equal(result.timer.durationMs, 1 * 60_000);
            assert.equal(result.timer.completed, true);
        });

        test("start while running cancels prior timer and re-arms", () => {
            const { s, clock, sp, fire } = makeTimerService();
            const { roomId } = s.createRoom("H", socketId);
            let firstFired = false;
            let secondFired = false;
            s.startTimer(roomId, socketId, 25, () => { firstFired = true; });
            clock.advance(5_000);
            s.startTimer(roomId, socketId, 10, () => { secondFired = true; });
            assert.equal(sp().ms, 10 * 60_000, "re-armed with new duration");
            fire();
            assert.equal(firstFired, false, "cancelled timer must not fire");
            assert.equal(secondFired, true, "new timer must fire");
            assert.equal(s.getState(roomId).state.timer.durationMs, 10 * 60_000);
        });

        test("pause then start resumes a fresh running timer", () => {
            const { s, clock } = makeTimerService();
            const { roomId } = s.createRoom("H", socketId);
            s.startTimer(roomId, socketId, 25);
            clock.advance(10_000);
            s.pauseTimer(roomId, socketId);        // remainingMs 24m50s
            s.startTimer(roomId, socketId, 5);     // restart fresh 5min
            const t = s.getState(roomId).state.timer;
            assert.equal(t.status, "running");
            assert.equal(t.durationMs, 5 * 60_000);
            assert.equal(t.remainingMs, 5 * 60_000);
            assert.equal(t.endsAt, clock.now() + 5 * 60_000);
        });
    });

    describe("resolveRoomBySocket", () => {
        test("finds room containing socket", () => {
            const { room } = service.createRoom("H", socketId);
            assert.equal(service.resolveRoomBySocket(socketId), room);
        });

        test("returns null when socket not in any room", () => {
            service.createRoom("H", socketId);
            assert.equal(service.resolveRoomBySocket("stranger"), null);
        });
    });
});
