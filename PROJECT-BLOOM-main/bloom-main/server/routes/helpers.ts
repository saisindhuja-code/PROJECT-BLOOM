import type { NextFunction, Request, Response } from "express";
import type { BloomDatabase, NotificationRecord, UserRecord } from "../db";
import type { SecurityContext } from "../security";
import type { SharedWsHub } from "../wsHub";

export interface RouteContext {
  db: BloomDatabase;
  security: SecurityContext;
  hub: SharedWsHub;
}

export interface AuthedRequest extends Request {
  user?: UserRecord;
}

export function requireAuth(ctx: RouteContext) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    const user = ctx.security.userFromRequest(ctx.db, req);
    if (!user) {
      res.status(401).json({ detail: "Please sign in first." });
      return;
    }
    req.user = user;
    next();
  };
}

export function createNotification(
  ctx: RouteContext,
  input: {
    userId: number;
    type: NotificationRecord["type"];
    actorId: number | null;
    title: string;
    body: string;
    link: string;
  },
): NotificationRecord {
  const rec: NotificationRecord = {
    id: ctx.db.nextId("notification"),
    user_id: input.userId,
    type: input.type,
    actor_id: input.actorId,
    title: input.title,
    body: input.body,
    link: input.link,
    read_at: null,
    created_at: ctx.db.now(),
  };
  ctx.db.notifications.push(rec);
  ctx.db.persist();
  const actor = input.actorId ? ctx.db.users.find((u) => u.id === input.actorId) : null;
  ctx.hub.sendToUser(input.userId, {
    type: "notification",
    notification: {
      ...rec,
      actor: actor ? { bloom_id: actor.bloom_id, display_name: actor.display_name } : null,
    },
  });
  return rec;
}
