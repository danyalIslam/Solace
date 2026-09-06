const { test } = require("node:test");
const assert = require("node:assert/strict");
const { resolveIceServers } = require("../../src/socket/handlers/rtcHandler");

test("stun only when TURN env absent", () => {
    const ice = resolveIceServers({});
    assert.equal(ice.length, 1);
    assert.match(ice[0].urls[0], /^stun:/);
});

test("stun + turn when TURN env present", () => {
    const ice = resolveIceServers({
        TURN_HOST: "turn.example.com",
        TURN_PORT: "3478",
        TURN_USER: "solace",
        TURN_PASSWORD: "secret"
    });
    assert.equal(ice.length, 2);
    const turn = ice.find((s) => s.urls[0].startsWith("turn:"));
    assert.ok(turn);
    assert.equal(turn.username, "solace");
    assert.equal(turn.credential, "secret");
    assert.match(turn.urls[0], /turn\.example\.com:3478/);
});
