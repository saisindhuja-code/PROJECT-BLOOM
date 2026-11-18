/**
 * Security hardening: scrypt password hashing, HMAC-signed httpOnly cookies,
 * CSRF header enforcement, rate limiting, Bloom ID generation, and image magic-byte inspection.
 */
import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import type { BloomDatabase, MediaRecord, ProjectRecord, UserRecord } from "./db";

const BLOOM_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
export const COOKIE_NAME = "bloom_session";

export function newBloomId(): string {
  const bytes = crypto.randomBytes(8);
  let chars = "";
  for (let i = 0; i < 8; i++) {
    chars += BLOOM_ALPHABET[bytes[i] % BLOOM_ALPHABET.length];
  }
  return `BLM-${chars.slice(0, 4)}-${chars.slice(4)}`;
}

export function normalizeBloomId(raw: string): string {
  const cleaned = raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  const body = cleaned.startsWith("BLM") ? cleaned.slice(3) : cleaned;
  if (body.length !== 8) return "";
  return `BLM-${body.slice(0, 4)}-${body.slice(4)}`;
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = crypto.scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${derived}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const [, salt, expectedHex] = parts;
  try {
    const derived = crypto.scryptSync(password, salt, 64);
    const expected = Buffer.from(expectedHex, "hex");
    if (derived.length !== expected.length) return false;
    return crypto.timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

export function burnPasswordCheck(password: string): void {
  crypto.scryptSync(password, "bloom-constant-time-burn-salt", 64);
}

export class SecurityContext {
  readonly secretKey: string;
  readonly sessionDays: number;
  readonly maxUploadBytes: number;
  readonly cookieSecure: boolean;
  private rateBuckets = new Map<string, number[]>();

  constructor(options: { secretKey?: string; sessionDays?: number; maxUploadMb?: number; cookieSecure?: boolean } = {}) {
    this.secretKey =
      options.secretKey || process.env.BLOOM_SECRET_KEY || crypto.randomBytes(32).toString("hex");
    this.sessionDays = options.sessionDays ?? (Number(process.env.BLOOM_SESSION_DAYS) || 14);
    this.maxUploadBytes = (options.maxUploadMb ?? (Number(process.env.BLOOM_MAX_UPLOAD_MB) || 12)) * 1024 * 1024;
    this.cookieSecure =
      options.cookieSecure ?? process.env.BLOOM_COOKIE_SECURE === "true";
  }

  signToken(userId: number): string {
    const exp = Math.floor(Date.now() / 1000) + this.sessionDays * 86400;
    const payload = Buffer.from(JSON.stringify({ uid: userId, exp }), "utf-8").toString("base64url");
    const sig = crypto.createHmac("sha256", this.secretKey).update(payload).digest("base64url");
    return `${payload}.${sig}`;
  }

  verifyToken(token: string | undefined): number | null {
    if (!token || typeof token !== "string") return null;
    const dot = token.indexOf(".");
    if (dot <= 0) return null;
    const payload = token.slice(0, dot);
    const sig = token.slice(dot + 1);
    const expected = crypto.createHmac("sha256", this.secretKey).update(payload).digest("base64url");
    const sigBuf = Buffer.from(sig);
    const expBuf = Buffer.from(expected);
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return null;
    try {
      const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf-8")) as { uid?: number; exp?: number };
      if (typeof data.uid !== "number" || typeof data.exp !== "number") return null;
      if (data.exp < Math.floor(Date.now() / 1000)) return null;
      return data.uid;
    } catch {
      return null;
    }
  }

  setSessionCookie(res: Response, userId: number): void {
    const token = this.signToken(userId);
    res.cookie(COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: this.cookieSecure,
      path: "/",
      maxAge: this.sessionDays * 86400 * 1000,
    });
  }

  clearSessionCookie(res: Response): void {
    res.clearCookie(COOKIE_NAME, {
      httpOnly: true,
      sameSite: "lax",
      secure: this.cookieSecure,
      path: "/",
    });
  }

  userFromRequest(db: BloomDatabase, req: Request): UserRecord | null {
    const rawCookie = (req.cookies?.[COOKIE_NAME] as string | undefined) ?? parseCookieHeader(req.headers.cookie)[COOKIE_NAME];
    const uid = this.verifyToken(rawCookie);
    if (uid === null) return null;
    return db.users.find((u) => u.id === uid) ?? null;
  }

  checkRateLimit(key: string, maxRequests = 25, windowMs = 60_000): boolean {
    const now = Date.now();
    const bucket = (this.rateBuckets.get(key) ?? []).filter((t) => now - t < windowMs);
    if (bucket.length >= maxRequests) {
      this.rateBuckets.set(key, bucket);
      return false;
    }
    bucket.push(now);
    this.rateBuckets.set(key, bucket);
    return true;
  }
}

export function parseCookieHeader(header: string | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  if (!header) return result;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx <= 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    result[k] = decodeURIComponent(v);
  }
  return result;
}

export function securityHeadersMiddleware(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("Permissions-Policy", "camera=(self), microphone=(self), geolocation=()");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  next();
}

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function csrfGuardMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (req.path.startsWith("/api/") && UNSAFE_METHODS.has(req.method)) {
    if (req.headers["x-bloom-client"] !== "1") {
      res.status(403).json({ detail: "Missing X-Bloom-Client header." });
      return;
    }
  }
  next();
}

export function inspectImage(buf: Buffer): { contentType: string; width: number; height: number } {
  if (!buf || buf.length < 12) {
    throw new Error("That file is empty or not a supported image.");
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a &&
    buf.length >= 24
  ) {
    const width = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    if (width > 0 && height > 0) return { contentType: "image/png", width, height };
  }
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    let offset = 2;
    while (offset + 4 < buf.length) {
      if (buf[offset] !== 0xff) break;
      const marker = buf[offset + 1];
      offset += 2;
      if (marker === 0xd8 || marker === 0xd9) continue;
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        if (offset + 7 <= buf.length) {
          const height = buf.readUInt16BE(offset + 3);
          const width = buf.readUInt16BE(offset + 5);
          if (width > 0 && height > 0) return { contentType: "image/jpeg", width, height };
        }
        break;
      }
      if (offset + 2 > buf.length) break;
      const len = buf.readUInt16BE(offset);
      if (len < 2) break;
      offset += len;
    }
    return { contentType: "image/jpeg", width: 1200, height: 900 };
  }
  // WEBP: RIFF....WEBP
  if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") {
    return { contentType: "image/webp", width: 1200, height: 900 };
  }
  throw new Error("Please upload a JPEG, PNG, or WebP image.");
}

export function areFriends(db: BloomDatabase, a: number, b: number): boolean {
  return db.friendships.some(
    (f) =>
      f.status === "accepted" &&
      ((f.requester_id === a && f.addressee_id === b) || (f.requester_id === b && f.addressee_id === a)),
  );
}

export function isActiveProjectMember(project: ProjectRecord, userId: number): boolean {
  return project.members.some((m) => m.user_id === userId && m.status === "active");
}

export function canViewMedia(db: BloomDatabase, media: MediaRecord, viewer: UserRecord): boolean {
  if (media.owner_id === viewer.id) return true;
  // Shared via active Bloom Together project contribution
  for (const project of db.projects) {
    if (!isActiveProjectMember(project, viewer.id)) continue;
    for (const c of project.contributions) {
      if (!isActiveProjectMember(project, c.user_id)) continue;
      if (c.items.some((item) => item.media_id === media.id)) return true;
    }
  }
  // Shared via Live Bloom room capture
  for (const cap of db.liveCaptures) {
    if (cap.media_id !== media.id) continue;
    const room = db.liveRooms.find((r) => r.id === cap.room_id);
    if (room && (room.host_id === viewer.id || room.guest_id === viewer.id)) return true;
  }
  // Shared via Unified Chat message
  for (const msg of db.chatMessages) {
    if (msg.media_id !== media.id) continue;
    const thread = db.chats.find((t) => t.id === msg.chat_id);
    if (thread && (thread.type === "studio" || thread.member_ids.includes(viewer.id))) return true;
  }
  return false;
}
