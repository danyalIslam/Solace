const { Server } = require("socket.io");
const MemoryRoomStore = require("../rooms/MemoryRoomStore");
const RoomService = require("../rooms/RoomService");
const { CLIENT, SERVER } = require("./events");
const createRoomHandler = require("./handlers/roomHandler");
const createPlaybackHandler = require("./handlers/playbackHandler");
const createWallpaperHandler = require("./handlers/wallpaperHandler");
const createChatHandler = require("./handlers/chatHandler");
const { createRtcHandler, resolveIceServers } = require("./handlers/rtcHandler");

function createSocketServer(httpServer) {
    const io = new Server(httpServer, {
        cors: {
            origin: process.env.CLIENT_ORIGIN || "http://localhost:3000",
            methods: ["GET", "POST"]
        }
    });

    const roomService = new RoomService(MemoryRoomStore);
    const roomHandler = createRoomHandler(io, roomService);
    const playbackHandler = createPlaybackHandler(io, roomService);
    const wallpaperHandler = createWallpaperHandler(io, roomService);
    const rtcHandler = createRtcHandler(io, roomService);
    const chatHandler = createChatHandler(io, roomService);

    io.on("connection", (socket) => {
        socket.emit(SERVER.RTC_CONFIG, { iceServers: resolveIceServers(process.env) });
        socket.on(CLIENT.ROOM_CREATE, (payload) => roomHandler.handleCreate(socket, payload));
        socket.on(CLIENT.ROOM_JOIN, (payload) => roomHandler.handleJoin(socket, payload));
        socket.on(CLIENT.ROOM_LEAVE, () => roomHandler.handleLeave(socket));
        socket.on(CLIENT.ROOM_GET_STATE, () => roomHandler.handleGetState(socket));
        socket.on(CLIENT.ROOM_SET_TITLE, (payload) => roomHandler.handleSetTitle(socket, payload));
        socket.on(CLIENT.PLAYBACK_PLAY, (payload) => playbackHandler.handlePlay(socket, payload));
        socket.on(CLIENT.PLAYBACK_PAUSE, () => playbackHandler.handlePause(socket));
        socket.on(CLIENT.PLAYBACK_SEEK, (payload) => playbackHandler.handleSeek(socket, payload));
        socket.on(CLIENT.PLAYBACK_SET_TRACK, (payload) => playbackHandler.handleSetTrack(socket, payload));
        socket.on(CLIENT.WALLPAPER_SET, (payload) => wallpaperHandler.handleSetWallpaper(socket, payload));
        socket.on(CLIENT.RTC_MEDIA, (payload) => rtcHandler.handleMedia(socket, payload));
        socket.on(CLIENT.RTC_OFFER, (payload) => rtcHandler.handleOffer(socket, payload));
        socket.on(CLIENT.RTC_ANSWER, (payload) => rtcHandler.handleAnswer(socket, payload));
        socket.on(CLIENT.RTC_ICE, (payload) => rtcHandler.handleIce(socket, payload));
        socket.on(CLIENT.CHAT_SEND, (payload) => chatHandler.handleSend(socket, payload));

        socket.on("disconnect", () => {
            const room = roomService.resolveRoomBySocket(socket.id);
            if (!room) return;
            roomService.leaveRoom(room.id, socket.id);
            socket.to(room.id).emit(SERVER.ROOM_MEMBER_LEFT, { socketId: socket.id });
        });
    });

    return { io, roomService };
}

module.exports = { createSocketServer };