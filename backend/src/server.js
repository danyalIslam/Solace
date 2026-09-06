require("dotenv").config();
const express = require("express");
const http = require("http");
const { createSocketServer } = require("./socket");

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

    const server = http.createServer(app);
    server.socketServer = createSocketServer(server);
    return server;
}

if (require.main === module) {
    const PORT = process.env.PORT;
    createHttpServer().listen(PORT, () => {
        console.log(`Server running on http://localhost:${PORT}`);
    });
}

module.exports = { createHttpServer };