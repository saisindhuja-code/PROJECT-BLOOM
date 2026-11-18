/**
 * Shared WebSocket Hub (Phase 1, 4, 8):
 * - `/api/ws`: Unified user socket for real-time notifications, Unified Bloom Chat
 *   (DMs, Group chats, Studio chat, Project chat), presence, and Bloom Together 2.0
 *   real-time state synchronization.
 * - `/api/live/ws/:roomId`: Live Bloom WebRTC signalling and synchronized capture rounds.
 */
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";
import type { BloomDatabase, UserRecord } from "./db";
import { COOKIE_NAME, SecurityContext, isActiveProjectMember, parseCookieHeader } from "./security";

const MAX_MESSAGE_BYTES = 64 * 1024;
const ALLOWED_LIVE_STATE_KEYS = new Set(["recipe", "theme", "layout", "mode"]);

interface UnifiedClient {
  userId: number;
  bloomId: string;
  displayName: string;
  ws: WebSocket;
  channels: Set<string>;
}

interface LivePeer {
  userId: number;
  bloomId: string;
  displayName: string;
  ws: WebSocket;
}

interface LiveRoomState {
  peers: Map<number, LivePeer>;
  shared: Record<string, unknown>;
}

function originAllowed(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  const host = req.headers.host ?? "";
  try {
    const u = new URL(origin);
    if (u.host === host) return true;
  } catch {
    return false;
  }
  const allowed = (process.env.BLOOM_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return allowed.includes(origin);
}

function cleanPlacement(raw: unknown): Record<string, number> | null {
  if (!raw || typeof raw !== "object") return null;
  const clean: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw).slice(0, 16)) {
    if (typeof value === "number" && Number.isFinite(value) && Math.abs(value) < 1e6) {
      clean[String(key).slice(0, 20)] = value;
    }
  }
  return clean;
}

export class SharedWsHub {
  private wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });
  private unifiedClients = new Map<number, Set<UnifiedClient>>();
  private channelSubscribers = new Map<string, Set<UnifiedClient>>();
  private liveRooms = new Map<string, LiveRoomState>();

  constructor(
    private db: BloomDatabase,
    private security: SecurityContext,
  ) {}

  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    if (!originAllowed(req)) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }
    const cookies = parseCookieHeader(req.headers.cookie);
    const uid = this.security.verifyToken(cookies[COOKIE_NAME]);
    const user = uid !== null ? this.db.users.find((u) => u.id === uid) ?? null : null;

    if (!user) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }

    if (url.pathname === "/api/ws") {
      this.wss.handleUpgrade(req, socket, head, (ws) => {
        this.attachUnified(ws, user);
      });
      return;
    }

    const liveMatch = url.pathname.match(/^\/api\/live\/ws\/([^/]+)$/);
    if (liveMatch) {
      const roomId = decodeURIComponent(liveMatch[1]);
      const roomRow = this.db.liveRooms.find((r) => r.id === roomId);
      if (!roomRow || roomRow.status !== "open" || (roomRow.host_id !== user.id && roomRow.guest_id !== user.id)) {
        socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
        socket.destroy();
        return;
      }
      this.wss.handleUpgrade(req, socket, head, (ws) => {
        this.attachLive(ws, user, roomId, roomRow.guest_id === user.id);
      });
      return;
    }

    socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
    socket.destroy();
  }

  // -------------------------------------------------------------------------
  // Unified Hub (/api/ws)
  // -------------------------------------------------------------------------

  private canSubscribe(user: UserRecord, channel: string): boolean {
    if (channel === `user:${user.id}`) return true;
    if (channel.startsWith("chat:")) {
      const chatId = Number(channel.slice(5));
      const chat = this.db.chats.find((c) => c.id === chatId);
      if (!chat) return false;
      if (chat.type === "studio") return true;
      return chat.member_ids.includes(user.id);
    }
    if (channel.startsWith("project:")) {
      const projectId = Number(channel.slice(8));
      const project = this.db.projects.find((p) => p.id === projectId);
      if (!project) return false;
      return isActiveProjectMember(project, user.id);
    }
    return false;
  }

  private attachUnified(ws: WebSocket, user: UserRecord): void {
    const client: UnifiedClient = {
      userId: user.id,
      bloomId: user.bloom_id,
      displayName: user.display_name,
      ws,
      channels: new Set(),
    };
    let set = this.unifiedClients.get(user.id);
    if (!set) {
      set = new Set();
      this.unifiedClients.set(user.id, set);
    }
    set.add(client);

    // Subscribe to personal user channel automatically
    this.subscribeClient(client, `user:${user.id}`);

    // Subscribe to Studio Lounge automatically if needed when requested, or send welcome
    this.sendWs(ws, {
      type: "welcome",
      bloom_id: user.bloom_id,
      online_friends: this.onlineFriendBloomIds(user.id),
    });

    ws.on("message", (raw) => {
      const text = raw.toString("utf-8");
      if (text.length > MAX_MESSAGE_BYTES) return;
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(text) as Record<string, unknown>;
      } catch {
        return;
      }
      if (!msg || typeof msg !== "object") return;
      const type = msg.type;
      if (type === "ping") {
        this.sendWs(ws, { type: "pong" });
      } else if (type === "subscribe" && typeof msg.channel === "string") {
        const ch = msg.channel;
        if (this.canSubscribe(user, ch)) {
          this.subscribeClient(client, ch);
          this.sendWs(ws, {
            type: "subscribed",
            channel: ch,
            online: this.channelOnlineBloomIds(ch),
          });
          if (ch.startsWith("project:")) {
            this.broadcastChannel(
              ch,
              { type: "project:presence", projectId: Number(ch.slice(8)), online: this.channelOnlineBloomIds(ch) },
              user.id,
            );
          }
        }
      } else if (type === "unsubscribe" && typeof msg.channel === "string") {
        const ch = msg.channel;
        this.unsubscribeClient(client, ch);
        if (ch.startsWith("project:")) {
          this.broadcastChannel(ch, {
            type: "project:presence",
            projectId: Number(ch.slice(8)),
            online: this.channelOnlineBloomIds(ch),
          });
        }
      } else if (type === "typing" && typeof msg.chatId === "number") {
        const ch = `chat:${msg.chatId}`;
        if (client.channels.has(ch) || this.canSubscribe(user, ch)) {
          this.broadcastChannel(
            ch,
            {
              type: "chat:typing",
              chatId: msg.chatId,
              bloom_id: user.bloom_id,
              display_name: user.display_name,
              active: Boolean(msg.active ?? true),
            },
            user.id,
          );
        }
      } else if (type === "project:cursor" && typeof msg.projectId === "number") {
        const ch = `project:${msg.projectId}`;
        if (client.channels.has(ch)) {
          this.broadcastChannel(
            ch,
            {
              type: "project:cursor",
              projectId: msg.projectId,
              bloom_id: user.bloom_id,
              display_name: user.display_name,
              slot: typeof msg.slot === "number" ? msg.slot : null,
            },
            user.id,
          );
        }
      }
    });

    ws.on("close", () => {
      const channels = Array.from(client.channels);
      for (const ch of channels) {
        this.unsubscribeClient(client, ch);
        if (ch.startsWith("project:")) {
          this.broadcastChannel(ch, {
            type: "project:presence",
            projectId: Number(ch.slice(8)),
            online: this.channelOnlineBloomIds(ch),
          });
        }
      }
      const userSet = this.unifiedClients.get(user.id);
      if (userSet) {
        userSet.delete(client);
        if (userSet.size === 0) this.unifiedClients.delete(user.id);
      }
    });
  }

  private subscribeClient(client: UnifiedClient, channel: string): void {
    client.channels.add(channel);
    let subs = this.channelSubscribers.get(channel);
    if (!subs) {
      subs = new Set();
      this.channelSubscribers.set(channel, subs);
    }
    subs.add(client);
  }

  private unsubscribeClient(client: UnifiedClient, channel: string): void {
    client.channels.delete(channel);
    const subs = this.channelSubscribers.get(channel);
    if (subs) {
      subs.delete(client);
      if (subs.size === 0) this.channelSubscribers.delete(channel);
    }
  }

  private channelOnlineBloomIds(channel: string): string[] {
    const subs = this.channelSubscribers.get(channel);
    if (!subs) return [];
    const ids = new Set<string>();
    for (const c of subs) {
      const u = this.db.users.find((uu) => uu.id === c.userId);
      if (!u || u.privacy.show_online) ids.add(c.bloomId);
    }
    return Array.from(ids);
  }

  private onlineFriendBloomIds(userId: number): string[] {
    const ids: string[] = [];
    for (const f of this.db.friendships) {
      if (f.status !== "accepted") continue;
      const otherId = f.requester_id === userId ? f.addressee_id : f.addressee_id === userId ? f.requester_id : null;
      if (otherId && this.isUserOnline(otherId)) {
        const other = this.db.users.find((u) => u.id === otherId);
        if (other && other.privacy.show_online) ids.push(other.bloom_id);
      }
    }
    return ids;
  }

  isUserOnline(userId: number): boolean {
    const set = this.unifiedClients.get(userId);
    return Boolean(set && set.size > 0);
  }

  sendToUser(userId: number, payload: Record<string, unknown>): void {
    const set = this.unifiedClients.get(userId);
    if (!set) return;
    for (const client of set) {
      this.sendWs(client.ws, payload);
    }
  }

  broadcastChannel(channel: string, payload: Record<string, unknown>, excludeUserId?: number): void {
    const subs = this.channelSubscribers.get(channel);
    if (!subs) return;
    for (const client of subs) {
      if (excludeUserId !== undefined && client.userId === excludeUserId) continue;
      this.sendWs(client.ws, payload);
    }
  }

  // -------------------------------------------------------------------------
  // Live Bloom WebRTC Rooms (/api/live/ws/:roomId)
  // -------------------------------------------------------------------------

  onlineLiveBloomIds(roomId: string): string[] {
    const room = this.liveRooms.get(roomId);
    return room ? Array.from(room.peers.values()).map((p) => p.bloomId) : [];
  }

  closeLiveRoom(roomId: string, reason: string): void {
    const room = this.liveRooms.get(roomId);
    if (!room) return;
    this.liveRooms.delete(roomId);
    for (const peer of room.peers.values()) {
      this.sendWs(peer.ws, { type: "closed", reason });
      try {
        peer.ws.close(4004, "Room closed");
      } catch {
        // ignore
      }
    }
  }

  private attachLive(ws: WebSocket, user: UserRecord, roomId: string, isPolite: boolean): void {
    let room = this.liveRooms.get(roomId);
    if (!room) {
      room = { peers: new Map(), shared: {} };
      this.liveRooms.set(roomId, room);
    }
    const oldPeer = room.peers.get(user.id);
    const peer: LivePeer = { userId: user.id, bloomId: user.bloom_id, displayName: user.display_name, ws };
    room.peers.set(user.id, peer);
    if (oldPeer) {
      try {
        oldPeer.ws.close(4001, "Opened in another tab");
      } catch {
        // ignore
      }
    }

    const others = Array.from(room.peers.values()).filter((p) => p.userId !== user.id);
    const captures = this.db.liveCaptures
      .filter((c) => c.room_id === roomId)
      .map((c) => {
        const owner = this.db.users.find((u) => u.id === c.user_id);
        return {
          round_id: c.round_id,
          bloom_id: owner?.bloom_id ?? "",
          media_id: c.media_id,
          media_url: `/api/media/${c.media_id}`,
          placement: c.placement,
        };
      });

    this.sendWs(ws, {
      type: "welcome",
      you: { bloom_id: user.bloom_id, display_name: user.display_name },
      polite: isPolite,
      peers: others.map((p) => ({ bloom_id: p.bloomId, display_name: p.displayName })),
      state: room.shared,
      captures,
    });

    for (const other of others) {
      this.sendWs(other.ws, {
        type: "peer-joined",
        peer: { bloom_id: user.bloom_id, display_name: user.display_name },
      });
    }

    ws.on("message", (raw) => {
      const text = raw.toString("utf-8");
      if (text.length > MAX_MESSAGE_BYTES) return;
      let message: Record<string, unknown>;
      try {
        message = JSON.parse(text) as Record<string, unknown>;
      } catch {
        return;
      }
      if (!message || typeof message !== "object") return;
      const kind = message.type;
      const currentRoom = this.liveRooms.get(roomId);
      if (!currentRoom) return;

      if (kind === "ping") {
        this.sendWs(ws, { type: "pong" });
      } else if (kind === "signal") {
        this.broadcastLive(roomId, { type: "signal", from: user.bloom_id, data: message.data }, user.id);
      } else if (kind === "devices") {
        this.broadcastLive(
          roomId,
          {
            type: "devices",
            bloom_id: user.bloom_id,
            camera: Boolean(message.camera),
            mic: Boolean(message.mic),
          },
          user.id,
        );
      } else if (kind === "state") {
        const patch = message.patch;
        if (patch && typeof patch === "object") {
          const ownKey = `placement:${user.bloom_id}`;
          for (const [k, v] of Object.entries(patch)) {
            if (ALLOWED_LIVE_STATE_KEYS.has(k) || k === ownKey) {
              currentRoom.shared[k] = v;
            }
          }
          this.broadcastLive(roomId, { type: "state", state: currentRoom.shared, by: user.bloom_id });
        }
      } else if (kind === "capture") {
        const roundId = String(message.round_id ?? "").slice(0, 24);
        const seconds = Math.min(Math.max(Math.round(Number(message.seconds ?? 3)), 0), 10);
        if (roundId) {
          this.broadcastLive(roomId, {
            type: "capture",
            round_id: roundId,
            seconds,
            by: user.bloom_id,
            together: Boolean(message.together ?? true),
          });
        }
      } else if (kind === "captured") {
        const roundId = String(message.round_id ?? "").slice(0, 24);
        const mediaId = message.media_id;
        const placement = cleanPlacement(message.placement);
        if (roundId && typeof mediaId === "number") {
          const media = this.db.media.find((m) => m.id === mediaId && m.owner_id === user.id);
          if (media) {
            this.db.liveCaptures.push({
              id: this.db.nextId("capture"),
              room_id: roomId,
              user_id: user.id,
              media_id: mediaId,
              round_id: roundId,
              placement,
              created_at: this.db.now(),
            });
            this.db.persist();
            this.broadcastLive(roomId, {
              type: "captured",
              round_id: roundId,
              bloom_id: user.bloom_id,
              media_id: mediaId,
              media_url: `/api/media/${mediaId}`,
              placement,
            });
          }
        }
      }
    });

    ws.on("close", () => {
      const currentRoom = this.liveRooms.get(roomId);
      if (!currentRoom) return;
      if (currentRoom.peers.get(user.id) === peer) {
        currentRoom.peers.delete(user.id);
      }
      if (currentRoom.peers.size === 0) {
        this.liveRooms.delete(roomId);
      } else {
        this.broadcastLive(roomId, { type: "peer-left", bloom_id: user.bloom_id });
      }
    });
  }

  private broadcastLive(roomId: string, payload: Record<string, unknown>, excludeUserId?: number): void {
    const room = this.liveRooms.get(roomId);
    if (!room) return;
    for (const peer of room.peers.values()) {
      if (excludeUserId !== undefined && peer.userId === excludeUserId) continue;
      this.sendWs(peer.ws, payload);
    }
  }

  private sendWs(ws: WebSocket, payload: Record<string, unknown>): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  }

  closeAll(): void {
    for (const clientSet of this.unifiedClients.values()) {
      for (const c of clientSet) c.ws.close();
    }
    this.unifiedClients.clear();
    this.channelSubscribers.clear();
    for (const room of this.liveRooms.values()) {
      for (const p of room.peers.values()) p.ws.close();
    }
    this.liveRooms.clear();
    this.wss.close();
  }
}
