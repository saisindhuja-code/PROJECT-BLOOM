"""Helper for persistent notifications + live WebSocket push."""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from .models import Notification, User
from .realtime import notify_user_async, notify_user_sync
from .schemas import NotificationPreferences

PREF_KEY_BY_KIND = {
    "friend_request": "friend_requests",
    "friend_accepted": "friend_requests",
    "follow": "follows",
    "reaction": "reactions",
    "message": "messages",
    "group_message": "messages",
    "studio_message": "messages",
    "project_invite": "projects",
    "project_activity": "projects",
    "live_invite": "live",
}


def preferences_for(user: User) -> NotificationPreferences:
    try:
        return NotificationPreferences.model_validate(user.notification_preferences or {})
    except Exception:
        return NotificationPreferences()


def notification_out(n: Notification) -> dict[str, Any]:
    return {
        "id": n.id,
        "kind": n.kind,
        "title": n.title,
        "body": n.body,
        "link": n.link,
        "target_type": n.target_type,
        "target_id": n.target_id,
        "is_read": n.is_read,
        "created_at": n.created_at,
        "actor": (
            {"bloom_id": n.actor.bloom_id, "display_name": n.actor.display_name}
            if n.actor is not None
            else None
        ),
    }


def emit_notification(
    db: Session,
    recipient: User,
    actor: User | None,
    kind: str,
    title: str,
    body: str = "",
    link: str = "",
    target_type: str | None = None,
    target_id: str | int | None = None,
) -> dict[str, Any] | None:
    if actor is not None and actor.id == recipient.id:
        return None
    pref_key = PREF_KEY_BY_KIND.get(kind)
    prefs = preferences_for(recipient)
    if pref_key and not getattr(prefs, pref_key, True):
        return None
    row = Notification(
        user_id=recipient.id,
        actor_id=actor.id if actor else None,
        kind=kind,
        title=title[:120],
        body=body[:300],
        link=link[:200],
        target_type=target_type,
        target_id=str(target_id)[:48] if target_id is not None else None,
    )
    db.add(row)
    db.flush()
    return {"user_id": recipient.id, "payload": {"type": "notification", "notification": notification_out(row)}}


def push_pending(events: list[dict[str, Any] | None]) -> None:
    for ev in events:
        if ev is not None:
            notify_user_sync(ev["user_id"], ev["payload"])


async def push_pending_async(events: list[dict[str, Any] | None]) -> None:
    for ev in events:
        if ev is not None:
            await notify_user_async(ev["user_id"], ev["payload"])
