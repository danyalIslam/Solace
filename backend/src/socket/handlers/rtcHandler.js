const { SERVER, CLIENT } = require("../events");
const { TargetNotInRoomError, NotInRoomError, InvalidPayloadError } = require("../../rooms/RoomService");

const DEFAULT_STUN_URL = "stun:stun.l.google.com:19302";

function resolveIceServers(env) {
    const iceServers = [{ urls: [DEFAULT_STUN_URL] }];
    const { TURN_HOST, TURN_PORT, TURN_USER, TURN_PASSWORD } = env;
    if (TURN_HOST && TURN_USER && TURN_PASSWORD) {
        const port = TURN_PORT || "3478";
        iceServers.push({
            urls: [
                `turn:${TURN_HOST}:${port}?transport=udp`,
                `turn:${TURN_HOST}:${port}?transport=tcp`
            ],
            username: TURN_USER,
            credential: TURN_PASSWORD
        });
    }
    return iceServers;
}

function createRtcHandler(io, roomService) {
    function emitError(socket, err) {
        socket.emit(SERVER.ROOM_ERROR, { code: err.code, message: err.message });
    }

    function relay(eventName, socket, payload, field) {
        const fromRoom = roomService.resolveRoomBySocket(socket.id);
        if (!fromRoom) {
            emitError(socket, new NotInRoomError());
            return;
        }
        const to = payload && payload.to;
        const data = payload && payload[field];
        if (typeof to !== "string" || typeof data !== "string" || data.length === 0) {
            emitError(socket, new InvalidPayloadError(`${eventName} requires { to: string, ${field}: string }`));
            return;
        }
        if (!fromRoom.members.has(to)) {
            emitError(socket, new TargetNotInRoomError());
            return;
        }
        const envelope = { from: socket.id, [field]: data };
        io.to(to).emit(eventName, envelope);
    }

    return {
        handleMedia(socket, payload) {
            try {
                const room = roomService.resolveRoomBySocket(socket.id);
                if (!room) {
                    emitError(socket, new NotInRoomError());
                    return;
                }
                const audio = payload && payload.audio;
                const video = payload && payload.video;
                const member = roomService.setMedia(room.id, socket.id, { audio, video });
                io.to(room.id).emit(SERVER.RTC_MEDIA_STATE, {
                    socketId: socket.id,
                    audio: member.audioOn,
                    video: member.videoOn
                });
            } catch (err) {
                emitError(socket, err);
            }
        },
        handleOffer(socket, payload) { relay(CLIENT.RTC_OFFER, socket, payload, "sdp"); },
        handleAnswer(socket, payload) { relay(CLIENT.RTC_ANSWER, socket, payload, "sdp"); },
        handleIce(socket, payload) { relay(CLIENT.RTC_ICE, socket, payload, "candidate"); }
    };
}

module.exports = { createRtcHandler, resolveIceServers };
