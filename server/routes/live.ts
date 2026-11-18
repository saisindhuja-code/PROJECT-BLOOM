/**
 * Live Bloom REST endpoints: room creation, ICE config, closing rooms.
 */
import crypto from "node:crypto";
import { Router } from "express";
import type { LiveRoomRecord, UserRecord } from "../db";
import { areFriends, normalizeBloomId } from "../security";
import { createNotification, requireAuth, type AuthedRequest, type RouteContext } from "./helpers";

export function liveRouter(ctx: RouteContext): Router {
  const router = Router();
  const auth = requireAuth(ctx);

  const roomOut = (room: LiveRoomRecord, viewer: UserRecord) => {
    const otherId = room.host_id === viewer.id ? room.guest_id : room.host_id;
    const other = ctx.db.users.find((u) => u.id === otherId);
    return {
      id: room.id,
      status: room.status,
      is_host: room.host_id === viewer.id,
      friend: {
        bloom_id: other?.bloom_id ?? "",
        display_name: other?.display_name ?? "Friend",
      },
      created_at: room.created_at,
      online: ctx.hub.onlineLiveBloomIds(room.id),
    };
  };

  router.get("/ice", auth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const stunRaw = process.env.STUN_URLS ?? "stun:stun.l.google.com:19302";
    const stunUrls = stunRaw.split(",").map((s) => s.trim()).filter(Boolean);
    const servers: Array<Record<string, unknown>> = [];
    if (stunUrls.length) servers.push({ urls: stunUrls });

    const turnUrls = (process.env.TURN_URLS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    const turnSecret = process.env.TURN_SHARED_SECRET ?? "";
    const turnUser = process.env.TURN_USERNAME ?? "";
    const turnCred = process.env.TURN_CREDENTIAL ?? "";

    if (turnUrls.length) {
      if (turnSecret) {
        const username = `${Math.floor(Date.now() / 1000) + 6 * 3600}:${user.bloom_id}`;
        const digest = crypto.createHmac("sha1", turnSecret).update(username).digest("base64");
        servers.push({ urls: turnUrls, username, credential: digest });
      } else if (turnUser && turnCred) {
        servers.push({ urls: turnUrls, username: turnUser, credential: turnCred });
      }
    }
    res.json({ iceServers: servers, hasTurn: servers.some((s) => "username" in s) });
  });

  router.get("/rooms", auth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const rooms = ctx.db.liveRooms
      .filter((r) => r.status === "open" && (r.host_id === user.id || r.guest_id === user.id))
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    res.json(rooms.map((r) => roomOut(r, user)));
  });

  router.post("/rooms", auth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const norm = normalizeBloomId(String((req.body ?? {}).friend_bloom_id ?? ""));
    const friend = norm ? ctx.db.users.find((u) => u.bloom_id === norm) : undefined;
    if (!friend || !areFriends(ctx.db, user.id, friend.id)) {
      res.status(422).json({ detail: "Live rooms are for friends. Add them by Bloom ID first." });
      return;
    }
    const existing = ctx.db.liveRooms.find(
      (r) =>
        r.status === "open" &&
        ((r.host_id === user.id && r.guest_id === friend.id) ||
          (r.host_id === friend.id && r.guest_id === user.id)),
    );
    if (existing) {
      res.status(201).json(roomOut(existing, user));
      return;
    }
    const room: LiveRoomRecord = {
      id: crypto.randomBytes(9).toString("base64url"),
      host_id: user.id,
      guest_id: friend.id,
      status: "open",
      created_at: ctx.db.now(),
      closed_at: null,
    };
    ctx.db.liveRooms.push(room);
    ctx.db.persist();
    createNotification(ctx, {
      userId: friend.id,
      type: "live_invite",
      actorId: user.id,
      title: "Live Bloom room opened",
      body: `${user.display_name} opened a Live Bloom room with you.`,
      link: `/live/${room.id}`,
    });
    res.status(201).json(roomOut(room, user));
  });

  router.get("/rooms/:roomId", auth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const room = ctx.db.liveRooms.find(
      (r) => r.id === req.params.roomId && (r.host_id === user.id || r.guest_id === user.id),
    );
    if (!room) {
      res.status(404).json({ detail: "That live room was not found." });
      return;
    }
    res.json(roomOut(room, user));
  });

  router.post("/rooms/:roomId/close", auth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const room = ctx.db.liveRooms.find(
      (r) => r.id === req.params.roomId && (r.host_id === user.id || r.guest_id === user.id),
    );
    if (!room) {
      res.status(404).json({ detail: "That live room was not found." });
      return;
    }
    room.status = "closed";
    room.closed_at = ctx.db.now();
    ctx.db.persist();
    ctx.hub.closeLiveRoom(room.id, "The room was closed.");
    res.json(roomOut(room, user));
  });

  return router;
}
