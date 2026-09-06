const { SERVER } = require("../events");

function createWallpaperHandler(io, roomService) {
    function emitError(socket, err) {
        socket.emit(SERVER.ROOM_ERROR, { code: err.code, message: err.message });
    }

    return {
        handleSetWallpaper(socket, payload) {
            try {
                const room = roomService.resolveRoomBySocket(socket.id);
                if (!room) {
                    const err = new Error("Room not found");
                    err.code = "ROOM_NOT_FOUND";
                    emitError(socket, err);
                    return;
                }
                const url = payload && payload.url;
                const { room: updatedRoom, url: newUrl } = roomService.setWallpaper(room.id, socket.id, url);
                // io.to(room.id) includes the originator so every member holds
                // the same canonical wallpaper state, not just new remote ones.
                io.to(updatedRoom.id).emit(SERVER.WALLPAPER_STATE, {
                    url: newUrl,
                    changedBy: socket.id
                });
            } catch (err) {
                emitError(socket, err);
            }
        }
    };
}

module.exports = createWallpaperHandler;