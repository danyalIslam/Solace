const { io: ioc } = require("socket.io-client");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createHttpServer } = require("../../src/server");

async function startTestServer() {
    process.env.UPLOADS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "solace-test-uploads-"));
    const server = createHttpServer();
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    return { server, port, io: server.socketServer.io };
}

function connectClient(port, name = `client-${Date.now()}-${Math.random().toString(36).slice(2)}`) {
    const socket = ioc(`http://localhost:${port}`, {
        transports: ["websocket"]
    });
    return new Promise((resolve, reject) => {
        socket.once("connect", () => resolve(socket));
        socket.once("connect_error", reject);
    });
}

function waitForEvent(socket, event, predicate = () => true, timeoutMs = 3000) {
    return new Promise((resolve, reject) => {
        const started = Date.now();
        const queue = [];
        const onEvent = (payload) => {
            if (predicate(payload)) {
                cleanup();
                resolve(payload);
            } else {
                queue.push(payload);
            }
        };
        const poll = () => {
            if (Date.now() - started > timeoutMs) {
                cleanup();
                reject(new Error(`Timed out waiting for event '${event}' (queue: ${queue.length} non-matching)`));
                return;
            }
            if (queue.length > 0) {
                const candidate = queue.shift();
                if (predicate(candidate)) {
                    cleanup();
                    resolve(candidate);
                    return;
                }
            }
            setTimeout(poll, 25);
        };
        const cleanup = () => {
            socket.off(event, onEvent);
            clearTimeout(pollTimer);
        };
        socket.on(event, onEvent);
        const pollTimer = setTimeout(poll, 25);
    });
}

function closeSocket(socket) {
    return new Promise((resolve) => {
        if (!socket || socket.disconnected) return resolve();
        socket.once("disconnect", resolve);
        socket.disconnect();
        setTimeout(resolve, 100);
    });
}

async function closeServer(server) {
    if (!server) return;
    await new Promise((resolve) => {
        server.close(resolve);
        if (server.socketServer && server.socketServer.io) {
            server.socketServer.io.close();
        }
    });
}

module.exports = { startTestServer, connectClient, waitForEvent, closeSocket, closeServer };
