const Room = require("./Room");

const MAX_ROOM_MEMBERS = 4;
const MAX_DISPLAY_NAME_LENGTH = 24;
const MAX_WALLPAPER_URL_LENGTH = 2048;
const MAX_CHAT_HISTORY = 50;
const MAX_CHAT_TEXT_LENGTH = 500;
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

class RoomService {
    constructor(store) {
        this.store = store;
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

    setWallpaper(roomId, socketId, url) {
        const room = this._assertRoom(roomId);
        this._assertMember(room, socketId);
        if (typeof url !== "string" || url.length === 0 || url.length > MAX_WALLPAPER_URL_LENGTH) {
            throw new InvalidPayloadError(`url must be a non-empty string of at most ${MAX_WALLPAPER_URL_LENGTH} chars`);
        }
        room.state.wallpaper.url = url;
        return { room, url };
    }

    sendChat(roomId, socketId, text) {
        const room = this._assertRoom(roomId);
        this._assertMember(room, socketId);
        if (typeof text !== "string" || text.trim().length === 0 || text.length > MAX_CHAT_TEXT_LENGTH) {
            throw new InvalidPayloadError(`text must be a non-empty string of at most ${MAX_CHAT_TEXT_LENGTH} chars`);
        }
        const trimmed = text.trim();
        const member = room.members.get(socketId);
        const message = {
            id: require("crypto").randomUUID(),
            senderId: socketId,
            displayName: member.displayName,
            text: trimmed,
            sentAt: Date.now()
        };
        room.state.chat.push(message);
        if (room.state.chat.length > MAX_CHAT_HISTORY) {
            room.state.chat = room.state.chat.slice(-MAX_CHAT_HISTORY);
        }
        return { room, message };
    }

    setMedia(roomId, socketId, { audio, video }) {
        const room = this._assertRoom(roomId);
        const member = room.members.get(socketId);
        if (!member) throw new TargetNotInRoomError();
        if (audio !== undefined) member.audioOn = coerceBoolean(audio, "audio");
        if (video !== undefined) member.videoOn = coerceBoolean(video, "video");
        return { socketId, displayName: member.displayName, audioOn: member.audioOn, videoOn: member.videoOn };
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
module.exports.MAX_ROOM_MEMBERS = MAX_ROOM_MEMBERS;
module.exports.MAX_CHAT_HISTORY = MAX_CHAT_HISTORY;