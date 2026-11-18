/**
 * Phase 8: Bloom Together 2.0 (Real-time WS sync for Twin/Two/Moment + invites + contributions).
 */
import { Router } from "express";
import type { ContributionItemRecord, ProjectRecord, UserRecord } from "../db";
import { areFriends, isActiveProjectMember, normalizeBloomId } from "../security";
import { VALID_LAYOUTS, VALID_PROJECT_MODES, cleanText, validateRecipe } from "../validation";
import { createNotification, requireAuth, type AuthedRequest, type RouteContext } from "./helpers";

const MAX_MEMBERS = 2;
const MAX_ITEMS: Record<string, number> = { twin: 1, two: 1, moment: 4 };

export function projectsRouter(ctx: RouteContext): Router {
  const router = Router();
  const auth = requireAuth(ctx);

  const projectOut = (project: ProjectRecord, viewer: UserRecord) => {
    const mine = project.members.find((m) => m.user_id === viewer.id);
    const owner = ctx.db.users.find((u) => u.id === project.owner_id);
    const base = {
      id: project.id,
      title: project.title,
      mode: project.mode,
      owner: {
        bloom_id: owner?.bloom_id ?? "",
        display_name: owner?.display_name ?? "Owner",
      },
      is_owner: project.owner_id === viewer.id,
      my_status: mine?.status ?? null,
      created_at: project.created_at,
      updated_at: project.updated_at,
    };
    if (!mine || mine.status !== "active") {
      return base;
    }

    const sortedMembers = [...project.members].sort((a, b) => (a.role === "owner" ? -1 : b.role === "owner" ? 1 : 0));
    return {
      ...base,
      layout: project.layout,
      theme_state: project.theme_state,
      shared_recipe: project.shared_recipe,
      members: sortedMembers.map((m) => {
        const u = ctx.db.users.find((uu) => uu.id === m.user_id);
        return {
          bloom_id: u?.bloom_id ?? "",
          display_name: u?.display_name ?? "",
          role: m.role,
          status: m.status,
          is_you: m.user_id === viewer.id,
        };
      }),
      contributions: project.contributions
        .filter((c) => isActiveProjectMember(project, c.user_id))
        .map((c) => {
          const u = ctx.db.users.find((uu) => uu.id === c.user_id);
          return {
            bloom_id: u?.bloom_id ?? "",
            display_name: u?.display_name ?? "",
            is_you: c.user_id === viewer.id,
            items: c.items.map((item) => ({
              ...item,
              media_url: item.media_id ? `/api/media/${item.media_id}` : null,
            })),
            updated_at: c.updated_at,
          };
        }),
    };
  };

  const broadcastProjectUpdate = (project: ProjectRecord, actor: UserRecord, kind: string) => {
    for (const m of project.members) {
      if (m.status !== "active") continue;
      const memberUser = ctx.db.users.find((u) => u.id === m.user_id);
      if (!memberUser) continue;
      ctx.hub.sendToUser(memberUser.id, {
        type: "project:updated",
        projectId: project.id,
        by: { bloom_id: actor.bloom_id, display_name: actor.display_name },
        kind,
        project: projectOut(project, memberUser),
      });
    }
  };

  const inviteMember = (project: ProjectRecord, inviter: UserRecord, rawBloomId: string): string | null => {
    const norm = normalizeBloomId(rawBloomId);
    const friend = norm ? ctx.db.users.find((u) => u.bloom_id === norm) : undefined;
    if (!friend || !areFriends(ctx.db, inviter.id, friend.id)) {
      return "You can only invite friends. Add them by Bloom ID first.";
    }
    if (project.members.some((m) => m.user_id === friend.id)) {
      return "They're already part of this project.";
    }
    if (project.members.length >= MAX_MEMBERS) {
      return "A Bloom Together project is for two people.";
    }
    project.members.push({
      user_id: friend.id,
      role: "member",
      status: "invited",
      created_at: ctx.db.now(),
    });
    createNotification(ctx, {
      userId: friend.id,
      type: "project_invite",
      actorId: inviter.id,
      title: `Invited to "${project.title}"`,
      body: `${inviter.display_name} invited you to a Bloom Together project.`,
      link: `/together/${project.id}`,
    });
    return null;
  };

  router.get("/", auth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const list = ctx.db.projects
      .filter((p) => p.members.some((m) => m.user_id === user.id))
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    res.json(list.map((p) => projectOut(p, user)));
  });

  router.post("/", auth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const title = cleanText(body.title, 80);
    const mode = String(body.mode ?? "");
    if (!title) {
      res.status(422).json({ detail: "Please add a title." });
      return;
    }
    if (!VALID_PROJECT_MODES.has(mode)) {
      res.status(422).json({ detail: "Invalid project mode." });
      return;
    }
    let sharedRecipe: Record<string, unknown> | null = null;
    if (body.shared_recipe) {
      try {
        sharedRecipe = validateRecipe(body.shared_recipe);
      } catch (err) {
        res.status(422).json({ detail: (err as Error).message });
        return;
      }
    }
    const now = ctx.db.now();
    const project: ProjectRecord = {
      id: ctx.db.nextId("project"),
      owner_id: user.id,
      title,
      mode: mode as ProjectRecord["mode"],
      shared_recipe: sharedRecipe,
      layout: "side-by-side",
      theme_state: null,
      members: [{ user_id: user.id, role: "owner", status: "active", created_at: now }],
      contributions: [],
      created_at: now,
      updated_at: now,
    };
    if (body.invite_bloom_id) {
      const err = inviteMember(project, user, String(body.invite_bloom_id));
      if (err) {
        res.status(err.includes("already") || err.includes("two") ? 409 : 422).json({ detail: err });
        return;
      }
    }
    ctx.db.projects.push(project);
    ctx.db.persist();
    res.status(201).json(projectOut(project, user));
  });

  router.get("/:id", auth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const project = ctx.db.projects.find((p) => p.id === Number(req.params.id));
    if (!project || !project.members.some((m) => m.user_id === user.id)) {
      res.status(404).json({ detail: "That project was not found." });
      return;
    }
    res.json(projectOut(project, user));
  });

  router.patch("/:id", auth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const project = ctx.db.projects.find((p) => p.id === Number(req.params.id));
    if (!project || !isActiveProjectMember(project, user.id)) {
      res.status(404).json({ detail: "That project was not found." });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (body.title !== undefined) {
      if (project.owner_id !== user.id) {
        res.status(403).json({ detail: "Only the person who started the project can rename it." });
        return;
      }
      const clean = cleanText(body.title, 80);
      if (!clean) {
        res.status(422).json({ detail: "Title cannot be empty." });
        return;
      }
      project.title = clean;
    }
    if (body.layout !== undefined) {
      if (typeof body.layout !== "string" || !VALID_LAYOUTS.has(body.layout)) {
        res.status(422).json({ detail: "Invalid layout." });
        return;
      }
      project.layout = body.layout;
    }
    if (body.theme_state !== undefined) {
      project.theme_state = body.theme_state as Record<string, unknown> | null;
    }
    if (body.shared_recipe !== undefined && body.shared_recipe !== null) {
      try {
        project.shared_recipe = validateRecipe(body.shared_recipe);
      } catch (err) {
        res.status(422).json({ detail: (err as Error).message });
        return;
      }
    }
    project.updated_at = ctx.db.now();
    ctx.db.persist();
    broadcastProjectUpdate(project, user, "settings");
    res.json(projectOut(project, user));
  });

  router.post("/:id/invite", auth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const project = ctx.db.projects.find((p) => p.id === Number(req.params.id) && p.owner_id === user.id);
    if (!project) {
      res.status(404).json({ detail: "That project was not found." });
      return;
    }
    const err = inviteMember(project, user, String((req.body ?? {}).bloom_id ?? ""));
    if (err) {
      res.status(err.includes("already") || err.includes("two") ? 409 : 422).json({ detail: err });
      return;
    }
    project.updated_at = ctx.db.now();
    ctx.db.persist();
    res.json(projectOut(project, user));
  });

  router.post("/:id/accept", auth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const project = ctx.db.projects.find((p) => p.id === Number(req.params.id));
    const member = project?.members.find((m) => m.user_id === user.id && m.status === "invited");
    if (!project || !member) {
      res.status(404).json({ detail: "That invitation was not found." });
      return;
    }
    member.status = "active";
    project.updated_at = ctx.db.now();
    ctx.db.persist();
    createNotification(ctx, {
      userId: project.owner_id,
      type: "project_update",
      actorId: user.id,
      title: `Joined "${project.title}"`,
      body: `${user.display_name} joined your Bloom Together project.`,
      link: `/together/${project.id}`,
    });
    broadcastProjectUpdate(project, user, "member-joined");
    res.json(projectOut(project, user));
  });

  router.post("/:id/decline", auth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const project = ctx.db.projects.find((p) => p.id === Number(req.params.id));
    const idx = project?.members.findIndex((m) => m.user_id === user.id && m.status === "invited") ?? -1;
    if (!project || idx < 0) {
      res.status(404).json({ detail: "That invitation was not found." });
      return;
    }
    project.members.splice(idx, 1);
    ctx.db.persist();
    res.status(204).end();
  });

  router.post("/:id/leave", auth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const project = ctx.db.projects.find((p) => p.id === Number(req.params.id));
    const idx = project?.members.findIndex((m) => m.user_id === user.id) ?? -1;
    if (!project || idx < 0) {
      res.status(404).json({ detail: "That project was not found." });
      return;
    }
    if (project.members[idx].role === "owner") {
      res.status(409).json({ detail: "You started this project. Close it instead of leaving." });
      return;
    }
    project.members.splice(idx, 1);
    project.contributions = project.contributions.filter((c) => c.user_id !== user.id);
    project.updated_at = ctx.db.now();
    ctx.db.persist();
    broadcastProjectUpdate(project, user, "member-left");
    res.status(204).end();
  });

  router.delete("/:id/members/:bloomId", auth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const project = ctx.db.projects.find((p) => p.id === Number(req.params.id) && p.owner_id === user.id);
    if (!project) {
      res.status(404).json({ detail: "That project was not found." });
      return;
    }
    const norm = normalizeBloomId(String(req.params.bloomId));
    const target = norm ? ctx.db.users.find((u) => u.bloom_id === norm) : undefined;
    const idx = target ? project.members.findIndex((m) => m.user_id === target.id && m.role !== "owner") : -1;
    if (!target || idx < 0) {
      res.status(404).json({ detail: "That member was not found." });
      return;
    }
    project.members.splice(idx, 1);
    project.contributions = project.contributions.filter((c) => c.user_id !== target.id);
    project.updated_at = ctx.db.now();
    ctx.db.persist();
    res.status(204).end();
  });

  router.delete("/:id", auth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const idx = ctx.db.projects.findIndex((p) => p.id === Number(req.params.id) && p.owner_id === user.id);
    if (idx < 0) {
      res.status(404).json({ detail: "That project was not found." });
      return;
    }
    ctx.db.projects.splice(idx, 1);
    ctx.db.persist();
    res.status(204).end();
  });

  router.put("/:id/contribution", auth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const project = ctx.db.projects.find((p) => p.id === Number(req.params.id));
    if (!project || !isActiveProjectMember(project, user.id)) {
      res.status(404).json({ detail: "That project was not found." });
      return;
    }
    const rawItems = Array.isArray((req.body ?? {}).items) ? (req.body.items as unknown[]) : [];
    if (rawItems.length > (MAX_ITEMS[project.mode] ?? 1)) {
      res.status(422).json({ detail: "Too many pictures for this mode." });
      return;
    }
    const cleanNumDict = (raw: unknown): Record<string, number> => {
      if (!raw || typeof raw !== "object") return {};
      const out: Record<string, number> = {};
      for (const [k, v] of Object.entries(raw).slice(0, 16)) {
        const n = Number(v);
        if (Number.isFinite(n)) out[String(k).slice(0, 20)] = n;
      }
      return out;
    };

    const items: ContributionItemRecord[] = [];
    for (const raw of rawItems) {
      if (!raw || typeof raw !== "object") continue;
      const item = raw as Record<string, unknown>;
      const mediaId = typeof item.media_id === "number" ? item.media_id : null;
      if (mediaId !== null && !ctx.db.media.some((m) => m.id === mediaId && m.owner_id === user.id)) {
        res.status(404).json({ detail: "Media not found." });
        return;
      }
      let recipe: Record<string, unknown> | null = null;
      if (item.recipe && project.mode !== "twin") {
        try {
          recipe = validateRecipe(item.recipe);
        } catch (err) {
          res.status(422).json({ detail: (err as Error).message });
          return;
        }
      }
      if (mediaId === null && recipe === null) continue;
      items.push({
        media_id: mediaId,
        recipe,
        photo: cleanNumDict(item.photo),
        flower: cleanNumDict(item.flower),
      });
    }

    const now = ctx.db.now();
    const existing = project.contributions.find((c) => c.user_id === user.id);
    if (existing) {
      existing.items = items;
      existing.updated_at = now;
    } else {
      project.contributions.push({ user_id: user.id, items, updated_at: now });
    }
    project.updated_at = now;
    ctx.db.persist();

    for (const m of project.members) {
      if (m.user_id !== user.id && m.status === "active") {
        createNotification(ctx, {
          userId: m.user_id,
          type: "project_update",
          actorId: user.id,
          title: `Updated "${project.title}"`,
          body: `${user.display_name} updated their part.`,
          link: `/together/${project.id}`,
        });
      }
    }
    broadcastProjectUpdate(project, user, "contribution");
    res.json(projectOut(project, user));
  });

  return router;
}
