const { SERVER } = require("../events");

function createRoomHandler(io, roomService) {
    function emitError(socket, err) {
        socket.emit(SERVER.ROOM_ERROR, { code: err.code, message: err.message });
    }

    return {
        handleCreate(socket, payload) {
            try {
                const displayName = payload && payload.displayName;
                const { roomId, room } = roomService.createRoom(displayName, socket.id);
                socket.join(roomId);
                roomService.appendActivity(roomId, {
                    type: "system",
                    actor: { socketId: socket.id, displayName },
                    detail: "created room"
                });
                const pub = room.toPublicState();
                socket.emit(SERVER.ROOM_CREATED, {
                    roomId,
                    members: pub.members,
                    state: pub.state
                });
            } catch (err) {
                emitError(socket, err);
            }
        },

        handleJoin(socket, payload) {
            try {
                const roomId = payload && payload.roomId;
                const displayName = payload && payload.displayName;
                const room = roomService.joinRoom(roomId, socket.id, displayName);
                socket.join(roomId);
                const { entry: joinEntry } = roomService.appendActivity(roomId, {
                    type: "system",
                    actor: { socketId: socket.id, displayName },
                    detail: "joined"
                });
                const pub = room.toPublicState();
                socket.emit(SERVER.ROOM_JOINED, {
                    roomId,
                    members: pub.members,
                    state: pub.state
                });
                socket.to(roomId).emit(SERVER.ROOM_MEMBER_JOINED, {
                    member: pub.members.find((m) => m.socketId === socket.id)
                });
                io.to(roomId).emit(SERVER.ROOM_ACTIVITY, { entry: joinEntry });
            } catch (err) {
                emitError(socket, err);
            }
        },

        handleLeave(socket) {
            try {
                const room = roomService.resolveRoomBySocket(socket.id);
                if (!room) {
                    socket.emit(SERVER.ROOM_ERROR, {
                        code: "NOT_IN_ROOM",
                        message: "Not a member of this room"
                    });
                    return;
                }
                const member = room.members.get(socket.id);
                const displayName = member ? member.displayName : "unknown";
                roomService.leaveRoom(room.id, socket.id);
                const { entry } = roomService.appendActivity(room.id, { type: "system", actor: { socketId: socket.id, displayName }, detail: "left" });
                socket.leave(room.id);
                socket.to(room.id).emit(SERVER.ROOM_MEMBER_LEFT, { socketId: socket.id });
                socket.to(room.id).emit(SERVER.ROOM_ACTIVITY, { entry });
            } catch (err) {
                emitError(socket, err);
            }
        },

        handleGetState(socket) {
            try {
                const room = roomService.resolveRoomBySocket(socket.id);
                if (!room) {
                    socket.emit(SERVER.ROOM_ERROR, {
                        code: "NOT_IN_ROOM",
                        message: "Not a member of this room"
                    });
                    return;
                }
                const pub = room.toPublicState();
                socket.emit(SERVER.ROOM_JOINED, {
                    roomId: pub.id,
                    members: pub.members,
                    state: pub.state
                });
            } catch (err) {
                emitError(socket, err);
            }
        },

        handleSetTitle(socket, payload) {
            try {
                const room = roomService.resolveRoomBySocket(socket.id);
                if (!room) {
                    socket.emit(SERVER.ROOM_ERROR, {
                        code: "NOT_IN_ROOM",
                        message: "Not a member of this room"
                    });
                    return;
                }
                const titlePayload = payload && payload.title;
                const result = roomService.setTitle(room.id, socket.id, { title: titlePayload });
                io.to(room.id).emit(SERVER.ROOM_TITLE_STATE, result);
            } catch (err) {
                emitError(socket, err);
            }
        }
    };
}

module.exports = createRoomHandler;