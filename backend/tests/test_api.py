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

        # removing a friend
        self.assertEqual(a.delete(f"/api/friends/{me_b['bloom_id']}").status_code, 204)
        self.assertEqual(a.get("/api/friends").json()["friends"], [])


if __name__ == "__main__":
    unittest.main()
