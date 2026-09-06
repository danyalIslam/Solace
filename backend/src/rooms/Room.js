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
                url: null,
                kind: "image",
                changedBy: null,
                updatedAt: Date.now()
            },
            wallpapers: [],
            activity: [],
            title: "",
            timer: {
                status: "idle",
                durationMs: 0,
                remainingMs: 0,
                endsAt: null,
                startedBy: null,
                startedAt: null,
                updatedAt: Date.now()
            }
        };
    }

    addMember(socketId, member) {
        this.members.set(socketId, {
            ...member,
            audioOn: false,
            videoOn: false
        });
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
                isHost: member.isHost,
                audioOn: member.audioOn,
                videoOn: member.videoOn
            })),
            state: this.state
        };
    }
}

module.exports = Room;