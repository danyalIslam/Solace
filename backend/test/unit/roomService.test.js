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
    MAX_ROOM_MEMBERS
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
