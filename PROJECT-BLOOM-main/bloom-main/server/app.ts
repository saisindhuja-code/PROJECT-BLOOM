/**
 * Express + SharedWsHub application factory for Bloom.
 */
import express, { type NextFunction, type Request, type Response } from "express";
import cookieParser from "cookie-parser";
import { BloomDatabase } from "./db";
import { SecurityContext, csrfGuardMiddleware, securityHeadersMiddleware } from "./security";
import { SharedWsHub } from "./wsHub";
import { authRouter } from "./routes/auth";
import { socialRouter } from "./routes/social";
import { journalRouter } from "./routes/journal";
import { chatsRouter } from "./routes/chats";
import { projectsRouter } from "./routes/projects";
import { liveRouter } from "./routes/live";
import type { RouteContext } from "./routes/helpers";

export interface BloomAppBundle {
  app: express.Express;
  db: BloomDatabase;
  security: SecurityContext;
  hub: SharedWsHub;
}

export function createBloomApp(options: { dataDir?: string | null; secretKey?: string } = {}): BloomAppBundle {
  const db = new BloomDatabase({ dataDir: options.dataDir });
  const security = new SecurityContext({ secretKey: options.secretKey });
  const hub = new SharedWsHub(db, security);
  const ctx: RouteContext = { db, security, hub };

  const app = express();
  app.set("trust proxy", true);

  app.use(securityHeadersMiddleware);
  app.use(cookieParser());
  app.use(express.json({ limit: "2mb" }));
  app.use(csrfGuardMiddleware);

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, status: "ok", mode: "node" });
  });

  app.use("/api/auth", authRouter(ctx));
  app.use("/api/chats", chatsRouter(ctx));
  app.use("/api/projects", projectsRouter(ctx));
  app.use("/api/live", liveRouter(ctx));
  app.use("/api", socialRouter(ctx));
  app.use("/api", journalRouter(ctx));

  // Unmatched API routes return clean JSON 404
  app.use("/api", (_req, res) => {
    res.status(404).json({ detail: "API endpoint not found." });
  });

  // Error handler for Multer file size / malformed JSON
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const e = err as { code?: string; status?: number; type?: string; message?: string };
    if (e?.code === "LIMIT_FILE_SIZE") {
      res.status(413).json({ detail: "That image is too large." });
      return;
    }
    if (e?.type === "entity.parse.failed" || e?.status === 400) {
      res.status(400).json({ detail: "Invalid JSON request body." });
      return;
    }
    res.status(e?.status ?? 500).json({ detail: e?.message || "Something went wrong on the server." });
  });

  return { app, db, security, hub };
}
