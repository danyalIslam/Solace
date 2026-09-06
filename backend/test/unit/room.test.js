const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const Room = require("../../src/rooms/Room");

describe("Room entity", () => {
    test("default state shape", () => {
        const room = new Room("ABC123");
        assert.equal(room.id, "ABC123");
        assert.ok(room.members instanceof Map);
        assert.equal(room.members.size, 0);
        assert.deepEqual(room.state.playback, {
            status: "paused",
            track: null,
            position: 0,
            updatedAt: room.state.playback.updatedAt
        });
        assert.deepEqual(room.state.wallpaper, { url: null });
        assert.deepEqual(room.state.chat, []);
    });

    test("addMember / removeMember", () => {
        const room = new Room("ABC123");
        room.addMember("s1", { displayName: "Alice", isHost: true });
        room.addMember("s2", { displayName: "Bob", isHost: false });
        assert.equal(room.members.size, 2);
        assert.ok(room.members.has("s1"));
        assert.equal(room.members.get("s2").displayName, "Bob");

        room.removeMember("s1");
        assert.equal(room.members.size, 1);
        assert.ok(!room.members.has("s1"));

        room.removeMember("nonexistent");
        assert.equal(room.members.size, 1);
    });

    test("toPublicState strips internal state refs", () => {
        const room = new Room("ABC123");
        const member = { displayName: "Alice", joinedAt: 12345, isHost: true };
        room.addMember("s1", member);
        room.state.playback = {
            status: "playing",
            track: { url: "http://track" },
            position: 42,
            updatedAt: 999
        };
        room.state.wallpaper.url = "http://wall";

        const pub = room.toPublicState();
        assert.equal(pub.id, "ABC123");
        assert.equal(pub.members.length, 1);
        const m = pub.members[0];
        assert.equal(m.socketId, "s1");
        assert.equal(m.displayName, "Alice");
        assert.equal(m.isHost, true);
        assert.ok(!("joinedAt" in m), "joinedAt must not leak to public state");
        assert.deepEqual(pub.state, room.state);
    });

    test("members default to media off and snapshot carries flags", () => {
        const room = new Room("ABC123");
        room.addMember("s1", { displayName: "A", joinedAt: 1, isHost: true });
        const pub = room.toPublicState();
        const m = pub.members.find((x) => x.socketId === "s1");
        assert.equal(m.displayName, "A");
        assert.equal(m.audioOn, false);
        assert.equal(m.videoOn, false);
    });
});
