"use client";
import { useEffect, useRef, useState } from "react";
import { PipWindow } from "@/components/video/PipWindow";
import { useRoomStore } from "@/lib/store";

function RemoteStream({
  stream,
  videoOn,
  mirror,
}: {
  stream: MediaStream;
  /** Declared camera state from rtc:media_state — the only authoritative
   *  signal for sender-side camera-off. Track mute/ended events DO NOT fire
   *  reliably: `replaceTrack(null)` on the sender never renegotiates, so the
   *  receiver's video track stays live+unmuted and keeps painting the frozen
   *  last frame. Without this gate the tile would show it forever. */
  videoOn: boolean;
  mirror?: boolean;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  // Self-tile must never play our own audio back (echo/feedback). The camera
  // toggle publishes the WHOLE localStream (audio tracks included when mic is
  // on) under our own id — mute the preview so only the feed plays it.
  const muted = mirror ?? false;
  // Presence-based init: remote tracks can arrive muted/blank at stream
  // creation — a muted track STILL has (soon-arriving) video, so show the
  // element immediately. Listeners narrow it to 'audio only' on mute/ended.
  const [videoActive, setVideoActive] = useState(() => stream.getVideoTracks().length > 0);

  useEffect(() => {
    if (audioRef.current) audioRef.current.srcObject = stream;
    if (videoRef.current) videoRef.current.srcObject = stream;
    const bound = new Set<MediaStreamTrack>();
    // Re-query the stream every update so tracks added/removed after mount
    // (store stream replacement via per-track ontrack, renegotiation) are seen
    // instead of a stale snapshot from the last effect run.
    const update = () =>
      setVideoActive(stream.getVideoTracks().some((t) => t.readyState === "live" && !t.muted));
    const bind = (t: MediaStreamTrack) => {
      if (bound.has(t)) return;
      bound.add(t);
      t.addEventListener("mute", update);
      t.addEventListener("unmute", update);
      t.addEventListener("ended", update);
    };
    const refresh = () => {
      stream.getVideoTracks().forEach(bind);
      update();
    };
    stream.getVideoTracks().forEach(bind);
    stream.addEventListener("addtrack", refresh);
    stream.addEventListener("removetrack", refresh);
    update();
    // Track events (mute/ended/addtrack/removetrack) are not reliable after
    // sender-side replaceTrack(null) — Chromium can keep the receiver track
    // live+unmuted and silently stop painting new frames. Polling keeps
    // videoActive honest even when no event fires.
    const heal = setInterval(update, 2500);
    return () => {
      clearInterval(heal);
      bound.forEach((t) => {
        t.removeEventListener("mute", update);
        t.removeEventListener("unmute", update);
        t.removeEventListener("ended", update);
      });
      bound.clear();
      stream.removeEventListener("addtrack", refresh);
      stream.removeEventListener("removetrack", refresh);
    };
  }, [stream]);

  const showVideo = videoOn && videoActive;

  return (
    <>
      <audio ref={audioRef} autoPlay playsInline muted={muted} className="hidden" />
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={muted}
        className={`w-full h-full object-cover ${showVideo ? "" : "hidden"} ${mirror ? "-scale-x-100" : ""}`}
      />
      {!showVideo && (
        <div className="w-full h-full grid place-items-center text-[8px] opacity-60">audio only</div>
      )}
    </>
  );
}

/** Docked feed tile — double-click detaches into a floating PiP window. */
export function VideoFeed({ socketId, memberName }: { socketId: string; memberName: string }) {
  const stream = useRoomStore((s) => s.remoteStreams[socketId]);
  const videoOn = useRoomStore((s) => s.members.find((m) => m.socketId === socketId)?.videoOn ?? true);
  const detached = useRoomStore((s) => s.detachedFeed?.socketId === socketId);
  const me = useRoomStore((s) => s.socketId);
  const mirror = socketId === me;

  if (detached) return null;

  return (
    <div
      className="relative rounded-lg overflow-hidden"
      style={{ width: 120, height: 90, border: "1px solid rgba(224,164,88,0.3)" }}
      onDoubleClick={() => useRoomStore.getState().detachFeed(socketId, memberName)}
      title="double-click to detach"
    >
      {stream ? (
        <RemoteStream stream={stream} videoOn={videoOn} mirror={mirror} />
      ) : (
        <div className="w-full h-full grid place-items-center text-[8px] opacity-50">connecting…</div>
      )}
    </div>
  );
}

/**
 * The undocked (PiP) feed. Mounted OUTSIDE any idle/hover chrome in RoomScreen
 * so it never fades or hides — an undocked video stays visible forever.
 */
export function DetachedVideoWindow() {
  const detachedFeed = useRoomStore((s) => s.detachedFeed);
  const stream = useRoomStore((s) => (detachedFeed ? s.remoteStreams[detachedFeed.socketId] : null));
  const videoOn = useRoomStore((s) =>
    detachedFeed ? (s.members.find((m) => m.socketId === detachedFeed.socketId)?.videoOn ?? true) : true
  );
  const me = useRoomStore((s) => s.socketId);

  if (!detachedFeed) return null;

  const mirror = detachedFeed.socketId === me;
  return (
    <PipWindow title={detachedFeed.title} onReDock={() => useRoomStore.getState().dockFeed()}>
      {stream ? (
        <RemoteStream stream={stream} videoOn={videoOn} mirror={mirror} />
      ) : (
        <div className="w-full h-full grid place-items-center text-[8px] opacity-50">connecting…</div>
      )}
    </PipWindow>
  );
}