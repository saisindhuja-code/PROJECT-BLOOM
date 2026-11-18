"""
End-to-end API tests. Run from the backend folder:

    python -m unittest discover -s tests -v

They use a throw-away SQLite database and media folder.
"""

from __future__ import annotations

import io
import os
import shutil
import tempfile
import unittest

TEMP = tempfile.mkdtemp(prefix="bloom-test-")
os.environ["BLOOM_DATA_DIR"] = TEMP
os.environ["BLOOM_SECRET_KEY"] = "test-secret-key-that-is-long-enough-123456"
os.environ.pop("DATABASE_URL", None)

from fastapi.testclient import TestClient  # noqa: E402
from PIL import Image  # noqa: E402

from app.main import app  # noqa: E402
from app.security import reset_login_rate  # noqa: E402

HEADERS = {"X-Bloom-Client": "1"}

import contextlib
import json
import socket
import threading
import time

import uvicorn
from websockets.sync.client import connect as _ws_connect


@contextlib.contextmanager
def live_server():
    """Runs the real app in uvicorn so WebSockets share one event loop, like production."""
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning"))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    for _ in range(100):
        if server.started:
            break
        time.sleep(0.05)
    try:
        yield f"http://127.0.0.1:{port}"
    finally:
        server.should_exit = True
        thread.join(timeout=5)


def ws_connect(url, client, origin="http://localhost:5173"):
    cookie = f"bloom_session={client.cookies.get('bloom_session')}"
    return _ws_connect(url, additional_headers={"Cookie": cookie}, origin=origin, open_timeout=5)


def recv(ws):
    return json.loads(ws.recv(timeout=5))


def send(ws, message):
    ws.send(json.dumps(message))



def png_bytes(color=(200, 80, 120), size=(64, 48)) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", size, color).save(buffer, "PNG")
    return buffer.getvalue()


def recipe(word="love"):
    return {"format": "bloom-flower", "version": 1, "word": word}


class BloomApiTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls._ctx = TestClient(app)
        cls._ctx.__enter__()  # runs startup (migrations)

    @classmethod
    def tearDownClass(cls) -> None:
        cls._ctx.__exit__(None, None, None)
        shutil.rmtree(TEMP, ignore_errors=True)

    def setUp(self) -> None:
        reset_login_rate()

    def client(self, username: str, name: str) -> tuple[TestClient, dict]:
        client = TestClient(app, headers=HEADERS)
        response = client.post(
            "/api/auth/register", json={"username": username, "display_name": name, "password": "petals-123"}
        )
        self.assertEqual(response.status_code, 201, response.text)
        return client, response.json()

    def upload(self, client: TestClient, kind="photo", color=(200, 80, 120)) -> dict:
        response = client.post("/api/media", files={"file": ("p.png", png_bytes(color), "image/png")}, data={"kind": kind})
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()

    # ------------------------------------------------------------------

    def test_01_accounts(self) -> None:
        client, me = self.client("sindhu", "Sindhu")
        self.assertRegex(me["bloom_id"], r"^BLM-[A-Z0-9]{4}-[A-Z0-9]{4}$")
        self.assertEqual(client.get("/api/auth/me").json()["username"], "sindhu")
        # duplicate username
        dup = TestClient(app, headers=HEADERS).post(
            "/api/auth/register", json={"username": "Sindhu", "display_name": "x", "password": "petals-123"}
        )
        self.assertEqual(dup.status_code, 409)
        # wrong password, then right password
        anon = TestClient(app, headers=HEADERS)
        self.assertEqual(anon.post("/api/auth/login", json={"username": "sindhu", "password": "nope-nope"}).status_code, 401)
        self.assertEqual(anon.post("/api/auth/login", json={"username": "sindhu", "password": "petals-123"}).status_code, 200)
        self.assertEqual(anon.post("/api/auth/logout").status_code, 204)
        self.assertEqual(anon.get("/api/auth/me").status_code, 401)
        # CSRF header is required for changes
        bare = TestClient(app)
        self.assertEqual(bare.post("/api/auth/login", json={"username": "sindhu", "password": "petals-123"}).status_code, 403)
        # weak input is rejected
        self.assertEqual(
            anon.post("/api/auth/register", json={"username": "a", "display_name": "x", "password": "short"}).status_code, 422
        )

    def test_02_designs_and_validation(self) -> None:
        client, _ = self.client("designer", "Designer")
        created = client.post("/api/designs", json={"title": "", "recipe": recipe("hello")})
        self.assertEqual(created.status_code, 201, created.text)
        design = created.json()
        self.assertEqual(design["title"], "hello")
        self.assertEqual(design["recipe"]["colors"]["ring1"], "#ffe6f2")  # original colours filled in
        bad = client.post("/api/designs", json={"recipe": {**recipe(), "petalSize": 9}})
        self.assertEqual(bad.status_code, 422)
        bad_color = client.post("/api/designs", json={"recipe": {**recipe(), "colors": {"ring1": "red"}}})
        self.assertEqual(bad_color.status_code, 422)
        updated = client.put(f"/api/designs/{design['id']}", json={"title": "Hi", "recipe": {**recipe("hi"), "rotation": 15}})
        self.assertEqual(updated.json()["recipe"]["rotation"], 15)
        self.assertEqual(len(client.get("/api/designs").json()), 1)
        other, _ = self.client("snoop", "Snoop")
        self.assertEqual(other.get(f"/api/designs/{design['id']}").status_code, 404)
        self.assertEqual(client.delete(f"/api/designs/{design['id']}").status_code, 204)

    def test_03_journal_albums_and_privacy(self) -> None:
        client, _ = self.client("journaler", "Journaler")
        stranger, _ = self.client("stranger", "Stranger")
        photo = self.upload(client)
        original = self.upload(client, kind="original")
        # not an image
        junk = client.post("/api/media", files={"file": ("x.png", b"hello", "image/png")})
        self.assertEqual(junk.status_code, 422)
        album = client.post("/api/albums", json={"name": "Summer"}).json()
        entry = client.post(
            "/api/journal",
            json={
                "entry_type": "photo",
                "title": "Garden day",
                "caption": "roses everywhere",
                "recipe": recipe("rose"),
                "photo_media_id": photo["id"],
                "original_media_id": original["id"],
                "edit_state": {"theme": {"name": "Polaroid"}},
                "album_ids": [album["id"]],
            },
        )
        self.assertEqual(entry.status_code, 201, entry.text)
        entry = entry.json()
        self.assertEqual(entry["album_ids"], [album["id"]])
        # private: strangers cannot see the photo or the entry
        self.assertEqual(client.get(entry["photo_url"]).status_code, 200)
        self.assertEqual(stranger.get(entry["photo_url"]).status_code, 404)
        self.assertEqual(stranger.get(f"/api/journal/{entry['id']}").status_code, 404)
        # strangers cannot attach someone else's media to their own entry
        steal = stranger.post("/api/journal", json={"entry_type": "photo", "photo_media_id": photo["id"]})
        self.assertEqual(steal.status_code, 404)
        # search and filters
        self.assertEqual(len(client.get("/api/journal", params={"q": "roses"}).json()), 1)
        self.assertEqual(len(client.get("/api/journal", params={"q": "polaroid"}).json()), 1)
        self.assertEqual(len(client.get("/api/journal", params={"q": "tulip"}).json()), 0)
        self.assertEqual(len(client.get("/api/journal", params={"album_id": album["id"]}).json()), 1)
        self.assertEqual(len(client.get("/api/journal", params={"type": "flower"}).json()), 0)
        # edit, duplicate, delete
        patched = client.patch(f"/api/journal/{entry['id']}", json={"title": "Garden", "album_ids": []}).json()
        self.assertEqual(patched["title"], "Garden")
        self.assertEqual(patched["album_ids"], [])
        copy = client.post(f"/api/journal/{entry['id']}/duplicate").json()
        self.assertEqual(copy["photo_media_id"], photo["id"])
        self.assertEqual(client.delete(f"/api/journal/{entry['id']}").status_code, 204)
        self.assertEqual(client.get(copy["photo_url"]).status_code, 200)  # still used by the copy
        # dropping the kept original deletes it once unused
        client.patch(f"/api/journal/{copy['id']}", json={"keep_original": False})
        self.assertEqual(client.get(f"/api/media/{original['id']}").status_code, 404)
        self.assertEqual(client.delete(f"/api/journal/{copy['id']}").status_code, 204)
        self.assertEqual(client.get(f"/api/media/{photo['id']}").status_code, 404)
        # flower entry needs a recipe
        self.assertEqual(client.post("/api/journal", json={"entry_type": "flower"}).status_code, 422)
        # oversized edit_state is rejected
        huge = client.post("/api/journal", json={"entry_type": "flower", "recipe": recipe("big"), "edit_state": {"pad": "x" * 70_000}})
        self.assertEqual(huge.status_code, 422)
        # album management
        self.assertEqual(client.post("/api/albums", json={"name": "Summer"}).status_code, 409)
        self.assertEqual(client.patch(f"/api/albums/{album['id']}", json={"name": "Spring"}).json()["name"], "Spring")
        self.assertEqual(stranger.delete(f"/api/albums/{album['id']}").status_code, 404)
        self.assertEqual(client.delete(f"/api/albums/{album['id']}").status_code, 204)

    def test_04_friends_projects_and_live(self) -> None:
        a, me_a = self.client("asha", "Asha")
        b, me_b = self.client("bindu", "Bindu")
        c, me_c = self.client("chitra", "Chitra")

        # lookup by Bloom ID (also accepts lowercase / no dashes)
        found = a.get("/api/users/lookup", params={"bloom_id": me_b["bloom_id"].lower().replace("-", "")})
        self.assertEqual(found.json(), {"bloom_id": me_b["bloom_id"], "display_name": "Bindu", "relation": "none"})
        self.assertNotIn("username", found.json())
        # cannot invite non-friends to anything
        self.assertEqual(
            a.post("/api/projects", json={"title": "x", "mode": "twin", "invite_bloom_id": me_b["bloom_id"]}).status_code, 422
        )
        self.assertEqual(a.post("/api/live/rooms", json={"friend_bloom_id": me_b["bloom_id"]}).status_code, 422)

        request = a.post("/api/friends/requests", json={"bloom_id": me_b["bloom_id"]})
        self.assertEqual(request.json()["status"], "pending")
        incoming = b.get("/api/friends").json()["incoming"]
        self.assertEqual(len(incoming), 1)
        self.assertEqual(b.get("/api/inbox").json()["count"], 1)
        self.assertEqual(c.post(f"/api/friends/requests/{incoming[0]['request_id']}/accept").status_code, 404)
        self.assertEqual(b.post(f"/api/friends/requests/{incoming[0]['request_id']}/accept").status_code, 200)
        self.assertEqual(len(a.get("/api/friends").json()["friends"]), 1)

        # --- Twin Bloom project ---
        project = a.post(
            "/api/projects",
            json={"title": "Us", "mode": "twin", "invite_bloom_id": me_b["bloom_id"], "shared_recipe": recipe("us")},
        ).json()
        pid = project["id"]
        invited_view = b.get(f"/api/projects/{pid}").json()
        self.assertEqual(invited_view["my_status"], "invited")
        self.assertNotIn("contributions", invited_view)  # nothing private before accepting
        self.assertEqual(c.get(f"/api/projects/{pid}").status_code, 404)
        self.assertEqual(b.post(f"/api/projects/{pid}/accept").json()["my_status"], "active")

        photo_a = self.upload(a, kind="contribution")
        photo_b = self.upload(b, kind="contribution", color=(10, 120, 60))
        # b cannot submit a's photo as their own
        self.assertEqual(b.put(f"/api/projects/{pid}/contribution", json={"items": [{"media_id": photo_a["id"]}]}).status_code, 404)
        a.put(f"/api/projects/{pid}/contribution", json={"items": [{"media_id": photo_a["id"], "photo": {"zoom": 1.2}}]})
        view = b.put(
            f"/api/projects/{pid}/contribution",
            json={"items": [{"media_id": photo_b["id"], "flower": {"x": 0.5, "y": 0.6, "scale": 0.4}}]},
        ).json()
        self.assertEqual(len(view["contributions"]), 2)
        # project members can see each other's contributed photos; outsiders cannot
        shared_photo = b.get(photo_a["url"])
        self.assertEqual(shared_photo.status_code, 200)
        self.assertIn("no-cache", shared_photo.headers["cache-control"])  # re-checked on every view
        self.assertEqual(c.get(photo_a["url"]).status_code, 404)
        # twin mode allows one photo each
        two_items = {"items": [{"media_id": photo_b["id"]}, {"media_id": photo_b["id"]}]}
        self.assertEqual(b.put(f"/api/projects/{pid}/contribution", json=two_items).status_code, 422)
        # shared layout / theme, saved to a chosen album
        a.patch(f"/api/projects/{pid}", json={"layout": "polaroid-pair", "theme_state": {"preset": "polaroid"}})
        self.assertEqual(b.get(f"/api/projects/{pid}").json()["layout"], "polaroid-pair")
        album_b = b.post("/api/albums", json={"name": "Together"}).json()
        final_b = self.upload(b, kind="photo")
        saved = b.post(
            "/api/journal",
            json={
                "entry_type": "composition",
                "photo_media_id": final_b["id"],
                "project_id": pid,
                "album_ids": [album_b["id"]],
                "edit_state": {"layout": "polaroid-pair"},
            },
        ).json()
        self.assertEqual({p["display_name"] for p in saved["participants"]}, {"Asha", "Bindu"})
        # owner revokes b: b loses access and b's photos disappear from the project
        self.assertEqual(a.delete(f"/api/projects/{pid}/members/{me_b['bloom_id']}").status_code, 204)
        self.assertEqual(b.get(f"/api/projects/{pid}").status_code, 404)
        self.assertEqual(b.get(photo_a["url"]).status_code, 404)
        self.assertEqual(a.get(photo_b["url"]).status_code, 404)
        self.assertEqual(len(a.get(f"/api/projects/{pid}").json()["contributions"]), 1)
        # b's own journal copy stays b's
        self.assertEqual(b.get(saved["photo_url"]).status_code, 200)
        # invite again, b leaves on their own
        a.post(f"/api/projects/{pid}/invite", json={"bloom_id": me_b["bloom_id"]})
        b.post(f"/api/projects/{pid}/accept")
        self.assertEqual(b.post(f"/api/projects/{pid}/leave").status_code, 204)
        self.assertEqual(a.post(f"/api/projects/{pid}/leave").status_code, 409)
        self.assertEqual(a.delete(f"/api/projects/{pid}").status_code, 204)
        self.assertEqual(a.get(photo_a["url"]).status_code, 404)

        # --- Live Bloom ---
        ice = a.get("/api/live/ice").json()
        self.assertTrue(ice["iceServers"])
        room = a.post("/api/live/rooms", json={"friend_bloom_id": me_b["bloom_id"]}).json()
        self.assertEqual(c.get(f"/api/live/rooms/{room['id']}").status_code, 404)
        with live_server() as base:
            ws_url = base.replace("http", "ws") + f"/api/live/ws/{room['id']}"
            with ws_connect(ws_url, a) as ws_a:
                welcome_a = recv(ws_a)
                self.assertEqual(welcome_a["type"], "welcome")
                self.assertFalse(welcome_a["polite"])
                self.assertEqual(b.get("/api/inbox").json()["live_invites"][0]["id"], room["id"])
                with ws_connect(ws_url, b) as ws_b:
                    welcome_b = recv(ws_b)
                    self.assertTrue(welcome_b["polite"])
                    self.assertEqual(welcome_b["peers"][0]["bloom_id"], me_a["bloom_id"])
                    self.assertEqual(recv(ws_a)["type"], "peer-joined")
                    send(ws_a, {"type": "signal", "data": {"description": {"type": "offer", "sdp": "v=0"}}})
                    relayed = recv(ws_b)
                    self.assertEqual(relayed["type"], "signal")
                    self.assertEqual(relayed["data"]["description"]["type"], "offer")
                    send(ws_b, {"type": "state", "patch": {"theme": "polaroid", "evil": 1}})
                    self.assertEqual(recv(ws_a)["state"], {"theme": "polaroid"})
                    recv(ws_b)  # b also receives the state echo
                    capture = self.upload(b, kind="capture")
                    send(ws_b, {"type": "captured", "round_id": "r1", "media_id": capture["id"]})
                    self.assertEqual(recv(ws_a)["type"], "captured")
                    self.assertEqual(a.get(capture["url"]).status_code, 200)  # shared inside the room
                    self.assertEqual(c.get(capture["url"]).status_code, 404)
                    # a cannot claim b's photo as their own capture: no broadcast follows
                    send(ws_a, {"type": "captured", "round_id": "r2", "media_id": photo_b["id"]})
                    send(ws_a, {"type": "ping"})
                    self.assertEqual(recv(ws_b)["type"], "captured")  # b's own r1 echo
                    self.assertEqual(recv(ws_a)["type"], "pong")
                self.assertEqual(recv(ws_a)["type"], "peer-left")
            # outsiders and foreign origins cannot open the socket
            with self.assertRaises(Exception):
                with ws_connect(ws_url, c) as ws_c:
                    recv(ws_c)
            with self.assertRaises(Exception):
                with ws_connect(ws_url, a, origin="https://evil.example") as ws_e:
                    recv(ws_e)
        self.assertEqual(a.post(f"/api/live/rooms/{room['id']}/close").json()["status"], "closed")
        self.assertEqual(b.get(capture["url"]).status_code, 404)

        # removing a friend
        self.assertEqual(a.delete(f"/api/friends/{me_b['bloom_id']}").status_code, 204)
        self.assertEqual(a.get("/api/friends").json()["friends"], [])


    def test_05_phase1_foundation_audio_security_and_ws(self) -> None:
        a, me_a = self.client("voice_user", "Voice User")
        b, _ = self.client("voice_stranger", "Stranger")

        ogg_opus = b"OggS\x00\x02" + b"\x00" * 22 + b"OpusHead" + b"\x00" * 32
        webm_opus = b"\x1a\x45\xdf\xa3" + b"\x00" * 16 + b"webm" + b"\x00" * 20 + b"A_OPUS" + b"\x00" * 32
        m4a_audio = b"\x00\x00\x00\x18ftypM4A \x00\x00\x00\x00M4A isom" + b"\x00" * 16 + b"mp4a" + b"\x00" * 16
        wav_audio = b"RIFF\x24\x00\x00\x00WAVEfmt " + b"\x00" * 32

        for fname, blob, expected_ct in [
            ("v.ogg", ogg_opus, "audio/ogg"),
            ("v.webm", webm_opus, "audio/webm"),
            ("v.m4a", m4a_audio, "audio/mp4"),
            ("v.wav", wav_audio, "audio/wav"),
        ]:
            up = a.post("/api/media", files={"file": (fname, blob, "application/octet-stream")}, data={"kind": "voice", "duration_ms": "2450"})
            self.assertEqual(up.status_code, 201, up.text)
            info = up.json()
            self.assertEqual(info["content_type"], expected_ct)
            self.assertEqual(info["duration_ms"], 2450)
            r_full = a.get(info["url"])
            self.assertEqual(r_full.status_code, 200)
            self.assertEqual(r_full.headers.get("x-content-type-options"), "nosniff")
            r_range = a.get(info["url"], headers={"Range": "bytes=0-9"})
            self.assertIn(r_range.status_code, (200, 206))
            if r_range.status_code == 206:
                self.assertEqual(len(r_range.content), 10)
            self.assertEqual(b.get(info["url"]).status_code, 404)

        webm_video = b"\x1a\x45\xdf\xa3" + b"\x00" * 16 + b"webm" + b"\x00" * 10 + b"V_VP9" + b"A_OPUS" + b"\x00" * 16
        self.assertEqual(a.post("/api/media", files={"file": ("bad.webm", webm_video, "audio/webm")}, data={"kind": "voice"}).status_code, 422)
        self.assertEqual(a.post("/api/media", files={"file": ("x.ogg", b"<script>alert(1)</script>" * 3, "audio/ogg")}, data={"kind": "voice"}).status_code, 422)
        self.assertEqual(a.post("/api/media", files={"file": ("a.ogg", ogg_opus, "audio/ogg")}, data={"kind": "photo"}).status_code, 422)

        huge_state = a.post("/api/journal", json={"entry_type": "flower", "recipe": recipe("big"), "edit_state": {"pad": "x" * 70_000}})
        self.assertEqual(huge_state.status_code, 422)
        huge_body = a.post("/api/journal", content=b'{"title":"' + b"a" * (2 * 1024 * 1024 + 50) + b'"}', headers={"Content-Type": "application/json", **HEADERS})
        self.assertEqual(huge_body.status_code, 413)

        with live_server() as base:
            ws_url = base.replace("http", "ws") + "/api/ws"
            with ws_connect(ws_url, a) as ws:
                ready = recv(ws)
                self.assertEqual(ready["type"], "ready")
                self.assertEqual(ready["bloom_id"], me_a["bloom_id"])
                send(ws, {"type": "ping"})
                self.assertEqual(recv(ws)["type"], "pong")
            anon = TestClient(app, headers=HEADERS)
            with self.assertRaises(Exception):
                with ws_connect(ws_url, anon) as ws_anon:
                    recv(ws_anon)
            with self.assertRaises(Exception):
                with ws_connect(ws_url, a, origin="https://evil.example") as ws_bad:
                    recv(ws_bad)


    def test_06_phase2_profiles_privacy_and_auth(self) -> None:
        a, me_a = self.client("alice", "Alice")
        b, me_b = self.client("bob", "Bob")
        c, me_c = self.client("carol", "Carol")

        # 1. Avatar upload, replacement cleanup, bio & privacy settings
        av1 = self.upload(a, kind="avatar", color=(180, 90, 140))
        av2 = self.upload(a, kind="avatar", color=(90, 180, 120))
        upd = a.patch(
            "/api/auth/me",
            json={
                "bio": "Growing word flowers in Bengaluru",
                "avatar_media_id": av1["id"],
                "privacy_settings": {
                    "profile_visibility": "friends",
                    "searchable": True,
                    "show_online_status": True,
                    "allow_friend_requests": True,
                },
            },
        )
        self.assertEqual(upd.status_code, 200, upd.text)
        self.assertEqual(upd.json()["avatar_url"], av1["url"])
        self.assertEqual(upd.json()["bio"], "Growing word flowers in Bengaluru")

        # Replacing avatar releases the old avatar media
        upd2 = a.patch("/api/auth/me", json={"avatar_media_id": av2["id"]})
        self.assertEqual(upd2.status_code, 200)
        self.assertEqual(a.get(av1["url"]).status_code, 404)

        # 2. Item visibility & profile privacy enforcement
        a.post("/api/designs", json={"title": "SecretRose", "recipe": recipe("secret"), "visibility": "private"})
        a.post("/api/designs", json={"title": "FriendsRose", "recipe": recipe("friends"), "visibility": "friends"})
        a.post("/api/designs", json={"title": "PublicRose", "recipe": recipe("public"), "visibility": "public"})

        p_priv = self.upload(a, kind="photo", color=(10, 10, 10))
        p_pub = self.upload(a, kind="photo", color=(240, 200, 210))
        o_pub = self.upload(a, kind="original", color=(240, 200, 210))
        alb_pub = a.post("/api/albums", json={"name": "Public Garden", "visibility": "public"}).json()
        a.post("/api/journal", json={"entry_type": "photo", "title": "Private Shot", "photo_media_id": p_priv["id"], "visibility": "private", "album_ids": [alb_pub["id"]]})
        a.post("/api/journal", json={"entry_type": "photo", "title": "Public Shot", "photo_media_id": p_pub["id"], "original_media_id": o_pub["id"], "visibility": "public", "album_ids": [alb_pub["id"]]})

        # While profile_visibility is "friends", non-friend b cannot see bio, avatar, flowers, or entries
        prof_b_before = b.get(f"/api/profiles/{me_a['bloom_id']}").json()
        self.assertFalse(prof_b_before["can_view_profile"])
        self.assertEqual(prof_b_before["bio"], "")
        self.assertIsNone(prof_b_before["avatar_url"])
        self.assertEqual(prof_b_before["flowers"], [])
        self.assertNotIn("username", prof_b_before)
        self.assertEqual(b.get(av2["url"]).status_code, 404)
        self.assertEqual(b.get(p_priv["url"]).status_code, 404)
        self.assertEqual(b.get(o_pub["url"]).status_code, 404)  # original always owner-only

        # Make a and b friends -> b sees friends + public items, still not private items
        req = b.post("/api/friends/requests", json={"bloom_id": me_a["bloom_id"]}).json()
        incoming = a.get("/api/friends").json()["incoming"]
        a.post(f"/api/friends/requests/{incoming[0]['request_id']}/accept")
        prof_b_friend = b.get(f"/api/profiles/{me_a['bloom_id']}").json()
        self.assertTrue(prof_b_friend["can_view_profile"])
        self.assertEqual({f["title"] for f in prof_b_friend["flowers"]}, {"FriendsRose", "PublicRose"})
        self.assertEqual([e["title"] for e in prof_b_friend["entries"]], ["Public Shot"])
        self.assertEqual(prof_b_friend["albums"][0]["entry_count"], 1)  # private entry excluded from public album
        self.assertEqual(b.get(av2["url"]).status_code, 200)
        self.assertEqual(b.get(p_pub["url"]).status_code, 200)
        self.assertEqual(b.get(p_priv["url"]).status_code, 404)

        # Public profile: stranger c sees public items only
        a.patch("/api/auth/me", json={"privacy_settings": {"profile_visibility": "public", "searchable": False, "show_online_status": True, "allow_friend_requests": False}})
        prof_c = c.get(f"/api/profiles/{me_a['bloom_id']}").json()
        self.assertTrue(prof_c["can_view_profile"])
        self.assertEqual([f["title"] for f in prof_c["flowers"]], ["PublicRose"])
        # Non-searchable hides from name search, and allow_friend_requests=False blocks new requests
        self.assertEqual(c.get("/api/profiles/search", params={"q": "Alice"}).json(), [])
        self.assertEqual(c.post("/api/friends/requests", json={"bloom_id": me_a["bloom_id"]}).status_code, 403)
        # Search by name works for searchable accounts without leaking username
        found_b = c.get("/api/profiles/search", params={"q": "Bob"}).json()
        self.assertEqual(len(found_b), 1)
        self.assertNotIn("username", found_b[0])

        # 3. Change password & account deletion with media cleanup
        self.assertEqual(c.post("/api/auth/change-password", json={"current_password": "wrong", "new_password": "new-petals-123"}).status_code, 401)
        self.assertEqual(c.post("/api/auth/change-password", json={"current_password": "petals-123", "new_password": "new-petals-123"}).status_code, 204)
        c2 = TestClient(app, headers=HEADERS)
        self.assertEqual(c2.post("/api/auth/login", json={"username": "carol", "password": "petals-123"}).status_code, 401)
        self.assertEqual(c2.post("/api/auth/login", json={"username": "carol", "password": "new-petals-123"}).status_code, 200)

        # Account deletion checks password and cleans up media
        self.assertEqual(a.post("/api/auth/delete-account", json={"password": "wrong"}).status_code, 401)
        self.assertEqual(a.post("/api/auth/delete-account", json={"password": "petals-123"}).status_code, 204)
        self.assertEqual(a.get("/api/auth/me").status_code, 401)
        self.assertEqual(b.get(p_pub["url"]).status_code, 404)


    def test_07_phase3_follows_reactions_feed_and_notifications(self) -> None:
        a, me_a = self.client("fiona", "Fiona")
        b, me_b = self.client("george", "George")
        c, me_c = self.client("hana", "Hana")

        a.patch("/api/auth/me", json={"privacy_settings": {"profile_visibility": "public", "searchable": True, "show_online_status": True, "allow_friend_requests": True}})
        c.patch("/api/auth/me", json={"privacy_settings": {"profile_visibility": "private", "searchable": False, "show_online_status": True, "allow_friend_requests": True}})

        self.assertEqual(b.post(f"/api/follows/{me_c['bloom_id']}").status_code, 404)
        self.assertEqual(b.post(f"/api/follows/{me_b['bloom_id']}").status_code, 422)
        self.assertEqual(b.post(f"/api/follows/{me_a['bloom_id']}").status_code, 201)
        self.assertEqual(len(b.get("/api/follows").json()["following"]), 1)
        self.assertEqual(len(a.get("/api/follows").json()["followers"]), 1)

        notifs_a = a.get("/api/notifications").json()
        self.assertGreaterEqual(notifs_a["unread_count"], 1)
        self.assertEqual(notifs_a["items"][0]["kind"], "follow")

        d_priv = a.post("/api/designs", json={"title": "QuietLily", "recipe": recipe("quiet"), "visibility": "private"}).json()
        d_pub = a.post("/api/designs", json={"title": "SunLily", "recipe": recipe("sun"), "visibility": "public"}).json()
        d_friends = a.post("/api/designs", json={"title": "MateLily", "recipe": recipe("mate"), "visibility": "friends"}).json()

        self.assertEqual(b.post("/api/reactions", json={"target_type": "design", "target_id": d_priv["id"], "kind": "heart"}).status_code, 404)
        self.assertEqual(b.post("/api/reactions", json={"target_type": "design", "target_id": d_friends["id"], "kind": "heart"}).status_code, 404)

        feed_b = b.get("/api/social/feed").json()["items"]
        self.assertEqual([i["title"] for i in feed_b], ["SunLily"])

        with live_server() as base:
            ws_url = base.replace("http", "ws") + "/api/ws"
            with ws_connect(ws_url, a) as ws_a:
                self.assertEqual(recv(ws_a)["type"], "ready")
                r = b.post("/api/reactions", json={"target_type": "design", "target_id": d_pub["id"], "kind": "bloom"})
                self.assertEqual(r.status_code, 200)
                self.assertEqual(r.json()["total"], 1)
                self.assertEqual(r.json()["my_reaction"], "bloom")
                pushed = recv(ws_a)
                self.assertEqual(pushed["type"], "notification")
                self.assertEqual(pushed["notification"]["kind"], "reaction")

        r2 = b.post("/api/reactions", json={"target_type": "design", "target_id": d_pub["id"], "kind": "bloom"})
        self.assertEqual(r2.json()["total"], 0)
        self.assertIsNone(r2.json()["my_reaction"])

        nid = a.get("/api/notifications").json()["items"][0]["id"]
        self.assertTrue(a.post(f"/api/notifications/{nid}/read").json()["is_read"])
        self.assertEqual(a.post("/api/notifications/read-all").status_code, 204)
        self.assertEqual(a.get("/api/notifications").json()["unread_count"], 0)

        a.patch("/api/notifications/preferences", json={"friend_requests": True, "follows": False, "reactions": True, "messages": True, "projects": True, "live": True})
        b.delete(f"/api/follows/{me_a['bloom_id']}")
        b.post(f"/api/follows/{me_a['bloom_id']}")
        self.assertEqual(a.get("/api/notifications").json()["unread_count"], 0)


    def test_08_phase4_unified_bloom_chat(self) -> None:
        a, me_a = self.client("maya", "Maya")
        b, me_b = self.client("noah", "Noah")
        c, me_c = self.client("olivia", "Olivia")

        # 1. DM requires friendship
        self.assertEqual(a.post("/api/chat/dm", json={"bloom_id": me_b["bloom_id"]}).status_code, 403)
        a.post("/api/friends/requests", json={"bloom_id": me_b["bloom_id"]})
        req = b.get("/api/friends").json()["incoming"][0]["request_id"]
        b.post(f"/api/friends/requests/{req}/accept")

        dm_a = a.post("/api/chat/dm", json={"bloom_id": me_b["bloom_id"]})
        self.assertEqual(dm_a.status_code, 201, dm_a.text)
        dm_id = dm_a.json()["id"]
        self.assertEqual(b.post("/api/chat/dm", json={"bloom_id": me_a["bloom_id"]}).json()["id"], dm_id)

        m1 = a.post(f"/api/chat/conversations/{dm_id}/messages", json={"kind": "text", "body": "Hey Noah!"}).json()
        img = self.upload(a, kind="chat_image")
        m2 = a.post(f"/api/chat/conversations/{dm_id}/messages", json={"kind": "image", "media_id": img["id"], "reply_to_id": m1["id"]}).json()
        ogg = b"OggS\x00\x02" + b"\x00" * 22 + b"OpusHead" + b"\x00" * 32
        voice = a.post("/api/media", files={"file": ("v.ogg", ogg, "audio/ogg")}, data={"kind": "voice", "duration_ms": "1200"}).json()
        m3 = a.post(f"/api/chat/conversations/{dm_id}/messages", json={"kind": "voice", "media_id": voice["id"]}).json()
        design = a.post("/api/designs", json={"title": "Lotus", "recipe": recipe("lotus")}).json()
        m4 = a.post(f"/api/chat/conversations/{dm_id}/messages", json={"kind": "shared", "share_type": "design", "share_id": design["id"]}).json()
        self.assertEqual(m4["shared_ref"]["title"], "Lotus")

        # Privacy checks
        self.assertEqual(b.get(img["url"]).status_code, 200)
        self.assertEqual(b.get(voice["url"]).status_code, 200)
        self.assertEqual(c.get(f"/api/chat/conversations/{dm_id}/messages").status_code, 404)
        self.assertEqual(c.post(f"/api/chat/conversations/{dm_id}/messages", json={"kind": "text", "body": "hi"}).status_code, 404)
        self.assertEqual(c.get(img["url"]).status_code, 404)
        self.assertEqual(c.get(voice["url"]).status_code, 404)

        # Pagination + search + unread + read receipts
        self.assertEqual(b.get("/api/chat/unread-total").json()["unread_count"], 4)
        page1 = b.get(f"/api/chat/conversations/{dm_id}/messages", params={"limit": 2}).json()
        self.assertTrue(page1["has_more"])
        self.assertEqual([m["id"] for m in page1["items"]], [m3["id"], m4["id"]])
        page0 = b.get(f"/api/chat/conversations/{dm_id}/messages", params={"before_id": page1["items"][0]["id"], "limit": 2}).json()
        self.assertEqual([m["id"] for m in page0["items"]], [m1["id"], m2["id"]])
        self.assertEqual(len(b.get("/api/chat/conversations", params={"q": "Noah!"}).json()), 1)

        b.post(f"/api/chat/conversations/{dm_id}/read")
        self.assertEqual(b.get("/api/chat/unread-total").json()["unread_count"], 0)

        # Soft delete frees orphaned media
        self.assertEqual(a.delete(f"/api/chat/messages/{m2['id']}").status_code, 204)
        self.assertEqual(b.get(img["url"]).status_code, 404)

        # 2. Group Chat with roles & permissions
        gav = self.upload(a, kind="avatar")
        grp = a.post("/api/chat/groups", json={"title": "Garden Club", "member_bloom_ids": [me_b["bloom_id"]], "avatar_media_id": gav["id"]}).json()
        gid = grp["id"]
        self.assertEqual(b.get(gav["url"]).status_code, 200)
        self.assertEqual(b.patch(f"/api/chat/groups/{gid}", json={"title": "Hacked"}).status_code, 403)
        self.assertEqual(a.patch(f"/api/chat/groups/{gid}/members/{me_b['bloom_id']}", json={"role": "admin"}).status_code, 200)
        self.assertEqual(b.patch(f"/api/chat/groups/{gid}", json={"title": "Botanical Club"}).json()["raw_title"], "Botanical Club")
        self.assertEqual(a.delete(f"/api/chat/groups/{gid}/members/{me_b['bloom_id']}").status_code, 204)
        self.assertEqual(b.get(f"/api/chat/conversations/{gid}").status_code, 404)
        self.assertEqual(b.get(gav["url"]).status_code, 404)

        # 3. Studio Chat directory & joining
        studio = a.post("/api/chat/studio", json={"title": "Y2K Film Studio", "description": "Share film presets"}).json()
        sid = studio["id"]
        self.assertEqual(len(c.get("/api/chat/studio/directory").json()), 1)
        self.assertEqual(c.get(f"/api/chat/conversations/{sid}/messages").status_code, 404)
        self.assertEqual(c.post(f"/api/chat/studio/{sid}/join").status_code, 200)
        self.assertEqual(c.post(f"/api/chat/conversations/{sid}/messages", json={"kind": "sticker", "sticker_id": "rose"}).status_code, 201)

        # 4. Real-time WebSocket chat delivery, typing & channel authorization
        with live_server() as base:
            ws_url = base.replace("http", "ws") + "/api/ws"
            with ws_connect(ws_url, a) as ws_a, ws_connect(ws_url, b) as ws_b:
                self.assertEqual(recv(ws_a)["type"], "ready")
                self.assertEqual(recv(ws_b)["type"], "ready")
                send(ws_b, {"type": "subscribe", "channel": f"conv:{sid}"})
                self.assertEqual(recv(ws_b)["type"], "error")
                send(ws_a, {"type": "subscribe", "channel": f"conv:{dm_id}"})
                self.assertEqual(recv(ws_a)["type"], "subscribed")
                send(ws_b, {"type": "subscribe", "channel": f"conv:{dm_id}"})
                self.assertEqual(recv(ws_b)["type"], "subscribed")

                send(ws_a, {"type": "typing", "channel": f"conv:{dm_id}", "active": True})
                typ = recv(ws_b)
                self.assertEqual(typ["type"], "typing")
                self.assertEqual(typ["bloom_id"], me_a["bloom_id"])

                sent = a.post(f"/api/chat/conversations/{dm_id}/messages", json={"kind": "text", "body": "Live msg"}).json()
                ev_b = recv(ws_b)
                self.assertEqual(ev_b["type"], "chat.message")
                self.assertEqual(ev_b["message"]["id"], sent["id"])


    def test_09_phase5_studio_recipe_v2_and_themes(self) -> None:
        a, _ = self.client("iris", "Iris")

        # 1. Backward compatibility: v1 recipe without new fields works
        v1_recipe = {"format": "bloom-flower", "version": 1, "word": "vintage"}
        des1 = a.post("/api/designs", json={"title": "V1 Flower", "recipe": v1_recipe}).json()
        self.assertEqual(des1["recipe"]["petalStyle"], "classic")
        self.assertEqual(des1["recipe"]["arrangement"], "rings")
        self.assertEqual(des1["recipe"]["centerText"], "")
        self.assertEqual(des1["recipe"]["stemMessage"], "")

        # 2. Studio 2.0 v2 recipe with petal styles, arrangements, and messages
        v2_recipe = {
            "format": "bloom-flower",
            "version": 2,
            "word": "solace",
            "shape": "flower",
            "petalStyle": "pointed",
            "arrangement": "spiral",
            "centerText": "Bloom 2.0",
            "stemMessage": "For my dearest",
            "themeId": "botanical",
            "bgStyle": "paper",
        }
        des2 = a.post("/api/designs", json={"title": "Botanical Solace", "recipe": v2_recipe}).json()
        self.assertEqual(des2["recipe"]["petalStyle"], "pointed")
        self.assertEqual(des2["recipe"]["arrangement"], "spiral")
        self.assertEqual(des2["recipe"]["centerText"], "Bloom 2.0")
        self.assertEqual(des2["recipe"]["stemMessage"], "For my dearest")
        self.assertEqual(des2["recipe"]["bgStyle"], "paper")

        # 3. Validation rejection on invalid styles or text limits
        bad_style = a.post("/api/designs", json={"recipe": {**v2_recipe, "petalStyle": "extraterrestrial"}})
        self.assertEqual(bad_style.status_code, 422)
        long_msg = a.post("/api/designs", json={"recipe": {**v2_recipe, "stemMessage": "x" * 50}})
        self.assertEqual(long_msg.status_code, 422)


    def test_10_phase6_cam_edit_state_persistence(self) -> None:
        a, _ = self.client("cam2_user", "Cam User")
        photo = self.upload(a, kind="photo")
        orig = self.upload(a, kind="original")
        edit_state = {
            "version": 2,
            "camStyle": "botanical-portrait",
            "crop": {"aspect": "3:4", "top": 0.05, "right": 0.0, "bottom": 0.05, "left": 0.0},
            "theme": {"preset": "botanical", "name": "Botanical Garden", "intensity": 1.0},
            "layers": [
                {"id": "l1", "recipe": recipe("rose"), "placement": {"x": 0.35, "y": 0.5, "size": 0.6}},
                {"id": "l2", "recipe": recipe("lily"), "placement": {"x": 0.7, "y": 0.4, "size": 0.5}},
            ],
            "overlay": {"x": 0.35, "y": 0.5, "size": 0.6},
        }
        created = a.post(
            "/api/journal",
            json={
                "entry_type": "photo",
                "title": "Two Flowers",
                "recipe": recipe("rose"),
                "photo_media_id": photo["id"],
                "original_media_id": orig["id"],
                "edit_state": edit_state,
            },
        )
        self.assertEqual(created.status_code, 201, created.text)
        loaded = a.get(f"/api/journal/{created.json()['id']}").json()
        self.assertEqual(loaded["edit_state"]["camStyle"], "botanical-portrait")
        self.assertEqual(loaded["edit_state"]["crop"]["aspect"], "3:4")
        self.assertEqual(len(loaded["edit_state"]["layers"]), 2)


if __name__ == "__main__":
    unittest.main()
