import { getSocket, onRtcConfig } from "@/lib/socket";
import { useRoomStore } from "@/lib/store";

type Kind = "audio" | "video";

let localStream: MediaStream | null = null;
let me: string | null = null;
let inited = false;
const peers = new Map<string, RTCPeerConnection>();
const senders = new Map<RTCPeerConnection, Partial<Record<Kind, RTCRtpSender>>>();
const negotiationChains = new WeakMap<RTCPeerConnection, Promise<void>>();
const pendingNegotiation = new Set<RTCPeerConnection>();
let iceServers: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];

onRtcConfig((cfg) => {
  if (cfg?.iceServers?.length) iceServers = cfg.iceServers;
});

function currentKinds(): { audio: boolean; video: boolean } {
  return {
    audio: (localStream?.getAudioTracks().length ?? 0) > 0,
    video: (localStream?.getVideoTracks().length ?? 0) > 0,
  };
}

function getPeer(socketId: string): RTCPeerConnection {
  let pc = peers.get(socketId);
  if (pc) return pc;
  console.debug("[solace:FE] rtc peer created", { me, to: socketId, iceServers });
  pc = new RTCPeerConnection({ iceServers });
  pc.onicecandidate = (e) => {
    if (e.candidate) {
      console.debug("[solace:FE] rtc onicecandidate", { me, to: socketId, candidate: e.candidate.toJSON() });
      getSocket().emit("rtc:ice", { to: socketId, candidate: e.candidate.toJSON() });
    }
  };
  pc.ontrack = (e) => {
    const stream = e.streams[0] ?? new MediaStream([e.track]);
    const videoTracks = stream.getVideoTracks().length;
    const audioTracks = stream.getAudioTracks().length;
    console.debug("[solace:FE] rtc ontrack", { me, from: socketId, videoTracks, audioTracks, trackKind: e.track.kind });
    useRoomStore.getState().setRemoteStream(socketId, stream);
  };
  const map: Partial<Record<Kind, RTCRtpSender>> = {};
  senders.set(pc, map);
  const stream = localStream;
  if (stream) {
    stream.getTracks().forEach((t) => {
      if (t.kind !== "audio" && t.kind !== "video") return;
      console.debug("[solace:FE] rtc addTrack", { me, to: socketId, kind: t.kind });
      map[t.kind] = pc!.addTrack(t, stream);
    });
  }
  peers.set(socketId, pc);
  return pc;
}

async function enableKind(kind: Kind): Promise<void> {
  if (localStream?.getTracks().some((t) => t.kind === kind)) {
    console.debug("[solace:FE] rtc track on (reuse)", { me, kind });
    return;
  }
  const constraints: MediaStreamConstraints = {
    audio: kind === "audio",
    video: kind === "video" ? { width: { ideal: 640 }, height: { ideal: 480 } } : false,
  };
  console.debug("[solace:FE] rtc getUserMedia START", { me, kind, constraints });
  try {
    const fresh = await navigator.mediaDevices.getUserMedia(constraints);
    if (!localStream) localStream = new MediaStream();
    fresh.getTracks().forEach((t) => localStream!.addTrack(t));
    console.debug("[solace:FE] rtc getUserMedia SUCCESS", {
      me,
      kind,
      videoTracks: fresh.getVideoTracks().length,
      audioTracks: fresh.getAudioTracks().length,
    });
    console.debug("[solace:FE] rtc track on", { me, kind, tracks: fresh.getTracks().length });
  } catch (err) {
    const e = err as DOMException;
    console.debug("[solace:FE] rtc getUserMedia FAILURE", { me, kind, name: e?.name, message: e?.message });
    throw err;
  }
}

function disableKind(kind: Kind): void {
  if (!localStream) return;
  const tracks = kind === "audio" ? localStream.getAudioTracks() : localStream.getVideoTracks();
  tracks.forEach((t) => {
    console.debug("[solace:FE] rtc track off", { me, kind });
    t.stop();
    localStream!.removeTrack(t);
  });
}

async function reconcilePeer(
  socketId: string,
  pc: RTCPeerConnection,
  desired: { audio: boolean; video: boolean }
): Promise<void> {
  const map = senders.get(pc) ?? {};
  senders.set(pc, map);
  const stream = localStream;
  let added = 0;
  let replaced = 0;
  let nulled = 0;
  let needsNegotiation = false;
  for (const kind of ["audio", "video"] as const) {
    const want = desired[kind];
    const existing = map[kind];
    const track = stream?.getTracks().find((t) => t.kind === kind) ?? null;
    if (want && track && stream) {
      if (existing) {
        if (existing.track !== track) {
          await existing.replaceTrack(track);
          replaced++;
        }
      } else {
        map[kind] = pc.addTrack(track, stream);
        added++;
        needsNegotiation = true;
      }
    } else if (!want && existing) {
      await existing.replaceTrack(null);
      nulled++;
    }
  }
  console.debug("[solace:FE] rtc reconcile", { me, to: socketId, added, replaced, nulled });
  if (needsNegotiation) void negotiate(pc, socketId);
}

function negotiate(pc: RTCPeerConnection, socketId: string): Promise<void> {
  const prev = negotiationChains.get(pc) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  negotiationChains.set(pc, prev.then(() => gate));
  return prev.then(async () => {
    try {
      if (pc.signalingState !== "stable") {
        pendingNegotiation.add(pc);
        console.debug("[solace:FE] rtc negotiation serialize", { me, to: socketId, state: pc.signalingState });
        return;
      }
      pendingNegotiation.delete(pc);
      console.debug("[solace:FE] rtc negotiation start", { me, to: socketId });
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      console.debug("[solace:FE] rtc negotiation offer", { me, to: socketId, hasSdp: !!pc.localDescription });
      getSocket().emit("rtc:offer", { to: socketId, sdp: pc.localDescription });
    } catch (err) {
      const e = err as DOMException;
      console.debug("[solace:FE] rtc negotiation error", {
        me,
        to: socketId,
        name: e?.name,
        message: e?.message,
        state: pc.signalingState,
      });
    } finally {
      release();
    }
  });
}

function flushPending(pc: RTCPeerConnection, socketId: string): void {
  if (pendingNegotiation.has(pc) && pc.signalingState === "stable") {
    console.debug("[solace:FE] rtc negotiation flush pending", { me, to: socketId });
    void negotiate(pc, socketId);
  }
}

let startRtcChain: Promise<void> = Promise.resolve();

async function startRtcInternal({ audio, video }: { audio: boolean; video: boolean }): Promise<void> {
  const socket = getSocket();
  const s = useRoomStore.getState();
  const cur = currentKinds();
  if (cur.audio === audio && cur.video === video) {
    // Idempotent re-entry: still refresh the server flags. A socket reconnect /
    // rebuild can drop media_state updates while local state stayed "on", so a
    // peer can keep showing a frozen frame + "video on" long after we stopped.
    console.debug("[solace:FE] rtc startRtc idempotent skip", { me, audio, video });
    s.setLocalMedia(audio, video);
    socket.emit("rtc:media", { audio, video });
    return;
  }
  console.debug("[solace:FE] rtc startRtc", { me, audio, video, peers: peers.size, hadLocalStream: !!localStream });

  try {
    if (audio) await enableKind("audio");
    else disableKind("audio");
    if (video) await enableKind("video");
    else disableKind("video");
  } finally {
    // Announce the TRUE final state, not just the intent. enableKind can throw
    // (camera/mic denied); if it does, the server must never be left advertising
    // media we are not actually sending — that is exactly the frozen-frame bug
    // (peer keeps a live track + "video on" forever when rtc:media never fires).
    const actual = currentKinds();
    s.setLocalMedia(actual.audio, actual.video);
    socket.emit("rtc:media", { audio: actual.audio, video: actual.video });
    if (me) {
      // Publish OUR OWN stream under our own socket id so the local user sees a
      // self-preview tile; null clears it (video off → no own tile entry).
      useRoomStore.getState().setRemoteStream(me, actual.video ? localStream : null);
    }
  }

  const desired = { audio: currentKinds().audio, video: currentKinds().video };

  for (const [socketId, pc] of peers) {
    await reconcilePeer(socketId, pc, desired);
  }
  for (const m of s.members) {
    if (m.socketId === me || peers.has(m.socketId)) continue;
    const pc = getPeer(m.socketId);
    await reconcilePeer(m.socketId, pc, desired);
    if (localStream && localStream.getTracks().length > 0) void negotiate(pc, m.socketId);
  }
}

export function startRtc(args: { audio: boolean; video: boolean }): Promise<void> {
  const run = startRtcChain.then(() => startRtcInternal(args));
  startRtcChain = run.catch(() => {});
  return run;
}

export function initRtc(): void {
  if (inited) return;
  inited = true;
  const socket = getSocket();
  console.debug("[solace:FE] rtc initRtc listeners registered", [
    "rtc:offer",
    "rtc:answer",
    "rtc:ice",
    "room:member_left",
    "connect",
  ]);
  socket.on("rtc:offer", async (p: { from: string; sdp: RTCSessionDescription }) => {
    try {
      const pc = getPeer(p.from);
      console.debug("[solace:FE] rtc offer received", { me, from: p.from, hasSdp: !!p.sdp, state: pc.signalingState });
      if (pc.signalingState === "have-remote-offer") {
        console.debug("[solace:FE] rtc offer duplicate ignored", { me, from: p.from, state: pc.signalingState });
        return;
      }
      if (pc.signalingState === "have-local-offer") {
        try {
          await pc.setLocalDescription({ type: "rollback" });
          console.debug("[solace:FE] rtc offer rollback", { me, from: p.from, state: pc.signalingState });
        } catch (e) {
          console.debug("[solace:FE] rtc offer rollback unsupported, skipping", {
            me,
            from: p.from,
            name: (e as DOMException)?.name,
          });
          return;
        }
      }
      await pc.setRemoteDescription(new RTCSessionDescription(p.sdp));
      console.debug("[solace:FE] rtc remote description set", { me, from: p.from, type: "offer" });
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      console.debug("[solace:FE] rtc answer created", { me, to: p.from, hasSdp: !!pc.localDescription });
      socket.emit("rtc:answer", { to: p.from, sdp: pc.localDescription });
      flushPending(pc, p.from);
    } catch (err) {
      const e = err as DOMException;
      console.debug("[solace:FE] rtc offer handler error", { me, from: p.from, name: e?.name, message: e?.message });
    }
  });
  socket.on("rtc:answer", async (p: { from: string; sdp: RTCSessionDescription }) => {
    const pc = peers.get(p.from);
    console.debug("[solace:FE] rtc answer received", { me, from: p.from, state: pc?.signalingState });
    if (!pc) {
      console.debug("[solace:FE] rtc answer ignored (no peer)", { me, from: p.from });
      return;
    }
    if (pc.signalingState !== "have-local-offer") {
      console.debug("[solace:FE] rtc answer ignored", { me, from: p.from, state: pc.signalingState });
      return;
    }
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(p.sdp));
      console.debug("[solace:FE] rtc remote description set", { me, from: p.from, type: "answer", state: pc.signalingState });
      flushPending(pc, p.from);
    } catch (err) {
      const e = err as DOMException;
      console.debug("[solace:FE] rtc answer setRemoteDescription failed", { me, from: p.from, name: e?.name, state: pc.signalingState });
    }
  });
  socket.on("rtc:ice", async (p: { from: string; candidate: RTCIceCandidateInit }) => {
    try {
      const pc = peers.get(p.from);
      console.debug("[solace:FE] rtc ice received", { me, from: p.from, hasPeer: !!pc });
      if (pc) await pc.addIceCandidate(new RTCIceCandidate(p.candidate)).catch(() => {});
      console.debug("[solace:FE] rtc ice candidate add", { me, from: p.from });
    } catch (err) {
      const e = err as DOMException;
      console.debug("[solace:FE] rtc ice handler error", { me, from: p.from, name: e?.name, message: e?.message });
    }
  });
  socket.on("room:member_left", (p: { socketId: string }) => {
    console.debug("[solace:FE] rtc room:member_left cleanup", { me, left: p.socketId });
    const pc = peers.get(p.socketId);
    if (pc) {
      pc.close();
      peers.delete(p.socketId);
      senders.delete(pc);
      pendingNegotiation.delete(pc);
    }
    useRoomStore.getState().setRemoteStream(p.socketId, null);
    // A detached (PiP) feed for a member who left must disappear too.
    if (useRoomStore.getState().detachedFeed?.socketId === p.socketId) {
      useRoomStore.getState().dockFeed();
    }
  });
  socket.on("connect", () => {
    me = socket.id ?? null;
    console.debug("[solace:FE] rtc connected", { me });
  });
  if (socket.connected) me = socket.id ?? null;
}

export function stopRtc(): void {
  console.debug("[solace:FE] rtc stopRtc", { me, peers: peers.size, hadLocalStream: !!localStream });
  localStream?.getTracks().forEach((t) => t.stop());
  localStream = null;
  if (me) useRoomStore.getState().setRemoteStream(me, null);
  peers.forEach((pc) => {
    pc.close();
    senders.delete(pc);
    pendingNegotiation.delete(pc);
  });
  peers.clear();
}

/**
 * After a socket reconnect the backend has dropped our old socket.id from the
 * room (membership is id-keyed) and our peers still reference stale ids. Tear
 * everything down, clear remote streams, then re-acquire local media and let
 * the next negotiation rebuild peers under the new socket id.
 */
export function rebuildAfterReconnect(): void {
  console.debug("[solace:FE] rtc rebuildAfterReconnect", { peers: peers.size, hadLocalStream: !!localStream });
  localStream?.getTracks().forEach((t) => t.stop());
  localStream = null;
  peers.forEach((pc) => {
    pc.close();
    senders.delete(pc);
    pendingNegotiation.delete(pc);
  });
  peers.clear();
  useRoomStore.getState().clearRemoteStreams();
  const { audioOnLocal, videoOnLocal } = useRoomStore.getState();
  if (audioOnLocal || videoOnLocal) {
    console.debug("[solace:FE] rtc rebuildAfterReconnect re-acquire media", { audioOnLocal, videoOnLocal });
    void startRtc({ audio: audioOnLocal, video: videoOnLocal });
  }
}

const analysers = new Map<string, AnalyserNode>();
let speakTimer: ReturnType<typeof setInterval> | null = null;

export function startSpeakingDetection(): void {
  if (speakTimer) return;
  const ctx = new AudioContext();
  speakTimer = setInterval(() => {
    const s = useRoomStore.getState();
    const talking: string[] = [];
    Object.entries(s.remoteStreams).forEach(([id, stream]) => {
      if (id === me) return; // own camera/audio preview — never self-detect speaking
      if (stream.getAudioTracks().length === 0) {
        analysers.delete(id);
        return;
      }
      let an = analysers.get(id);
      if (!an) {
        const src = ctx.createMediaStreamSource(stream);
        an = ctx.createAnalyser();
        an.fftSize = 512;
        src.connect(an);
        analysers.set(id, an);
      }
      const data = new Uint8Array(an.frequencyBinCount);
      an.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) sum += Math.abs(data[i] - 128);
      const level = sum / data.length;
      if (level > 8) talking.push(id);
    });
    if (talking.length) console.debug("[solace:FE] rtc speaking", { me, talking });
    s.setSpeaking(talking);
  }, 300);
}
