"""
Shared WebSocket hub for Bloom 2.0 real-time features:
- Authenticated user sockets (notifications, chat message/unread events)
- Verified channel subscriptions (conv:{id}, project:{id})
- Typing indicators, live Twin Bloom draft sync, project presence & online status
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections import defaultdict
from typing import Any

import anyio
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from fastapi.concurrency import run_in_threadpool
from sqlalchemy import or_, select

from .config import settings
from .db import SessionLocal
from .models import ConversationMember, Friendship, ProjectMember, User
from .schemas import PrivacySettings
from .security import user_from_token

router = APIRouter(tags=["realtime"])
log = logging.getLogger("bloom.realtime")

MAX_WS_MESSAGE_BYTES = 64 * 1024


def ws_origin_allowed(websocket: WebSocket) -> bool:
    origin = websocket.headers.get("origin")
    if origin is None:
        return True
    host = websocket.headers.get("host", "")
    if origin.split("://", 1)[-1] == host:
        return True
    return origin in settings.allowed_origins


class ConnectionHub:
    """In-memory pub/sub manager for authenticated users and channel rooms."""

    def __init__(self) -> None:
        self._user_sockets: dict[int, set[WebSocket]] = defaultdict(set)
        self._channels: dict[str, set[WebSocket]] = defaultdict(set)
        self._socket_channels: dict[WebSocket, set[str]] = defaultdict(set)
        self._socket_bloom: dict[WebSocket, str] = {}
        self._lock = asyncio.Lock()

    def is_online(self, user_id: int) -> bool:
        return bool(self._user_sockets.get(user_id))

    def online_user_ids(self, user_ids: list[int]) -> list[int]:
        return [uid for uid in user_ids if self.is_online(uid)]

    def has_channel_subscribers(self, channel: str) -> bool:
        return bool(self._channels.get(channel))

    def channel_bloom_ids(self, channel: str) -> list[str]:
        return sorted({self._socket_bloom[s] for s in self._channels.get(channel, ()) if s in self._socket_bloom})

    async def connect(self, user_id: int, bloom_id: str, socket: WebSocket) -> None:
        async with self._lock:
            self._user_sockets[user_id].add(socket)
            self._socket_bloom[socket] = bloom_id

    async def disconnect(self, user_id: int, socket: WebSocket) -> list[str]:
        async with self._lock:
            sockets = self._user_sockets.get(user_id)
            if sockets:
                sockets.discard(socket)
                if not sockets:
                    del self._user_sockets[user_id]
            self._socket_bloom.pop(socket, None)
            channels = list(self._socket_channels.pop(socket, ()))
            for ch in channels:
                members = self._channels.get(ch)
                if members:
                    members.discard(socket)
                    if not members:
                        del self._channels[ch]
            return channels

    async def subscribe(self, channel: str, socket: WebSocket) -> None:
        async with self._lock:
            self._channels[channel].add(socket)
            self._socket_channels[socket].add(channel)

    async def unsubscribe(self, channel: str, socket: WebSocket) -> None:
        async with self._lock:
            members = self._channels.get(channel)
            if members:
                members.discard(socket)
                if not members:
                    del self._channels[channel]
            chans = self._socket_channels.get(socket)
            if chans:
                chans.discard(channel)

    async def send_socket(self, socket: WebSocket, message: dict[str, Any]) -> bool:
        try:
            await socket.send_text(json.dumps(message, default=str))
            return True
        except Exception:
            return False

    async def send_user(self, user_id: int, message: dict[str, Any]) -> None:
        sockets = list(self._user_sockets.get(user_id, ()))
        for sock in sockets:
            await self.send_socket(sock, message)

    async def broadcast_channel(
        self, channel: str, message: dict[str, Any], exclude: WebSocket | None = None
    ) -> None:
        sockets = list(self._channels.get(channel, ()))
        for sock in sockets:
            if sock is not exclude:
                await self.send_socket(sock, message)


connection_hub = ConnectionHub()


def notify_user_sync(user_id: int, message: dict[str, Any]) -> None:
    if not connection_hub.is_online(user_id):
        return
    try:
        anyio.from_thread.run(connection_hub.send_user, user_id, message)
    except Exception:
        pass


def broadcast_channel_sync(channel: str, message: dict[str, Any]) -> None:
    if not connection_hub.has_channel_subscribers(channel):
        return
    try:
        anyio.from_thread.run(connection_hub.broadcast_channel, channel, message)
    except Exception:
        pass


async def notify_user_async(user_id: int, message: dict[str, Any]) -> None:
    if connection_hub.is_online(user_id):
        await connection_hub.send_user(user_id, message)


def _authenticate_ws(token: str | None) -> tuple[int, str, str] | None:
    with SessionLocal() as db:
        user = user_from_token(db, token)
        if user is None:
            return None
        return user.id, user.bloom_id, user.display_name


def _can_join_channel(user_id: int, channel: str) -> bool:
    parts = channel.split(":", 1)
    if len(parts) != 2 or not parts[1].isdigit():
        return False
    kind, target_id = parts[0], int(parts[1])
    with SessionLocal() as db:
        if kind == "conv":
            return (
                db.scalar(
                    select(ConversationMember.id).where(
                        ConversationMember.conversation_id == target_id,
                        ConversationMember.user_id == user_id,
                    )
                )
                is not None
            )
        if kind == "project":
            return (
                db.scalar(
                    select(ProjectMember.id).where(
                        ProjectMember.project_id == target_id,
                        ProjectMember.user_id == user_id,
                        ProjectMember.status == "active",
                    )
                )
                is not None
            )
    return False


def _visible_online_bloom_ids(viewer_id: int, bloom_ids: list[str]) -> list[str]:
    clean_ids = [str(bid)[:16] for bid in bloom_ids[:60] if isinstance(bid, str)]
    if not clean_ids:
        return []
    with SessionLocal() as db:
        targets = db.scalars(select(User).where(User.bloom_id.in_(clean_ids))).all()
        friend_links = db.scalars(
            select(Friendship).where(
                Friendship.status == "accepted",
                or_(Friendship.requester_id == viewer_id, Friendship.addressee_id == viewer_id),
            )
        ).all()
        friend_ids = {l.addressee_id if l.requester_id == viewer_id else l.requester_id for l in friend_links}
        viewer_convs = set(
            db.scalars(select(ConversationMember.conversation_id).where(ConversationMember.user_id == viewer_id)).all()
        )
        shared_member_ids = (
            set(
                db.scalars(
                    select(ConversationMember.user_id).where(ConversationMember.conversation_id.in_(viewer_convs))
                ).all()
            )
            if viewer_convs
            else set()
        )
        online: list[str] = []
        for t in targets:
            if t.id != viewer_id and t.id not in friend_ids and t.id not in shared_member_ids:
                continue
            try:
                priv = PrivacySettings.model_validate(t.privacy_settings or {})
            except Exception:
                priv = PrivacySettings()
            if priv.show_online_status and connection_hub.is_online(t.id):
                online.append(t.bloom_id)
        return online


async def _emit_project_presence(channel: str) -> None:
    if channel.startswith("project:"):
        await connection_hub.broadcast_channel(
            channel,
            {"type": "project.presence", "channel": channel, "online": connection_hub.channel_bloom_ids(channel)},
        )


@router.websocket("/api/ws")
async def user_socket(websocket: WebSocket) -> None:
    if not ws_origin_allowed(websocket):
        await websocket.close(code=4003, reason="Origin not allowed")
        return
    auth = await run_in_threadpool(_authenticate_ws, websocket.cookies.get(settings.cookie_name))
    if auth is None:
        await websocket.close(code=4003, reason="Authentication required")
        return
    user_id, bloom_id, display_name = auth
    await websocket.accept()
    await connection_hub.connect(user_id, bloom_id, websocket)
    await connection_hub.send_socket(websocket, {"type": "ready", "bloom_id": bloom_id})
    try:
        while True:
            raw = await websocket.receive_text()
            if len(raw) > MAX_WS_MESSAGE_BYTES:
                continue
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue
            if not isinstance(msg, dict):
                continue
            kind = msg.get("type")
            if kind == "ping":
                await connection_hub.send_socket(websocket, {"type": "pong"})
            elif kind == "subscribe":
                channel = str(msg.get("channel", ""))[:40]
                if await run_in_threadpool(_can_join_channel, user_id, channel):
                    await connection_hub.subscribe(channel, websocket)
                    await connection_hub.send_socket(websocket, {"type": "subscribed", "channel": channel})
                    await _emit_project_presence(channel)
                else:
                    await connection_hub.send_socket(websocket, {"type": "error", "detail": "Not allowed in that channel."})
            elif kind == "unsubscribe":
                channel = str(msg.get("channel", ""))[:40]
                await connection_hub.unsubscribe(channel, websocket)
                await _emit_project_presence(channel)
            elif kind == "typing":
                channel = str(msg.get("channel", ""))[:40]
                if await run_in_threadpool(_can_join_channel, user_id, channel):
                    await connection_hub.broadcast_channel(
                        channel,
                        {
                            "type": "typing",
                            "channel": channel,
                            "bloom_id": bloom_id,
                            "display_name": display_name,
                            "active": bool(msg.get("active", True)),
                        },
                        exclude=websocket,
                    )
            elif kind == "project.draft":
                channel = str(msg.get("channel", ""))[:40]
                if channel.startswith("project:") and await run_in_threadpool(_can_join_channel, user_id, channel):
                    await connection_hub.broadcast_channel(
                        channel,
                        {
                            "type": "project.draft",
                            "channel": channel,
                            "bloom_id": bloom_id,
                            "display_name": display_name,
                            "recipe": msg.get("recipe"),
                        },
                        exclude=websocket,
                    )
            elif kind == "presence":
                ids = msg.get("bloom_ids")
                if isinstance(ids, list):
                    online = await run_in_threadpool(_visible_online_bloom_ids, user_id, ids)
                    await connection_hub.send_socket(websocket, {"type": "presence", "online": online})
    except WebSocketDisconnect:
        pass
    except Exception:  # pragma: no cover
        log.exception("realtime socket error")
    finally:
        left_channels = await connection_hub.disconnect(user_id, websocket)
        for ch in left_channels:
            await _emit_project_presence(ch)
