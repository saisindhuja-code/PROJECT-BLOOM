"""
Live Bloom: private real-time rooms for two friends.

- REST endpoints create/close rooms and hand out ICE (STUN/TURN) settings.
- A WebSocket per room carries WebRTC signalling (offers, answers, ICE
  candidates) and the shared session state (flower, theme, layout, capture
  rounds). Audio/video itself flows directly between the browsers (or via
  TURN), never through this server.

The hub keeps connections in memory, so run a single backend process (the
default). Scaling out would need a shared message bus such as Redis.
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import json
import logging
import secrets
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect, status
from fastapi.concurrency import run_in_threadpool
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from ..access import are_friends, not_found
from ..config import settings
from ..db import SessionLocal, get_db
from ..models import LiveCapture, LiveRoom, Media, User
from ..schemas import LiveRoomIn
from ..security import current_user, user_from_token
from .friends import find_by_bloom_id

router = APIRouter(prefix="/api/live", tags=["live"])
log = logging.getLogger("bloom.live")

MAX_MESSAGE_BYTES = 64 * 1024


def room_out(room: LiveRoom, viewer: User) -> dict[str, Any]:
    other = room.guest if room.host_id == viewer.id else room.host
    return {
        "id": room.id,
        "status": room.status,
        "is_host": room.host_id == viewer.id,
        "friend": {"bloom_id": other.bloom_id, "display_name": other.display_name},
        "created_at": room.created_at,
        "online": hub.online_bloom_ids(room.id),
    }


def _member_room(db: Session, room_id: str, user: User) -> LiveRoom:
    room = db.get(LiveRoom, room_id)
    if room is None or user.id not in (room.host_id, room.guest_id):
        raise not_found("That live room")
    return room


@router.get("/ice")
def ice_config(user: User = Depends(current_user)) -> dict[str, Any]:
    servers: list[dict[str, Any]] = []
    if settings.stun_urls:
        servers.append({"urls": settings.stun_urls})
    if settings.turn_urls:
        if settings.turn_shared_secret:
            # coturn "use-auth-secret": short-lived credentials, nothing long-lived reaches the browser.
            username = f"{int(time.time()) + 6 * 3600}:{user.bloom_id}"
            digest = hmac.new(settings.turn_shared_secret.encode(), username.encode(), hashlib.sha1).digest()
            servers.append({"urls": settings.turn_urls, "username": username, "credential": base64.b64encode(digest).decode()})
        elif settings.turn_username and settings.turn_credential:
            servers.append(
                {"urls": settings.turn_urls, "username": settings.turn_username, "credential": settings.turn_credential}
            )
    return {"iceServers": servers, "hasTurn": any("username" in s for s in servers)}


@router.get("/rooms")
def list_rooms(user: User = Depends(current_user), db: Session = Depends(get_db)) -> list[dict[str, Any]]:
    rooms = db.scalars(
        select(LiveRoom)
        .where(LiveRoom.status == "open", or_(LiveRoom.host_id == user.id, LiveRoom.guest_id == user.id))
        .order_by(LiveRoom.created_at.desc())
    ).all()
    return [room_out(r, user) for r in rooms]


@router.post("/rooms", status_code=status.HTTP_201_CREATED)
def create_room(body: LiveRoomIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    friend = find_by_bloom_id(db, body.friend_bloom_id)
    if friend is None or not are_friends(db, user.id, friend.id):
        raise HTTPException(422, "Live rooms are for friends. Add them by Bloom ID first.")
    existing = db.scalar(
        select(LiveRoom).where(
            LiveRoom.status == "open",
            or_(
                (LiveRoom.host_id == user.id) & (LiveRoom.guest_id == friend.id),
                (LiveRoom.host_id == friend.id) & (LiveRoom.guest_id == user.id),
            ),
        )
    )
    if existing is not None:
        return room_out(existing, user)
    room = LiveRoom(id=secrets.token_urlsafe(9), host_id=user.id, guest_id=friend.id)
    db.add(room)
    db.commit()
    return room_out(room, user)


@router.get("/rooms/{room_id}")
def get_room(room_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return room_out(_member_room(db, room_id, user), user)


@router.post("/rooms/{room_id}/close")
async def close_room(room_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    room = _member_room(db, room_id, user)
    room.status = "closed"
    room.closed_at = datetime.now(timezone.utc)
    db.commit()
    await hub.close_room(room_id, "The room was closed.")
    return room_out(room, user)


# ---------------------------------------------------------------------------
# WebSocket hub
# ---------------------------------------------------------------------------


@dataclass
class Peer:
    user_id: int
    bloom_id: str
    display_name: str
    socket: WebSocket


@dataclass
class RoomState:
    peers: dict[int, Peer] = field(default_factory=dict)
    shared: dict[str, Any] = field(default_factory=dict)
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)


class LiveHub:
    def __init__(self) -> None:
        self.rooms: dict[str, RoomState] = {}

    def online_bloom_ids(self, room_id: str) -> list[str]:
        room = self.rooms.get(room_id)
        return [p.bloom_id for p in room.peers.values()] if room else []

    async def send(self, peer: Peer, message: dict[str, Any]) -> None:
        try:
            await peer.socket.send_text(json.dumps(message, default=str))
        except Exception:  # the socket is closing; its own handler cleans up
            pass

    async def broadcast(self, room_id: str, message: dict[str, Any], exclude: int | None = None) -> None:
        room = self.rooms.get(room_id)
        if not room:
            return
        for peer in list(room.peers.values()):
            if peer.user_id != exclude:
                await self.send(peer, message)

    async def join(self, room_id: str, peer: Peer) -> RoomState:
        room = self.rooms.setdefault(room_id, RoomState())
        async with room.lock:
            old = room.peers.get(peer.user_id)
            room.peers[peer.user_id] = peer
        if old is not None:
            try:
                await old.socket.close(code=4001, reason="Opened in another tab")
            except Exception:
                pass
        return room

    async def leave(self, room_id: str, peer: Peer) -> None:
        room = self.rooms.get(room_id)
        if not room:
            return
        async with room.lock:
            if room.peers.get(peer.user_id) is peer:
                del room.peers[peer.user_id]
            empty = not room.peers
        if empty:
            self.rooms.pop(room_id, None)
        else:
            await self.broadcast(room_id, {"type": "peer-left", "bloom_id": peer.bloom_id})

    async def close_room(self, room_id: str, reason: str) -> None:
        room = self.rooms.pop(room_id, None)
        if not room:
            return
        for peer in list(room.peers.values()):
            await self.send(peer, {"type": "closed", "reason": reason})
            try:
                await peer.socket.close(code=4004, reason="Room closed")
            except Exception:
                pass


hub = LiveHub()

ALLOWED_STATE_KEYS = {"recipe", "theme", "layout", "mode"}


def _clean_placement(raw: Any) -> dict[str, float] | None:
    """Only small numeric flower-placement settings are relayed."""
    if not isinstance(raw, dict):
        return None
    clean: dict[str, float] = {}
    for key, value in list(raw.items())[:16]:
        if isinstance(value, (int, float)) and not isinstance(value, bool) and abs(value) < 1e6:
            clean[str(key)[:20]] = float(value)
    return clean


def _origin_allowed(websocket: WebSocket) -> bool:
    origin = websocket.headers.get("origin")
    if origin is None:
        return True  # non-browser clients send no Origin; they still need the session cookie
    host = websocket.headers.get("host", "")
    if origin.split("://", 1)[-1] == host:
        return True
    return origin in settings.allowed_origins


def _load_member(room_id: str, token: str | None) -> tuple[User, LiveRoom] | None:
    with SessionLocal() as db:
        user = user_from_token(db, token)
        if user is None:
            return None
        room = db.get(LiveRoom, room_id)
        if room is None or room.status != "open" or user.id not in (room.host_id, room.guest_id):
            return None
        db.expunge_all()
        return user, room


def _record_capture(room_id: str, user_id: int, media_id: int, round_id: str, placement: dict[str, float] | None) -> bool:
    with SessionLocal() as db:
        media = db.get(Media, media_id)
        if media is None or media.owner_id != user_id:
            return False
        db.add(LiveCapture(room_id=room_id, user_id=user_id, media_id=media_id, round_id=round_id[:24], placement=placement))
        db.commit()
        return True


def _room_captures(room_id: str) -> list[dict[str, Any]]:
    with SessionLocal() as db:
        rows = db.execute(
            select(LiveCapture, User.bloom_id)
            .join(User, User.id == LiveCapture.user_id)
            .where(LiveCapture.room_id == room_id)
            .order_by(LiveCapture.id)
        ).all()
        return [
            {
                "round_id": c.round_id,
                "bloom_id": bloom_id,
                "media_id": c.media_id,
                "media_url": f"/api/media/{c.media_id}",
                "placement": c.placement,
            }
            for c, bloom_id in rows
        ]


@router.websocket("/ws/{room_id}")
async def live_socket(websocket: WebSocket, room_id: str) -> None:
    if not _origin_allowed(websocket):
        await websocket.close(code=4003, reason="Origin not allowed")
        return
    member = await run_in_threadpool(_load_member, room_id, websocket.cookies.get(settings.cookie_name))
    if member is None:
        await websocket.close(code=4003, reason="Not allowed in this room")
        return
    user, room_row = member
    await websocket.accept()
    peer = Peer(user.id, user.bloom_id, user.display_name, websocket)
    room = await hub.join(room_id, peer)
    others = [p for p in room.peers.values() if p.user_id != user.id]
    await hub.send(
        peer,
        {
            "type": "welcome",
            "you": {"bloom_id": user.bloom_id, "display_name": user.display_name},
            "polite": user.id == room_row.guest_id,  # the guest yields during offer collisions
            "peers": [{"bloom_id": p.bloom_id, "display_name": p.display_name} for p in others],
            "state": room.shared,
            "captures": await run_in_threadpool(_room_captures, room_id),
        },
    )
    await hub.broadcast(
        room_id,
        {"type": "peer-joined", "peer": {"bloom_id": user.bloom_id, "display_name": user.display_name}},
        exclude=user.id,
    )
    try:
        while True:
            raw = await websocket.receive_text()
            if len(raw) > MAX_MESSAGE_BYTES:
                continue
            try:
                message = json.loads(raw)
            except json.JSONDecodeError:
                continue
            if not isinstance(message, dict):
                continue
            kind = message.get("type")
            if kind == "ping":
                await hub.send(peer, {"type": "pong"})
            elif kind == "signal":
                await hub.broadcast(
                    room_id, {"type": "signal", "from": user.bloom_id, "data": message.get("data")}, exclude=user.id
                )
            elif kind == "devices":
                await hub.broadcast(
                    room_id,
                    {
                        "type": "devices",
                        "bloom_id": user.bloom_id,
                        "camera": bool(message.get("camera")),
                        "mic": bool(message.get("mic")),
                    },
                    exclude=user.id,
                )
            elif kind == "state":
                patch = message.get("patch")
                if isinstance(patch, dict):
                    # Shared keys anyone may change, plus your own flower placement.
                    own_key = f"placement:{user.bloom_id}"
                    clean = {k: v for k, v in patch.items() if k in ALLOWED_STATE_KEYS or k == own_key}
                    room.shared.update(clean)
                    await hub.broadcast(room_id, {"type": "state", "state": room.shared, "by": user.bloom_id})
            elif kind == "capture":
                round_id = str(message.get("round_id", ""))[:24]
                seconds = min(max(int(message.get("seconds", 3)), 0), 10)
                if round_id:
                    await hub.broadcast(
                        room_id,
                        {"type": "capture", "round_id": round_id, "seconds": seconds, "by": user.bloom_id,
                         "together": bool(message.get("together", True))},
                    )
            elif kind == "captured":
                round_id = str(message.get("round_id", ""))[:24]
                media_id = message.get("media_id")
                placement = _clean_placement(message.get("placement"))
                if round_id and isinstance(media_id, int):
                    ok = await run_in_threadpool(_record_capture, room_id, user.id, media_id, round_id, placement)
                    if ok:
                        await hub.broadcast(
                            room_id,
                            {
                                "type": "captured",
                                "round_id": round_id,
                                "bloom_id": user.bloom_id,
                                "media_id": media_id,
                                "media_url": f"/api/media/{media_id}",
                                "placement": placement,
                            },
                        )
    except WebSocketDisconnect:
        pass
    except Exception:  # pragma: no cover - log unexpected socket errors
        log.exception("live socket error")
    finally:
        await hub.leave(room_id, peer)
