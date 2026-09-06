const Room = require("./Room");

// A-Z0-9 minus ambiguous chars 0, O, 1, I
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 6;

class MemoryRoomStore {
    constructor() {
        this.rooms = new Map();
    }

    _generateCode() {
        let code;
        do {
            code = Array.from(
                { length: CODE_LENGTH },
                () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]
            ).join("");
        } while (this.rooms.has(code));
        return code;
    }

    create(roomId) {
        const id = roomId || this._generateCode();
        const room = new Room(id);
        this.rooms.set(id, room);
        return room;
    }

    get(roomId) {
        return this.rooms.get(roomId) || null;
    }

    remove(roomId) {
        this.rooms.delete(roomId);
    }

    all() {
        return Array.from(this.rooms.values());
    }

    get size() {
        return this.rooms.size;
    }
}

const store = new MemoryRoomStore();

module.exports = store;