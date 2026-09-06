const Room = require("./Room");

const MAX_ROOM_MEMBERS = 4;
const MAX_DISPLAY_NAME_LENGTH = 24;
const MAX_WALLPAPER_URL_LENGTH = 2048;
const WALLPAPER_KINDS = ["image", "video"];
const MAX_ROOM_UPLOADS = 3;
const MAX_ACTIVITY_HISTORY = 50;
const MAX_CHAT_TEXT_LENGTH = 500;
const MAX_ROOM_TITLE_LENGTH = 60;
const MIN_TIMER_MINUTES = 1;
const MAX_TIMER_MINUTES = 180;
const PLAYBACK_STATUSES = ["playing", "paused"];

function coerceBoolean(value, field) {
    if (value === true || value === false) return value;
    if (value === "true") return true;
    if (value === "false") return false;
    if (value === 1) return true;
    if (value === 0) return false;
    throw new InvalidPayloadError(`${field} must be true, false, 'true', 'false', 1, or 0`);
}

class RoomNotFoundError extends Error {
    constructor(message = "Room not found") {
        super(message);
        this.name = "RoomNotFoundError";
        this.code = "ROOM_NOT_FOUND";
    }
}

class RoomFullError extends Error {
    constructor(message = "Room is full") {
        super(message);
        this.name = "RoomFullError";
        this.code = "ROOM_FULL";
    }
}

class AlreadyInRoomError extends Error {
    constructor(message = "Already in this room") {
        super(message);
        this.name = "AlreadyInRoomError";
        this.code = "ALREADY_IN_ROOM";
    }
}

class NotInRoomError extends Error {
    constructor(message = "Not a member of this room") {
        super(message);
        this.name = "NotInRoomError";
        this.code = "NOT_IN_ROOM";
    }
}

class TargetNotInRoomError extends Error {
    constructor(message = "Target member is not in this room") {
        super(message);
        this.name = "TargetNotInRoomError";
        this.code = "TARGET_NOT_IN_ROOM";
    }
}

class InvalidPayloadError extends Error {
    constructor(message = "Invalid payload") {
        super(message);
        this.name = "InvalidPayloadError";
        this.code = "INVALID_PAYLOAD";
    }
}

class NotHostError extends Error {
    constructor(message = "Only the room host can set the title") {
        super(message);
        this.name = "NotHostError";
        this.code = "NOT_HOST";
    }
}

class RoomService {
    constructor(store, timers) {
        this.store = store;
        this._now = (timers && timers.now) || (() => Date.now());
        this._schedule = (timers && timers.schedule) || ((fn, ms) => setTimeout(fn, ms));
        this._cancel = (timers && timers.cancel) || ((id) => clearTimeout(id));
    }

    _assertRoom(roomId) {
        const room = this.store.get(roomId);
        if (!room) throw new RoomNotFoundError();
        return room;
    }

    _assertMember(room, socketId) {
        if (!room.members.has(socketId)) throw new NotInRoomError();
    }

    _assertDisplayName(displayName) {
        if (typeof displayName !== "string" || displayName.trim().length === 0 || displayName.length > MAX_DISPLAY_NAME_LENGTH) {
            throw new InvalidPayloadError(`displayName must be a non-empty string of at most ${MAX_DISPLAY_NAME_LENGTH} chars`);
        }
    }

    createRoom(displayName, socketId) {
        this._assertDisplayName(displayName);
        const room = this.store.create();
        room.addMember(socketId, {
            displayName,
            joinedAt: Date.now(),
            isHost: true
        });
        return { roomId: room.id, room };
    }

    joinRoom(roomId, socketId, displayName) {
        const room = this._assertRoom(roomId);
        this._assertDisplayName(displayName);
        if (room.members.size >= MAX_ROOM_MEMBERS) throw new RoomFullError();
        if (room.members.has(socketId)) throw new AlreadyInRoomError();
        room.addMember(socketId, {
            displayName,
            joinedAt: Date.now(),
            isHost: false
        });
        return room;
    }

    leaveRoom(roomId, socketId) {
        const room = this._assertRoom(roomId);
        this._assertMember(room, socketId);
        room.removeMember(socketId);
        return room;
    }

    getState(roomId) {
        const room = this._assertRoom(roomId);
        return room.toPublicState();
    }

    setPlayback(roomId, socketId, { status, track, position }) {
        const room = this._assertRoom(roomId);
        this._assertMember(room, socketId);

        if (status !== undefined && !PLAYBACK_STATUSES.includes(status)) {
            throw new InvalidPayloadError("status must be 'playing' or 'paused'");
        }
        if (track !== undefined && track !== null && !(typeof track === "object" && typeof track.url === "string")) {
            throw new InvalidPayloadError("track must be null or an object with a url string");
        }
        if (position !== undefined && (typeof position !== "number" || !Number.isFinite(position) || position < 0)) {
            throw new InvalidPayloadError("position must be a non-negative number");
        }

        const current = room.state.playback;
        const change = {
            status: status !== undefined ? status : current.status,
            track: track !== undefined ? track : current.track,
            position: position !== undefined ? position : current.position,
            updatedAt: Date.now()
        };

        room.state.playback = change;
        return { room, change };
    }

    setWallpaper(roomId, socketId, url, kind) {
        const room = this._assertRoom(roomId);
        this._assertMember(room, socketId);
        if (typeof url !== "string" || url.length === 0 || url.length > MAX_WALLPAPER_URL_LENGTH) {
            throw new InvalidPayloadError(`url must be a non-empty string of at most ${MAX_WALLPAPER_URL_LENGTH} chars`);
        }
        const nextKind = kind === undefined ? room.state.wallpaper.kind : kind;
        if (!WALLPAPER_KINDS.includes(nextKind)) {
            throw new InvalidPayloadError(`kind must be one of ${WALLPAPER_KINDS.join(", ")}`);
        }
        room.state.wallpaper.url = url;
        room.state.wallpaper.kind = nextKind;
        room.state.wallpaper.changedBy = socketId;
        room.state.wallpaper.updatedAt = Date.now();
        return { room, url, kind: nextKind };
    }

    addUpload(roomId, meta) {
        const room = this._assertRoom(roomId);
        room.state.wallpapers.push(meta);
        let evicted = null;
        while (room.state.wallpapers.length > MAX_ROOM_UPLOADS) {
            const victim = room.state.wallpapers.find((w) => w.url !== room.state.wallpaper.url);
            if (!victim) break;
            const idx = room.state.wallpapers.indexOf(victim);
            room.state.wallpapers.splice(idx, 1);
            evicted = victim;
        }
        return { room, uploads: room.state.wallpapers, evicted };
    }

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

    setMedia(roomId, socketId, { audio, video }) {
        const room = this._assertRoom(roomId);
        const member = room.members.get(socketId);
        if (!member) throw new TargetNotInRoomError();
        if (audio !== undefined) member.audioOn = coerceBoolean(audio, "audio");
        if (video !== undefined) member.videoOn = coerceBoolean(video, "video");
        return { socketId, displayName: member.displayName, audioOn: member.audioOn, videoOn: member.videoOn };
    }

    setTitle(roomId, socketId, { title }) {
        const room = this._assertRoom(roomId);
        const member = room.members.get(socketId);
        if (!member) throw new NotInRoomError();
        if (!member.isHost) throw new NotHostError();
        if (typeof title !== "string" || title.trim().length === 0 || title.length > MAX_ROOM_TITLE_LENGTH) {
            throw new InvalidPayloadError(`title must be a non-empty string of at most ${MAX_ROOM_TITLE_LENGTH} chars`);
        }
        const trimmed = title.trim();
        room.state.title = trimmed;
        return { title: trimmed, changedBy: socketId, updatedAt: Date.now() };
    }

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

    resolveRoomBySocket(socketId) {
        const rooms = this.store.all();
        for (const room of rooms) {
            if (room.members.has(socketId)) return room;
        }
        return null;
    }
}

module.exports = RoomService;

module.exports.Room = Room;
module.exports.RoomNotFoundError = RoomNotFoundError;
module.exports.RoomFullError = RoomFullError;
module.exports.AlreadyInRoomError = AlreadyInRoomError;
module.exports.NotInRoomError = NotInRoomError;
module.exports.TargetNotInRoomError = TargetNotInRoomError;
module.exports.InvalidPayloadError = InvalidPayloadError;
module.exports.NotHostError = NotHostError;
module.exports.MAX_ROOM_MEMBERS = MAX_ROOM_MEMBERS;
module.exports.MAX_ACTIVITY_HISTORY = MAX_ACTIVITY_HISTORY;