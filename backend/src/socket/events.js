const CLIENT = {
    ROOM_CREATE: "room:create",
    ROOM_JOIN: "room:join",
    ROOM_LEAVE: "room:leave",
    ROOM_GET_STATE: "room:get_state",
    PLAYBACK_PLAY: "playback:play",
    PLAYBACK_PAUSE: "playback:pause",
    PLAYBACK_SEEK: "playback:seek",
    PLAYBACK_SET_TRACK: "playback:set_track",
    WALLPAPER_SET: "wallpaper:set",
    CHAT_SEND: "chat:send"
};

const SERVER = {
    ROOM_CREATED: "room:created",
    ROOM_JOINED: "room:joined",
    ROOM_MEMBER_JOINED: "room:member_joined",
    ROOM_MEMBER_LEFT: "room:member_left",
    ROOM_ERROR: "room:error",
    PLAYBACK_STATE: "playback:state",
    WALLPAPER_STATE: "wallpaper:state",
    CHAT_MESSAGE: "chat:message"
};

module.exports = { CLIENT, SERVER };