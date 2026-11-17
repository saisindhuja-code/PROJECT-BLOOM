"""
Shared WebSocket hub for Bloom 2.0 real-time features:
- Authenticated user sockets (notifications, presence, multi-tab updates)
- Channel subscriptions (Bloom Chat conversations, Bloom Together projects)
- Shared WebSocket Origin validation
"""

from __future__ import annotations

import asyncio
import json
import logging

import anyio
from collections import defaultdict
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from fastapi.concurrency import run_in_threadpool

from .config import settings
from .db import SessionLocal
from .security import user_from_token

router = APIRouter(tags=["realtime"])
log = logging.getLogger("bloom.realtime")

MAX_WS_MESSAGE_BYTES = 64 * 1024


def ws_origin_allowed(websocket: WebSocket) -> bool:
    origin = websocket.headers.get("origin")
    if origin is None:
        return True  # non-browser clients send no Origin; they still require a valid session cookie
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
        self._lock = asyncio.Lock()

    def is_online(self, user_id: int) -> bool:
        return bool(self._user_sockets.get(user_id))

    def online_user_ids(self, user_ids: list[int]) -> list[int]:
        return [uid for uid in user_ids if self.is_online(uid)]

    async def connect(self, user_id: int, socket: WebSocket) -> None:
        async with self._lock:
            self._user_sockets[user_id].add(socket)

    async def disconnect(self, user_id: int, socket: WebSocket) -> list[str]:
        async with self._lock:
            sockets = self._user_sockets.get(user_id)
            if sockets:
                sockets.discard(socket)
                if not sockets:
                    del self._user_sockets[user_id]
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


async def notify_user_async(user_id: int, message: dict[str, Any]) -> None:
    if connection_hub.is_online(user_id):
        await connection_hub.send_user(user_id, message)


def _authenticate_ws(token: str | None) -> tuple[int, str, str] | None:
    with SessionLocal() as db:
        user = user_from_token(db, token)
        if user is None:
            return None
        return user.id, user.bloom_id, user.display_name


@router.websocket("/api/ws")
async def user_socket(websocket: WebSocket) -> None:
    """Persistent authenticated user socket for real-time Bloom 2.0 events."""
    if not ws_origin_allowed(websocket):
        await websocket.close(code=4003, reason="Origin not allowed")
        return
    auth = await run_in_threadpool(_authenticate_ws, websocket.cookies.get(settings.cookie_name))
    if auth is None:
        await websocket.close(code=4003, reason="Authentication required")
        return
    user_id, bloom_id, _display_name = auth
    await websocket.accept()
    await connection_hub.connect(user_id, websocket)
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
            if msg.get("type") == "ping":
                await connection_hub.send_socket(websocket, {"type": "pong"})
    except WebSocketDisconnect:
        pass
    except Exception:  # pragma: no cover
        log.exception("realtime socket error")
    finally:
        await connection_hub.disconnect(user_id, websocket)
