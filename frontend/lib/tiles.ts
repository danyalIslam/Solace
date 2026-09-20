import type { Member } from "@/lib/store";

/**
 * Tile pin logic (UsersStack).
 *
 * Pinned = never disappears when chrome goes idle. Rules:
 * - Video on (server flag) pins forever. We deliberately do NOT trust a live
 *   remote video track: after sender-side `replaceTrack(null)` Chromium can
 *   keep the receiver's video track `live` + unmuted while silently painting
 *   a frozen last frame, so track liveness alone would leave a stale tile.
 * - Actual audio received from the peer (live, unmuted remote audio track)
 *   pins — a self-reported `audioOn` flag does NOT, because the remote may be
 *   muted/silent. Speaking energy also pins.
 * - Everyone else may hide while idle.
 */

export function streamHasLive(stream: MediaStream | undefined, kind: "audio" | "video"): boolean {
  if (!stream) return false;
  return stream.getTracks().some((t) => t.kind === kind && t.readyState === "live" && !t.muted);
}

/** socketIds that stay visible during idle. */
export function pinnedIds(
  members: Member[],
  remoteStreams: Record<string, MediaStream>,
  speaking: string[]
): Set<string> {
  return new Set(
    members
      .filter((m) => {
        const stream = remoteStreams[m.socketId];
        const videoLive = m.videoOn;
        const audioLive = streamHasLive(stream, "audio");
        return videoLive || audioLive || speaking.includes(m.socketId);
      })
      .map((m) => m.socketId)
  );
}

/** Has something worth rendering a feed tile for (or connecting placeholder). */
export function memberHasMedia(m: Member, remoteStreams: Record<string, MediaStream>): boolean {
  const stream = remoteStreams[m.socketId];
  return m.videoOn || m.audioOn || streamHasLive(stream, "audio");
}