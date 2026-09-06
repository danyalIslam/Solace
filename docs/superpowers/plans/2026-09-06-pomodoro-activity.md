# Pomodoro Timer + Unified Activity Log Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a shared server-driven pomodoro timer and replace the chat channel with a unified, capped activity log (chat becomes one activity type) in the Solace room backend.

**Architecture:** Room state gains `state.timer` (idle/running/paused, server-owned `endsAt`) and `state.activity` (capped 50-entry timeline, replacing `state.chat`). `RoomService` holds the core mutation logic with an injectable clock + scheduler for deterministic tests. New `timerHandler` and `activityHandler` wrap the wire protocol; every existing handler appends an activity entry additive to its broadcast. Wire renames are breaking (`chat:send`→`activity:send`, `chat:message`→`room:activity`, `state.chat`→`state.activity`).

**Tech Stack:** Node 26, CommonJS, socket.io ^4.8.3, node:test + node:assert/strict, node:crypto (`randomUUID`).

**Spec:** `docs/superpowers/specs/2026-09-06-pomodoro-activity-design.md`

---

## Ground rules for every task

- TDD strictly: write failing test → run (verify FAIL) → implement → run (verify PASS) → commit.
- Work on `v2` branch from HEAD `ce3bd4a`. Working tree must be clean between tasks.
- Test command: `cd backend && npm test` (runs `node --test "test/**/*.test.js"`).
- Coverage check: `cd backend && npm run test:coverage` — bar is ≥90% line. Do not let it regress.
- Commit messages: caveman-terse conventional, e.g. `feat: add room timer state machine`.
- `MAX_ROOM_MEMBERS = 4`, `MAX_CHAT_TEXT_LENGTH = 500` currently in RoomService; activity reuses the chat text limit and history cap.

---

## File structure map

- `backend/src/rooms/Room.js` — room state (holds `playback`, `wallpaper`, `activity`, `title`, `timer`).
- `backend/src/rooms/RoomService.js` — all room mutations + errors + constants; join/leave/sendActivity/timer core; injectable clock/scheduler.
- `backend/src/socket/events.js` — CLIENT/SERVER event name constants.
- `backend/src/socket/handlers/activityHandler.js` — NEW: `activity:send` inbound.
- `backend/src/socket/handlers/timerHandler.js` — NEW: `timer:start|pause|reset` inbound + completion fan-out.
- `backend/src/socket/handlers/roomHandler.js` — create/join/leave/getState/title; appends system/activity entries.
- `backend/src/socket/handlers/{playback,wallpaper,rtc}Handler.js` — append activity entries (additive).
- `backend/src/socket/index.js` — register new handlers/events, remove `chat:send`.
- `backend/scripts/socket-cli.js` — rename `say`, add timer commands.
- `backend/scripts/smoke.js` — extend scenario.
- Tests: `backend/test/unit/room.test.js`, `backend/test/unit/roomService.test.js`, `backend/test/integration/socket.test.js`.
- `docs/frontend-design/design-prompt.md` — refresh state/event names.

---

## Task 1: Room state — activity + timer fields

**Files:**
- Modify: `backend/src/rooms/Room.js`
- Test: `backend/test/unit/room.test.js`

- [ ] **Step 1: Write the failing test**

Add to `backend/test/unit/room.test.js` inside the existing "state shape" describe. Read the current test file first to match its exact constructor/assertions. The current default-state test asserts `room.state.chat` deep-equals `[]`. Replace that assertion and add timer assertions:

```js
// replace: assert.deepEqual(room.state.chat, []);
assert.deepEqual(room.state.activity, []);
assert.deepEqual(room.state.timer, {
    status: "idle",
    durationMs: 0,
    remainingMs: 0,
    endsAt: null,
    startedBy: null,
    startedAt: null,
    updatedAt: room.state.timer.updatedAt // any number; assert existence separately
});
```

Add a dedicated check:

```js
test("room state exposes activity and timer defaults", () => {
    const room = new Room("ABC123");
    assert.deepEqual(room.state.activity, []);
    assert.equal(room.state.timer.status, "idle");
    assert.equal(room.state.timer.endsAt, null);
    assert.equal(typeof room.state.timer.updatedAt, "number");
    assert.ok(!("chat" in room.state), "chat must be removed from room state");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && node --test test/unit/room.test.js`
Expected: FAIL — `room.state.timer` undefined, `room.state.chat` still present.

- [ ] **Step 3: Implement**

In `Room.js`, replace the `chat: []` line in the constructor `state` object with `activity: []`, and add `timer` after `title`:

```js
this.state = {
    playback: { status: "paused", track: null, position: 0, updatedAt: Date.now() },
    wallpaper: { url: null },
    activity: [],
    title: "",
    timer: {
        status: "idle",
        durationMs: 0,
        remainingMs: 0,
        endsAt: null,
        startedBy: null,
        startedAt: null,
        updatedAt: Date.now()
    }
};
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && node --test test/unit/room.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/rooms/Room.js backend/test/unit/room.test.js
git commit -m "feat: add activity + timer fields to room state"
```

---

## Task 2: RoomService activity core (appendActivity + sendActivity)

**Files:**
- Modify: `backend/src/rooms/RoomService.js`
- Test: `backend/test/unit/roomService.test.js`

- [ ] **Step 1: Write the failing test**

Add a describe block to `backend/test/unit/roomService.test.js`. Match the existing file's imports (currently imports `InvalidPayloadError, TargetNotInRoomError, ...` from RoomService). Add `MAX_ACTIVITY_HISTORY` to the destructured imports. Read the test file's setup (`service = new RoomService(...)` pattern, `socketId` constant) and reuse it.

```js
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && node --test test/unit/roomService.test.js`
Expected: FAIL — `sendActivity`/`appendActivity` not a function, `MAX_ACTIVITY_HISTORY` undefined.

- [ ] **Step 3: Implement**

In `RoomService.js`:

Replace constant line:
```js
const MAX_CHAT_HISTORY = 50;
```
with:
```js
const MAX_ACTIVITY_HISTORY = 50;
```
(keep `MAX_CHAT_TEXT_LENGTH = 500` — reused as the text length cap for chat-type activity).

Delete the `sendChat` method entirely. Add these methods (place near `setTitle`):

```js
appendActivity(roomId, { type, actor, detail }) {
    const room = this._assertRoom(roomId);
    const entry = {
        id: require("crypto").randomUUID(),
        type,
        actor,
        detail,
        at: Date.now()
    };
    room.state.activity.push(entry);
    if (room.state.activity.length > MAX_ACTIVITY_HISTORY) {
        room.state.activity = room.state.activity.slice(-MAX_ACTIVITY_HISTORY);
    }
    return { room, entry };
}

sendActivity(roomId, socketId, text) {
    const room = this._assertRoom(roomId);
    this._assertMember(room, socketId);
    if (typeof text !== "string" || text.trim().length === 0 || text.length > MAX_CHAT_TEXT_LENGTH) {
        throw new InvalidPayloadError(`text must be a non-empty string of at most ${MAX_CHAT_TEXT_LENGTH} chars`);
    }
    const member = room.members.get(socketId);
    return this.appendActivity(room.id, {
        type: "chat",
        actor: { socketId, displayName: member.displayName },
        detail: text.trim()
    });
}
```

Update the exports block at the bottom: replace `module.exports.MAX_CHAT_HISTORY = MAX_CHAT_HISTORY;` with `module.exports.MAX_ACTIVITY_HISTORY = MAX_ACTIVITY_HISTORY;`.

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && npm test`
Expected: PASS. NOTE — other existing tests still reference `sendChat`, `MAX_CHAT_HISTORY`, `state.chat`, `chat:message`. Those will FAIL until Tasks 3–5 land. That is acceptable mid-plan; do NOT fix them here. Confirm only the new activity tests pass and the chat-related failures are precisely the "not yet migrated" set.

- [ ] **Step 5: Commit**

```bash
git add backend/src/rooms/RoomService.js backend/test/unit/roomService.test.js
git commit -m "feat: add activity log core to RoomService"
```

---

## Task 3: RoomService timer core (injectable clock/scheduler)

**Files:**
- Modify: `backend/src/rooms/RoomService.js`
- Test: `backend/test/unit/roomService.test.js`

- [ ] **Step 1: Write the failing test**

Add to `backend/test/unit/roomService.test.js`. Note the timer tests use an injected fake clock + scheduler so they are deterministic (no real waits). The fake scheduler captures the pending callback; tests fire it manually.

```js
describe("timer", () => {
    function makeTimerService() {
        let now = 1_000_000;
        let pending = null; // { fn, ms }
        const clock = { now: () => now, advance: (ms) => { now += ms; } };
        const schedule = (fn, ms) => { pending = { fn, ms }; return 1; };
        const cancel = () => { pending = null; };
        const s = new RoomService(undefined, { now: clock.now, schedule, cancel });
        // Fake store:
        s.store = { all: () => [], get: () => null, create: () => null };
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
        const { s, clock, fire } = makeTimerService();
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
        const { s, clock, fire } = makeTimerService();
        const { roomId } = s.createRoom("H", socketId);
        s.startTimer(roomId, socketId, 1);
        const completion = { called: false, result: null };
        // register the onComplete callback the service uses
        s.startTimer(roomId, socketId, 1, (r) => { completion.called = true; completion.result = r; });
        fire();
        assert.equal(completion.called, true, "onComplete must fire on schedule");
        assert.equal(completion.result.status, "idle");
        assert.equal(completion.result.timer.status, "idle");
        assert.equal(completion.result.timer.durationMs, 1 * 60_000);
        assert.equal(completion.result.timer.completed, true);
    });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && node --test test/unit/roomService.test.js`
Expected: FAIL — `startTimer`/`pauseTimer`/`resetTimer` not functions.

- [ ] **Step 3: Implement**

The fake clock/scheduler lands on the constructor. Rewrite the constructor:

```js
constructor(store, timers) {
    this.store = store;
    this._now = (timers && timers.now) || (() => Date.now());
    this._schedule = (timers && timers.schedule) || ((fn, ms) => setTimeout(fn, ms));
    this._cancel = (timers && timers.cancel) || ((id) => clearTimeout(id));
}
```

Add timer constants near the top:
```js
const MIN_TIMER_MINUTES = 1;
const MAX_TIMER_MINUTES = 180;
```

Add methods (place after `setTitle`):

```js
startTimer(roomId, socketId, minutes, onComplete) {
    const room = this._assertRoom(roomId);
    this._assertMember(room, socketId);
    if (typeof minutes !== "number" || !Number.isFinite(minutes) || minutes < MIN_TIMER_MINUTES || minutes > MAX_TIMER_MINUTES) {
        throw new InvalidPayloadError(`minutes must be a number between ${MIN_TIMER_MINUTES} and ${MAX_TIMER_MINUTES}`);
    }
    if (room.timerHandle) this._cancel(room.timerHandle);
    const durationMs = minutes * 60_000;
    const startedAt = this._now();
    Object.assign(room.state.timer, {
        status: "running",
        durationMs,
        remainingMs: durationMs,
        endsAt: startedAt + durationMs,
        startedBy: socketId,
        startedAt,
        updatedAt: startedAt
    });
    const handle = this._schedule(() => {
        room.state.timer.endsAt = null;
        room.state.timer.startedAt = null;
        room.state.timer.startedBy = null;
        if (typeof onComplete === "function") {
            onComplete({
                status: "idle",
                timer: { ...room.state.timer, status: "idle", completed: true }
            });
        }
    }, durationMs);
    room.timerHandle = handle;
    return { room, timer: { ...room.state.timer } };
}

pauseTimer(roomId, socketId) {
    const room = this._assertRoom(roomId);
    this._assertMember(room, socketId);
    const t = room.state.timer;
    if (t.status !== "running") throw new InvalidPayloadError("Timer is not running");
    const now = this._now();
    if (room.timerHandle) { this._cancel(room.timerHandle); room.timerHandle = null; }
    const remainingMs = t.endsAt ? Math.max(0, t.endsAt - now) : t.remainingMs;
    Object.assign(t, { status: "paused", remainingMs, endsAt: null, updatedAt: now });
    return { room, timer: { ...t } };
}

resetTimer(roomId, socketId) {
    const room = this._assertRoom(roomId);
    this._assertMember(room, socketId);
    if (room.timerHandle) { this._cancel(room.timerHandle); room.timerHandle = null; }
    Object.assign(room.state.timer, {
        status: "idle", durationMs: 0, remainingMs: 0, endsAt: null,
        startedBy: null, startedAt: null, updatedAt: this._now()
    });
    return { room, timer: { ...room.state.timer } };
}
```

NOTE: `room.timerHandle` is a transient field on the Room instance, not part of public state — `toPublicState` only serializes `members` + `state`, so it stays internal. Confirm the fake `fire()` path: in the test, `onComplete` is passed on the SECOND `startTimer` call, so the first arming is overwritten before firing.

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && node --test test/unit/roomService.test.js`
Expected: PASS for the timer describe block. (Chat-related failures elsewhere remain, as in Task 2.)

- [ ] **Step 5: Commit**

```bash
git add backend/src/rooms/RoomService.js backend/test/unit/roomService.test.js
git commit -m "feat: add injectable-clock room timer state machine"
```

---

## Task 4: Wire events — events.js renames + additions

**Files:**
- Modify: `backend/src/socket/events.js`

- [ ] **Step 1: Edit the CLIENT object**

Replace `CHAT_SEND: "chat:send",` with `ACTIVITY_SEND: "activity:send",` and add timer client events after `ROOM_SET_TITLE`:

```js
const CLIENT = {
    ROOM_CREATE: "room:create",
    ROOM_JOIN: "room:join",
    ROOM_LEAVE: "room:leave",
    ROOM_GET_STATE: "room:get_state",
    ROOM_SET_TITLE: "room:set_title",
    ACTIVITY_SEND: "activity:send",
    TIMER_START: "timer:start",
    TIMER_PAUSE: "timer:pause",
    TIMER_RESET: "timer:reset",
    PLAYBACK_PLAY: "playback:play",
    PLAYBACK_PAUSE: "playback:pause",
    PLAYBACK_SEEK: "playback:seek",
    PLAYBACK_SET_TRACK: "playback:set_track",
    WALLPAPER_SET: "wallpaper:set",
    RTC_MEDIA: "rtc:media",
    RTC_OFFER: "rtc:offer",
    RTC_ANSWER: "rtc:answer",
    RTC_ICE: "rtc:ice"
};
```

- [ ] **Step 2: Edit the SERVER object**

Replace `CHAT_MESSAGE: "chat:message",` with `ROOM_ACTIVITY: "room:activity",` and add timer server events after `ROOM_TITLE_STATE`:

```js
    ROOM_TITLE_STATE: "room:title_state",
    ROOM_ACTIVITY: "room:activity",
    TIMER_STATE: "timer:state",
    TIMER_COMPLETE: "timer:complete",
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/socket/events.js
git commit -m "feat: define activity + timer wire events"
```

---

## Task 5: activityHandler + rewire roomHandler/index.js (wire activity:send)

**Files:**
- Create: `backend/src/socket/handlers/activityHandler.js`
- Modify: `backend/src/socket/handlers/roomHandler.js` (append system entries on join/leave/create)
- Modify: `backend/src/socket/index.js` (register activity handler, remove chat, add room:activity broadcast)
- Test: `backend/test/integration/socket.test.js`

- [ ] **Step 1: Write the failing integration test**

Add to `backend/test/integration/socket.test.js`. Read existing `createRoom`/`joinRoom` helpers to reuse. Existing tests reference `chat:send`/`chat:message`; you may leave them broken for now (Task 7 rewrites them), but add new ones:

```js
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
        const { joined } = await joinRoom(port, roomId, "Guest");
        // host snapshot (create) should contain a system entry for creation
        const sys = await waitForEvent(host, "room:activity", (p) => p.entry && p.entry.type === "system");
        assert.ok(sys.entry.detail.length > 0);
        assert.ok(joined.state.activity.length >= 1, "late joiner sees prior activity");
    });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && node --test test/integration/socket.test.js`
Expected: FAIL — no `activity:send` handler, no `room:activity` broadcast.

- [ ] **Step 3: Create activityHandler.js**

```js
const { SERVER } = require("../events");

function createActivityHandler(io, roomService) {
    function emitError(socket, err) {
        socket.emit(SERVER.ROOM_ERROR, { code: err.code, message: err.message });
    }

    return {
        handleSend(socket, payload) {
            try {
                const room = roomService.resolveRoomBySocket(socket.id);
                if (!room) {
                    emitError(socket, Object.assign(new Error("Not a member of this room"), { code: "NOT_IN_ROOM" }));
                    return;
                }
                const text = payload && payload.text;
                const { room: updatedRoom, entry } = roomService.sendActivity(room.id, socket.id, text);
                io.to(updatedRoom.id).emit(SERVER.ROOM_ACTIVITY, { entry });
            } catch (err) {
                emitError(socket, err);
            }
        }
    };
}

module.exports = createActivityHandler;
```

- [ ] **Step 4: Modify roomHandler.js — append system entries**

In `handleCreate`, after `socket.join(roomId)` and BEFORE building `pub`, append a system entry:

```js
socket.join(roomId);
roomService.appendActivity(roomId, {
    type: "system",
    actor: { socketId: socket.id, displayName },
    detail: "created room"
});
const pub = room.toPublicState();
```

In `handleJoin`, after `socket.join(roomId)`:

```js
socket.join(roomId);
roomService.appendActivity(roomId, {
    type: "system",
    actor: { socketId: socket.id, displayName },
    detail: "joined"
});
const pub = room.toPublicState();
```

In `handleLeave`, after `roomService.leaveRoom(...)`:

```js
roomService.leaveRoom(room.id, socket.id);
roomService.appendActivity(room.id, {
    type: "system",
    actor: { socketId: socket.id, displayName: "unknown" },
    detail: "left"
});
```

NOTE: in `handleLeave` the member may be hard to fetch after removal; store displayName BEFORE calling `leaveRoom`:
```js
const member = room.members.get(socket.id);
const displayName = member ? member.displayName : "unknown";
roomService.leaveRoom(room.id, socket.id);
roomService.appendActivity(room.id, { type: "system", actor: { socketId: socket.id, displayName }, detail: "left" });
```
The room:activity broadcast for join/leave entries can be sent right after, in the handler, since the actor is the initiator and everyone else should hear it: `io.to(room.id).emit(SERVER.ROOM_ACTIVITY, { entry })`.

- [ ] **Step 5: Modify index.js — register activity handler, drop chat, wire broadcasts**

Top requires: swap `createChatHandler`/`chatHandler` for `createActivityHandler`/`activityHandler`:
```js
const createActivityHandler = require("./handlers/activityHandler");
```
In the handler instantiation block replace `const chatHandler = createChatHandler(io, roomService);` with `const activityHandler = createActivityHandler(io, roomService);`.

Replace the `socket.on(CLIENT.CHAT_SEND, ...)` line with:
```js
socket.on(CLIENT.ACTIVITY_SEND, (payload) => activityHandler.handleSend(socket, payload));
socket.on(CLIENT.TIMER_START, (payload) => timerHandler.handleStart(socket, payload));
socket.on(CLIENT.TIMER_PAUSE, () => timerHandler.handlePause(socket));
socket.on(CLIENT.TIMER_RESET, () => timerHandler.handleReset(socket));
```
(Registering `timerHandler` references is fine if Task 6 creates the file before you run — sequence Task 5 then Task 6 to keep `npm test` green, OR create a stub. Do Task 5 fully, then Task 6 immediately.)

Also in the `disconnect` handler, append a system "left" entry:
```js
socket.on("disconnect", () => {
    const room = roomService.resolveRoomBySocket(socket.id);
    if (!room) return;
    const member = room.members.get(socket.id);
    const displayName = member ? member.displayName : "unknown";
    roomService.leaveRoom(room.id, socket.id);
    const { entry } = roomService.appendActivity(room.id, { type: "system", actor: { socketId: socket.id, displayName }, detail: "left" });
    io.to(room.id).emit(SERVER.ROOM_MEMBER_LEFT, { socketId: socket.id });
    io.to(room.id).emit(SERVER.ROOM_ACTIVITY, { entry });
});
```

- [ ] **Step 6: Run integration tests to verify new ones pass**

Run: `cd backend && node --test test/integration/socket.test.js`
Expected: the two new `activity` tests PASS. Chat-related failures remain (Task 7 rewrites them).

- [ ] **Step 7: Commit**

```bash
git add backend/src/socket/handlers/activityHandler.js backend/src/socket/handlers/roomHandler.js backend/src/socket/index.js backend/test/integration/socket.test.js
git commit -m "feat: wire activity:send handler and system join/leave entries"
```

---

## Task 6: timerHandler + wire timer:state/complete

**Files:**
- Create: `backend/src/socket/handlers/timerHandler.js`
- Modify: `backend/src/socket/index.js` (already has `timerHandler` registration from Task 5 — create the real file)
- Test: `backend/test/integration/socket.test.js`

- [ ] **Step 1: Write the failing integration test**

Add to `backend/test/integration/socket.test.js`:

```js
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
    });

    test("non-member or bad minutes -> room:error", async () => {
        const { port } = await boot();
        const { client: host } = await createRoom(port, "Host");
        const errP = waitForEvent(host, "room:error", (p) => p.code === "INVALID_PAYLOAD");
        host.emit("timer:start", { minutes: 999 });
        const err = await errP;
        assert.equal(err.code, "INVALID_PAYLOAD");
    });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && node --test test/integration/socket.test.js`
Expected: FAIL — `timerHandler` file missing / require error.

- [ ] **Step 3: Create timerHandler.js**

```js
const { SERVER } = require("../events");

function createTimerHandler(io, roomService) {
    function emitError(socket, err) {
        socket.emit(SERVER.ROOM_ERROR, { code: err.code, message: err.message });
    }

    function requireRoom(socket) {
        const room = roomService.resolveRoomBySocket(socket.id);
        if (!room) {
            emitError(socket, Object.assign(new Error("Not a member of this room"), { code: "NOT_IN_ROOM" }));
            return null;
        }
        return room;
    }

    function logTimer(room, actor, detail) {
        const { entry } = roomService.appendActivity(room.id, {
            type: "timer",
            actor,
            detail
        });
        io.to(room.id).emit(SERVER.ROOM_ACTIVITY, { entry });
    }

    return {
        handleStart(socket, payload) {
            const room = requireRoom(socket);
            if (!room) return;
            try {
                const minutes = payload && payload.minutes;
                const member = room.members.get(socket.id);
                const actor = { socketId: socket.id, displayName: member.displayName };
                const { room: updatedRoom, timer } = roomService.startTimer(room.id, socket.id, minutes, (completion) => {
                    io.to(updatedRoom.id).emit(SERVER.TIMER_COMPLETE, {
                        completedBy: actor.socketId,
                        durationMs: completion.timer.durationMs
                    });
                    io.to(updatedRoom.id).emit(SERVER.TIMER_STATE, completion.timer);
                    logTimer(updatedRoom, actor, "timer finished");
                });
                io.to(updatedRoom.id).emit(SERVER.TIMER_STATE, timer);
                logTimer(updatedRoom, actor, `started ${minutes}min timer`);
            } catch (err) {
                emitError(socket, err);
            }
        },
        handlePause(socket) {
            const room = requireRoom(socket);
            if (!room) return;
            try {
                const member = room.members.get(socket.id);
                const actor = { socketId: socket.id, displayName: member.displayName };
                const { room: updatedRoom, timer } = roomService.pauseTimer(room.id, socket.id);
                io.to(updatedRoom.id).emit(SERVER.TIMER_STATE, timer);
                logTimer(updatedRoom, actor, "paused timer");
            } catch (err) {
                emitError(socket, err);
            }
        },
        handleReset(socket) {
            const room = requireRoom(socket);
            if (!room) return;
            try {
                const member = room.members.get(socket.id);
                const actor = { socketId: socket.id, displayName: member.displayName };
                const { room: updatedRoom, timer } = roomService.resetTimer(room.id, socket.id);
                io.to(updatedRoom.id).emit(SERVER.TIMER_STATE, timer);
                logTimer(updatedRoom, actor, "reset timer");
            } catch (err) {
                emitError(socket, err);
            }
        }
    };
}

module.exports = createTimerHandler;
```

- [ ] **Step 4: In index.js add the require + instantiate**

Top:
```js
const createTimerHandler = require("./handlers/timerHandler");
```
Instantiations:
```js
const timerHandler = createTimerHandler(io, roomService);
```
(`socket.on` registrations already exist from Task 5; if Task 5 was skipped, add them now.)

- [ ] **Step 5: Run integration tests**

Run: `cd backend && node --test test/integration/socket.test.js`
Expected: new `timer` tests PASS. Existing chat tests still failing (Task 7).

For the "completion" path, integration can't easily wait a real timer without a long pause. Skip an integration completion test — unit tests in Task 3 already cover completion deterministically via the injected scheduler. Coverage for timerHandler completion branch is covered by reading; add a `SMOKE` assertion in Task 8 instead if desired.

- [ ] **Step 6: Commit**

```bash
git add backend/src/socket/handlers/timerHandler.js backend/src/socket/index.js backend/test/integration/socket.test.js
git commit -m "feat: add timer handler with state + complete broadcast"
```

---

## Task 7: Append activity on playback/wallpaper/media/title handlers

**Files:**
- Modify: `backend/src/socket/handlers/playbackHandler.js`
- Modify: `backend/src/socket/handlers/wallpaperHandler.js`
- Modify: `backend/src/socket/handlers/rtcHandler.js`
- Modify: `backend/src/socket/handlers/roomHandler.js` (title entry)
- Test: `backend/test/integration/socket.test.js`

- [ ] **Step 1: Write failing integration tests (append entries)**

Add to `backend/test/integration/socket.test.js`:

```js
describe("activity entries from actions", () => {
    async function lastEntry(port, act) {
        // helper: join observer and read snapshot activity tail
        const { joined } = await joinRoom(port, "ACTROOM", "Obs");
        const tail = joined.state.activity;
        return tail[tail.length - 1];
    }

    test("wallpaper set produces a wallpaper-type entry", async () => {
        const { port } = await boot();
        const { client: host, roomId } = await createRoom(port, "Host");
        host.emit("wallpaper:set", { url: "http://w/1.png" });
        await waitForEvent(host, "wallpaper:state");
        const last = await lastEntry(port, "ACTROOM");
        assert.equal(last.type, "wallpaper");
        assert.match(last.detail, /wallpaper/i);
    });

    test("title set produces a title-type entry", async () => {
        const { port } = await boot();
        const { client: host, roomId } = await createRoom(port, "Host");
        host.emit("room:set_title", { title: "My Room" });
        await waitForEvent(host, "room:title_state");
        const last = await lastEntry(port, "ACTROOM");
        assert.equal(last.type, "title");
        assert.match(last.detail, /My Room/);
    });

    test("media change produces a media-type entry", async () => {
        const { port } = await boot();
        const { client: host, roomId } = await createRoom(port, "Host");
        host.emit("rtc:media", { audio: true, video: false });
        await waitForEvent(host, "rtc:media_state");
        const last = await lastEntry(port, "ACTROOM");
        assert.equal(last.type, "media");
    });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && node --test test/integration/socket.test.js`
Expected: FAIL — entries absent.

- [ ] **Step 3: Implement appends**

In `wallpaperHandler.js` `handleSetWallpaper`, add a helper + append after emitting:

```js
const detail = `set wallpaper ${newUrl}`;
const actor = { socketId: socket.id, displayName: roomService.resolveRoomBySocket(socket.id).members.get(socket.id).displayName };
const { entry } = roomService.appendActivity(updatedRoom.id, { type: "wallpaper", actor, detail });
io.to(updatedRoom.id).emit(SERVER.ROOM_ACTIVITY, { entry });
```

In `playbackHandler.js`, add a helper `appendActivity(room, socket, detail)` and call it in each of `handlePlay`/`handlePause`/`handleSeek`/`handleSetTrack`:
```js
function appendActivity(room, socket, detail) {
    const member = room.members.get(socket.id);
    const actor = { socketId: socket.id, displayName: member ? member.displayName : "unknown" };
    const { entry } = roomService.appendActivity(room.id, { type: "playback", actor, detail });
    io.to(room.id).emit(SERVER.ROOM_ACTIVITY, { entry });
}
```
Call sites:
- `handlePlay`: `appendActivity(updatedRoom, socket, \`play ${change.track ? change.track.url : "paused"}\`);` — use `track ? \`played ${track.url}\` : "played"`.
- `handlePause`: `appendActivity(updatedRoom, socket, "paused playback")`.
- `handleSeek`: `` `seeked to ${change.position}s` ``.
- `handleSetTrack`: `` `set track ${change.track.url}` ``.

In `rtcHandler.js` `handleMedia`, after emitting media state:
```js
const member2 = room.members.get(socket.id);
const actor = { socketId: socket.id, displayName: member2.displayName };
const detail = member.audioOn && member.videoOn ? "camera+mic on" : (member.videoOn ? "camera on" : (member.audioOn ? "mic on" : "camera+mic off"));
const { entry } = roomService.appendActivity(room.id, { type: "media", actor, detail });
io.to(room.id).emit(SERVER.ROOM_ACTIVITY, { entry });
```

In `roomHandler.js` `handleSetTitle`, after the title broadcast:
```js
const member = room.members.get(socket.id);
const actor = { socketId: socket.id, displayName: member.displayName };
const { entry } = roomService.appendActivity(room.id, { type: "title", actor, detail: `set title to ${result.title}` });
io.to(room.id).emit(SERVER.ROOM_ACTIVITY, { entry });
```

- [ ] **Step 4: Run integration tests**

Run: `cd backend && node --test test/integration/socket.test.js`
Expected: new entry tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/socket/handlers/playbackHandler.js backend/src/socket/handlers/wallpaperHandler.js backend/src/socket/handlers/rtcHandler.js backend/src/socket/handlers/roomHandler.js backend/test/integration/socket.test.js
git commit -m "feat: append activity entries across action handlers"
```

---

## Task 8: Rewrite chat tests + CLI + smoke + docs to the activity contract

**Files:**
- Modify: `backend/test/unit/roomService.test.js`
- Modify: `backend/test/integration/socket.test.js`
- Modify: `backend/scripts/socket-cli.js`
- Modify: `backend/scripts/smoke.js`
- Modify: `docs/frontend-design/design-prompt.md`

- [ ] **Step 1: Migrate unit tests**

In `backend/test/unit/roomService.test.js`, replace the old chat describe block (`sendChat`, `MAX_CHAT_HISTORY` references, `state.chat` assertions) with activity equivalents. The chat cap test becomes:

```js
test("chat activity capped at MAX_ACTIVITY_HISTORY drops oldest", () => {
    const { roomId } = service.createRoom("H", socketId);
    for (let i = 0; i < 55; i++) service.sendActivity(roomId, socketId, "msg-" + i);
    const act = service.getState(roomId).state.activity;
    assert.equal(act.length, MAX_ACTIVITY_HISTORY);
    assert.ok(!act.some((e) => e.detail === "msg-0"), "oldest dropped");
    assert.equal(act[act.length - 1].detail, "msg-54");
});
```
Remove `MAX_CHAT_HISTORY` import, add `MAX_ACTIVITY_HISTORY`, `MAX_CHAT_TEXT_LENGTH`.

- [ ] **Step 2: Migrate integration tests**

In `backend/test/integration/socket.test.js`, rewrite all `chat:send`/`chat:message`/`state.chat` references:
- Send via `activity:send`. Receive via `room:activity` where `entry.type === "chat"` and `entry.senderId`-equivalent is `entry.actor.socketId`, text is `entry.detail`.
- The "chat history in snapshot" tests now read `joined.state.activity`.

- [ ] **Step 3: Update socket-cli.js**

- In `SERVER_EVENTS`, replace `"chat:message"` with `"room:activity"`, add `"timer:state"`, `"timer:complete"`.
- Rename the `say` command to send `activity:send { text }`, keep help text updated:
```js
case "say":
    emit("activity:send", { text: rest.join(" ") });
    break;
```
- Add help lines:
```
"  timer <minutes>     — timer:start",
"  timer pause         — timer:pause",
"  timer reset         — timer:reset",
```
- Add cases:
```js
case "timer":
    if (arg0 === "pause") { emit("timer:pause"); break; }
    if (arg0 === "reset") { emit("timer:reset"); break; }
    const m = Number(arg0);
    if (!arg0 || Number.isNaN(m) || m < 1 || m > 180) {
        console.log("Usage: timer <minutes 1-180> | pause | reset");
        break;
    }
    emit("timer:start", { minutes: m });
    break;
```

- [ ] **Step 4: Update smoke.js**

- Replace the `chat:send` step: use `activity:send`, listen `room:activity` with `entry.type === "chat"` and `entry.actor.socketId === B.id`.
- Add timer steps after chat:
```js
const timerP = waitFor(B, "timer:state", (p) => p.status === "running");
A.emit("timer:start", { minutes: 25 });
const t = await timerP;
pass("timer start syncs host -> guest", `duration=${t.durationMs}ms`);
```
- Add a "chat is in activity" assertion: read `joined.state.activity` in an existing step to confirm a chat entry present.

- [ ] **Step 5: Update design-prompt.md**

Replace references to `state.chat`, `chat:send`, `chat:message` with `state.activity`, `activity:send`, `room:activity`; add `state.timer`, `timer:start|pause|reset`, `timer:state`, `timer:complete`.

- [ ] **Step 6: Full verification**

Run: `cd backend && npm test`
Expected: ALL PASS (no chat remnants). If any `chat:` or `state.chat` references remain, grep and fix:
```bash
cd backend && rg -n "chat:|state\.chat|CHAT_MESSAGE|CHAT_SEND" src test scripts
```
Run: `cd backend && npm run test:coverage` — confirm ≥90% line overall (watch roomHandler.js, timerHandler.js coverage).
Run: `cd backend && node --check scripts/socket-cli.js && node --check scripts/smoke.js`
Run smoke: `cd backend && node scripts/smoke.js` — 13+ steps PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/test backend/scripts docs/frontend-design/design-prompt.md
git commit -m "feat: migrate tests, cli, smoke, docs to activity contract"
```

---

## Task 9 (final): Full-suite gate

**Files:** none (verification + commit if needed)

- [ ] **Step 1: Verify clean full suite**

```bash
cd backend && npm test && npm run test:coverage
git status --short   # expect clean
```
Expected: ALL tests pass, ≥90% line coverage, working tree clean.

- [ ] **Step 2: Live smoke**

```bash
cd backend && node scripts/smoke.js
```
Expected: all steps PASS, exit 0.

- [ ] **Step 3: Confirm no stale references**

```bash
cd backend && rg -n "chat:send|chat:message|state\.chat|CHAT_MESSAGE" src scripts test
```
Expected: zero matches. (Allow `MAX_CHAT_TEXT_LENGTH` and the word "chat" as an activity type.)

- [ ] **Step 4: Commit any residual cleanup (if non-empty)**

```bash
git add -A && git commit -m "chore: finalize activity + timer migration"
```

---

## Self-review notes

- **Spec coverage:** timer state machine (T3/T6) ✓; custom minutes 1–180 (T3/T6) ✓; any-room control (T6, no host check) ✓; one timer/room (single `state.timer`) ✓; activity cap 50 + entry shape (T2) ✓; chat-as-activity (T2/T5/T8) ✓; system join/leave entries (T5) ✓; timer system entry on complete (T6) ✓; `chat:*` removal (T4/T5/T8) ✓; injectable clock (T3) ✓; smoke extends (T8) ✓. Breakage acknowledged pre-frontend.
- **Type/method consistency:** `startTimer(roomId, socketId, minutes, onComplete)`; `pauseTimer/resetTimer(roomId, socketId)`; `appendActivity(roomId, {type,actor,detail})`; `sendActivity(roomId, socketId, text)`; completion callback receives `{ status, timer }`. Entry shape `{id, type, actor, detail, at}`. Event names match events.js. `Scripting`: roomHandler `handleCreate` now needs displayName in scope (it has `displayName` already).
- **Deferred breakage:** Tasks 2–6 knowingly leave older chat tests red. Task 8 restores green. Ground rules say each task commits; intermediate red is documented and expected.
