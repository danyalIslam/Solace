# WebRTC Mesh Rooms — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add WebRTC mesh signaling (offer/answer/ICE relay), media presence flags, and TURN support to the Solace backend room system.

**Architecture:** Backend relays only tiny WebRTC signaling JSON between room members — no media through the server. Media presence is tracked as per-member `audioOn`/`videoOn` flags broadcast room-wide. ICE server config (STUN always, optional coturn TURN from env) is emitted to each client on connect. All relay logic lives in a new pure `rtcHandler` factory following the existing chatHandler/playbackHandler pattern; domain rules live in `RoomService.setMedia`.

**Tech Stack:** Node 26, CommonJS, socket.io v4, node:test, Docker Compose + coturn.

**Context for executor:** Repo rotates on `v2` branch. Backend = `/Users/saif/Programming/Solace/backend`. Existing patterns: `rooms/` pure domain (no socket imports), `socket/handlers/<domain>Handler.js` factories translating events → service calls → `io.to(roomId).emit` broadcasts, `socket/events.js` holds all event constants, custom error classes carry `.code`. Tests: `test/unit/*.test.js` + `test/integration/socket.test.js`, run with `npm test` (`node --test "test/**/*.test.js"`). Helper: `test/helpers/startServer.js` exports `startTestServer()`, `connectClient(port)`, `waitForEvent(socket, event, predicate)`, `closeSocket`, `closeServer`. Room member object shape: `{ displayName, joinedAt, isHost }`, keyed by socketId.

---

## File Structure

- Modify: `backend/src/socket/events.js` — 4 new CLIENT constants + 2 new SERVER constants
- Create: `backend/src/socket/handlers/rtcHandler.js` — relay + media handlers + pure `resolveIceServers(env)`
- Modify: `backend/src/rooms/Room.js:13-23` — addMember defaults + media flags in snapshot
- Modify: `backend/src/rooms/RoomService.js` — `TargetNotInRoomError`, `setMedia()`
- Modify: `backend/src/socket/index.js:20-31` — create rtcHandler, wire 4 events, emit `rtc:config` on connect
- Modify: `backend/test/unit/room.test.js` — media flag defaults
- Modify: `backend/test/unit/roomService.test.js` — `setMedia` block
- Modify: `backend/test/integration/socket.test.js` — rtc relay + media E2E block
- Modify: `backend/scripts/socket-cli.js` — `media` + `offer` commands, print `rtc:*` events
- Modify: `docker-compose.yml` — coturn service + backend TURN envs

---

### Task 1: Member media flags

**Files:**
- Modify: `backend/src/rooms/Room.js`
- Test: `backend/test/unit/room.test.js`

- [ ] **Step 1: Write the failing test**

Append to `backend/test/unit/room.test.js`:

```js
test("members default to media off and snapshot carries flags", () => {
    const room = new Room("ABC123");
    room.addMember("s1", { displayName: "A", joinedAt: 1, isHost: true });
    const pub = room.toPublicState();
    const m = pub.members.find((x) => x.socketId === "s1");
    assert.equal(m.displayName, "A");
    assert.equal(m.audioOn, false);
    assert.equal(m.videoOn, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/unit/room.test.js`
Expected: FAIL — `audioOn`/`videoOn` are `undefined`

- [ ] **Step 3: Implement in Room.js**

In `addMember`, change the stored member to include defaults:

```js
addMember(socketId, member) {
    this.members.set(socketId, {
        ...member,
        audioOn: false,
        videoOn: false
    });
}
```

In `toPublicState`, add the flags to the mapped member:

```js
members: Array.from(this.members.entries()).map(([socketId, member]) => ({
    socketId,
    displayName: member.displayName,
    isHost: member.isHost,
    audioOn: member.audioOn,
    videoOn: member.videoOn
})),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/unit/room.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/rooms/Room.js backend/test/unit/room.test.js
git commit -m "feat: track media presence flags on room members"
```

---

### Task 2: RoomService.setMedia + TargetNotInRoomError

**Files:**
- Modify: `backend/src/rooms/RoomService.js`
- Test: `backend/test/unit/roomService.test.js`

- [ ] **Step 1: Write failing tests**

Append to `backend/test/unit/roomService.test.js`:

```js
describe("setMedia", () => {
    // NOTE: construct the RoomService exactly like the existing tests at the
    // top of this file (same fake store instance/class pattern). Example:
    function setup() {
        const service = new RoomService(new RoomStore());
        const { roomId } = service.createRoom("Host", "s-host");
        service.joinRoom(roomId, "s-b", "Bravo");
        return { service, roomId };
    }

    test("sets audio/video flags", () => {
        const { service, roomId } = setup();
        const { member } = service.setMedia(roomId, "s-host", { audio: true, video: true });
        assert.equal(member.audioOn, true);
        assert.equal(member.videoOn, true);
        const pub = service.getState(roomId);
        const m = pub.members.find((x) => x.socketId === "s-host");
        assert.equal(m.audioOn, true);
        assert.equal(m.videoOn, true);
    });

    test("partial update keeps other flag unchanged", () => {
        const { service, roomId } = setup();
        service.setMedia(roomId, "s-host", { audio: true, video: false });
        const { member } = service.setMedia(roomId, "s-host", { audio: false });
        assert.equal(member.audioOn, false);
        assert.equal(member.videoOn, false);
    });

    test("non-member -> NotInRoomError", () => {
        const { service, roomId } = setup();
        assert.throws(() => service.setMedia(roomId, "s-ghost", { audio: true }), NotInRoomError);
    });

    test("missing room -> RoomNotFoundError", () => {
        const { service } = setup();
        assert.throws(() => service.setMedia("ZZZZZZ", "s-host", { audio: true }), RoomNotFoundError);
    });

    test("non-boolean flag -> InvalidPayloadError", () => {
        const { service, roomId } = setup();
        assert.throws(() => service.setMedia(roomId, "s-host", { audio: "yes" }), InvalidPayloadError);
    });
});
```

Note: the placeholder line in the first test must be replaced with the real assertion `assert.equal(m.videoOn, true);` — write it correctly, no placeholders.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/unit/roomService.test.js 2>&1 | grep -E "setMedia|pass|fail"`
Expected: FAIL — `service.setMedia is not a function`

- [ ] **Step 3: Implement setMedia + error**

In `RoomService.js`, after `NotInRoomError` class add:

```js
class TargetNotInRoomError extends Error {
    constructor(message = "Target not a member of this room") {
        super(message);
        this.name = "TargetNotInRoomError";
        this.code = "TARGET_NOT_IN_ROOM";
    }
}
```

In `RoomService` class, after `setWallpaper` add:

```js
setMedia(roomId, socketId, { audio, video }) {
    const room = this._assertRoom(roomId);
    this._assertMember(room, socketId);
    const audioOn = audio !== undefined ? audio : undefined;
    const videoOn = video !== undefined ? video : undefined;
    if (audioOn !== undefined && typeof audioOn !== "boolean") {
        throw new InvalidPayloadError("audio must be boolean");
    }
    if (videoOn !== undefined && typeof videoOn !== "boolean") {
        throw new InvalidPayloadError("video must be boolean");
    }
    const member = room.members.get(socketId);
    if (audioOn !== undefined) member.audioOn = audioOn;
    if (videoOn !== undefined) member.videoOn = videoOn;
    return { room, member };
}
```

In the module.exports block add:

```js
module.exports.TargetNotInRoomError = TargetNotInRoomError;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/unit/roomService.test.js 2>&1 | grep -E "setMedia|pass|fail"`
Expected: PASS — all unit tests in file green

- [ ] **Step 5: Commit**

```bash
git add backend/src/rooms/RoomService.js backend/test/unit/roomService.test.js
git commit -m "feat: add setMedia presence update to RoomService"
```

---

### Task 3: Event constants

**Files:**
- Modify: `backend/src/socket/events.js`

- [ ] **Step 1: Add constants**

In `CLIENT` object after `WALLPAPER_SET`:

```js
RTC_MEDIA: "rtc:media",
RTC_OFFER: "rtc:offer",
RTC_ANSWER: "rtc:answer",
RTC_ICE: "rtc:ice"
```

In `SERVER` object after `WALLPAPER_STATE`:

```js
RTC_CONFIG: "rtc:config",
RTC_MEDIA_STATE: "rtc:media_state"
```

- [ ] **Step 2: Verify**

Run: `node -e "const {CLIENT,SERVER}=require('./src/socket/events'); console.log(CLIENT.RTC_OFFER, SERVER.RTC_CONFIG)"`
Expected: `rtc:offer rtc:config`

- [ ] **Step 3: Commit**

```bash
git add backend/src/socket/events.js
git commit -m "feat: add rtc event constants"
```

---

### Task 4: rtcHandler — relay + media + ICE resolver

**Files:**
- Create: `backend/src/socket/handlers/rtcHandler.js`
- Test: `backend/test/unit/roomService.test.js` (pure resolver — put in new file `test/unit/rtcHandler.test.js` instead)

- [ ] **Step 1: Write failing unit test for resolveIceServers**

Create `backend/test/unit/rtcHandler.test.js`:

```js
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
```

- [ ] **Step 2: Run to verify fail**

Run: `node --test test/unit/rtcHandler.test.js`
Expected: FAIL — `Cannot find module ../../src/socket/handlers/rtcHandler`

- [ ] **Step 3: Implement resolveIceServers + relay factory**

Create `backend/src/socket/handlers/rtcHandler.js`:

```js
const { SERVER, CLIENT } = require("../events");

const DEFAULT_STUN_URL = "stun:stun.l.google.com:19302";

function resolveIceServers(env) {
    const iceServers = [{ urls: [DEFAULT_STUN_URL] }];
    const { TURN_HOST, TURN_PORT, TURN_USER, TURN_PASSWORD } = env;
    if (TURN_HOST && TURN_USER && TURN_PASSWORD) {
        const port = TURN_PORT || "3478";
        iceServers.push({
            urls: [
                `turn:${TURN_HOST}:${port}?transport=udp`,
                `turn:${TURN_HOST}:${port}?transport=tcp`
            ],
            username: TURN_USER,
            credential: TURN_PASSWORD
        });
    }
    return iceServers;
}

function createRtcHandler(io, roomService) {
    function emitError(socket, err) {
        socket.emit(SERVER.ROOM_ERROR, { code: err.code, message: err.message });
    }

    // Generic relay: rtc:offer / rtc:answer / rtc:ice all land here with
    // payload { to, sdp | candidate }. Only same-room targets are reachable.
    function relay(eventName, socket, payload, field) {
        const fromRoom = roomService.resolveRoomBySocket(socket.id);
        if (!fromRoom) {
            const err = new Error("Not a member of this room");
            err.code = "NOT_IN_ROOM";
            emitError(socket, err);
            return;
        }
        const to = payload && payload.to;
        const data = payload && payload[field];
        if (typeof to !== "string" || typeof data !== "string" || data.length === 0) {
            emitError(socket, { code: "INVALID_PAYLOAD", message: `${eventName} requires { to: string, ${field}: string }` });
            return;
        }
        if (!fromRoom.members.has(to)) {
            const err = new Error("Target not a member of this room");
            err.code = "TARGET_NOT_IN_ROOM";
            emitError(socket, err);
            return;
        }
        const envelope = { from: socket.id, [field]: data };
        io.to(to).emit(eventName, envelope);
    }

    return {
        handleMedia(socket, payload) {
            try {
                const room = roomService.resolveRoomBySocket(socket.id);
                if (!room) {
                    const err = new Error("Not a member of this room");
                    err.code = "NOT_IN_ROOM";
                    emitError(socket, err);
                    return;
                }
                const audio = payload && payload.audio;
                const video = payload && payload.video;
                const { room: updatedRoom, member } = roomService.setMedia(room.id, socket.id, { audio, video });
                io.to(updatedRoom.id).emit(SERVER.RTC_MEDIA_STATE, {
                    socketId: socket.id,
                    audio: member.audioOn,
                    video: member.videoOn
                });
            } catch (err) {
                emitError(socket, err);
            }
        },
        handleOffer(socket, payload) { relay(CLIENT.RTC_OFFER, socket, payload, "sdp"); },
        handleAnswer(socket, payload) { relay(CLIENT.RTC_ANSWER, socket, payload, "sdp"); },
        handleIce(socket, payload) { relay(CLIENT.RTC_ICE, socket, payload, "candidate"); }
    };
}

module.exports = { createRtcHandler, resolveIceServers };
```

- [ ] **Step 4: Run unit tests to verify pass**

Run: `node --test test/unit/rtcHandler.test.js`
Expected: PASS 2/2

- [ ] **Step 5: Commit**

```bash
git add backend/src/socket/handlers/rtcHandler.js backend/test/unit/rtcHandler.test.js
git commit -m "feat: add WebRTC relay handler with ICE resolver"
```

---

### Task 5: Wire into socket/index.js + rtc:config emit

**Files:**
- Modify: `backend/src/socket/index.js`

- [ ] **Step 1: Wire handler + config**

In `backend/src/socket/index.js`:

- require rtcHandler after wallpaperHandler require:

```js
const { createRtcHandler, resolveIceServers } = require("./handlers/rtcHandler");
```

- after wallpaperHandler creation add:

```js
const rtcHandler = createRtcHandler(io, roomService);
```

- in the connection callback, before the other `socket.on` lines:

```js
socket.emit(SERVER.RTC_CONFIG, { iceServers: resolveIceServers(process.env) });
```

- after `socket.on(CLIENT.WALLPAPER_SET, ...)` add:

```js
socket.on(CLIENT.RTC_MEDIA, (payload) => rtcHandler.handleMedia(socket, payload));
socket.on(CLIENT.RTC_OFFER, (payload) => rtcHandler.handleOffer(socket, payload));
socket.on(CLIENT.RTC_ANSWER, (payload) => rtcHandler.handleAnswer(socket, payload));
socket.on(CLIENT.RTC_ICE, (payload) => rtcHandler.handleIce(socket, payload));
```

- [ ] **Step 2: Verify wiring**

Run: `node -e "require('./src/socket/index.js')"` (from `backend/`)
Expected: no error

- [ ] **Step 3: Commit**

```bash
git add backend/src/socket/index.js
git commit -m "feat: wire rtc events and emit ice config on connect"
```

---

### Task 6: Integration tests — relay, media broadcast, flags

**Files:**
- Modify: `backend/test/integration/socket.test.js`

- [ ] **Step 1: Add rtc integration describe block**

Append inside the existing top-level test suite (look at how existing tests create a fresh room — reuse that exact helper function, e.g. `createRoomWith(client, name)` if present, otherwise replicate the create/join pattern already in the file):

```js
describe("WebRTC relay + media presence", () => {
    let A, B, serverPort;

    beforeEach(async () => {
        const ctx = await startTestServer();
        serverPort = ctx.port;
        A = await connectClient(serverPort);
        B = await connectClient(serverPort);
    });

    afterEach(async () => {
        if (A) closeSocket(A);
        if (B) closeSocket(B);
        if (serverPort) await closeServer(serverPort);
    });

    test("rtc:config arrives with STUN on connect", async () => {
        const cfg = await waitForEvent(A, "rtc:config");
        assert.ok(cfg.iceServers.length >= 1);
        assert.match(cfg.iceServers[0].urls[0], /^stun:/);
    });

    test("offer relays A -> B with from envelope", async () => {
        const { roomId } = await createRoom(A, "Host");
        await joinRoom(B, roomId, "Bravo");
        const offerP = waitForEvent(B, "rtc:offer");
        A.emit("rtc:offer", { to: B.id, sdp: "v=0 fake-offer" });
        const env = await offerP;
        assert.equal(env.from, A.id);
        assert.equal(env.sdp, "v=0 fake-offer");
    });

    test("answer relays B -> A", async () => {
        const { roomId } = await createRoom(A, "Host");
        await joinRoom(B, roomId, "Bravo");
        const answerP = waitForEvent(A, "rtc:answer");
        B.emit("rtc:answer", { to: A.id, sdp: "v=0 fake-answer" });
        const env = await answerP;
        assert.equal(env.from, B.id);
        assert.equal(env.sdp, "v=0 fake-answer");
    });

    test("ice relays candidate", async () => {
        const { roomId } = await createRoom(A, "Host");
        await joinRoom(B, roomId, "Bravo");
        const iceP = waitForEvent(B, "rtc:ice");
        A.emit("rtc:ice", { to: B.id, candidate: "candidate:1 1 udp 2122260223 1.2.3.4 5000 typ host" });
        const env = await iceP;
        assert.equal(env.from, A.id);
        assert.match(env.candidate, /^candidate:/);
    });

    test("relay to non-member target -> TARGET_NOT_IN_ROOM", async () => {
        const { roomId } = await createRoom(A, "Host");
        await joinRoom(B, roomId, "Bravo");
        const C = await connectClient(serverPort);
        closeSocket(C);
        const errP = waitForEvent(A, "room:error");
        A.emit("rtc:offer", { to: "ghost-socket", sdp: "v=0" });
        const err = await errP;
        assert.equal(err.code, "TARGET_NOT_IN_ROOM");
    });

    test("media broadcast reaches room incl. flags", async () => {
        const { roomId } = await createRoom(A, "Host");
        await joinRoom(B, roomId, "Bravo");
        const mediaP = waitForEvent(B, "rtc:media_state");
        A.emit("rtc:media", { audio: true, video: true });
        const st = await mediaP;
        assert.equal(st.socketId, A.id);
        assert.equal(st.audio, true);
        assert.equal(st.video, true);
    });

    test("media flags visible in room:joined snapshot for late joiner", async () => {
        const { roomId } = await createRoom(A, "Host");
        A.emit("rtc:media", { audio: true, video: false });
        await waitForEvent(A, "rtc:media_state");
        const joinedP = waitForEvent(B, "room:joined");
        B.emit("room:join", { roomId, displayName: "Bravo" });
        const joined = await joinedP;
        const host = joined.members.find((m) => m.socketId === A.id);
        assert.equal(host.audioOn, true);
        assert.equal(host.videoOn, false);
    });
});
```

Note: adapt helper names (`createRoom`, `joinRoom`) to whatever the file already defines; the file likely inlines create/join per test — if no helpers exist, add local ones mirroring existing patterns.

- [ ] **Step 2: Run integration tests**

Run: `node --test test/integration/socket.test.js`
Expected: PASS — existing tests + new rtc block all green

- [ ] **Step 3: Full suite**

Run: `npm test`
Expected: `ℹ tests N` with N = previous count + 7, `ℹ pass N`, `ℹ fail 0`

- [ ] **Step 4: Commit**

```bash
git add backend/test/integration/socket.test.js
git commit -m "test: cover rtc relay and media presence E2E"
```

---

### Task 7: CLI — media + offer relay commands

**Files:**
- Modify: `backend/scripts/socket-cli.js`

- [ ] **Step 1: Add commands**

- Add `"rtc:config"`, `"rtc:media_state"`, `"rtc:offer"`, `"rtc:answer"`, `"rtc:ice"` to the inbound SERVER_EVENTS array (the array the script uses to print all events).
- Add to help after `say <text>`:

```js
"  media <on|off>       — rtc:media { audio, video }",
"  offer <targetId> <sdp> — rtc:offer relay",
```

- In the command switch, after the `say` case add:

```js
case "media": {
    const arg = parts[1];
    if (arg !== "on" && arg !== "off") {
        console.log("Usage: media <on|off>");
        break;
    }
    const v = arg === "on";
    emit("rtc:media", { audio: v, video: v });
    break;
}
case "offer": {
    const to = parts[1];
    const sdp = parts[2];
    if (!to || !sdp) {
        console.log("Usage: offer <targetId> <sdp>");
        break;
    }
    emit("rtc:offer", { to, sdp });
    break;
}
```

(Keep the existing `emit(event, payload)` helper convention used by other commands.)

- [ ] **Step 2: Verify script boots**

Run: `node -e "require('./scripts/socket-cli.js')"` would hang interactively — instead verify syntax:
Run: `node --check backend/scripts/socket-cli.js` (from repo root)
Expected: exit 0, no output

- [ ] **Step 3: Commit**

```bash
git add backend/scripts/socket-cli.js
git commit -m "feat: add rtc commands to socket CLI"
```

---

### Task 8: coturn in docker-compose + TURN env plumbing

**Files:**
- Modify: `docker-compose.yml`

- [ ] **Step 1: Add coturn service**

Modify `docker-compose.yml` to add a `coturn` service after `backend` (same `services:` level), plus env passthrough on backend:

```yaml
  coturn:
    image: coturn/coturn:4.6
    container_name: solace-turn
    restart: unless-stopped
    command: >
      -n --log-file=stdout
      --lt-cred-mech
      --realm=${TURN_REALM:-solace.local}
      --user=${TURN_USER:-solace}:${TURN_PASSWORD:-changeme}
      --fingerprint
      --no-tls
      --no-dtls
    ports:
      - "3478:3478/udp"
      - "3478:3478/tcp"
```

Add to the `backend` service `environment:` section:

```yaml
        - TURN_HOST=${TURN_HOST:-localhost}
        - TURN_PORT=${TURN_PORT:-3478}
        - TURN_USER=${TURN_USER:-solace}
        - TURN_PASSWORD=${TURN_PASSWORD:-changeme}
```

Note security: keep `changeme` default (dev convenience). For production, set `TURN_PASSWORD` in the deploy env. Do NOT add a `.env` file to the repo.

- [ ] **Step 2: Validate compose syntax**

Run: `docker compose config --quiet` (from repo root)
Expected: exit 0, no output

- [ ] **Step 3: Boot stack + verify TURN answers**

Run:
```bash
docker compose up -d --build
sleep 5
docker compose ps
```
Expected: `solace-backend` healthy, `solace-turn` running.

Verify TURN responds:
```bash
docker run --rm --network host coturn/coturn:4.6 --help >/dev/null 2>&1
curl -sS -m 5 http://localhost:8080/ 
```
Then confirm STUN+TURN reachable from host:
```bash
node -e "
const dgram=require('dgram');
const s=dgram.createSocket('udp4');
s.on('message',(m)=>{console.log('TURN/UDP reachable, len='+m.length);s.close();process.exit(0);});
s.on('error',(e)=>{console.log('ERR '+e.message);process.exit(1);});
s.send(Buffer.from([0,0,0,0,0,0,0,0]),3478,'127.0.0.1');
setTimeout(()=>{console.log('no response');process.exit(1);},3000);
"
```
Expected: `TURN/UDP reachable, len=...` (a binding response means the TURN port answers).

- [ ] **Step 4: Verify rtc:config includes TURN when env set**

Restart backend with TURN envs set (already in compose) and check the config event via CLI:
```bash
printf 'quit\n' | node backend/scripts/socket-cli.js http://localhost:8080 2>&1 | grep -A2 "rtc:config"
```
Expected: iceServers shows both `stun:...` and `turn:localhost:3478` entries with username/credential.

- [ ] **Step 5: Tear down**

Run: `docker compose down`
Expected: containers stopped and removed

- [ ] **Step 6: Commit**

```bash
git add docker-compose.yml
git commit -m "build(docker): add coturn TURN server for WebRTC"
```

---

### Task 9: Final verification + branch wrap

- [ ] **Step 1: Full suite**

Run: `npm test` (in `backend/`)
Expected: all pass, `fail 0`

- [ ] **Step 2: Coverage**

Run: `npm run test:coverage` (in `backend/`)
Expected: line coverage ≥ 90%

- [ ] **Step 3: Determinism**

Run: `npm test` a second time
Expected: identical pass count

- [ ] **Step 4: Push**

```bash
git push -u origin v2
```

---