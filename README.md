# bloom 2.0

Grow a flower from a word, photograph it with the look of an old camera, layer it in a scrapbook, share it live in Bloom Chat, and collaborate with friends.

Bloom started as a Python Turtle program (`legacy/bloom_turtle.py`, kept intact). The `"classic"` petal style preserves the exact Python Turtle geometry, rings, stem arcs, leaves, and floating hearts — alongside Bloom 2.0 creative and social upgrades.

| Feature | What it does |
| --- | --- |
| **01 · Flower Studio 2.0** | Type any word; pick **7 word shapes**, **6 petal curves** (`classic`, `rounded`, `tulip`, `daisy`, `lotus`, `heart`), curated **Studio color palettes**, optional **dedication messages & signatures**, SVG/PNG/`.bloom.json` export, and re-editing from journal entries. |
| **02 · Bloom Cam 2.0** | Camera or photo upload, **multi-flower layers** (add/move/resize/rotate/remove), **non-destructive Crop** (`Free`, `1:1`, `4:5`, `3:4`, `16:9`), **Photo Strip (4)** & **Contact Sheet (6)** booth modes, MediaPipe hand tracking, and 10 analog film filters. |
| **03 · Journal & Scrapbook** | Save creations locally (`IndexedDB`) or synced to your account; search, filter, albums, emoji reactions, soft-delete **Trash & Restore**, and the multi-layer **Scrapbook Studio** (papers, photos, flowers, stickers, notes, freehand ink brush). |
| **04 · Together & Friends** | Bloom IDs, friend requests, user discovery & **Follow graph**, privacy controls, **real-time WebSocket sync** across Twin Bloom / Two Blooms / Our Moment slots, partner live cursors, and built-in Session Chat. |
| **05 · Live Bloom** | Two-person WebRTC video rooms with shared flower/filter/layout and synchronized countdown captures. |
| **06 · Unified Bloom Chat** | 3-column responsive chat workspace for **Direct Messages**, **Group Chats**, **Project Chats**, and the open **Studio Lounge**, complete with interactive flower cards, typing indicators, photo sharing, and emoji reactions. |

---

## 1. Requirements & Quick Start

- **Node.js 22+** (includes `npm`)

```bash
npm install
npm run dev
```

Open **http://localhost:3000**. Both the Express API, WebSocket hubs (`/api/ws` and `/api/live/ws/:roomId`), and Vite frontend are served cleanly from the single process on port `3000`.

### Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Runs the unified Node.js + Express + WebSocket + Vite dev server on port `3000` |
| `npm run lint` | Type-checks both `server/` (`tsconfig.json`) and `frontend/` (`frontend/tsconfig.json`) |
| `npm test` | Runs automated tests (`tests/flower.test.ts` and `tests/server.test.ts`) |
| `npm run build` | Type-checks and builds `frontend/dist` for production |
| `npm start` | Starts the production Node.js server serving `frontend/dist` and API/WebSockets |

---

## 2. Project Architecture

```
bloom/
├── server.ts                   Single-process HTTP + WebSocket entrypoint (port 3000)
├── server/
│   ├── app.ts                  Express app factory, security headers, CSRF & JSON error handler
│   ├── db.ts                   Persistent JSON store (`BLOOM_DATA_DIR/bloom-db.json` + media blobs)
│   ├── security.ts             scrypt password hashing, HMAC-SHA256 cookies, CSRF guard, media ACLs
│   ├── validation.ts           Recipe, layout, profile, and upload validation
│   ├── wsHub.ts                Shared WebSocket hub (`/api/ws` + `/api/live/ws/:roomId`)
│   └── routes/                 `auth`, `social`, `chats`, `journal`, `projects`, `live`
├── frontend/                   React 18 + TypeScript + Vite SPA
│   └── src/
│       ├── flower/             Turtle engine, petal curves, SVG/PNG renderer, `.bloom.json` recipes
│       ├── imaging/            Non-destructive crop, multi-flower composition, strips & filters
│       ├── cam/                Camera access & MediaPipe hand tracking
│       ├── lib/                API client, `BloomWsClient`, session provider, IndexedDB/server stores
│       ├── components/         Stage, controls, reactions bar, share modal, inbox/notifications
│       └── pages/              Studio, Cam, Journal, Scrapbook, Friends, Together, Live, Chat, Account
├── tests/                      Automated Node.js test suite (`flower.test.ts`, `server.test.ts`)
└── legacy/                     Original Python Turtle implementation & static prototype
```

---

## 3. Privacy & Security Model

- **Authentication**: Passwords hashed with `crypto.scryptSync` and constant-time comparisons; `httpOnly` HMAC-SHA256 signed cookies.
- **CSRF & Origin Protection**: All mutating API requests require `X-Bloom-Client: 1`; WebSocket handshakes enforce `Origin` validation.
- **Granular Privacy**: Users configure `profile_visibility` (`everyone` / `friends` / `private`), `allow_dm_from` (`everyone` / `friends`), `discoverable`, and `show_online`.
- **Private Media Access Control**: Media blobs are verified on every request (`canViewMedia`), allowing owners, active project co-members, active live room participants, and authorized chat participants only.
