<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

---

## Backend Contract

Reference for frontend agents. All names sourced from `backend/src/` — do not invent.

### 1. Connect

```ts
import { io } from "socket.io-client";
const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";
const socket = io(BACKEND, { transports: ["websocket"] });
// rtc:config fires IMMEDIATELY on connect — bind BEFORE calling io()
socket.on("rtc:config", (payload: { iceServers: RTCIceServer[] }) => { ... });
```

CORS: server reads `CLIENT_ORIGIN` env (default `http://localhost:3000`). Port from `PORT` env.

### 2. Events — Client → Server

| Event | Payload |
|---|---|
| `room:create` | `{ displayName }` |
| `room:join` | `{ roomId, displayName }` |
| `room:leave` | _(none)_ |
| `room:get_state` | _(none)_ |
| `room:set_title` | `{ title }` |
| `activity:send` | `{ text }` |
| `playback:play` | `{ track? }` — track is `{ url }` or null |
| `playback:pause` | _(none)_ |
| `playback:seek` | `{ position }` — number, seconds |
| `playback:set_track` | `{ track }` — `{ url }` or null |
| `wallpaper:set` | `{ url, kind? }` — kind: `"image"` \| `"video"` |
| `timer:start` | `{ minutes }` — 1–180 |
| `timer:pause` | _(none)_ |
| `timer:reset` | _(none)_ |
| `rtc:media` | `{ audio?, video? }` — booleans |
| `rtc:offer` | `{ to, sdp }` |
| `rtc:answer` | `{ to, sdp }` |
| `rtc:ice` | `{ to, candidate }` |

### 3. Events — Server → Client

| Event | Payload |
|---|---|
| `room:created` | `{ roomId, members, state }` |
| `room:joined` | `{ roomId, members, state }` — same shape as `room:created`; also returned by `get_state` |
| `room:member_joined` | `{ member }` |
| `room:member_left` | `{ socketId }` |
| `room:error` | `{ code, message }` |
| `room:title_state` | `{ title, changedBy, updatedAt }` |
| `room:activity` | `{ entry }` |
| `playback:state` | `{ status, track, position, updatedAt, changedBy }` |
| `wallpaper:state` | `{ url, kind, changedBy, updatedAt }` |
| `wallpaper:uploads` | `{ uploads }` — library broadcast after upload/eviction |
| `timer:state` | `{ status, durationMs, remainingMs, endsAt, startedBy, startedAt, updatedAt }` |
| `timer:complete` | `{ completedBy, durationMs }` |
| `rtc:config` | `{ iceServers }` — emitted once on connect |
| `rtc:media_state` | `{ socketId, audio, video }` |
| `rtc:offer` | `{ from, sdp }` — relayed |
| `rtc:answer` | `{ from, sdp }` — relayed |
| `rtc:ice` | `{ from, candidate }` — relayed |

### 4. State Shapes

**Full state** (inside `room:joined` / `room:created` payload as `.state`):

```ts
{
  playback: { status: "playing"|"paused", track: { url: string }|null, position: number, updatedAt: number },
  wallpaper: { url: string|null, kind: "image"|"video", changedBy: string|null, updatedAt: number },
  wallpapers: UploadMeta[],   // max 3 entries
  activity: ActivityEntry[],  // max 50 entries
  title: string,
  timer: { status: "idle"|"running"|"paused", durationMs: number, remainingMs: number,
           endsAt: number|null, startedBy: string|null, startedAt: number|null, updatedAt: number }
}
```

**Member** (inside `.members[]`):

```ts
{ socketId: string, displayName: string, isHost: boolean, audioOn: boolean, videoOn: boolean }
```

**UploadMeta** (inside `.wallpapers[]`):

```ts
{ id: string, url: string, kind: "image"|"video", contentType: string, size: number,
  originalName: string, uploadedBy: string, uploadedAt: number }
```

### 5. Activity System

Entry shape: `{ id: string, type: string, actor: { socketId, displayName }, detail: string, at: number }`

| Type | Triggered by | Detail text (exact from handlers) |
|---|---|---|
| `system` | room:create | `"created room"` |
| `system` | room:join / disconnect | `"joined"` / `"left"` |
| `system` | timer:complete | `"timer finished"` |
| `playback` | playback:play | `"played <url>"` or `"played"` |
| `playback` | playback:pause | `"paused playback"` |
| `playback` | playback:seek | `"seeked to <position>s"` |
| `playback` | playback:set_track | `"set track <url>"` or `"cleared track"` |
| `wallpaper` | wallpaper:set | `"set wallpaper <url>"` or `"set video wallpaper <url>"` |
| `wallpaper` | POST /uploads | `"uploaded <originalName>"` |
| `title` | room:set_title | `"set title to <title>"` |
| `media` | rtc:media | `"camera+mic on"` / `"camera on"` / `"mic on"` / `"camera+mic off"` |
| `timer` | timer:start | `"started <minutes>min timer"` |
| `timer` | timer:pause | `"paused timer"` |
| `timer` | timer:reset | `"reset timer"` |
| `chat` | activity:send | user-provided text (trimmed) |

### 6. Wallpaper + Uploads

**Set wallpaper via socket**: emit `wallpaper:set` with `{ url, kind }`. Server broadcasts `wallpaper:state` to all members.

**Upload flow** (HTTP, not socket):

1. `POST /uploads` — `multipart/form-data`, fields: `roomId` (string), `file` (binary)
2. Success `201`: `{ id, url, kind, size }`
3. Then emit `wallpaper:set` with `{ url: response.url, kind: response.kind }`
4. Server broadcasts `wallpaper:uploads` with updated library

**HTTP statuses**: `400` MISSING_FILE, `404` ROOM_NOT_FOUND, `415` UNSUPPORTED_MEDIA_TYPE, `413` PAYLOAD_TOO_LARGE

**Supported formats** (magic-byte verified): jpg, png, gif, webp, mp4, webm

**Static serving**: `GET /uploads/:roomId/:file` — immutable cache (`max-age=31536000`)

**Library eviction**: max 3 uploads per room. On overflow, oldest **non-active** entry evicted (compared to current `state.wallpaper.url`). If all entries are active, no eviction. Frontend: playlist UI should expect library to shrink on next `wallpaper:uploads` after setting a new wallpaper.

**Video wallpapers**: render with `muted loop playsinline` attributes.

### 7. Timer

| Action | Payload | Notes |
|---|---|---|
| `timer:start` | `{ minutes }` | 1–180 integer. Cancels any running timer. |
| `timer:pause` | _(none)_ | Only works when `status === "running"`. Freezes `remainingMs`. |
| `timer:reset` | _(none)_ | Sets to idle, clears all fields. |

**`timer:state` shape**: `{ status, durationMs, remainingMs, endsAt, startedBy, startedAt, updatedAt }`

**Render guidance**: compute remaining locally via `endsAt - Date.now()`. Run a 250ms–1s interval, not per-second server ticks. `endsAt` is authoritative.

**`timer:complete`**: `{ completedBy, durationMs }` — broadcast to all members. Server also emits `timer:state` with `status: "idle"`.

**One timer per room.** Any member can start/pause/reset.

### 8. Errors

**Socket**: `room:error` → `{ code, message }`. Show `message` directly to user.

| Code | Meaning |
|---|---|
| `ROOM_NOT_FOUND` | roomId doesn't exist |
| `ROOM_FULL` | 4 members max |
| `NOT_IN_ROOM` | caller not a member |
| `NOT_HOST` | only host can set title |
| `ALREADY_IN_ROOM` | duplicate join attempt |
| `TARGET_NOT_IN_ROOM` | RTC relay target missing |
| `INVALID_PAYLOAD` | validation failed (see message) |

**HTTP upload errors**: `400` BAD_REQUEST / MISSING_FILE, `404` ROOM_NOT_FOUND, `413` PAYLOAD_TOO_LARGE, `415` UNSUPPORTED_MEDIA_TYPE

### 9. Limits

| Constraint | Value |
|---|---|
| Room members | 4 max |
| Room ID | 6 chars (A-Z, 2-9, no 0/O/1/I) |
| Display name | 24 chars max |
| Room title | 60 chars max |
| Activity history | 50 entries |
| Chat text | 500 chars |
| Timer range | 1–180 minutes |
| Wallpaper URL | 2048 chars |
| Upload file size | 20 MB |
| Uploads per room | 3 max |

### 10. Realtime Gotchas

- **`rtc:config` fires during handshake** — listener MUST be bound before `socket.connect()` / `io()` resolves. Use pre-bound listener pattern.
- **Hydrate from `room:joined`** — payload includes full state + activity history + wallpapers. Initialize UI from this snapshot, not by replaying events.
- **`io.to(roomId)` includes sender** — wallpaper, playback, timer, title, and activity broadcasts reach ALL members including the originator. No client-side special-casing needed.
- **Activity `actor.socketId` is canonical** — do not use a separate `senderId` field. For HTTP uploads, `actor.socketId` is `"upload"`.
- **`timer.endsAt` is authoritative** — compute remaining client-side; do not trust per-tick server messages for countdown accuracy.
- **`room:activity` carries ALL activity types** — filter by `.entry.type` to separate chat, playback, wallpaper, etc.
- **`room:joined` vs `room:member_joined`** — first is sent to the joining member with full state; second is broadcast to others with just the new member object.

### 11. Manual Testing

```bash
# Start backend
cd backend && npm run dev          # hot-reload (nodemon)
cd backend && npm start            # production

# Full E2E smoke (two simulated clients, all events)
node backend/scripts/smoke.js                  # spawns local server
node backend/scripts/smoke.js <remote-url>     # against running stack

# Interactive socket REPL
node backend/scripts/socket-cli.js
# Commands: create <name>, join <id> <name>, leave, wall <url> [kind],
#           upload <path>, timer <minutes>, play <url>, pause, seek <pos>,
#           chat <text>, quit
```
