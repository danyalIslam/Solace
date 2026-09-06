# Room Title — Design Spec

**Date:** 2026-09-06
**Status:** Approved

## Goal

Allow the room host to set a text title for the room. Title is collaborative room state, synced to all members like wallpaper/playback/chat.

## Decisions

- **Host-only writer.** Only the member with `isHost: true` may set the title. All others are read-only and receive `NOT_HOST` on attempt.
- **Validation:** `title` must be a non-empty string, max 60 chars (`MAX_ROOM_TITLE_LENGTH = 60`). Missing, non-string, empty, or >60 → `InvalidPayloadError` (`INVALID_PAYLOAD`). No partial-update semantics; title is required in the payload. Clearing a title is not supported (empty rejected).
- **Storage:** `Room.state.title`, default `""`. Included in `Room.toPublicState().state` so every snapshot (`room:created`, `room:joined`, `room:get_state`) carries it.
- **Wire protocol:**
  - C→S `room:set_title {title}`
  - S→C `room:title_state {title, changedBy, updatedAt}` broadcast to the room (mirrors `wallpaper:state` pattern)
- **Handler placement:** `roomHandler` (room-level event; no new handler file).

## Architecture

1. `backend/src/rooms/Room.js` — `state` gains `title: ""`; `toPublicState().state` includes it.
2. `backend/src/rooms/RoomService.js` — new `NotHostError` (`code "NOT_HOST"`), `MAX_ROOM_TITLE_LENGTH = 60`, `setTitle(roomId, socketId, { title })`:
   - missing room → `RoomNotFoundError`
   - caller not host → `NotHostError`
   - invalid title → `InvalidPayloadError`
   - success → sets `state.title`, returns `{ title, changedBy, updatedAt }`
   - `updatedAt` = `Date.now()` at call time
3. `backend/src/socket/events.js` — `CLIENT.ROOM_SET_TITLE = "room:set_title"`, `SERVER.ROOM_TITLE_STATE = "room:title_state"`.
4. `backend/src/socket/handlers/roomHandler.js` — `handleSetTitle(socket, payload)` mirrors `roomHandler`'s existing factory pattern (returns handlers object; `socket` bound per connection).
5. `backend/src/socket/index.js` — `socket.on(CLIENT.ROOM_SET_TITLE, ...)` wired.
6. `backend/scripts/socket-cli.js` — `title <text>` command; inbound `room:title_state` printed.
7. Tests:
   - Unit (`roomService.test.js`): validation matrix (missing/empty/non-string/61-char → `INVALID_PAYLOAD`), non-host → `NOT_HOST`, missing room → `ROOM_NOT_FOUND`, happy path sets state + snapshot reflects, host check uses stored `isHost`.
   - Unit (`room.test.js`): `state.title` default `""`, present in `toPublicState().state`.
   - Integration (`socket.test.js`): host sets → `room:title_state` broadcast with correct fields; late joiner snapshot has `state.title`; non-host → `room:error NOT_HOST`.

## Non-goals

- No title clearing (empty is invalid by design).
- No title-length customization, no per-room entitlements, no titles in room codes / URLs.
- No frontend work.

## Error codes added

`NOT_HOST` — "Only the room host can set the title"