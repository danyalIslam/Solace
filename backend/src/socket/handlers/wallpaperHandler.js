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
                const kind = payload && payload.kind;
                const { room: updatedRoom, url: newUrl, kind: newKind } = roomService.setWallpaper(room.id, socket.id, url, kind);
                // io.to(room.id) includes the originator so every member holds
                // the same canonical wallpaper state, not just new remote ones.
                io.to(updatedRoom.id).emit(SERVER.WALLPAPER_STATE, {
                    url: newUrl,
                    kind: newKind,
                    changedBy: socket.id,
                    updatedAt: updatedRoom.state.wallpaper.updatedAt
                });
                const member = updatedRoom.members.get(socket.id);
                const actor = { socketId: socket.id, displayName: member ? member.displayName : "unknown" };
                const detail = newKind === "video" ? `set video wallpaper ${newUrl}` : `set wallpaper ${newUrl}`;
                const { entry } = roomService.appendActivity(updatedRoom.id, { type: "wallpaper", actor, detail });
                io.to(updatedRoom.id).emit(SERVER.ROOM_ACTIVITY, { entry });
            } catch (err) {
                emitError(socket, err);
            }
        }
    };
}

module.exports = createWallpaperHandler;