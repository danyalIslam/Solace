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
