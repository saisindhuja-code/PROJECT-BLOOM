/**
 * Phase 2: Auth upgrades, user profiles, privacy settings, and password updates.
 */
import { Router } from "express";
import type { UserRecord } from "../db";
import {
  burnPasswordCheck,
  hashPassword,
  newBloomId,
  verifyPassword,
} from "../security";
import { USERNAME_RE, cleanText, userOut, validateRecipe } from "../validation";
import { requireAuth, type AuthedRequest, type RouteContext } from "./helpers";

export function authRouter(ctx: RouteContext): Router {
  const router = Router();
  const auth = requireAuth(ctx);

  router.post("/register", (req, res) => {
    const ip = req.ip ?? "unknown";
    if (!ctx.security.checkRateLimit(`auth:${ip}`, 30, 60_000)) {
      res.status(429).json({ detail: "Too many attempts. Wait a moment and try again." });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const username = typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
    const displayName = cleanText(body.display_name, 48);
    const password = typeof body.password === "string" ? body.password : "";

    if (!USERNAME_RE.test(username)) {
      res.status(422).json({ detail: "username: use 3-32 letters, numbers, dots or underscores" });
      return;
    }
    if (!displayName) {
      res.status(422).json({ detail: "display name: please add a name" });
      return;
    }
    if (password.length < 8 || password.length > 200) {
      res.status(422).json({ detail: "password: use at least 8 characters" });
      return;
    }
    if (ctx.db.users.some((u) => u.username === username)) {
      res.status(409).json({ detail: "That username is taken." });
      return;
    }

    let bloomId = newBloomId();
    for (let i = 0; i < 10; i++) {
      if (!ctx.db.users.some((u) => u.bloom_id === bloomId)) break;
      bloomId = newBloomId();
    }

    const now = ctx.db.now();
    const user: UserRecord = {
      id: ctx.db.nextId("user"),
      bloom_id: bloomId,
      username,
      display_name: displayName,
      password_hash: hashPassword(password),
      bio: "",
      favorite_word: "",
      avatar_recipe: null,
      privacy: {
        profile_visibility: "everyone",
        allow_dm_from: "everyone",
        discoverable: true,
        show_online: true,
      },
      created_at: now,
      updated_at: now,
    };
    ctx.db.users.push(user);
    ctx.db.persist();
    ctx.security.setSessionCookie(res, user.id);
    res.status(201).json(userOut(user));
  });

  router.post("/login", (req, res) => {
    const ip = req.ip ?? "unknown";
    if (!ctx.security.checkRateLimit(`auth:${ip}`, 30, 60_000)) {
      res.status(429).json({ detail: "Too many login attempts. Please wait a minute." });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const username = typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const user = ctx.db.users.find((u) => u.username === username);
    if (!user) {
      burnPasswordCheck(password);
      res.status(401).json({ detail: "That username and password don't match." });
      return;
    }
    if (!verifyPassword(password, user.password_hash)) {
      res.status(401).json({ detail: "That username and password don't match." });
      return;
    }
    ctx.security.setSessionCookie(res, user.id);
    res.json(userOut(user));
  });

  router.post("/logout", (_req, res) => {
    ctx.security.clearSessionCookie(res);
    res.status(204).end();
  });

  router.get("/session", (req, res) => {
    const user = ctx.security.userFromRequest(ctx.db, req);
    res.json({ user: user ? userOut(user) : null });
  });

  router.get("/me", auth, (req: AuthedRequest, res) => {
    res.json(userOut(req.user!));
  });

  router.patch("/me", auth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const body = (req.body ?? {}) as Record<string, unknown>;

    if (body.display_name !== undefined) {
      const clean = cleanText(body.display_name, 48);
      if (!clean) {
        res.status(422).json({ detail: "Display name cannot be empty." });
        return;
      }
      user.display_name = clean;
    }
    if (body.bio !== undefined) {
      user.bio = cleanText(body.bio, 240);
    }
    if (body.favorite_word !== undefined) {
      user.favorite_word = cleanText(body.favorite_word, 24);
    }
    if (body.avatar_recipe !== undefined) {
      if (body.avatar_recipe === null) {
        user.avatar_recipe = null;
      } else {
        try {
          user.avatar_recipe = validateRecipe(body.avatar_recipe);
        } catch (err) {
          res.status(422).json({ detail: (err as Error).message });
          return;
        }
      }
    }
    if (body.privacy && typeof body.privacy === "object") {
      const p = body.privacy as Record<string, unknown>;
      if (p.profile_visibility === "everyone" || p.profile_visibility === "friends" || p.profile_visibility === "private") {
        user.privacy.profile_visibility = p.profile_visibility;
      }
      if (p.allow_dm_from === "everyone" || p.allow_dm_from === "friends") {
        user.privacy.allow_dm_from = p.allow_dm_from;
      }
      if (typeof p.discoverable === "boolean") {
        user.privacy.discoverable = p.discoverable;
      }
      if (typeof p.show_online === "boolean") {
        user.privacy.show_online = p.show_online;
      }
    }
    user.updated_at = ctx.db.now();
    ctx.db.persist();
    res.json(userOut(user));
  });

  router.post("/password", auth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const currentPassword = typeof body.current_password === "string" ? body.current_password : "";
    const newPassword = typeof body.new_password === "string" ? body.new_password : "";
    if (!verifyPassword(currentPassword, user.password_hash)) {
      res.status(401).json({ detail: "Current password is incorrect." });
      return;
    }
    if (newPassword.length < 8 || newPassword.length > 200) {
      res.status(422).json({ detail: "New password must be at least 8 characters." });
      return;
    }
    user.password_hash = hashPassword(newPassword);
    user.updated_at = ctx.db.now();
    ctx.db.persist();
    res.json({ ok: true });
  });

  return router;
}
