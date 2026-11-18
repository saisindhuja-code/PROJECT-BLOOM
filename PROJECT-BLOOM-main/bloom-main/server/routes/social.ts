/**
 * Phase 2 & 3: Bloom ID Discovery, User Profiles (with privacy), Friends,
 * Follow Social Graph, Reactions, Persistent Notifications, and Inbox.
 */
import { Router } from "express";
import type { FriendshipRecord, UserRecord } from "../db";
import { areFriends, normalizeBloomId } from "../security";
import { VALID_REACTION_EMOJIS, publicUserOut } from "../validation";
import { createNotification, requireAuth, type AuthedRequest, type RouteContext } from "./helpers";

export function socialRouter(ctx: RouteContext): Router {
  const router = Router();
  const auth = requireAuth(ctx);

  const findByBloomId = (raw: string): UserRecord | undefined => {
    const norm = normalizeBloomId(raw);
    return norm ? ctx.db.users.find((u) => u.bloom_id === norm) : undefined;
  };

  const friendshipBetween = (a: number, b: number): FriendshipRecord | undefined =>
    ctx.db.friendships.find(
      (f) => (f.requester_id === a && f.addressee_id === b) || (f.requester_id === b && f.addressee_id === a),
    );

  const relationOf = (viewerId: number, otherId: number) => {
    if (viewerId === otherId) return "self";
    const link = friendshipBetween(viewerId, otherId);
    if (!link) return "none";
    if (link.status === "accepted") return "friend";
    return link.requester_id === viewerId ? "request-sent" : "request-received";
  };

  // --- Bloom ID lookup & Discovery -----------------------------------------

  router.get("/users/lookup", auth, (req: AuthedRequest, res) => {
    const viewer = req.user!;
    const raw = String(req.query.bloom_id ?? "");
    const other = findByBloomId(raw);
    if (!other) {
      res.status(404).json({ detail: "No one with that Bloom ID." });
      return;
    }
    const relation = relationOf(viewer.id, other.id);
    const following = ctx.db.follows.some((f) => f.follower_id === viewer.id && f.followee_id === other.id);
    res.json({
      ...publicUserOut(other, ctx.hub.isUserOnline(other.id)),
      relation,
      following,
    });
  });

  router.get("/users/discover", auth, (req: AuthedRequest, res) => {
    const viewer = req.user!;
    const q = String(req.query.q ?? "").trim().toLowerCase();
    const normId = normalizeBloomId(q);
    const matches = ctx.db.users
      .filter((u) => u.id !== viewer.id)
      .filter((u) => {
        if (normId && u.bloom_id === normId) return true;
        if (!u.privacy.discoverable) return false;
        if (!q) return true;
        return (
          u.display_name.toLowerCase().includes(q) ||
          u.bloom_id.toLowerCase().includes(q) ||
          u.favorite_word.toLowerCase().includes(q)
        );
      })
      .slice(0, 24)
      .map((u) => ({
        ...publicUserOut(u, ctx.hub.isUserOnline(u.id)),
        favorite_word: u.privacy.profile_visibility === "private" ? "" : u.favorite_word,
        relation: relationOf(viewer.id, u.id),
        following: ctx.db.follows.some((f) => f.follower_id === viewer.id && f.followee_id === u.id),
      }));
    res.json(matches);
  });

  router.get("/users/:bloomId/profile", auth, (req: AuthedRequest, res) => {
    const viewer = req.user!;
    const other = findByBloomId(String(req.params.bloomId));
    if (!other) {
      res.status(404).json({ detail: "That Bloom user was not found." });
      return;
    }
    const isSelf = viewer.id === other.id;
    const isFriend = areFriends(ctx.db, viewer.id, other.id);
    const vis = other.privacy.profile_visibility;
    const canSeeDetails = isSelf || vis === "everyone" || (vis === "friends" && isFriend);

    const followersCount = ctx.db.follows.filter((f) => f.followee_id === other.id).length;
    const followingCount = ctx.db.follows.filter((f) => f.follower_id === other.id).length;
    const friendsCount = ctx.db.friendships.filter(
      (f) => f.status === "accepted" && (f.requester_id === other.id || f.addressee_id === other.id),
    ).length;

    res.json({
      ...publicUserOut(other, ctx.hub.isUserOnline(other.id)),
      relation: relationOf(viewer.id, other.id),
      following: ctx.db.follows.some((f) => f.follower_id === viewer.id && f.followee_id === other.id),
      follows_you: ctx.db.follows.some((f) => f.follower_id === other.id && f.followee_id === viewer.id),
      profile_locked: !canSeeDetails,
      bio: canSeeDetails ? other.bio : "",
      favorite_word: canSeeDetails ? other.favorite_word : "",
      allow_dm: isSelf || other.privacy.allow_dm_from === "everyone" || isFriend,
      stats: canSeeDetails
        ? { followers: followersCount, following: followingCount, friends: friendsCount }
        : { followers: 0, following: 0, friends: 0 },
      created_at: other.created_at,
    });
  });

  // --- Friends -------------------------------------------------------------

  router.get("/friends", auth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const links = ctx.db.friendships.filter((f) => f.requester_id === user.id || f.addressee_id === user.id);
    const friends: Array<Record<string, unknown>> = [];
    const incoming: Array<Record<string, unknown>> = [];
    const outgoing: Array<Record<string, unknown>> = [];

    for (const link of links) {
      const otherId = link.requester_id === user.id ? link.addressee_id : link.requester_id;
      const other = ctx.db.users.find((u) => u.id === otherId);
      if (!other) continue;
      const item = {
        request_id: link.id,
        ...publicUserOut(other, ctx.hub.isUserOnline(other.id)),
        since: link.responded_at ?? link.created_at,
      };
      if (link.status === "accepted") friends.push(item);
      else if (link.addressee_id === user.id) incoming.push(item);
      else outgoing.push(item);
    }
    const sortByName = (a: Record<string, unknown>, b: Record<string, unknown>) =>
      String(a.display_name).localeCompare(String(b.display_name));
    friends.sort(sortByName);
    incoming.sort(sortByName);
    outgoing.sort(sortByName);
    res.json({ friends, incoming, outgoing });
  });

  router.post("/friends/requests", auth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const other = findByBloomId(String(body.bloom_id ?? ""));
    if (!other) {
      res.status(404).json({ detail: "No one with that Bloom ID." });
      return;
    }
    if (other.id === user.id) {
      res.status(422).json({ detail: "That's your own Bloom ID." });
      return;
    }
    const link = friendshipBetween(user.id, other.id);
    if (link) {
      if (link.status === "accepted") {
        res.status(409).json({ detail: "You're already friends." });
        return;
      }
      if (link.requester_id === other.id) {
        link.status = "accepted";
        link.responded_at = ctx.db.now();
        ctx.db.persist();
        createNotification(ctx, {
          userId: other.id,
          type: "friend_accepted",
          actorId: user.id,
          title: "Friend request accepted",
          body: `${user.display_name} accepted your friend request.`,
          link: "/friends",
        });
        res.status(201).json({ status: "accepted", ...publicUserOut(other) });
        return;
      }
      res.status(409).json({ detail: "Your request is already waiting for them." });
      return;
    }
    ctx.db.friendships.push({
      id: ctx.db.nextId("friendship"),
      requester_id: user.id,
      addressee_id: other.id,
      status: "pending",
      created_at: ctx.db.now(),
      responded_at: null,
    });
    ctx.db.persist();
    createNotification(ctx, {
      userId: other.id,
      type: "friend_request",
      actorId: user.id,
      title: "New friend request",
      body: `${user.display_name} (${user.bloom_id}) wants to be friends.`,
      link: "/friends",
    });
    res.status(201).json({ status: "pending", ...publicUserOut(other) });
  });

  router.post("/friends/requests/:id/accept", auth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const reqId = Number(req.params.id);
    const link = ctx.db.friendships.find((f) => f.id === reqId && f.addressee_id === user.id && f.status === "pending");
    if (!link) {
      res.status(404).json({ detail: "That friend request was not found." });
      return;
    }
    link.status = "accepted";
    link.responded_at = ctx.db.now();
    ctx.db.persist();
    const requester = ctx.db.users.find((u) => u.id === link.requester_id)!;
    createNotification(ctx, {
      userId: requester.id,
      type: "friend_accepted",
      actorId: user.id,
      title: "Friend request accepted",
      body: `${user.display_name} accepted your friend request.`,
      link: "/friends",
    });
    res.json({ status: "accepted", ...publicUserOut(requester) });
  });

  router.post("/friends/requests/:id/decline", auth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const reqId = Number(req.params.id);
    const idx = ctx.db.friendships.findIndex((f) => f.id === reqId && f.addressee_id === user.id && f.status === "pending");
    if (idx < 0) {
      res.status(404).json({ detail: "That friend request was not found." });
      return;
    }
    ctx.db.friendships.splice(idx, 1);
    ctx.db.persist();
    res.status(204).end();
  });

  router.delete("/friends/requests/:id", auth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const reqId = Number(req.params.id);
    const idx = ctx.db.friendships.findIndex((f) => f.id === reqId && f.requester_id === user.id && f.status === "pending");
    if (idx < 0) {
      res.status(404).json({ detail: "That friend request was not found." });
      return;
    }
    ctx.db.friendships.splice(idx, 1);
    ctx.db.persist();
    res.status(204).end();
  });

  router.delete("/friends/:bloomId", auth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const other = findByBloomId(String(req.params.bloomId));
    if (!other) {
      res.status(404).json({ detail: "That friend was not found." });
      return;
    }
    const idx = ctx.db.friendships.findIndex(
      (f) =>
        f.status === "accepted" &&
        ((f.requester_id === user.id && f.addressee_id === other.id) ||
          (f.requester_id === other.id && f.addressee_id === user.id)),
    );
    if (idx < 0) {
      res.status(404).json({ detail: "That friend was not found." });
      return;
    }
    ctx.db.friendships.splice(idx, 1);
    ctx.db.persist();
    res.status(204).end();
  });

  // --- Follow Graph (Phase 3) ----------------------------------------------

  router.get("/social/graph", auth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const followers = ctx.db.follows
      .filter((f) => f.followee_id === user.id)
      .map((f) => ctx.db.users.find((u) => u.id === f.follower_id))
      .filter((u): u is UserRecord => Boolean(u))
      .map((u) => publicUserOut(u, ctx.hub.isUserOnline(u.id)));
    const following = ctx.db.follows
      .filter((f) => f.follower_id === user.id)
      .map((f) => ctx.db.users.find((u) => u.id === f.followee_id))
      .filter((u): u is UserRecord => Boolean(u))
      .map((u) => publicUserOut(u, ctx.hub.isUserOnline(u.id)));
    res.json({ followers, following });
  });

  router.post("/social/follow/:bloomId", auth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const other = findByBloomId(String(req.params.bloomId));
    if (!other) {
      res.status(404).json({ detail: "User not found." });
      return;
    }
    if (other.id === user.id) {
      res.status(422).json({ detail: "You cannot follow yourself." });
      return;
    }
    const existing = ctx.db.follows.find((f) => f.follower_id === user.id && f.followee_id === other.id);
    if (!existing) {
      ctx.db.follows.push({
        id: ctx.db.nextId("follow"),
        follower_id: user.id,
        followee_id: other.id,
        created_at: ctx.db.now(),
      });
      ctx.db.persist();
      createNotification(ctx, {
        userId: other.id,
        type: "follow",
        actorId: user.id,
        title: "New follower",
        body: `${user.display_name} started following your blooms.`,
        link: "/friends",
      });
    }
    res.status(201).json({ following: true, bloom_id: other.bloom_id });
  });

  router.delete("/social/follow/:bloomId", auth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const other = findByBloomId(String(req.params.bloomId));
    if (!other) {
      res.status(404).json({ detail: "User not found." });
      return;
    }
    const idx = ctx.db.follows.findIndex((f) => f.follower_id === user.id && f.followee_id === other.id);
    if (idx >= 0) {
      ctx.db.follows.splice(idx, 1);
      ctx.db.persist();
    }
    res.json({ following: false, bloom_id: other.bloom_id });
  });

  // --- Reactions (Phase 3) -------------------------------------------------

  router.get("/reactions", auth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const targetType = String(req.query.target_type ?? "");
    const targetId = String(req.query.target_id ?? "");
    const list = ctx.db.reactions.filter((r) => r.target_type === targetType && r.target_id === targetId);
    const grouped: Record<string, { emoji: string; count: number; reacted: boolean }> = {};
    for (const r of list) {
      if (!grouped[r.emoji]) grouped[r.emoji] = { emoji: r.emoji, count: 0, reacted: false };
      grouped[r.emoji].count += 1;
      if (r.user_id === user.id) grouped[r.emoji].reacted = true;
    }
    res.json(Object.values(grouped));
  });

  router.post("/reactions", auth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const targetType = body.target_type;
    const targetId = String(body.target_id ?? "");
    const emoji = String(body.emoji ?? "");
    if (
      targetType !== "entry" &&
      targetType !== "project" &&
      targetType !== "message" &&
      targetType !== "design"
    ) {
      res.status(422).json({ detail: "Invalid reaction target." });
      return;
    }
    if (!targetId || !VALID_REACTION_EMOJIS.has(emoji)) {
      res.status(422).json({ detail: "Unsupported reaction emoji." });
      return;
    }
    const existingIdx = ctx.db.reactions.findIndex(
      (r) => r.target_type === targetType && r.target_id === targetId && r.user_id === user.id && r.emoji === emoji,
    );
    let added = false;
    if (existingIdx >= 0) {
      ctx.db.reactions.splice(existingIdx, 1);
    } else {
      ctx.db.reactions.push({
        id: ctx.db.nextId("reaction"),
        target_type: targetType,
        target_id: targetId,
        user_id: user.id,
        emoji,
        created_at: ctx.db.now(),
      });
      added = true;
    }
    ctx.db.persist();

    // Notify target owner if reaction was added on message or project
    if (added && targetType === "message") {
      const msg = ctx.db.chatMessages.find((m) => String(m.id) === targetId);
      if (msg) {
        const list = ctx.db.reactions.filter((r) => r.target_type === "message" && r.target_id === targetId);
        const summary: Record<string, { emoji: string; count: number }> = {};
        for (const r of list) {
          if (!summary[r.emoji]) summary[r.emoji] = { emoji: r.emoji, count: 0 };
          summary[r.emoji].count += 1;
        }
        ctx.hub.broadcastChannel(`chat:${msg.chat_id}`, {
          type: "chat:reaction",
          chatId: msg.chat_id,
          messageId: msg.id,
          reactions: Object.values(summary),
        });
        if (msg.sender_id !== user.id) {
          createNotification(ctx, {
            userId: msg.sender_id,
            type: "reaction",
            actorId: user.id,
            title: `Reacted ${emoji}`,
            body: `${user.display_name} reacted ${emoji} to your message.`,
            link: `/chat/${msg.chat_id}`,
          });
        }
      }
    }

    const list = ctx.db.reactions.filter((r) => r.target_type === targetType && r.target_id === targetId);
    const grouped: Record<string, { emoji: string; count: number; reacted: boolean }> = {};
    for (const r of list) {
      if (!grouped[r.emoji]) grouped[r.emoji] = { emoji: r.emoji, count: 0, reacted: false };
      grouped[r.emoji].count += 1;
      if (r.user_id === user.id) grouped[r.emoji].reacted = true;
    }
    res.json({ added, reactions: Object.values(grouped) });
  });

  // --- Persistent Notifications (Phase 3) ----------------------------------

  router.get("/notifications", auth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const items = ctx.db.notifications
      .filter((n) => n.user_id === user.id)
      .sort((a, b) => b.id - a.id)
      .slice(0, 50)
      .map((n) => {
        const actor = n.actor_id ? ctx.db.users.find((u) => u.id === n.actor_id) : null;
        return {
          ...n,
          actor: actor ? { bloom_id: actor.bloom_id, display_name: actor.display_name } : null,
        };
      });
    const unread = ctx.db.notifications.filter((n) => n.user_id === user.id && !n.read_at).length;
    res.json({ items, unread });
  });

  router.post("/notifications/:id/read", auth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const n = ctx.db.notifications.find((item) => item.id === Number(req.params.id) && item.user_id === user.id);
    if (!n) {
      res.status(404).json({ detail: "Notification not found." });
      return;
    }
    if (!n.read_at) {
      n.read_at = ctx.db.now();
      ctx.db.persist();
    }
    res.json({ ok: true });
  });

  router.post("/notifications/read-all", auth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const now = ctx.db.now();
    for (const n of ctx.db.notifications) {
      if (n.user_id === user.id && !n.read_at) n.read_at = now;
    }
    ctx.db.persist();
    res.json({ ok: true });
  });

  // --- Inbox summary -------------------------------------------------------

  router.get("/inbox", auth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const friendRequests = ctx.db.friendships
      .filter((f) => f.addressee_id === user.id && f.status === "pending")
      .map((f) => {
        const requester = ctx.db.users.find((u) => u.id === f.requester_id);
        return requester
          ? { request_id: f.id, bloom_id: requester.bloom_id, display_name: requester.display_name }
          : null;
      })
      .filter(Boolean);

    const projectInvites = ctx.db.projects
      .filter((p) => p.members.some((m) => m.user_id === user.id && m.status === "invited"))
      .map((p) => {
        const owner = ctx.db.users.find((u) => u.id === p.owner_id);
        return {
          id: p.id,
          title: p.title,
          mode: p.mode,
          owner: owner?.display_name ?? "A friend",
        };
      });

    const liveInvites = ctx.db.liveRooms
      .filter((r) => r.guest_id === user.id && r.status === "open")
      .filter((r) => {
        const host = ctx.db.users.find((u) => u.id === r.host_id);
        return host && ctx.hub.onlineLiveBloomIds(r.id).includes(host.bloom_id);
      })
      .map((r) => {
        const host = ctx.db.users.find((u) => u.id === r.host_id)!;
        return { id: r.id, friend: { bloom_id: host.bloom_id, display_name: host.display_name } };
      });

    const unreadNotifications = ctx.db.notifications.filter((n) => n.user_id === user.id && !n.read_at).length;

    let unreadMessages = 0;
    for (const chat of ctx.db.chats) {
      if (chat.type !== "studio" && !chat.member_ids.includes(user.id)) continue;
      const lastRead = chat.last_read_by[user.id] ?? 0;
      unreadMessages += ctx.db.chatMessages.filter(
        (m) => m.chat_id === chat.id && m.id > lastRead && m.sender_id !== user.id,
      ).length;
    }

    res.json({
      friend_requests: friendRequests,
      project_invites: projectInvites,
      live_invites: liveInvites,
      unread_notifications: unreadNotifications,
      unread_messages: unreadMessages,
      count: friendRequests.length + projectInvites.length + liveInvites.length + unreadNotifications,
    });
  });

  return router;
}
