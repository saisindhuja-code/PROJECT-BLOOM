import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocket } from "ws";
import { createBloomApp } from "../server/app";

// Minimal valid 1x1 PNG bytes for testing media upload validation
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

class TestClient {
  cookie = "";
  constructor(private baseUrl: string) {}

  async req<T = unknown>(
    path: string,
    options: { method?: string; body?: unknown; form?: FormData; csrf?: boolean } = {},
  ): Promise<{ status: number; data: T }> {
    const method = options.method ?? (options.body || options.form ? "POST" : "GET");
    const headers: Record<string, string> = {};
    if (this.cookie) headers.Cookie = this.cookie;
    if (options.csrf !== false && !["GET", "HEAD", "OPTIONS"].includes(method)) {
      headers["X-Bloom-Client"] = "1";
    }
    let body: BodyInit | undefined;
    if (options.form) {
      body = options.form;
    } else if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(options.body);
    }

    const res = await fetch(`${this.baseUrl}${path}`, { method, headers, body });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) {
      const part = setCookie.split(";")[0];
      if (part) this.cookie = part;
    }
    if (res.status === 204) return { status: res.status, data: undefined as T };
    const ct = res.headers.get("content-type") ?? "";
    const data = ct.includes("application/json") ? ((await res.json()) as T) : ((await res.text()) as T);
    return { status: res.status, data };
  }
}

async function startTestServer() {
  const bundle = createBloomApp({ dataDir: null, secretKey: "test-secret-key-bloom-2" });
  const server = http.createServer(bundle.app);
  server.on("upgrade", (req, socket, head) => bundle.hub.handleUpgrade(req, socket, head));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;
  const wsUrl = `ws://127.0.0.1:${port}`;
  return {
    baseUrl,
    wsUrl,
    close: async () => {
      bundle.hub.closeAll();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

test("Bloom 2.0 server integration: auth, CSRF, privacy, social graph, reactions, chat + WS, together + WS, and journal trash/restore", async () => {
  const srv = await startTestServer();
  try {
    const alice = new TestClient(srv.baseUrl);
    const bob = new TestClient(srv.baseUrl);

    // 1. Health & CSRF guard
    const health = await alice.req<{ ok: boolean; mode: string }>("/api/health");
    assert.equal(health.status, 200);
    assert.equal(health.data.ok, true);
    assert.equal(health.data.mode, "node");

    const blockedNoCsrf = await alice.req("/api/auth/register", {
      csrf: false,
      body: { username: "alice", display_name: "Alice", password: "password123" },
    });
    assert.equal(blockedNoCsrf.status, 403);

    // 2. Register Alice & Bob + signed session cookie
    const regA = await alice.req<{ id: number; bloom_id: string; display_name: string }>("/api/auth/register", {
      body: { username: "alice", display_name: "Alice", password: "password123" },
    });
    assert.equal(regA.status, 201);
    assert.match(regA.data.bloom_id, /^BLM-/);

    const regB = await bob.req<{ id: number; bloom_id: string; display_name: string }>("/api/auth/register", {
      body: { username: "bob", display_name: "Bob", password: "password123" },
    });
    assert.equal(regB.status, 201);

    // 3. Profile customization + Privacy enforcement
    const patchB = await bob.req<{ bio: string; privacy: { profile_visibility: string; allow_dm_from: string } }>(
      "/api/auth/me",
      {
        method: "PATCH",
        body: {
          bio: "Secret greenhouse notes",
          favorite_word: "solstice",
          privacy: { profile_visibility: "friends", allow_dm_from: "friends" },
        },
      },
    );
    assert.equal(patchB.status, 200);
    assert.equal(patchB.data.privacy.profile_visibility, "friends");

    // Non-friend Alice cannot view private details or DM Bob yet
    const lockedProfile = await alice.req<{ profile_locked: boolean; bio: string; allow_dm: boolean }>(
      `/api/users/${regB.data.bloom_id}/profile`,
    );
    assert.equal(lockedProfile.status, 200);
    assert.equal(lockedProfile.data.profile_locked, true);
    assert.equal(lockedProfile.data.bio, "");
    assert.equal(lockedProfile.data.allow_dm, false);

    const deniedDm = await alice.req("/api/chats/dm", { body: { bloom_id: regB.data.bloom_id } });
    assert.equal(deniedDm.status, 403);

    // 4. Follow graph + Friend request + Notifications
    const followRes = await alice.req<{ following: boolean }>(`/api/social/follow/${regB.data.bloom_id}`, {
      method: "POST",
    });
    assert.equal(followRes.status, 201);
    assert.equal(followRes.data.following, true);

    const reqRes = await alice.req("/api/friends/requests", { body: { bloom_id: regB.data.bloom_id } });
    assert.equal(reqRes.status, 201);

    const bobFriends = await bob.req<{ incoming: Array<{ request_id: number }> }>("/api/friends");
    assert.equal(bobFriends.data.incoming.length, 1);
    const requestId = bobFriends.data.incoming[0].request_id;

    const acceptRes = await bob.req(`/api/friends/requests/${requestId}/accept`, { method: "POST" });
    assert.equal(acceptRes.status, 200);

    // Now Alice can view Bob's full profile and stats
    const unlockedProfile = await alice.req<{ profile_locked: boolean; bio: string; allow_dm: boolean; stats: { followers: number; friends: number } }>(
      `/api/users/${regB.data.bloom_id}/profile`,
    );
    assert.equal(unlockedProfile.data.profile_locked, false);
    assert.equal(unlockedProfile.data.bio, "Secret greenhouse notes");
    assert.equal(unlockedProfile.data.allow_dm, true);
    assert.equal(unlockedProfile.data.stats.followers, 1);
    assert.equal(unlockedProfile.data.stats.friends, 1);

    // Alice received notification for friend request acceptance
    const aliceNotifs = await alice.req<{ items: Array<{ id: number; type: string }>; unread: number }>("/api/notifications");
    assert.ok(aliceNotifs.data.unread >= 1);
    await alice.req("/api/notifications/read-all", { method: "POST" });
    const aliceNotifsAfter = await alice.req<{ unread: number }>("/api/notifications");
    assert.equal(aliceNotifsAfter.data.unread, 0);

    // 5. Real-time WebSocket Chat & Group Chat
    const dmRes = await alice.req<{ id: number }>("/api/chats/dm", { body: { bloom_id: regB.data.bloom_id } });
    assert.equal(dmRes.status, 201);
    const chatId = dmRes.data.id;

    const bobWs = new WebSocket(`${srv.wsUrl}/api/ws`, { headers: { Cookie: bob.cookie } });
    const receivedEvents: Array<Record<string, unknown>> = [];
    await new Promise<void>((resolve, reject) => {
      bobWs.on("open", () => {
        bobWs.send(JSON.stringify({ type: "subscribe", channel: `chat:${chatId}` }));
      });
      bobWs.on("message", (raw) => {
        const msg = JSON.parse(raw.toString()) as Record<string, unknown>;
        receivedEvents.push(msg);
        if (msg.type === "subscribed") resolve();
      });
      bobWs.on("error", reject);
    });

    const msgPromise = new Promise<Record<string, unknown>>((resolve) => {
      const handler = (raw: Buffer | string) => {
        const parsed = JSON.parse(raw.toString()) as Record<string, unknown>;
        if (parsed.type === "chat:message" && parsed.chatId === chatId) {
          bobWs.off("message", handler);
          resolve(parsed);
        }
      };
      bobWs.on("message", handler);
    });

    const sentMsg = await alice.req<{ id: number }>(`/api/chats/${chatId}/messages`, {
      body: {
        text: "Look at this lotus flower",
        flower_recipe: { word: "aurora", shape: "flower", petalStyle: "lotus" },
      },
    });
    assert.equal(sentMsg.status, 201);
    const wsDelivery = await msgPromise;
    assert.equal((wsDelivery.message as { text: string }).text, "Look at this lotus flower");

    // Emoji reaction on message
    const reactRes = await bob.req<{ added: boolean; reactions: Array<{ emoji: string; count: number }> }>("/api/reactions", {
      body: { target_type: "message", target_id: String(sentMsg.data.id), emoji: "🌸" },
    });
    assert.equal(reactRes.status, 200);
    assert.equal(reactRes.data.added, true);
    assert.equal(reactRes.data.reactions[0].count, 1);

    // 6. Media privacy, Journal Scrapbook + Trash / Restore
    const form = new FormData();
    form.append("kind", "photo");
    form.append("file", new Blob([TINY_PNG], { type: "image/png" }), "pixel.png");
    const uploadRes = await alice.req<{ id: number }>("/api/media", { form });
    assert.equal(uploadRes.status, 201);
    const mediaId = uploadRes.data.id;

    // Bob cannot view Alice's private media
    const deniedMedia = await bob.req(`/api/media/${mediaId}`);
    assert.equal(deniedMedia.status, 404);

    // Create & Soft-delete -> Trash -> Restore
    const createdEntry = await alice.req<{ id: number }>("/api/journal", {
      body: {
        entry_type: "photo",
        title: "Scrapbook test",
        photo_media_id: mediaId,
        edit_state: { version: 2, scrapbook: { paper: "cream", title: "Scrapbook test", layers: [], strokes: [] } },
      },
    });
    assert.equal(createdEntry.status, 201);

    const softDel = await alice.req(`/api/journal/${createdEntry.data.id}`, { method: "DELETE" });
    assert.equal(softDel.status, 204);

    const activeList = await alice.req<Array<{ id: number }>>("/api/journal");
    assert.equal(activeList.data.length, 0);

    const trashList = await alice.req<Array<{ id: number; deleted_at: string }>>("/api/journal?trash=1");
    assert.equal(trashList.data.length, 1);
    assert.ok(trashList.data[0].deleted_at);

    const restored = await alice.req<{ id: number; deleted_at: string | null }>(
      `/api/journal/${createdEntry.data.id}/restore`,
      { method: "POST" },
    );
    assert.equal(restored.status, 200);
    assert.equal(restored.data.deleted_at, null);

    // 7. Bloom Together real-time WS update
    const projRes = await alice.req<{ id: number }>("/api/projects", {
      body: { title: "Sunday Twin", mode: "twin", invite_bloom_id: regB.data.bloom_id },
    });
    assert.equal(projRes.status, 201);
    const projId = projRes.data.id;

    await bob.req(`/api/projects/${projId}/accept`, { method: "POST" });

    const projEventPromise = new Promise<Record<string, unknown>>((resolve) => {
      const handler = (raw: Buffer | string) => {
        const parsed = JSON.parse(raw.toString()) as Record<string, unknown>;
        if (parsed.type === "project:updated" && parsed.projectId === projId && parsed.kind === "settings") {
          bobWs.off("message", handler);
          resolve(parsed);
        }
      };
      bobWs.on("message", handler);
    });

    const patchProj = await alice.req(`/api/projects/${projId}`, {
      method: "PATCH",
      body: { layout: "polaroid-pair" },
    });
    assert.equal(patchProj.status, 200);
    const wsProj = await projEventPromise;
    assert.equal((wsProj.project as { layout: string }).layout, "polaroid-pair");

    bobWs.close();
  } finally {
    await srv.close();
  }
});
