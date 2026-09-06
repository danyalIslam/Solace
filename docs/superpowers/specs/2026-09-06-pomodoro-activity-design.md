# Pomodoro Timer + Unified Activity Log — Design

Date: 2026-09-06
Status: Approved (inline brainstorm)
Branch: v2

## 1. Purpose

Add two backend features to the Solace room, pre-frontend (cheapest time for wire-contract changes):

1. **Pomodoro timer** — one shared, server-driven countdown per room. Anyone in the room
   controls it. Custom duration (minutes, 1–180). Option A semantics: single countdown,
   no auto-repeat cycles.
2. **Unified activity log** — a single capped timeline replaces the chat channel. Chat
   messages become one kind of activity; system events (join/leave/timer) are logged too.

## 2. Scope / non-goals

- One timer per room, not parallel timers.
- No classic pomodoro cycle state machine (focus/break auto-alternation). Out of scope.
- No entitlements/roles beyond existing host flag (timer is anyone-control).
- No frontend work. Wire contract + backend only.
- Breaking wire-contract change is accepted: `chat:*` events and `state.chat` are
  removed/replaced. This is the cheapest time because no frontend exists yet.

## 3. Timer design

Single server-driven countdown owned by the room. No per-second tick over the wire;
clients render a countdown from the authoritative state (`remainingMs`, `endsAt`).

### 3.1 State

Stored on the room: `state.timer`:

```js
{
  status: "idle" | "running" | "paused",
  durationMs: number,     // total duration in ms (the configured custom duration)
  remainingMs: number,    // remaining ms when idle/paused (authoritative base)
  endsAt: number|null,    // epoch ms when a running timer fires (server clock)
  startedBy: socketId|null,
  startedAt: number|null, // epoch ms the running timer was started
  updatedAt: number       // epoch ms of last timer state change
}
```

### 3.2 Wire protocol

| Direction | Event | Payload |
|---|---|---|
| C→S | `timer:start` | `{ minutes: number }` (1–180) |
| C→S | `timer:pause` | — |
| C→S | `timer:reset` | — |
| S→C | `timer:state` | full `state.timer` (broadcast room-wide on every change) |
| S→C | `timer:complete` | `{ completedBy, durationMs }` (broadcast when a running timer fires) |

### 3.3 Transitions

- **start** (idle|paused|running → running): re-arm with new duration.
  `durationMs = minutes*60_000`, `remainingMs = durationMs`, `endsAt = now + durationMs`,
  `startedBy = initiator`, `startedAt = now`. Clear any pending timer.
- **pause** (running → paused): cancel timer, `remainingMs = endsAt - now`, `endsAt = null`.
- **reset** (any → idle): cancel timer, clear `durationMs/remainingMs/endsAt/startedBy/startedAt`.
- **fire** (running, after `durationMs`): broadcast `timer:complete`, transition to idle,
  broadcast `timer:state { status:"idle", completed:true, completedBy, durationMs }`,
  append `type:"system"` activity entry.

### 3.4 Clock / timer injection

Timer depends on real `setTimeout` + `Date.now()`. For deterministic unit tests, inject a
clock and a timer scheduler:

- `RoomService` accepts an optional clock (`now()`) and a `schedule(fn, ms)` + `cancel()`
  abstraction, defaulting to real `setTimeout`/`clearTimeout` and `Date.now()`.
- Tests inject a fake clock (manual advance) and a controllable scheduler so no real waits.

### 3.5 Errors

All timer control events reject via `emitError` → `room:error`:
- minutes not a finite number, < 1, or > 180 → `INVALID_PAYLOAD`
- caller not a member → `NOT_IN_ROOM`
- room missing → `ROOM_NOT_FOUND`

## 4. Activity log design

Single capped timeline replaces chat. One array, one cap, one broadcast stream.

### 4.1 State

`state.activity: ActivityEntry[]` replaces `state.chat`. Cap `MAX_ACTIVITY_HISTORY = 50`
(reuses the previous 50-entry chat budget). Oldest entries dropped on overflow.

### 4.2 Entry shape

```js
{
  id: string,                    // unique per room
  type: "chat" | "playback" | "wallpaper" | "title" | "media" | "timer" | "system",
  at: number,                    // epoch ms
  actor: { socketId, displayName } | null, // null for no actor (host-less events)
  detail: string                 // minimal per-type human-readable string
}
```

`detail` is intentionally minimal — not full payloads.

### 4.3 Wire protocol

| Direction | Event | Payload | Notes |
|---|---|---|---|
| C→S | `activity:send` | `{ text: string }` | replaces `chat:send`; creates `type:"chat"` entry |
| S→C | `room:activity` | `{ entry }` | append-only delta, room-wide |
| S→C | changed | broadcast streams | `rtc:media_state` etc. keep existing events; each ALSO appends an activity entry |

`state.activity` flows through every snapshot (`room:created`, `room:joined`,
`room:get_state`).

### 4.4 Trigger points (every append is additive to existing broadcasts)

| Action | type | detail example |
|---|---|---|
| join (owner create / member join) | `system` | `"joined"` / `"created room"` |
| leave | `system` | `"left"` |
| playback play/pause/seek/set_track | `playback` | `"played <track>"` / `"paused"` |
| wallpaper set | `wallpaper` | `"set wallpaper <url>"` |
| title set | `title` | `"set room title to <title>"` |
| media change | `media` | `"camera on"` etc. |
| chat send | `chat` | `"<text>"` |
| timer start/pause/reset | `timer` | `"started 25min timer"` |
| timer complete | `system` | `"timer finished"` |

### 4.5 Removed / renamed

- `state.chat` → removed (activity supersedes)
- `chat:send` → `activity:send`
- `chat:message` → `room:activity` (payload becomes `{ entry }`)

## 5. Components

- `backend/src/rooms/Room.js` — `state` gains `activity: []`, `timer:{...}`; drop `chat`.
  `toPublicState().state` exposes both.
- `backend/src/rooms/RoomService.js` — core `appendActivity` (id gen, cap 50),
  `sendActivity`, refactor `sendChat`→activity; `startTimer/pauseTimer/resetTimer`;
  injectable clock + scheduler; `MAX_ACTIVITY_HISTORY = 50`; timer validation.
- `backend/src/socket/handlers/activityHandler.js` — NEW, replaces `chatHandler`:
  `handleActivitySend`.
- `backend/src/socket/handlers/timerHandler.js` — NEW: `handleStart/Pause/Reset`,
  schedules + owns the room-scoped timer scheduling (or delegates to RoomService),
  emits `timer:state` / `timer:complete`.
- `backend/src/socket/handlers/roomHandler.js` — join/leave append `system` entries;
  `handleCreate/handleJoin/handleGetState` wipe chat→activity in snapshots.
- `backend/src/socket/handlers/{playback,wallpaper,rtc}Handler.js` — append activity
  entries on their respective actions (additive).
- `backend/src/socket/events.js` — add `ACTIVITY_SEND`, `ROOM_ACTIVITY`, `TIMER_START`,
  `TIMER_PAUSE`, `TIMER_RESET`, `TIMER_STATE`, `TIMER_COMPLETE`; remove `CHAT_SEND`,
  `CHAT_MESSAGE`.
- `backend/src/socket/index.js` — rewire `activity:send`, `timer:*` handlers;
  remove `chat:send`.
- `backend/scripts/socket-cli.js` — `say` → activity; add `timer <minutes>|pause|reset`;
  inbound `room:activity`, `timer:state`, `timer:complete`.
- `backend/scripts/smoke.js` — extend scenario: timer start → state broadcast, custom
  duration boundary, activity reads chat + system entries, chat-as-activity.
- Tests: `test/unit/roomService.test.js`, `test/unit/room.test.js`,
  `test/integration/socket.test.js` updated for renames; new timer + activity cases.

## 6. Error handling

All control handlers use existing `emitError(socket, err)` → `room:error { code, message }`.
Error classes reused: `InvalidPayloadError` (`INVALID_PAYLOAD`), `NotInRoomError`
(`NOT_IN_ROOM`), `RoomNotFoundError` (`ROOM_NOT_FOUND`). No new error classes.

## 7. Testing strategy

**Unit (deterministic):**
- Timer state machine: idle→running→paused→idle via injected fake clock/scheduler.
- Fire at 0: `timer:complete`, transition to idle, system activity entry appended.
- Duration boundary: minutes 1 accepted, 180 accepted, 0/181/non-numeric → `INVALID_PAYLOAD`.
- `appendActivity` cap: 51st entry drops oldest; entry shape (id/type/at/actor/detail).
- `sendActivity` appends `type:"chat"` with actor displayName; non-member → `NOT_IN_ROOM`.
- Timer controls: non-member → `NOT_IN_ROOM`.

**Integration (socket):**
- `activity:send` → room-wide `room:activity` with chat entry; both members receive.
- System entries appear for join; late joiner snapshot has prior activity.
- `timer:start` → `timer:state` broadcast to room; `timer:pause`/`reset` transitions.
- `timer:complete` → event + system entry + idle state (uses a very short injected
  duration in test-only helper; integration uses real clock with sub-second duration via
  an injectable hook).
- `chat:*`/`state.chat` fully removed — no references remain.

## 8. Docs

- Update `docs/frontend-design/design-prompt.md` to reference `state.activity` +
  `state.timer`, `room:activity`, `timer:*` (removes `state.chat` / `chat:*`).
