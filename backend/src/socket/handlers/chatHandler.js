const { SERVER } = require("../events");

function createChatHandler(io, roomService) {
    function emitError(socket, err) {
        socket.emit(SERVER.ROOM_ERROR, { code: err.code, message: err.message });
    }

    return {
        handleSend(socket, payload) {
            const room = roomService.resolveRoomBySocket(socket.id);
            if (!room) {
                const err = new Error("Not a member of this room");
                err.code = "NOT_IN_ROOM";
                emitError(socket, err);
                return;
            }
            try {
                const text = payload && payload.text;
                const { room: updatedRoom, message } = roomService.sendChat(room.id, socket.id, text);
                // io.to(room.id) includes the originator so every member holds
                // the same canonical chat history, not just new remote ones.
                io.to(updatedRoom.id).emit(SERVER.CHAT_MESSAGE, message);
            } catch (err) {
                emitError(socket, err);
            }
        }
    };
}

module.exports = createChatHandler;
