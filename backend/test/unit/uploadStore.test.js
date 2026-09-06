const assert = require("node:assert");
const { test, beforeEach, afterEach } = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createUploadStore, sniffKind } = require("../../src/upload/uploadStore");

const SAMPLES = {
    "image/jpeg": Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]),
    "image/png": Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(8)]),
    "image/gif": Buffer.from("GIF89a" + "0000000000"),
    "image/webp": Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBPVP8 ")]),
    "video/mp4": Buffer.concat([Buffer.alloc(4), Buffer.from("ftypmp42"), Buffer.alloc(16)]),
    "video/webm": Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(16)])
};

let tmpRoot;
let store;

beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "solace-uploads-"));
    process.env.UPLOADS_DIR = path.join(tmpRoot, "uploads");
    store = createUploadStore();
});

afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    delete process.env.UPLOADS_DIR;
});

test("sniffKind classifies supported magic bytes", () => {
    for (const [mime, buf] of Object.entries(SAMPLES)) {
        const { kind, contentType } = sniffKind(buf);
        const expectedKind = mime.startsWith("video/") ? "video" : "image";
        assert.equal(kind, expectedKind, mime);
        assert.equal(contentType, mime, mime);
    }
});

test("sniffKind rejects unknown bytes", () => {
    assert.throws(() => sniffKind(Buffer.from("plain text not media")), /unsupported/i);
});

test("save writes file and returns relative url", () => {
    const { url } = store.save("ROOM1", "abc.png", SAMPLES["image/png"]);
    assert.equal(url, "/uploads/ROOM1/abc.png");
    const abs = path.join(tmpRoot, "uploads", "ROOM1", "abc.png");
    assert.ok(fs.existsSync(abs));
    assert.deepEqual(fs.readFileSync(abs), SAMPLES["image/png"]);
});

test("buildMeta sanitizes filename and captures meta", () => {
    const meta = store.buildMeta("ROOM1", "evil/../wall.png", SAMPLES["image/png"], 999, "uploader", 123);
    assert.ok(!meta.url.includes(".."), "no traversal in url");
    assert.equal(meta.kind, "image");
    assert.equal(meta.originalName, "evil/../wall.png");
    assert.equal(meta.size, 999);
    assert.equal(meta.uploadedBy, "uploader");
    assert.equal(meta.uploadedAt, 123);
});

test("delete removes file for a known url", () => {
    const { url } = store.save("ROOM1", "a.png", SAMPLES["image/png"]);
    store.deleteByUrl(url);
    assert.ok(!fs.existsSync(path.join(tmpRoot, "uploads", "ROOM1", "a.png")));
});

test("delete refuses urls outside the room dir (traversal guard)", () => {
    assert.throws(() => store.deleteByUrl("/uploads/../secret.png"), /invalid/i);
});

test("createUploadStore wipes the uploads dir on init", () => {
    store.save("ROOM1", "a.png", SAMPLES["image/png"]);
    store = createUploadStore();
    assert.ok(!fs.existsSync(path.join(tmpRoot, "uploads", "ROOM1")));
});
