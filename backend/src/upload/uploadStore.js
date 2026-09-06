const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const ROOT = () => process.env.UPLOADS_DIR || path.join(process.cwd(), "uploads");

const SIGNATURES = [
    { mime: "image/jpeg", kind: "image", ext: "jpg", match: (b) => b.length > 2 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
    { mime: "image/png", kind: "image", ext: "png", match: (b) => b.length > 7 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a },
    { mime: "image/gif", kind: "image", ext: "gif", match: (b) => b.length > 5 && b.toString("latin1", 0, 4) === "GIF8" },
    { mime: "image/webp", kind: "image", ext: "webp", match: (b) => b.length > 11 && b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP" },
    { mime: "video/mp4", kind: "video", ext: "mp4", match: (b) => b.length > 11 && b.toString("latin1", 4, 8) === "ftyp" },
    { mime: "video/webm", kind: "video", ext: "webm", match: (b) => b.length > 3 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3 }
];

const CONTENT_TYPES = {
    ".jpg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".mp4": "video/mp4",
    ".webm": "video/webm"
};

class UnsupportedMediaError extends Error {
    constructor(message = "Unsupported media type") {
        super(message);
        this.name = "UnsupportedMediaError";
        this.code = "UNSUPPORTED_MEDIA_TYPE";
    }
}

function sniffKind(buffer) {
    const sig = SIGNATURES.find((s) => s.match(buffer));
    if (!sig) throw new UnsupportedMediaError("Unsupported media type");
    return { kind: sig.kind, ext: sig.ext, contentType: sig.mime };
}

function assertInsideRoot(absPath) {
    const rel = path.relative(ROOT(), absPath);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
        throw new Error("Invalid upload path");
    }
}

function createUploadStore() {
    const root = ROOT();
    fs.rmSync(root, { recursive: true, force: true });
    fs.mkdirSync(root, { recursive: true });

    function save(roomId, fileName, buffer) {
        const roomDir = path.join(root, roomId);
        fs.mkdirSync(roomDir, { recursive: true });
        const abs = path.join(roomDir, fileName);
        assertInsideRoot(abs);
        fs.writeFileSync(abs, buffer);
        return { url: `/uploads/${roomId}/${fileName}` };
    }

    function buildMeta(roomId, originalName, buffer, size, uploadedBy, uploadedAt) {
        const { kind, ext, contentType } = sniffKind(buffer);
        const id = crypto.randomUUID();
        const fileName = `${id}.${ext}`;
        const { url } = save(roomId, fileName, buffer);
        return { id, url, kind, contentType, size, originalName, uploadedBy, uploadedAt };
    }

    function deleteByUrl(url) {
        if (typeof url !== "string" || !url.startsWith("/uploads/")) throw new Error("Invalid upload path");
        const abs = path.join(root, url.replace(/^\/uploads\//, ""));
        assertInsideRoot(abs);
        fs.rmSync(abs, { force: true });
    }

    return { save, buildMeta, deleteByUrl, root, contentTypeOf: (ext) => CONTENT_TYPES[ext] || "application/octet-stream" };
}

module.exports = { createUploadStore, sniffKind, UnsupportedMediaError, SIGNATURES, CONTENT_TYPES };
