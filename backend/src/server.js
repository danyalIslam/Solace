require("dotenv").config();
const express = require("express");
const http = require("http");
const { createSocketServer } = require("./socket");
const MemoryRoomStore = require("./rooms/MemoryRoomStore");
const RoomService = require("./rooms/RoomService");
const { createUploadRouter } = require("./upload/uploadRouter");

function createHttpServer() {
    const app = express();

    // Middleware
    app.use(express.json());

    // Test route
    app.get("/", (req, res) => {
        res.json({
            message: "Backend is running!"
        });
    });

    const roomService = new RoomService(MemoryRoomStore);
    const server = http.createServer(app);
    const socketServer = createSocketServer(server, roomService);
    server.socketServer = socketServer;
    app.set("socketServer", socketServer.io);
    app.use(createUploadRouter(roomService));
    return server;
}

if (require.main === module) {
    const PORT = process.env.PORT;
    createHttpServer().listen(PORT, () => {
        console.log(`Server running on http://localhost:${PORT}`);
    });
}

module.exports = { createHttpServer };