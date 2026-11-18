/**
 * Phase 5 & 7: Flower designs, private media uploads, Journal entries, Scrapbook state,
 * Albums, and Soft-Delete Trash / Restore.
 */
import crypto from "node:crypto";
import { Router } from "express";
import multer from "multer";
import type { JournalEntryRecord, MediaRecord } from "../db";
import { canViewMedia, inspectImage, isActiveProjectMember } from "../security";
import { cleanText, validateRecipe } from "../validation";
import { requireAuth, type AuthedRequest, type RouteContext } from "./helpers";

const MEDIA_KINDS = new Set(["original", "photo", "flower", "contribution", "capture"]);

export function journalRouter(ctx: RouteContext): Router {
  const router = Router();
  const auth = requireAuth(ctx);

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: ctx.security.maxUploadBytes },
  });

  const entryOut = (e: JournalEntryRecord) => ({
    id: e.id,
    entry_type: e.entry_type,
    title: e.title,
    caption: e.caption,
    notes: e.notes,
    taken_at: e.taken_at,
    recipe: e.recipe,
    photo_url: e.photo_media_id ? `/api/media/${e.photo_media_id}` : null,
    photo_media_id: e.photo_media_id,
    original_url: e.original_media_id ? `/api/media/${e.original_media_id}` : null,
    original_media_id: e.original_media_id,
    edit_state: e.edit_state,
    project_id: e.project_id,
    participants: e.participants ?? [],
    album_ids: [...e.album_ids].sort((a, b) => a - b),
    deleted_at: e.deleted_at,
    created_at: e.created_at,
    updated_at: e.updated_at,
  });

  const releaseMediaIfUnused = (mediaId: number | null) => {
    if (mediaId === null) return;
    const mIdx = ctx.db.media.findIndex((m) => m.id === mediaId);
    if (mIdx < 0) return;
    const media = ctx.db.media[mIdx];
    const usedInJournal = ctx.db.journalEntries.some(
      (e) => e.photo_media_id === mediaId || e.original_media_id === mediaId,
    );
    const usedInCapture = ctx.db.liveCaptures.some((c) => c.media_id === mediaId);
    const usedInProject = ctx.db.projects.some((p) =>
      p.contributions.some((c) => c.items.some((i) => i.media_id === mediaId)),
    );
    const usedInChat = ctx.db.chatMessages.some((m) => m.media_id === mediaId);
    if (usedInJournal || usedInCapture || usedInProject || usedInChat) return;
    ctx.db.deleteMediaBytes(media.storage_key);
    ctx.db.media.splice(mIdx, 1);
  };

  // --- Designs -------------------------------------------------------------

  router.get("/designs", auth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const rows = ctx.db.designs
      .filter((d) => d.owner_id === user.id)
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    res.json(rows);
  });

  router.post("/designs", auth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const body = (req.body ?? {}) as Record<string, unknown>;
    let recipe: Record<string, unknown>;
    try {
      recipe = validateRecipe(body.recipe);
    } catch (err) {
      res.status(422).json({ detail: (err as Error).message });
      return;
    }
    const now = ctx.db.now();
    const design = {
      id: ctx.db.nextId("design"),
      owner_id: user.id,
      title: cleanText(body.title, 80) || String(recipe.word),
      recipe,
      created_at: now,
      updated_at: now,
    };
    ctx.db.designs.push(design);
    ctx.db.persist();
    res.status(201).json(design);
  });

  router.get("/designs/:id", auth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const design = ctx.db.designs.find((d) => d.id === Number(req.params.id) && d.owner_id === user.id);
    if (!design) {
      res.status(404).json({ detail: "That design was not found." });
      return;
    }
    res.json(design);
  });

  router.put("/designs/:id", auth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const design = ctx.db.designs.find((d) => d.id === Number(req.params.id) && d.owner_id === user.id);
    if (!design) {
      res.status(404).json({ detail: "That design was not found." });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    let recipe: Record<string, unknown>;
    try {
      recipe = validateRecipe(body.recipe);
    } catch (err) {
      res.status(422).json({ detail: (err as Error).message });
      return;
    }
    design.title = cleanText(body.title, 80) || String(recipe.word);
    design.recipe = recipe;
    design.updated_at = ctx.db.now();
    ctx.db.persist();
    res.json(design);
  });

  router.delete("/designs/:id", auth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const idx = ctx.db.designs.findIndex((d) => d.id === Number(req.params.id) && d.owner_id === user.id);
    if (idx < 0) {
      res.status(404).json({ detail: "That design was not found." });
      return;
    }
    ctx.db.designs.splice(idx, 1);
    ctx.db.persist();
    res.status(204).end();
  });

  // --- Media ---------------------------------------------------------------

  router.post("/media", auth, upload.single("file"), (req: AuthedRequest, res) => {
    const user = req.user!;
    const ip = req.ip ?? "unknown";
    if (!ctx.security.checkRateLimit(`media:${ip}`, 60, 60_000)) {
      res.status(429).json({ detail: "Too many uploads. Wait a moment." });
      return;
    }
    const kind = String((req.body ?? {}).kind ?? "photo");
    if (!MEDIA_KINDS.has(kind)) {
      res.status(422).json({ detail: "Unknown image kind." });
      return;
    }
    if (!req.file?.buffer) {
      res.status(422).json({ detail: "No image uploaded." });
      return;
    }
    let meta: { contentType: string; width: number; height: number };
    try {
      meta = inspectImage(req.file.buffer);
    } catch (err) {
      res.status(422).json({ detail: (err as Error).message });
      return;
    }
    const ext = meta.contentType === "image/png" ? "png" : meta.contentType === "image/webp" ? "webp" : "jpg";
    const key = `${crypto.randomUUID()}.${ext}`;
    ctx.db.saveMediaBytes(key, req.file.buffer);
    const media: MediaRecord = {
      id: ctx.db.nextId("media"),
      owner_id: user.id,
      kind,
      storage_key: key,
      content_type: meta.contentType,
      width: meta.width,
      height: meta.height,
      size_bytes: req.file.buffer.length,
      created_at: ctx.db.now(),
    };
    ctx.db.media.push(media);
    ctx.db.persist();
    res.status(201).json({
      id: media.id,
      kind: media.kind,
      url: `/api/media/${media.id}`,
      width: media.width,
      height: media.height,
      content_type: media.content_type,
    });
  });

  router.get("/media/:id", auth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const media = ctx.db.media.find((m) => m.id === Number(req.params.id));
    if (!media || !canViewMedia(ctx.db, media, user)) {
      res.status(404).json({ detail: "That image was not found." });
      return;
    }
    const bytes = ctx.db.readMediaBytes(media.storage_key);
    if (!bytes) {
      res.status(404).json({ detail: "That image was not found." });
      return;
    }
    res.setHeader("Content-Type", media.content_type);
    res.setHeader("Cache-Control", "private, no-cache");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.send(bytes);
  });

  // --- Journal & Trash/Restore ---------------------------------------------

  router.get("/journal", auth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const q = String(req.query.q ?? "").trim().toLowerCase();
    const type = String(req.query.type ?? "");
    const albumId = req.query.album_id ? Number(req.query.album_id) : null;
    const showTrash = req.query.trash === "1" || req.query.trash === "true";

    let list = ctx.db.journalEntries.filter((e) => e.owner_id === user.id);
    list = showTrash ? list.filter((e) => e.deleted_at !== null) : list.filter((e) => e.deleted_at === null);

    if (type === "flower" || type === "photo" || type === "composition") {
      list = list.filter((e) => e.entry_type === type);
    }
    if (albumId !== null && !showTrash) {
      list = list.filter((e) => e.album_ids.includes(albumId));
    }
    if (q) {
      list = list.filter((e) => {
        const word = String((e.recipe ?? {}).word ?? "");
        const names = e.participants.map((p) => p.display_name).join(" ");
        const theme = String(((e.edit_state ?? {}).theme as Record<string, unknown> | undefined)?.name ?? "");
        const haystack = [e.title, e.caption, e.notes, word, names, theme].join(" ").toLowerCase();
        return haystack.includes(q);
      });
    }
    list.sort((a, b) => b.taken_at.localeCompare(a.taken_at) || b.id - a.id);
    res.json(list.map(entryOut));
  });

  router.delete("/journal/trash", auth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const trashed = ctx.db.journalEntries.filter((e) => e.owner_id === user.id && e.deleted_at !== null);
    const mediaToRelease: Array<number | null> = [];
    for (const e of trashed) {
      mediaToRelease.push(e.photo_media_id, e.original_media_id);
    }
    ctx.db.journalEntries = ctx.db.journalEntries.filter((e) => !(e.owner_id === user.id && e.deleted_at !== null));
    for (const mid of mediaToRelease) releaseMediaIfUnused(mid);
    ctx.db.persist();
    res.status(204).end();
  });

  router.post("/journal", auth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const entryType = body.entry_type;
    if (entryType !== "flower" && entryType !== "photo" && entryType !== "composition") {
      res.status(422).json({ detail: "Invalid entry type." });
      return;
    }

    const photoMediaId = body.photo_media_id ? Number(body.photo_media_id) : null;
    const originalMediaId = body.original_media_id ? Number(body.original_media_id) : null;

    if (photoMediaId !== null && !ctx.db.media.some((m) => m.id === photoMediaId && m.owner_id === user.id)) {
      res.status(404).json({ detail: "Photo media not found." });
      return;
    }
    if (originalMediaId !== null && !ctx.db.media.some((m) => m.id === originalMediaId && m.owner_id === user.id)) {
      res.status(404).json({ detail: "Original media not found." });
      return;
    }

    let recipe: Record<string, unknown> | null = null;
    if (body.recipe) {
      try {
        recipe = validateRecipe(body.recipe);
      } catch (err) {
        res.status(422).json({ detail: (err as Error).message });
        return;
      }
    }
    if (entryType === "flower" && !recipe && !photoMediaId) {
      res.status(422).json({ detail: "A flower entry needs its recipe." });
      return;
    }
    if ((entryType === "photo" || entryType === "composition") && photoMediaId === null) {
      res.status(422).json({ detail: "This entry needs its finished image." });
      return;
    }

    let participants: Array<{ bloom_id: string; display_name: string }> = [];
    const projectId = body.project_id ? Number(body.project_id) : null;
    const editState = body.edit_state && typeof body.edit_state === "object" ? (body.edit_state as Record<string, unknown>) : null;
    if (projectId !== null) {
      const project = ctx.db.projects.find((p) => p.id === projectId);
      if (!project || !isActiveProjectMember(project, user.id)) {
        res.status(404).json({ detail: "That project was not found." });
        return;
      }
      participants = project.members
        .filter((m) => m.status === "active")
        .map((m) => {
          const u = ctx.db.users.find((uu) => uu.id === m.user_id);
          return u ? { bloom_id: u.bloom_id, display_name: u.display_name } : null;
        })
        .filter((p): p is { bloom_id: string; display_name: string } => Boolean(p));
    } else if (Array.isArray(editState?.participants)) {
      participants = editState.participants.slice(0, 4).map((p: unknown) => {
        const po = (p ?? {}) as Record<string, unknown>;
        return {
          bloom_id: String(po.bloom_id ?? "").slice(0, 16),
          display_name: String(po.display_name ?? "").slice(0, 48),
        };
      });
    }

    const albumIds = Array.isArray(body.album_ids)
      ? Array.from(new Set(body.album_ids.map(Number))).filter((aid) =>
          ctx.db.albums.some((a) => a.id === aid && a.owner_id === user.id),
        )
      : [];

    const now = ctx.db.now();
    const entry: JournalEntryRecord = {
      id: ctx.db.nextId("entry"),
      owner_id: user.id,
      entry_type: entryType,
      title: cleanText(body.title, 120),
      caption: cleanText(body.caption, 500),
      notes: typeof body.notes === "string" ? body.notes.slice(0, 10_000) : "",
      taken_at: typeof body.taken_at === "string" && body.taken_at ? body.taken_at : now,
      recipe,
      photo_media_id: photoMediaId,
      original_media_id: originalMediaId,
      edit_state: editState,
      project_id: projectId,
      participants,
      album_ids: albumIds,
      deleted_at: null,
      created_at: now,
      updated_at: now,
    };
    ctx.db.journalEntries.push(entry);
    ctx.db.persist();
    res.status(201).json(entryOut(entry));
  });

  router.get("/journal/:id", auth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const entry = ctx.db.journalEntries.find((e) => e.id === Number(req.params.id) && e.owner_id === user.id);
    if (!entry) {
      res.status(404).json({ detail: "That journal entry was not found." });
      return;
    }
    res.json(entryOut(entry));
  });

  router.patch("/journal/:id", auth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const entry = ctx.db.journalEntries.find((e) => e.id === Number(req.params.id) && e.owner_id === user.id);
    if (!entry) {
      res.status(404).json({ detail: "That journal entry was not found." });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const released: Array<number | null> = [];

    if (body.title !== undefined) entry.title = cleanText(body.title, 120);
    if (body.caption !== undefined) entry.caption = cleanText(body.caption, 500);
    if (body.notes !== undefined && typeof body.notes === "string") entry.notes = body.notes.slice(0, 10_000);
    if (typeof body.taken_at === "string" && body.taken_at) entry.taken_at = body.taken_at;
    if (body.recipe !== undefined && body.recipe !== null) {
      try {
        entry.recipe = validateRecipe(body.recipe);
      } catch (err) {
        res.status(422).json({ detail: (err as Error).message });
        return;
      }
    }
    if (typeof body.photo_media_id === "number" && body.photo_media_id !== entry.photo_media_id) {
      if (!ctx.db.media.some((m) => m.id === body.photo_media_id && m.owner_id === user.id)) {
        res.status(404).json({ detail: "Photo media not found." });
        return;
      }
      released.push(entry.photo_media_id);
      entry.photo_media_id = body.photo_media_id;
    }
    if (typeof body.original_media_id === "number" && body.original_media_id !== entry.original_media_id) {
      if (!ctx.db.media.some((m) => m.id === body.original_media_id && m.owner_id === user.id)) {
        res.status(404).json({ detail: "Original media not found." });
        return;
      }
      released.push(entry.original_media_id);
      entry.original_media_id = body.original_media_id;
    }
    if (body.keep_original === false && entry.original_media_id !== null) {
      released.push(entry.original_media_id);
      entry.original_media_id = null;
    }
    if (body.edit_state !== undefined && typeof body.edit_state === "object") {
      entry.edit_state = body.edit_state as Record<string, unknown> | null;
    }
    if (Array.isArray(body.album_ids)) {
      entry.album_ids = Array.from(new Set(body.album_ids.map(Number))).filter((aid) =>
        ctx.db.albums.some((a) => a.id === aid && a.owner_id === user.id),
      );
    }
    entry.updated_at = ctx.db.now();
    for (const mid of released) releaseMediaIfUnused(mid);
    ctx.db.persist();
    res.json(entryOut(entry));
  });

  router.post("/journal/:id/duplicate", auth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const entry = ctx.db.journalEntries.find((e) => e.id === Number(req.params.id) && e.owner_id === user.id);
    if (!entry) {
      res.status(404).json({ detail: "That journal entry was not found." });
      return;
    }
    const now = ctx.db.now();
    const copy: JournalEntryRecord = {
      ...entry,
      id: ctx.db.nextId("entry"),
      title: (entry.title ? `${entry.title} (copy)` : "Copy").slice(0, 120),
      album_ids: [...entry.album_ids],
      participants: [...entry.participants],
      deleted_at: null,
      created_at: now,
      updated_at: now,
    };
    ctx.db.journalEntries.push(copy);
    ctx.db.persist();
    res.status(201).json(entryOut(copy));
  });

  router.post("/journal/:id/restore", auth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const entry = ctx.db.journalEntries.find((e) => e.id === Number(req.params.id) && e.owner_id === user.id);
    if (!entry) {
      res.status(404).json({ detail: "That journal entry was not found." });
      return;
    }
    entry.deleted_at = null;
    entry.updated_at = ctx.db.now();
    ctx.db.persist();
    res.json(entryOut(entry));
  });

  router.delete("/journal/:id", auth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const idx = ctx.db.journalEntries.findIndex((e) => e.id === Number(req.params.id) && e.owner_id === user.id);
    if (idx < 0) {
      res.status(404).json({ detail: "That journal entry was not found." });
      return;
    }
    const entry = ctx.db.journalEntries[idx];
    const permanent = req.query.permanent === "1" || req.query.permanent === "true" || entry.deleted_at !== null;
    if (!permanent) {
      entry.deleted_at = ctx.db.now();
      entry.updated_at = entry.deleted_at;
      ctx.db.persist();
      res.status(204).end();
      return;
    }
    const mediaIds = [entry.photo_media_id, entry.original_media_id];
    ctx.db.journalEntries.splice(idx, 1);
    for (const mid of mediaIds) releaseMediaIfUnused(mid);
    ctx.db.persist();
    res.status(204).end();
  });

  // --- Albums --------------------------------------------------------------

  const albumOut = (album: { id: number; name: string; created_at: string }) => ({
    id: album.id,
    name: album.name,
    entry_count: ctx.db.journalEntries.filter(
      (e) => e.owner_id === userOwner(album.id) && e.deleted_at === null && e.album_ids.includes(album.id),
    ).length,
    created_at: album.created_at,
  });

  const userOwner = (albumId: number) => ctx.db.albums.find((a) => a.id === albumId)?.owner_id;

  router.get("/albums", auth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const list = ctx.db.albums
      .filter((a) => a.owner_id === user.id)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(albumOut);
    res.json(list);
  });

  router.post("/albums", auth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const name = cleanText((req.body ?? {}).name, 60);
    if (!name) {
      res.status(422).json({ detail: "Please name the album." });
      return;
    }
    if (ctx.db.albums.some((a) => a.owner_id === user.id && a.name.toLowerCase() === name.toLowerCase())) {
      res.status(409).json({ detail: "You already have an album with that name." });
      return;
    }
    const album = { id: ctx.db.nextId("album"), owner_id: user.id, name, created_at: ctx.db.now() };
    ctx.db.albums.push(album);
    ctx.db.persist();
    res.status(201).json(albumOut(album));
  });

  router.patch("/albums/:id", auth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const album = ctx.db.albums.find((a) => a.id === Number(req.params.id) && a.owner_id === user.id);
    if (!album) {
      res.status(404).json({ detail: "That album was not found." });
      return;
    }
    const name = cleanText((req.body ?? {}).name, 60);
    if (!name) {
      res.status(422).json({ detail: "Please name the album." });
      return;
    }
    if (ctx.db.albums.some((a) => a.id !== album.id && a.owner_id === user.id && a.name.toLowerCase() === name.toLowerCase())) {
      res.status(409).json({ detail: "You already have an album with that name." });
      return;
    }
    album.name = name;
    ctx.db.persist();
    res.json(albumOut(album));
  });

  router.delete("/albums/:id", auth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const aid = Number(req.params.id);
    const idx = ctx.db.albums.findIndex((a) => a.id === aid && a.owner_id === user.id);
    if (idx < 0) {
      res.status(404).json({ detail: "That album was not found." });
      return;
    }
    ctx.db.albums.splice(idx, 1);
    for (const e of ctx.db.journalEntries) {
      if (e.owner_id === user.id && e.album_ids.includes(aid)) {
        e.album_ids = e.album_ids.filter((x) => x !== aid);
      }
    }
    ctx.db.persist();
    res.status(204).end();
  });

  return router;
}
