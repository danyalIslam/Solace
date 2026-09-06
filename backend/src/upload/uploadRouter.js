const express = require("express");
const multer = require("multer");
const path = require("node:path");
const { createUploadStore, UnsupportedMediaError } = require("./uploadStore");
const { SERVER } = require("../socket/events");

const MAX_FILE_BYTES = 20 * 1024 * 1024;

function createUploadRouter(roomService) {
    const store = createUploadStore();
    const router = express.Router();
    const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FILE_BYTES } });

    router.get("/uploads/:roomId/:file", (req, res) => {
        const ext = "." + req.params.file.split(".").pop();
        res.set("Cache-Control", "public, max-age=31536000, immutable");
        res.set("Content-Type", store.contentTypeOf(ext));
        res.sendFile(path.join(store.root, req.params.roomId, req.params.file), (err) => {
            if (err) res.status(404).json({ error: "NOT_FOUND" });
        });
    });

    router.post("/uploads", upload.single("file"), (req, res) => {
        const { roomId } = req.body;
        const file = req.file;
        if (!file) return res.status(400).json({ error: "MISSING_FILE" });
        let room;
        try {
            room = roomService.getRoom(roomId);
        } catch (err) {
            if (err && err.code === "ROOM_NOT_FOUND") return res.status(404).json({ error: err.code });
            throw err;
        }
        let meta;
        try {
            meta = store.buildMeta(roomId, file.originalname, file.buffer, file.size, "upload", Date.now());
        } catch (err) {
            if (err instanceof UnsupportedMediaError) return res.status(415).json({ error: err.code });
            throw err;
        }
        const { room: updatedRoom, uploads, evicted } = roomService.addUpload(roomId, meta);
        if (evicted) store.deleteByUrl(evicted.url);
        const io = req.app.get("socketServer");
        if (io) {
            io.to(roomId).emit(SERVER.WALLPAPER_UPLOADS, { uploads });
            const member = updatedRoom.members.get("upload");
            const actor = { socketId: "upload", displayName: member ? member.displayName : "unknown" };
            const { entry } = roomService.appendActivity(updatedRoom.id, { type: "wallpaper", actor, detail: `uploaded ${meta.originalName}` });
            io.to(roomId).emit(SERVER.ROOM_ACTIVITY, { entry });
        }
        res.status(201).json({ id: meta.id, url: meta.url, kind: meta.kind, size: meta.size });
    });

    router.use((err, req, res, next) => {
        if (err instanceof multer.MulterError) {
            if (err.code === "LIMIT_FILE_SIZE") return res.status(413).json({ error: "PAYLOAD_TOO_LARGE" });
            return res.status(400).json({ error: "BAD_REQUEST", message: err.code });
        }
        next(err);
    });

    return router;
}

module.exports = { createUploadRouter, MAX_FILE_BYTES };
