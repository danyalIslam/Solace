const CLIENT = {
    ROOM_CREATE: "room:create",
    ROOM_JOIN: "room:join",
    ROOM_LEAVE: "room:leave",
    ROOM_GET_STATE: "room:get_state",
    ROOM_SET_TITLE: "room:set_title",
    ACTIVITY_SEND: "activity:send",
    TIMER_START: "timer:start",
    TIMER_PAUSE: "timer:pause",
    TIMER_RESET: "timer:reset",
    PLAYBACK_PLAY: "playback:play",
    PLAYBACK_PAUSE: "playback:pause",
    PLAYBACK_SEEK: "playback:seek",
    PLAYBACK_SET_TRACK: "playback:set_track",
    WALLPAPER_SET: "wallpaper:set",
    RTC_MEDIA: "rtc:media",
    RTC_OFFER: "rtc:offer",
    RTC_ANSWER: "rtc:answer",
    RTC_ICE: "rtc:ice"
};

const SERVER = {
    ROOM_CREATED: "room:created",
    ROOM_JOINED: "room:joined",
    ROOM_MEMBER_JOINED: "room:member_joined",
    ROOM_MEMBER_LEFT: "room:member_left",
    ROOM_ERROR: "room:error",
    ROOM_TITLE_STATE: "room:title_state",
    ROOM_ACTIVITY: "room:activity",
    TIMER_STATE: "timer:state",
    TIMER_COMPLETE: "timer:complete",
    PLAYBACK_STATE: "playback:state",
    WALLPAPER_STATE: "wallpaper:state",
    RTC_CONFIG: "rtc:config",
    RTC_MEDIA_STATE: "rtc:media_state",
    RTC_OFFER: "rtc:offer",
    RTC_ANSWER: "rtc:answer",
    RTC_ICE: "rtc:ice"
};

module.exports = { CLIENT, SERVER };
