# bloom

Grow a flower from a word, photograph it, give it the look of an old camera,
and keep it in a journal you can share with friends.

Bloom started as a Python Turtle program (`legacy/bloom_turtle.py`, kept exactly
as written). This project turns it into a website without changing the
flower: the same rings, petal maths, stem arcs, leaves and hearts.

| Part | What it does |
| --- | --- |
| **Studio** | Type a word; it is written along every petal. Change colours; optional petal size/count/rotation; save designs; export transparent PNG, SVG, or a `.bloom.json` recipe. |
| **Bloom Cam** | Camera or photo upload, flower overlay you can move/resize/rotate/crop, optional hand tracking, timer, undo/redo/reset, 10 camera themes, save to journal. |
| **Journal** | Flowers, photos and shared creations with titles, captions, notes, dates, albums, search and filters; open, edit, duplicate, download, delete. Works without an account (saved on the device). |
| **Together** | Bloom IDs, friend requests, and private two-person projects: Twin Bloom, Two Blooms, Our Moment. Each person adds their part whenever they like. |
| **Live Bloom** | Private video room for two friends (WebRTC), flower/theme/layout chosen together, capture together on a shared countdown, confirm before saving. |

---

## 1. What you need

- **Python 3.10 or newer** (python.org; tick "Add python.exe to PATH" when installing)
- **Node.js 18 or newer** (nodejs.org, the LTS version)
- A modern browser (Chrome, Edge, Firefox or Safari)

## 2. Set up (Windows, PowerShell or the VS Code terminal)

Open the `bloom` folder in VS Code, then open a terminal (**Terminal → New Terminal**).

**Backend**

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env
```

If PowerShell refuses to run `Activate.ps1`, run this once:
`Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`

**Frontend** (in a second terminal)

```powershell
cd frontend
npm install
```

`npm install` also copies MediaPipe's hand-tracking files into
`public/mediapipe` and tries to download the hand model.

## 3. Run it

Terminal 1, the backend:

```powershell
cd backend
.\.venv\Scripts\Activate.ps1
uvicorn app.main:app --reload --port 8000
```

Terminal 2, the frontend:

```powershell
cd frontend
npm run dev
```

Open **http://localhost:5173**. The database (`backend/data/bloom.db`) and
uploaded images (`backend/data/media`) are created on first start.

To try Together or Live on one computer, sign up two accounts: one in a normal
window and one in a private/incognito window (or a second browser).

### On your phone

Browsers only allow cameras on `https://` pages or `localhost`. Opening
`http://192.168.x.x:5173` from a phone will show the camera as unavailable
(uploading photos still works). For phone testing, use an HTTPS tunnel such
as `cloudflared tunnel --url http://localhost:5173`, or deploy (section 6).

## 4. Tests

```powershell
cd backend
python -m unittest discover -s tests -v
```

These cover accounts, sessions, CSRF protection, uploads and image
validation, designs, journal search/albums/duplicate/delete, private-photo
access, friend requests, project invites/revoke/leave, and Live Bloom
signalling over a real WebSocket server.

```powershell
cd frontend
npm run typecheck
```

## 5. How it is built

```
bloom/
├── legacy/                     your original Turtle program + the earlier static site
├── backend/                    Python + FastAPI
│   ├── app/main.py             app, security headers, CSRF guard, serves the built frontend
│   ├── app/models.py           database tables (SQLAlchemy)
│   ├── app/routers/            auth, designs, media, journal, friends, projects, live, inbox
│   ├── app/storage.py          image storage (local disk; interface ready for a cloud bucket)
│   ├── migrations/             Alembic migrations (run automatically on start)
│   └── tests/
└── frontend/                   React + TypeScript + Vite
    └── src/
        ├── flower/engine.ts    ← the original Turtle program, ported line by line
        ├── flower/render.ts    SVG / PNG / canvas output
        ├── flower/recipe.ts    the recipe format (.bloom.json)
        ├── imaging/            themes, non-destructive photo pipeline, layouts
        ├── cam/                camera, MediaPipe hand tracking, hand → flower maths
        ├── lib/                API client, session, storage (server + IndexedDB), WebRTC
        └── pages/              Studio, Cam, Journal, Together, Live, ...
```

### The flower engine

`frontend/src/flower/engine.ts` replays your Turtle program with a small
"recording turtle" and stores what it would draw (lines and word stamps). It
reproduces `turtle.circle()` exactly, including Turtle's own polygon step
count. Compared against the real Turtle program, all 823 word positions match
to 0.0000 px, and every stem and leaf line matches in points and width.

Changes that could not be avoided:

- **Hearts:** Python's `random` can't be reproduced in a browser, so the hearts
  use a seeded generator. Same rule (12 tries, kept if more than 130 px from
  the centre), and the same recipe always gives the same hearts.
- **"Click anywhere to close"** was Turtle window text, not part of the artwork,
  so it is left out.
- **Optional controls** (petal size, petals per ring, rotation, stem/leaves/hearts
  on/off) only scale the original numbers. With defaults, the flower is the original.

### Privacy and security

- Passwords are hashed with scrypt; sessions are signed, httpOnly cookies.
- All changing requests need an `X-Bloom-Client` header, which blocks cross-site form posts.
- Photos are private by default. Another person can see one only while you are both
  active members of the project it was added to, or in the live room where it was
  captured. Removing someone or leaving a project removes access immediately (the
  server re-checks on every view).
- Other users only ever see your Bloom ID and display name.
- Cameras and microphones start only when you press the button. Live video goes
  browser to browser (or through your TURN relay), not through the Bloom server.

### Non-destructive editing

Themes and overlays are settings, not pixels. Every preview and the saved image
are rendered fresh from the untouched original, so effects never stack. If you
keep the original (on by default), a journal photo can be fully re-edited later.

### Website themes (separate from photo filters)

- Four themes: **Midnight Garden** (default), **Y2K Digicam**, **Paper Hearts**, **Fairycore**, plus **Auto** (Midnight Garden when your device is in dark mode, Paper Hearts in light mode).
- Pick one from the palette button in the top bar, or open the gallery at `/themes` to see each theme previewed first.
- Your choice is saved in this browser (`localStorage` key `bloom.theme`). Saving goes through `themeStorage` in `src/theme/ThemeProvider.tsx`, so it can sync to accounts later.
- Files: `src/theme/themes.ts` (typed config: names, palettes, suggested flower colours, starting camera filter), `src/theme/ThemeProvider.tsx`, `src/theme/ThemeMenu.tsx`, `src/theme/ThemeDecor.tsx`, `src/pages/Themes.tsx` and `src/styles/themes.css` (all colours are CSS variables per theme). `index.html` applies the saved theme before the page draws, so it doesn't flash.
- Themes never change a flower, a saved recipe or a saved photo. The Studio offers "Use {theme} colours", and nothing changes until you press it.
- Photo filters are separate (`src/imaging/themes.ts`). The Bloom Cam filters are: Y2K Flash, Vintage Film, Disposable Camera, Soft Dream, Midnight Blue, Warm Sunset, Black and White, Soft Glow, Polaroid, Scrapbook and Botanical Garden.
  - Each filter has strength, grain, vignette and glow, plus your own brightness, contrast and saturation.
  - There's also undo/redo, Remove filter and Reset all.
  - The original photo is always kept; filters are only settings applied when rendering.
  - The website theme only picks the camera's *starting* filter.

## 6. Production

1. Set real values in `backend/.env`:
   - `BLOOM_ENV=production`
   - `BLOOM_SECRET_KEY`: a long random string
   - `BLOOM_COOKIE_SECURE=true`
   - `BLOOM_ALLOWED_ORIGINS`: your site address
2. Use PostgreSQL: `pip install -r requirements-postgres.txt`, then set
   `DATABASE_URL=postgresql://user:password@host:5432/bloom`. Migrations run on start.
3. Build the frontend with `cd frontend && npm run build`. The backend then serves
   `frontend/dist` itself, so a single `uvicorn app.main:app --host 0.0.0.0 --port 8000`
   behind an HTTPS proxy (Caddy, nginx, or your host's) runs the whole site.
4. Run **one** backend process. Live Bloom keeps room connections in memory.

## 7. Things you need to set up yourself

| Service | Why | Where |
| --- | --- | --- |
| **TURN server** | Live Bloom can't connect directly on some networks (strict Wi-Fi, many mobile carriers). A TURN relay fixes this. Without one, those calls show "Connection problem". | Run coturn or use a hosted TURN service; set `TURN_URLS` + credentials in `backend/.env` |
| **HTTPS** | Cameras need https:// on anything except localhost | Your host / reverse proxy, or a tunnel for testing |
| **Internet for first run** | Google Fonts, and the MediaPipe hand model download | Automatic; the app falls back to system fonts if offline |

No API keys or paid services are needed for anything else.

## 8. What is and isn't tested

Tested end to end in real browsers (Chromium with simulated cameras), with
two separate browsers for the social parts:

- **Studio:** live SVG preview, recipes, saved designs, transparent PNG/SVG export.
- **Bloom Cam:** camera, upload, drag/resize the flower, shutter, all 10 themes, undo/redo.
- **Journal:** save with albums, search, filters, persistence after sign-out, re-editing
  from the kept original, duplicate/delete, this-device mode after reload.
- **Friends:** requests by Bloom ID.
- **Twin Bloom:** both people's contributions, shared layout/theme picked up by the
  other person, privacy for outsiders, revoking access.
- **Live Bloom:** WebRTC video between two browsers, shared flower/theme/layout,
  capture together, saving, reconnection after one person reloads, outsiders blocked.

Not verified here:

- **Hand tracking (MediaPipe)** is implemented, and its hand-to-flower maths is
  tested with synthetic hands, but the model needs internet, which the build
  machine didn't have. It has not yet been tried with a real hand. If it can't
  load, Bloom says so and you place the flower by dragging.
- **Live Bloom across different networks / TURN:** only tested on one machine.
- **Background replacement** is not implemented. Your photo is always kept as the background.
- **OpenCV:** not used. All photo processing runs in the browser (canvas), so photos
  never need to be uploaded just to preview an effect.

## 9. Troubleshooting

| Problem | Fix |
| --- | --- |
| "Can't reach the Bloom server" | Start the backend (section 3). Bloom keeps working and saves on this device meanwhile. |
| `uvicorn` not found | Activate the virtual environment first: `.\.venv\Scripts\Activate.ps1` |
| Camera says permission declined | Click the camera icon in the address bar → Allow, then press Start camera again. |
| Camera unavailable on phone | Use HTTPS (section 3, "On your phone"). |
| Live room stuck on "Connecting video…" | Both people must be on the room page; on different networks you may need TURN (section 7). |
| Hand tracking won't load | Run `npm install` again while online, or just drag the flower. |
| Port 8000 or 5173 in use | `uvicorn ... --port 8001`, and change the target in `frontend/vite.config.ts`. |
