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
    MAX_ROOM_MEMBERS,
    MAX_CHAT_HISTORY
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

    describe("sendChat", () => {
        test("valid text -> returns message with id, senderId, displayName, text, sentAt", () => {
            const { roomId } = service.createRoom("Host", socketId);
            const { message } = service.sendChat(roomId, socketId, "hello");
            assert.equal(typeof message.id, "string");
            assert.ok(message.id.length > 0);
            assert.equal(message.senderId, socketId);
            assert.equal(message.displayName, "Host");
            assert.equal(message.text, "hello");
            assert.equal(typeof message.sentAt, "number");
        });

        test("appends message to state.chat", () => {
            const { roomId } = service.createRoom("Host", socketId);
            service.sendChat(roomId, socketId, "first");
            service.sendChat(roomId, socketId, "second");
            assert.equal(service.getState(roomId).state.chat.length, 2);
            assert.equal(service.getState(roomId).state.chat[0].text, "first");
            assert.equal(service.getState(roomId).state.chat[1].text, "second");
        });

        test("trims whitespace", () => {
            const { roomId } = service.createRoom("Host", socketId);
            const { message } = service.sendChat(roomId, socketId, "  hi  ");
            assert.equal(message.text, "hi");
        });

        test("empty text -> InvalidPayloadError", () => {
            const { roomId } = service.createRoom("H", socketId);
            assert.throws(() => service.sendChat(roomId, socketId, ""), InvalidPayloadError);
            assert.throws(() => service.sendChat(roomId, socketId, "   "), InvalidPayloadError);
        });

        test("non-string text -> InvalidPayloadError", () => {
            const { roomId } = service.createRoom("H", socketId);
            assert.throws(() => service.sendChat(roomId, socketId, undefined), InvalidPayloadError);
            assert.throws(() => service.sendChat(roomId, socketId, null), InvalidPayloadError);
            assert.throws(() => service.sendChat(roomId, socketId, 42), InvalidPayloadError);
        });

        test("too long text -> InvalidPayloadError", () => {
            const { roomId } = service.createRoom("H", socketId);
            assert.throws(() => service.sendChat(roomId, socketId, "a".repeat(501)), InvalidPayloadError);
            assert.doesNotThrow(() => service.sendChat(roomId, socketId, "a".repeat(500)));
        });

        test("missing room -> RoomNotFoundError", () => {
            assert.throws(() => service.sendChat("NOPE", socketId, "hi"), RoomNotFoundError);
        });

        test("non-member -> NotInRoomError", () => {
            const { roomId } = service.createRoom("H", socketId);
            assert.throws(() => service.sendChat(roomId, "stranger", "hi"), NotInRoomError);
        });

        test("cap at MAX_CHAT_HISTORY drops oldest", () => {
            const { roomId } = service.createRoom("H", socketId);
            const firstId = service.sendChat(roomId, socketId, "msg-0").message.id;
            for (let i = 1; i < 55; i++) {
                service.sendChat(roomId, socketId, "msg-" + i);
            }
            const chat = service.getState(roomId).state.chat;
            assert.equal(chat.length, MAX_CHAT_HISTORY);
            assert.equal(chat.length, 50);
            const ids = chat.map((m) => m.id);
            assert.ok(!ids.includes(firstId), "oldest message must be dropped");
            assert.equal(chat[chat.length - 1].text, "msg-54");
            assert.equal(chat[0].text, "msg-5");
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
