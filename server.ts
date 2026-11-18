/**
 * Bloom unified Node.js server entrypoint (port 3000).
 * Serves API routes, shared WebSockets (/api/ws & /api/live/ws/:roomId),
 * and Vite dev middleware (or static frontend/dist in production).
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import express from "express";
import { createBloomApp } from "./server/app";

async function startServer() {
  const port = Number(process.env.PORT || 3000);
  const host = "0.0.0.0";
  const isProd = process.env.NODE_ENV === "production";

  const { app, hub } = createBloomApp();

  if (isProd) {
    const distDir = path.resolve(process.cwd(), "frontend/dist");
    if (fs.existsSync(distDir)) {
      app.use(express.static(distDir, { index: false }));
      app.get("*", (req, res, next) => {
        if (req.path.startsWith("/api")) {
          next();
          return;
        }
        res.sendFile(path.join(distDir, "index.html"));
      });
    }
  } else {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      root: path.resolve(process.cwd(), "frontend"),
      configFile: path.resolve(process.cwd(), "frontend/vite.config.ts"),
      server: {
        middlewareMode: true,
        hmr: false,
      },
      appType: "spa",
    });

    app.use((req, res, next) => {
      if (req.path.startsWith("/api")) {
        next();
        return;
      }
      vite.middlewares(req, res, next);
    });
  }

  const server = http.createServer(app);
  server.on("upgrade", (req, socket, head) => {
    hub.handleUpgrade(req, socket, head);
  });

  server.listen(port, host, () => {
    console.log(`Bloom server listening at http://${host}:${port}`);
  });

  const shutdown = () => {
    hub.closeAll();
    server.close(() => process.exit(0));
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

startServer().catch((err) => {
  console.error("Failed to start Bloom server:", err);
  process.exit(1);
});
