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
        const { entry } = roomService.appendActivity(room.id, { type: "timer", actor, detail });
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
