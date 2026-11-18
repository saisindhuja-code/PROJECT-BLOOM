/**
 * Live Bloom connection: a WebSocket for signalling and shared state, and a
 * WebRTC peer connection for audio/video between the two browsers.
 *
 * Uses the "perfect negotiation" pattern: the guest is the polite peer and
 * yields when both sides send offers at the same moment. Camera and
 * microphone tracks are swapped in and out with replaceTrack, so turning a
 * device on or off never needs a new negotiation, and nothing is sent until
 * the person switches a device on.
 */

import { API_BASE, api } from "./api";

export type LiveStatus =
  | "connecting"
  | "waiting"
  | "negotiating"
  | "connected"
  | "reconnecting"
  | "failed"
  | "closed"
  | "denied";

export interface PeerInfo {
  bloom_id: string;
  display_name: string;
}

export interface CapturedPhoto {
  round_id: string;
  bloom_id: string;
  media_id: number;
  media_url: string;
  placement: Record<string, number> | null;
}

export interface LiveEvents {
  onStatus(status: LiveStatus, detail?: string): void;
  onWelcome(info: { you: PeerInfo; polite: boolean; peers: PeerInfo[]; state: Record<string, unknown>; captures: CapturedPhoto[] }): void;
  onPeer(peer: PeerInfo | null): void;
  onRemoteStream(stream: MediaStream | null): void;
  onState(state: Record<string, unknown>, by: string): void;
  onCapture(message: { round_id: string; seconds: number; by: string; together: boolean }): void;
  onCaptured(capture: CapturedPhoto): void;
  onDevices(info: { bloom_id: string; camera: boolean; mic: boolean }): void;
}

export function webrtcSupported(): boolean {
  return typeof window !== "undefined" && "RTCPeerConnection" in window;
}

function socketUrl(roomId: string): string {
  const base = API_BASE || window.location.origin;
  const url = new URL(`/api/live/ws/${encodeURIComponent(roomId)}`, base);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

export class LiveSession {
  private ws: WebSocket | null = null;
  private pc: RTCPeerConnection | null = null;
  private iceServers: RTCIceServer[] = [];
  private polite = false;
  private makingOffer = false;
  private ignoreOffer = false;
  private closedByUser = false;
  private retries = 0;
  private retryTimer = 0;
  private pingTimer = 0;
  private disconnectTimer = 0;
  private peerPresent = false;
  private remoteStream: MediaStream | null = null;
  private tracks: { audio: MediaStreamTrack | null; video: MediaStreamTrack | null } = { audio: null, video: null };
  hasTurn = false;

  constructor(
    private readonly roomId: string,
    private readonly events: LiveEvents,
  ) {}

  async start(): Promise<void> {
    this.events.onStatus("connecting");
    try {
      const ice = await api<{ iceServers: RTCIceServer[]; hasTurn: boolean }>("/api/live/ice");
      this.iceServers = ice.iceServers;
      this.hasTurn = ice.hasTurn;
    } catch {
      this.iceServers = [];
    }
    this.openSocket();
  }

  // -------------------------------------------------------------------
  // WebSocket
  // -------------------------------------------------------------------

  private openSocket(): void {
    if (this.closedByUser) return;
    const ws = new WebSocket(socketUrl(this.roomId));
    this.ws = ws;
    ws.onopen = () => {
      this.retries = 0;
      window.clearInterval(this.pingTimer);
      this.pingTimer = window.setInterval(() => this.send({ type: "ping" }), 20000);
    };
    ws.onmessage = (event) => {
      let message: Record<string, unknown>;
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }
      void this.handle(message);
    };
    ws.onclose = (event) => {
      window.clearInterval(this.pingTimer);
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.closedByUser) return;
      if (event.code === 4003) {
        this.events.onStatus("denied", "You're not part of this room, or it has ended.");
        return;
      }
      if (event.code === 4004) {
        this.teardownPeer();
        this.events.onStatus("closed", "The room was closed.");
        return;
      }
      if (event.code === 4001) {
        this.teardownPeer();
        this.events.onStatus("closed", "This room was opened in another tab.");
        return;
      }
      this.events.onStatus("reconnecting");
      const delay = Math.min(10000, 1000 * 2 ** this.retries++);
      this.retryTimer = window.setTimeout(() => this.openSocket(), delay);
    };
  }

  private send(message: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(message));
  }

  private async handle(message: Record<string, unknown>): Promise<void> {
    switch (message.type) {
      case "welcome": {
        // (Re)joined: always start from a fresh peer connection.
        this.teardownPeer();
        this.polite = Boolean(message.polite);
        const peers = (message.peers as PeerInfo[]) ?? [];
        this.events.onWelcome({
          you: message.you as PeerInfo,
          polite: this.polite,
          peers,
          state: (message.state as Record<string, unknown>) ?? {},
          captures: (message.captures as CapturedPhoto[]) ?? [],
        });
        this.peerPresent = peers.length > 0;
        this.events.onPeer(peers[0] ?? null);
        this.announceDevices();
        if (this.peerPresent) {
          this.events.onStatus("negotiating");
          if (!this.polite) this.startCall();
        } else {
          this.events.onStatus("waiting");
        }
        break;
      }
      case "peer-joined":
        // The other person (re)joined: the host starts a fresh call; the guest waits for its offer.
        if (this.polite) this.teardownPeer();
        this.peerPresent = true;
        this.events.onPeer(message.peer as PeerInfo);
        this.events.onStatus("negotiating");
        this.announceDevices();
        if (!this.polite) this.startCall();
        break;
      case "peer-left":
        this.peerPresent = false;
        this.events.onPeer(null);
        this.teardownPeer();
        this.events.onStatus("waiting");
        break;
      case "signal":
        await this.onSignal(message.data as { description?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit });
        break;
      case "state":
        this.events.onState((message.state as Record<string, unknown>) ?? {}, String(message.by ?? ""));
        break;
      case "capture":
        this.events.onCapture(message as unknown as { round_id: string; seconds: number; by: string; together: boolean });
        break;
      case "captured":
        this.events.onCaptured(message as unknown as CapturedPhoto);
        break;
      case "devices":
        this.events.onDevices(message as unknown as { bloom_id: string; camera: boolean; mic: boolean });
        break;
      case "closed":
        this.closedByUser = true;
        this.teardownPeer();
        this.events.onStatus("closed", String(message.reason ?? "The room was closed."));
        break;
      default:
        break;
    }
  }

  // -------------------------------------------------------------------
  // WebRTC
  // -------------------------------------------------------------------

  private createPeer(): RTCPeerConnection {
    this.teardownPeer();
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    this.pc = pc;
    this.remoteStream = new MediaStream();
    this.events.onRemoteStream(this.remoteStream);

    pc.ontrack = (event) => {
      if (this.pc !== pc || !this.remoteStream) return;
      if (!this.remoteStream.getTracks().includes(event.track)) this.remoteStream.addTrack(event.track);
      this.events.onRemoteStream(this.remoteStream);
    };
    pc.onicecandidate = (event) => {
      if (event.candidate) this.send({ type: "signal", data: { candidate: event.candidate.toJSON() } });
    };
    pc.onnegotiationneeded = async () => {
      if (this.pc !== pc) return;
      try {
        this.makingOffer = true;
        await pc.setLocalDescription();
        this.send({ type: "signal", data: { description: pc.localDescription?.toJSON() } });
      } catch {
        /* a later negotiation will retry */
      } finally {
        this.makingOffer = false;
      }
    };
    pc.onconnectionstatechange = () => {
      if (this.pc !== pc) return;
      window.clearTimeout(this.disconnectTimer);
      switch (pc.connectionState) {
        case "connected":
          this.events.onStatus("connected");
          break;
        case "disconnected":
          this.events.onStatus("reconnecting");
          // Give the network a moment, then try a fresh route.
          this.disconnectTimer = window.setTimeout(() => {
            if (this.pc === pc && pc.connectionState !== "connected" && !this.polite) pc.restartIce();
          }, 4000);
          break;
        case "failed":
          if (!this.polite) pc.restartIce();
          this.events.onStatus(
            "failed",
            this.hasTurn
              ? "The video connection failed. Trying again…"
              : "The video connection failed. Your networks may need a TURN relay server (see the README).",
          );
          break;
        default:
          break;
      }
    };
    return pc;
  }

  /** Host side: create the connection with one audio and one video slot and send the offer. */
  private startCall(): void {
    if (!webrtcSupported()) return;
    const pc = this.createPeer();
    pc.addTransceiver(this.tracks.audio ?? "audio", { direction: "sendrecv" });
    pc.addTransceiver(this.tracks.video ?? "video", { direction: "sendrecv" });
  }

  private async onSignal(data: { description?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit } | undefined): Promise<void> {
    if (!data || !webrtcSupported()) return;
    let pc = this.pc;
    if (!pc) {
      if (!data.description || data.description.type !== "offer") return;
      pc = this.createPeer();
    }
    try {
      if (data.description) {
        const collision = data.description.type === "offer" && (this.makingOffer || pc.signalingState !== "stable");
        this.ignoreOffer = !this.polite && collision;
        if (this.ignoreOffer) return;
        await pc.setRemoteDescription(data.description);
        if (data.description.type === "offer") {
          // Guest side: send on the slots the host created.
          for (const transceiver of pc.getTransceivers()) {
            if (transceiver.direction === "recvonly" || transceiver.direction === "inactive") transceiver.direction = "sendrecv";
            const kind = transceiver.receiver.track.kind as "audio" | "video";
            if (transceiver.sender.track !== this.tracks[kind]) await transceiver.sender.replaceTrack(this.tracks[kind]);
          }
          await pc.setLocalDescription();
          this.send({ type: "signal", data: { description: pc.localDescription?.toJSON() } });
        }
      } else if (data.candidate) {
        try {
          await pc.addIceCandidate(data.candidate);
        } catch (error) {
          if (!this.ignoreOffer) throw error;
        }
      }
    } catch {
      this.events.onStatus("reconnecting");
    }
  }

  private teardownPeer(): void {
    window.clearTimeout(this.disconnectTimer);
    if (this.pc) {
      this.pc.onconnectionstatechange = null;
      this.pc.ontrack = null;
      this.pc.onicecandidate = null;
      this.pc.onnegotiationneeded = null;
      this.pc.close();
    }
    this.pc = null;
    this.remoteStream?.getTracks().forEach((t) => this.remoteStream?.removeTrack(t));
    this.remoteStream = null;
    this.events.onRemoteStream(null);
  }

  // -------------------------------------------------------------------
  // Devices and shared actions
  // -------------------------------------------------------------------

  async setTrack(kind: "audio" | "video", track: MediaStreamTrack | null): Promise<void> {
    this.tracks[kind] = track;
    const transceiver = this.pc?.getTransceivers().find((t) => t.receiver.track.kind === kind);
    if (transceiver) {
      try {
        await transceiver.sender.replaceTrack(track);
      } catch {
        /* the connection is being rebuilt; the next one picks up the track */
      }
    }
    this.announceDevices();
  }

  private announceDevices(): void {
    this.send({ type: "devices", camera: Boolean(this.tracks.video), mic: Boolean(this.tracks.audio) });
  }

  sendState(patch: Record<string, unknown>): void {
    this.send({ type: "state", patch });
  }

  startCapture(roundId: string, together: boolean, seconds = 3): void {
    this.send({ type: "capture", round_id: roundId, seconds, together });
  }

  sendCaptured(roundId: string, mediaId: number, placement: Record<string, number>): void {
    this.send({ type: "captured", round_id: roundId, media_id: mediaId, placement });
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  close(): void {
    this.closedByUser = true;
    window.clearTimeout(this.retryTimer);
    window.clearInterval(this.pingTimer);
    this.teardownPeer();
    this.ws?.close(1000, "left");
    this.ws = null;
  }
}
