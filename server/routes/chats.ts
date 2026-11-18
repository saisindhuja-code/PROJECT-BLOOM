/**
 * Phase 4 & 8: Unified Bloom Chat (Personal DMs, Group Chats, Studio Chat, Project Session Chat).
 */
import { Router } from "express";
import type { ChatMessageRecord, ChatThreadRecord, UserRecord } from "../db";
import { areFriends, isActiveProjectMember, normalizeBloomId } from "../security";
import { cleanText, publicUserOut, validateRecipe } from "../validation";
import { createNotification, requireAuth, type AuthedRequest, type RouteContext } from "./helpers";

export function chatsRouter(ctx: RouteContext): Router {
  const router = Router();
  const auth = requireAuth(ctx);

  const canAccessThread = (thread: ChatThreadRecord, user: UserRecord): boolean => {
    if (thread.type === "studio") return true;
    if (thread.type === "project" && thread.project_id) {
      const project = ctx.db.projects.find((p) => p.id === thread.project_id);
      return Boolean(project && isActiveProjectMember(project, user.id));
    }
    return thread.member_ids.includes(user.id);
  };

  const messageOut = (m: ChatMessageRecord, viewerId: number) => {
    const sender = ctx.db.users.find((u) => u.id === m.sender_id);
    const reactionsList = ctx.db.reactions.filter((r) => r.target_type === "message" && r.target_id === String(m.id));
    const grouped: Record<string, { emoji: string; count: number; reacted: boolean }> = {};
    for (const r of reactionsList) {
      if (!grouped[r.emoji]) grouped[r.emoji] = { emoji: r.emoji, count: 0, reacted: false };
      grouped[r.emoji].count += 1;
      if (r.user_id === viewerId) grouped[r.emoji].reacted = true;
    }
    const replyTo = m.reply_to_id ? ctx.db.chatMessages.find((mm) => mm.id === m.reply_to_id) : null;
    const replySender = replyTo ? ctx.db.users.find((u) => u.id === replyTo.sender_id) : null;
    return {
      id: m.id,
      chat_id: m.chat_id,
      sender: sender ? publicUserOut(sender, ctx.hub.isUserOnline(sender.id)) : { bloom_id: "", display_name: "Unknown" },
      is_you: m.sender_id === viewerId,
      text: m.text,
      flower_recipe: m.flower_recipe,
      media_id: m.media_id,
      media_url: m.media_id ? `/api/media/${m.media_id}` : null,
      journal_entry_id: m.journal_entry_id,
      reply_to: replyTo
        ? {
            id: replyTo.id,
            text: replyTo.text,
            sender_name: replySender?.display_name ?? "Someone",
          }
        : null,
      reactions: Object.values(grouped),
      created_at: m.created_at,
    };
  };

  const threadOut = (t: ChatThreadRecord, viewer: UserRecord) => {
    const messages = ctx.db.chatMessages.filter((m) => m.chat_id === t.id);
    const lastMsg = messages.length ? messages[messages.length - 1] : null;
    const lastReadId = t.last_read_by[viewer.id] ?? 0;
    const unread = messages.filter((m) => m.id > lastReadId && m.sender_id !== viewer.id).length;

    const members = t.member_ids
      .map((uid) => ctx.db.users.find((u) => u.id === uid))
      .filter((u): u is UserRecord => Boolean(u))
      .map((u) => ({
        ...publicUserOut(u, ctx.hub.isUserOnline(u.id)),
        is_you: u.id === viewer.id,
      }));

    let displayTitle = t.title;
    if (t.type === "dm") {
      const other = members.find((m) => !m.is_you);
      if (other) displayTitle = other.display_name;
    }

    return {
      id: t.id,
      type: t.type,
      title: displayTitle,
      project_id: t.project_id,
      members,
      unread,
      last_message: lastMsg ? messageOut(lastMsg, viewer.id) : null,
      created_at: t.created_at,
      updated_at: t.updated_at,
    };
  };

  router.get("/", auth, (req: AuthedRequest, res) => {
    const viewer = req.user!;
    const visible = ctx.db.chats
      .filter((t) => canAccessThread(t, viewer))
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    res.json(visible.map((t) => threadOut(t, viewer)));
  });

  router.get("/studio", auth, (req: AuthedRequest, res) => {
    const viewer = req.user!;
    const studio = ctx.db.chats.find((t) => t.type === "studio");
    if (!studio) {
      res.status(404).json({ detail: "Studio chat unavailable." });
      return;
    }
    res.json(threadOut(studio, viewer));
  });

  router.post("/dm", auth, (req: AuthedRequest, res) => {
    const viewer = req.user!;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const norm = normalizeBloomId(String(body.bloom_id ?? ""));
    const other = norm ? ctx.db.users.find((u) => u.bloom_id === norm) : undefined;
    if (!other) {
      res.status(404).json({ detail: "No one with that Bloom ID." });
      return;
    }
    if (other.id === viewer.id) {
      res.status(422).json({ detail: "You can't start a DM with yourself." });
      return;
    }
    if (other.privacy.allow_dm_from === "friends" && !areFriends(ctx.db, viewer.id, other.id)) {
      res.status(403).json({ detail: `${other.display_name} only accepts messages from friends.` });
      return;
    }
    let existing = ctx.db.chats.find(
      (t) =>
        t.type === "dm" &&
        t.member_ids.length === 2 &&
        t.member_ids.includes(viewer.id) &&
        t.member_ids.includes(other.id),
    );
    if (!existing) {
      const now = ctx.db.now();
      existing = {
        id: ctx.db.nextId("chat"),
        type: "dm",
        title: other.display_name,
        project_id: null,
        created_by: viewer.id,
        member_ids: [viewer.id, other.id],
        last_read_by: {},
        created_at: now,
        updated_at: now,
      };
      ctx.db.chats.push(existing);
      ctx.db.persist();
    }
    res.status(201).json(threadOut(existing, viewer));
  });

  router.post("/group", auth, (req: AuthedRequest, res) => {
    const viewer = req.user!;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const title = cleanText(body.title, 60);
    if (!title) {
      res.status(422).json({ detail: "Please name the group chat." });
      return;
    }
    const rawIds = Array.isArray(body.member_bloom_ids) ? body.member_bloom_ids : [];
    const memberIds = new Set<number>([viewer.id]);
    for (const raw of rawIds.slice(0, 12)) {
      const norm = normalizeBloomId(String(raw ?? ""));
      const u = norm ? ctx.db.users.find((uu) => uu.bloom_id === norm) : undefined;
      if (u && u.id !== viewer.id) {
        if (!areFriends(ctx.db, viewer.id, u.id)) {
          res.status(403).json({ detail: `You can only add friends to group chats (${u.display_name} is not a friend yet).` });
          return;
        }
        memberIds.add(u.id);
      }
    }
    const now = ctx.db.now();
    const group: ChatThreadRecord = {
      id: ctx.db.nextId("chat"),
      type: "group",
      title,
      project_id: null,
      created_by: viewer.id,
      member_ids: Array.from(memberIds),
      last_read_by: {},
      created_at: now,
      updated_at: now,
    };
    ctx.db.chats.push(group);
    ctx.db.persist();
    for (const uid of group.member_ids) {
      if (uid !== viewer.id) {
        createNotification(ctx, {
          userId: uid,
          type: "chat_message",
          actorId: viewer.id,
          title: `Added to ${title}`,
          body: `${viewer.display_name} started a group chat "${title}".`,
          link: `/chat/${group.id}`,
        });
      }
    }
    res.status(201).json(threadOut(group, viewer));
  });

  router.get("/project/:projectId", auth, (req: AuthedRequest, res) => {
    const viewer = req.user!;
    const projectId = Number(req.params.projectId);
    const project = ctx.db.projects.find((p) => p.id === projectId);
    if (!project || !isActiveProjectMember(project, viewer.id)) {
      res.status(404).json({ detail: "Project not found." });
      return;
    }
    let chat = ctx.db.chats.find((t) => t.type === "project" && t.project_id === projectId);
    const activeIds = project.members.filter((m) => m.status === "active").map((m) => m.user_id);
    if (!chat) {
      const now = ctx.db.now();
      chat = {
        id: ctx.db.nextId("chat"),
        type: "project",
        title: `${project.title} · Chat`,
        project_id: project.id,
        created_by: project.owner_id,
        member_ids: activeIds,
        last_read_by: {},
        created_at: now,
        updated_at: now,
      };
      ctx.db.chats.push(chat);
      ctx.db.persist();
    } else {
      chat.member_ids = activeIds;
      chat.title = `${project.title} · Chat`;
    }
    res.json(threadOut(chat, viewer));
  });

  router.get("/:chatId/messages", auth, (req: AuthedRequest, res) => {
    const viewer = req.user!;
    const chatId = Number(req.params.chatId);
    const thread = ctx.db.chats.find((t) => t.id === chatId);
    if (!thread || !canAccessThread(thread, viewer)) {
      res.status(404).json({ detail: "Chat not found." });
      return;
    }
    const msgs = ctx.db.chatMessages
      .filter((m) => m.chat_id === chatId)
      .slice(-150)
      .map((m) => messageOut(m, viewer.id));
    res.json(msgs);
  });

  router.post("/:chatId/messages", auth, (req: AuthedRequest, res) => {
    const viewer = req.user!;
    const chatId = Number(req.params.chatId);
    const thread = ctx.db.chats.find((t) => t.id === chatId);
    if (!thread || !canAccessThread(thread, viewer)) {
      res.status(404).json({ detail: "Chat not found." });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const text = typeof body.text === "string" ? body.text.trim().slice(0, 2000) : "";

    let flowerRecipe: Record<string, unknown> | null = null;
    if (body.flower_recipe) {
      try {
        flowerRecipe = validateRecipe(body.flower_recipe);
      } catch (err) {
        res.status(422).json({ detail: (err as Error).message });
        return;
      }
    }

    let mediaId: number | null = null;
    if (body.media_id !== undefined && body.media_id !== null) {
      const m = ctx.db.media.find((mm) => mm.id === Number(body.media_id) && mm.owner_id === viewer.id);
      if (!m) {
        res.status(404).json({ detail: "Media not found." });
        return;
      }
      mediaId = m.id;
    }

    const journalEntryId =
      body.journal_entry_id !== undefined && body.journal_entry_id !== null
        ? Number(body.journal_entry_id)
        : null;

    if (!text && !flowerRecipe && !mediaId) {
      res.status(422).json({ detail: "Message cannot be empty." });
      return;
    }

    const replyToId =
      body.reply_to_id !== undefined && body.reply_to_id !== null &&
      ctx.db.chatMessages.some((m) => m.id === Number(body.reply_to_id) && m.chat_id === chatId)
        ? Number(body.reply_to_id)
        : null;

    const now = ctx.db.now();
    const msg: ChatMessageRecord = {
      id: ctx.db.nextId("message"),
      chat_id: chatId,
      sender_id: viewer.id,
      text,
      flower_recipe: flowerRecipe,
      media_id: mediaId,
      journal_entry_id: journalEntryId,
      reply_to_id: replyToId,
      created_at: now,
    };
    ctx.db.chatMessages.push(msg);
    thread.updated_at = now;
    thread.last_read_by[viewer.id] = msg.id;
    ctx.db.persist();

    // Broadcast to chat channel subscribers
    const baseOut = messageOut(msg, viewer.id);
    ctx.hub.broadcastChannel(`chat:${chatId}`, {
      type: "chat:message",
      chatId,
      message: { ...baseOut, is_you: false },
    }, viewer.id);

    // Also push personal notification / inbox refresh to members not currently subscribed or offline
    if (thread.type !== "studio") {
      for (const uid of thread.member_ids) {
        if (uid === viewer.id) continue;
        ctx.hub.sendToUser(uid, {
          type: "chat:notify",
          chatId,
          message: { ...baseOut, is_you: false },
        });
        if (thread.type === "dm" || thread.type === "group") {
          createNotification(ctx, {
            userId: uid,
            type: "chat_message",
            actorId: viewer.id,
            title: thread.type === "group" ? `${viewer.display_name} in ${thread.title}` : `Message from ${viewer.display_name}`,
            body: text ? text.slice(0, 90) : "Shared a bloom with you 🌸",
            link: `/chat/${thread.id}`,
          });
        }
      }
    }

    res.status(201).json(baseOut);
  });

  router.post("/:chatId/read", auth, (req: AuthedRequest, res) => {
    const viewer = req.user!;
    const chatId = Number(req.params.chatId);
    const thread = ctx.db.chats.find((t) => t.id === chatId);
    if (!thread || !canAccessThread(thread, viewer)) {
      res.status(404).json({ detail: "Chat not found." });
      return;
    }
    const msgs = ctx.db.chatMessages.filter((m) => m.chat_id === chatId);
    const lastId = msgs.length ? msgs[msgs.length - 1].id : 0;
    thread.last_read_by[viewer.id] = lastId;
    ctx.db.persist();
    ctx.hub.broadcastChannel(
      `chat:${chatId}`,
      { type: "chat:read", chatId, bloom_id: viewer.bloom_id, last_read_id: lastId },
      viewer.id,
    );
    res.json({ ok: true, last_read_id: lastId });
  });

  router.post("/:chatId/members", auth, (req: AuthedRequest, res) => {
    const viewer = req.user!;
    const chatId = Number(req.params.chatId);
    const thread = ctx.db.chats.find((t) => t.id === chatId && t.type === "group");
    if (!thread || !thread.member_ids.includes(viewer.id)) {
      res.status(404).json({ detail: "Group chat not found." });
      return;
    }
    const norm = normalizeBloomId(String((req.body ?? {}).bloom_id ?? ""));
    const other = norm ? ctx.db.users.find((u) => u.bloom_id === norm) : undefined;
    if (!other || !areFriends(ctx.db, viewer.id, other.id)) {
      res.status(422).json({ detail: "You can only add friends to this group." });
      return;
    }
    if (!thread.member_ids.includes(other.id)) {
      thread.member_ids.push(other.id);
      ctx.db.persist();
    }
    res.json(threadOut(thread, viewer));
  });

  router.delete("/:chatId/members/:bloomId", auth, (req: AuthedRequest, res) => {
    const viewer = req.user!;
    const chatId = Number(req.params.chatId);
    const thread = ctx.db.chats.find((t) => t.id === chatId && t.type === "group");
    if (!thread || !thread.member_ids.includes(viewer.id)) {
      res.status(404).json({ detail: "Group chat not found." });
      return;
    }
    const norm = normalizeBloomId(String(req.params.bloomId));
    const target = norm ? ctx.db.users.find((u) => u.bloom_id === norm) : undefined;
    if (!target) {
      res.status(404).json({ detail: "Member not found." });
      return;
    }
    if (target.id !== viewer.id && thread.created_by !== viewer.id) {
      res.status(403).json({ detail: "Only the group creator can remove others." });
      return;
    }
    thread.member_ids = thread.member_ids.filter((id) => id !== target.id);
    ctx.db.persist();
    res.status(204).end();
  });

  return router;
}
