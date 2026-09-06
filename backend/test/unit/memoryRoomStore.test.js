const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const storeSingleton = require("../../src/rooms/MemoryRoomStore");
const Room = require("../../src/rooms/Room");

function freshStore() {
    return new storeSingleton.constructor();
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const FORBIDDEN = ["0", "O", "1", "I"];

describe("MemoryRoomStore", () => {
    test("singleton is exported", () => {
        assert.ok(storeSingleton.constructor);
        assert.equal(typeof storeSingleton.create, "function");
    });

    test("create returns a Room with a 6-char code from allowed alphabet", () => {
        const store = freshStore();
        const room = store.create();
        assert.ok(room instanceof Room);
        assert.equal(room.id.length, 6);
        for (const ch of room.id) {
            assert.ok(CODE_ALPHABET.includes(ch), `char '${ch}' not in allowed alphabet`);
            assert.ok(!FORBIDDEN.includes(ch), `ambiguous char '${ch}' present`);
        }
    });

    test("created codes are unique across many creates", () => {
        const store = freshStore();
        const ids = new Set();
        for (let i = 0; i < 200; i++) {
            ids.add(store.create().id);
        }
        assert.equal(ids.size, 200);
        assert.equal(store.size, 200);
    });

    test("get returns room or null", () => {
        const store = freshStore();
        const room = store.create();
        assert.equal(store.get(room.id), room);
        assert.equal(store.get("ZZZZZZ"), null);
    });

    test("remove deletes the room", () => {
        const store = freshStore();
        const room = store.create();
        assert.equal(store.get(room.id), room);
        store.remove(room.id);
        assert.equal(store.get(room.id), null);
        assert.equal(store.size, 0);
    });

    test("all returns every room", () => {
        const store = freshStore();
        const a = store.create();
        const b = store.create();
        const rooms = store.all();
        assert.equal(rooms.length, 2);
        assert.ok(rooms.includes(a));
        assert.ok(rooms.includes(b));
    });

    test("create with forced id uses it", () => {
        const store = freshStore();
        const room = store.create("CUSTOM");
        assert.equal(room.id, "CUSTOM");
        assert.equal(store.get("CUSTOM"), room);
    });
});
