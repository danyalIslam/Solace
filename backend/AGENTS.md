# Solace Backend — Agent Guide

## 1. Project overview
Watch-together rooms backend (`backend/`). Synchronizes shared room state (playback, wallpaper, title, activity log, timer) over socket.io. Hosts a small HTTP upload endpoint for wallpaper files (magic-byte verified, locally stored). Rooms live in-memory (no DB, no auth) — the 6-char roomId IS the capability. Express serves the API; socket.io shares the same HTTP server.

## 2. Commands
Run from `backend/`. CommonJS, no build step, Node ≥20 (`node --test`).

| Command | What |
|---|---|
| `npm test` | All unit + integration tests (node --test) |
| `npm run test:unit` | `test/unit/*.test.js` only |
| `npm run test:integration` | `test/integration/*.test.js` only |
| `npm run test:coverage` | Tests + coverage report; **keep line ≥90%** (currently 91.4) |
| `node scripts/smoke.js` | Full E2E journey, spawns local server on ephemeral port, exit 0/1 |
| `node scripts/smoke.js <url>` | Same journey against a running stack (docker / remote) |
| `npm run dev` | nodemon `src/server.js` (hot reload) |
| `npm start` | plain `node src/server.js` |

Note: plain `npm test` currently exits cleanly. If tests hang on exit (known `node --test` quirk, seen with armed timer or socket.io reconnect timers), fall back to `node --test --test-force-exit`.

## 3. Architecture map
```
backend/
├── src/
│   ├── server.js            createHttpServer(): express + http + socket.io on one port; mounts upload router; exports { createHttpServer }
│   ├── socket/
│   │   ├── index.js         createSocketServer(server, roomService): io bootstrap, CORS, event→handler wiring per connection, disconnect cleanup
│   │   ├── events.js        Single source of truth: CLIENT + SERVER wire-name constants. NEVER inline literal event strings
│   │   └── handlers/        One factory per domain: room/playback/wallpaper/activity/timer/rtc
│   │       └── (each).js    createXHandler(io, roomService) → { handleX(socket, payload) }; emitError(socket, err) sends {code,message}
│   ├── rooms/
│   │   ├── Room.js          Room class: members Map, state object, toPublicState() snapshot
│   │   ├── RoomService.js   Domain logic + validation + error classes; appendActivity + addUpload choke points live here
│   │   └── MemoryRoomStore.js  Singleton store; 6-char roomId (A-Z0-9 minus 0,O,1,I)
│   └── upload/
│       ├── uploadStore.js   createUploadStore(): magic-byte sniffing, save/delete, boot wipe of uploads dir
│       └── uploadRouter.js  Express routes: POST /uploads (multipart), GET /uploads/:roomId/:file (static, immutable)
├── test/
│   ├── helpers/startServer.js  startTestServer/connectClient/waitForEvent/closeSocket/closeServer; per-boot tmp UPLOADS_DIR
│   ├── unit/               Room, RoomService, MemoryRoomStore, rtcHandler, uploadStore tests
│   ├── integration/
│   │   ├── socket.test.js      boot/track/createRoom/joinRoom helpers; full E2E over real socket.io
│   │   └── uploads.test.js     HTTP upload endpoint (happy, 415, 413, eviction, GET serve, traversal)
├── scripts/
│   ├── smoke.js            E2E smoke runner (two real clients, full surface, CI-friendly exit code)
│   └── socket-cli.js       Interactive REPL socket.io tester (help lists commands)
├── Dockerfile              node:24-alpine, prod deps only, COPY src/
└── package.json            commonjs; deps: express, socket.io, multer, dotenv; devDeps: nodemon, socket.io-client
```

## 4. State shape + wire protocol

Room state (`room.state`), exact field names:
- `playback`: `{ status: "playing"|"paused", track: object|null, position: number, updatedAt }`
- `wallpaper`: `{ url: string|null, kind: "image"|"video", changedBy, updatedAt }`
- `wallpapers`: array of upload metas `{ id, url, kind, contentType, size, originalName, uploadedBy, uploadedAt }`
- `activity`: array of entries (capped at 50)
- `title`: string
- `timer`: `{ status: "idle"|"running"|"paused", durationMs, remainingMs, endsAt, startedBy, startedAt, updatedAt }`

Activity entry: `{ id: uuid, type, actor: { socketId, displayName }, detail, at }` where `type ∈ chat|playback|wallpaper|title|media|timer|system`. System entries auto-created on join ("joined"), leave ("left"), create ("created room"), timer-complete ("timer finished").

Constraints (`RoomService.js`): max 4 members, displayName ≤24, chat text ≤500, title ≤60, timer 1–180 min, wallpaper url ≤2048, activity history 50, room uploads 3.

**CLIENT → SERVER** (from `events.js` CLIENT):
| Constant | Wire |
|---|---|
| ROOM_CREATE | `room:create` |
| ROOM_JOIN | `room:join` |
| ROOM_LEAVE | `room:leave` |
| ROOM_GET_STATE | `room:get_state` |
| ROOM_SET_TITLE | `room:set_title` |
| ACTIVITY_SEND | `activity:send` |
| TIMER_START/PAUSE/RESET | `timer:start` `timer:pause` `timer:reset` |
| PLAYBACK_PLAY/PAUSE/SEEK/SET_TRACK | `playback:play` `playback:pause` `playback:seek` `playback:set_track` |
| WALLPAPER_SET | `wallpaper:set` |
| RTC_MEDIA/OFFER/ANSWER/ICE | `rtc:media` `rtc:offer` `rtc:answer` `rtc:ice` |

**SERVER → CLIENT** (from `events.js` SERVER):
| Constant | Wire | Payload highlights |
|---|---|---|
| ROOM_CREATED | `room:created` | `{ roomId, members, state }` |
| ROOM_JOINED | `room:joined` | `{ roomId, members, state }` (also served by get_state) |
| ROOM_MEMBER_JOINED | `room:member_joined` | `{ member }` |
| ROOM_MEMBER_LEFT | `room:member_left` | `{ socketId }` |
| ROOM_ERROR | `room:error` | `{ code, message }` |
| ROOM_TITLE_STATE | `room:title_state` | `{ title, changedBy, updatedAt }` |
| ROOM_ACTIVITY | `room:activity` | `{ entry }` |
| TIMER_STATE | `timer:state` | timer object |
| TIMER_COMPLETE | `timer:complete` | `{ completedBy, durationMs }` |
| PLAYBACK_STATE | `playback:state` | `{ status, track, position, updatedAt, changedBy }` |
| WALLPAPER_STATE | `wallpaper:state` | `{ url, kind, changedBy, updatedAt }` |
| WALLPAPER_UPLOADS | `wallpaper:uploads` | `{ uploads }` (library broadcast after upload/eviction) |
| RTC_CONFIG | `rtc:config` | `{ iceServers }` (emitted on connect) |
| RTC_MEDIA_STATE | `rtc:media_state` | `{ socketId, audio, video }` |
| RTC_OFFER/ANSWER/ICE | `rtc:offer` `rtc:answer` `rtc:ice` | `{ from, sdp\|candidate }` (relayed) |

## 5. Conventions (hard requirements)
- **CommonJS**: `require`/`module.exports`. No ESM imports. No build step.
- **Handler factory pattern**: `createXHandler(io, roomService)` returning `{ handleX(socket, payload) }`. Each factory defines a local `emitError(socket, err)` that emits `SERVER.ROOM_ERROR` with `{ code, message }`.
- **Route ALL errors through emitError** (`{ code, message }`). Real codes (verify in source): `ROOM_NOT_FOUND`, `ROOM_FULL`, `ALREADY_IN_ROOM`, `NOT_IN_ROOM`, `TARGET_NOT_IN_ROOM`, `INVALID_PAYLOAD`, `NOT_HOST`, `UNSUPPORTED_MEDIA_TYPE` (HTTP 415), `PAYLOAD_TOO_LARGE` (HTTP 413, multer), plus HTTP `MISSING_FILE`, `NOT_FOUND`, `BAD_REQUEST`.
- **Member lookup guard**: `member ? member.displayName : "unknown"` before reading displayName from `room.members.get(socketId)` (a disconnect/upload `socketId` may not be a member).
- **Wire names ONLY via `events.js` constants** (import `{ CLIENT, SERVER }`). Never string literal event names, including in tests/CLI.
- **State mutations only inside RoomService**. `appendActivity` is the single choke point for the activity log (every action handler + join/leave/timer through it); `addUpload` is the choke point for the wallpaper library (eviction lives inside it). Handlers call service methods, never mutate `room.state` directly.
- **TDD expected**: unit + integration tests; coverage ≥90% line. Update tests alongside code.
- **Keep `scripts/smoke.js` and `scripts/socket-cli.js` in sync** whenever the wire contract changes.

## 6. Gotchas
- **Uploads dir wiped on boot**: `createUploadStore()` does `fs.rmSync(root, {recursive, force})` then recreates. Rooms are in-memory — restart loses all state and all files. Persistent uploads survive only via the docker volume.
- **Test runner hang-on-exit quirk**: `node --test` can hang if a real timer is left armed (RoomService uses real `setTimeout` for countdown) or socket.io reconnect timers stay alive. Integration tests explicitly reset armed timers; smoke force-exits on failure. If hang, use `--test-force-exit`.
- **Parallel test processes race on shared uploads dir**: `startTestServer()` sets `process.env.UPLOADS_DIR` to a fresh `mkdtemp` per boot so parallel test files/processes never step on each other's files.
- **`io.to(roomId)` includes the originator**: playback/wallpaper/timer/title/activity broadcasts use `io.to(room.id)` (not `socket.to`) so every member — including the sender — holds the same canonical state. Intentional.
- **Activity entries on action handlers must go through `appendActivity`** — never push to `room.state.activity` directly or you bypass the 50-entry cap and the emit already handled by the service call.
- **`getRoom()` throws `RoomNotFoundError`**: `uploadRouter` wraps it and returns HTTP 404 `{ error: "ROOM_NOT_FOUND" }`. Don't expect a null return.
- **Wallpaper eviction skips the active wallpaper**: `addUpload` evicts oldest non-active (non-active == url != current `state.wallpaper.url`), up to 3 entries. If all are active it stops (no eviction).
- **Smoke uses `waitFor` with pre-bound listeners for connect-time events**: `rtc:config` fires during the connect handshake, so the listener is bound BEFORE `connect` resolves (same pattern as integration tests).
- **`docs/` and `.lavish/` are gitignored** (repo-root `.gitignore`) — local-only, never commit there. `backend/AGENTS.md` is committed.

## 7. Git discipline
- Work on a feature branch. Commit per logical unit.
- Conventional, terse prefixes: `feat:`, `fix:`, `chore:`, `docs:`, `test:`, `build(docker):`.
- **NO merging / pushing without captain approval.**
- Run tests + confirm coverage ≥90% before committing. Keep commits small and focused.
