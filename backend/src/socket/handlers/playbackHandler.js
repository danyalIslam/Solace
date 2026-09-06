const { SERVER } = require("../events");

function createPlaybackHandler(io, roomService) {
    function emitError(socket, err) {
        socket.emit(SERVER.ROOM_ERROR, { code: err.code, message: err.message });
    }

    function emitOrError(socket, err) {
        emitError(socket, err);
        return null;
    }

    // io.to(room.id) includes the originator: all room members see the same
    // canonical playback state, keeping every client in lockstep.
    function broadcast(room, change, changedBy) {
        io.to(room.id).emit(SERVER.PLAYBACK_STATE, {
            status: change.status,
            track: change.track,
            position: change.position,
            updatedAt: change.updatedAt,
            changedBy
        });
    }

    function assertRoom(socket) {
        const room = roomService.resolveRoomBySocket(socket.id);
        if (!room) {
            const err = new Error("Not a member of this room");
            err.code = "NOT_IN_ROOM";
            return emitOrError(socket, err);
        }
        return room;
    }

    function appendActivity(room, socket, detail) {
        const member = room.members.get(socket.id);
        const actor = { socketId: socket.id, displayName: member ? member.displayName : "unknown" };
        const { entry } = roomService.appendActivity(room.id, { type: "playback", actor, detail });
        io.to(room.id).emit(SERVER.ROOM_ACTIVITY, { entry });
    }

    return {
        handlePlay(socket, payload) {
            const room = assertRoom(socket);
            if (!room) return;
            try {
                const track = payload && payload.track;
                const { room: updatedRoom, change } = roomService.setPlayback(room.id, socket.id, {
                    status: "playing",
                    track
                });
                broadcast(updatedRoom, change, socket.id);
                appendActivity(updatedRoom, socket, change.track ? `played ${change.track.url}` : "played");
            } catch (err) {
                emitError(socket, err);
            }
        },

        handlePause(socket) {
            const room = assertRoom(socket);
            if (!room) return;
            try {
                const { room: updatedRoom, change } = roomService.setPlayback(room.id, socket.id, {
                    status: "paused"
                });
                broadcast(updatedRoom, change, socket.id);
                appendActivity(updatedRoom, socket, "paused playback");
            } catch (err) {
                emitError(socket, err);
            }
        },

        handleSeek(socket, payload) {
            const room = assertRoom(socket);
            if (!room) return;
            try {
                const position = payload && payload.position;
                const { room: updatedRoom, change } = roomService.setPlayback(room.id, socket.id, {
                    position
                });
                broadcast(updatedRoom, change, socket.id);
                appendActivity(updatedRoom, socket, `seeked to ${change.position}s`);
            } catch (err) {
                emitError(socket, err);
            }
        },

        handleSetTrack(socket, payload) {
            const room = assertRoom(socket);
            if (!room) return;
            try {
                const track = payload && payload.track;
                const { room: updatedRoom, change } = roomService.setPlayback(room.id, socket.id, {
                    track
                });
                broadcast(updatedRoom, change, socket.id);
                appendActivity(updatedRoom, socket, change.track ? `set track ${change.track.url}` : "cleared track");
            } catch (err) {
                emitError(socket, err);
            }
        }
    };
}

module.exports = createPlaybackHandler;