class Room {
    constructor(id) {
        this.id = id;
        this.members = new Map();
        this.state = {
            playback: {
                status: "paused",
                track: null,
                position: 0,
                updatedAt: Date.now()
            },
            wallpaper: {
                url: null
            }
        };
    }

    addMember(socketId, member) {
        this.members.set(socketId, member);
    }

    removeMember(socketId) {
        this.members.delete(socketId);
    }

    toPublicState() {
        return {
            id: this.id,
            members: Array.from(this.members.entries()).map(([socketId, member]) => ({
                socketId,
                displayName: member.displayName,
                isHost: member.isHost
            })),
            state: this.state
        };
    }
}

module.exports = Room;