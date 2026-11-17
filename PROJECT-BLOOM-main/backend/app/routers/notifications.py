"""Persistent notification history, unread counts, and preferences."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from ..access import not_found
from ..db import get_db
from ..models import Notification, User
from ..notifications import notification_out, preferences_for
from ..schemas import NotificationPreferences
from ..security import current_user

router = APIRouter(prefix="/api/notifications", tags=["notifications"])


@router.get("")
def list_notifications(
    unread_only: bool = False,
    limit: int = Query(default=40, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    query = select(Notification).where(Notification.user_id == user.id)
    if unread_only:
        query = query.where(Notification.is_read.is_(False))
    items = db.scalars(
        query.order_by(Notification.created_at.desc(), Notification.id.desc()).offset(offset).limit(limit)
    ).all()
    unread_count = int(
        db.scalar(
            select(func.count(Notification.id)).where(
                Notification.user_id == user.id,
                Notification.is_read.is_(False),
            )
        )
        or 0
    )
    return {
        "items": [notification_out(n) for n in items],
        "unread_count": unread_count,
    }


@router.post("/{notification_id}/read")
def mark_read(
    notification_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)
) -> dict[str, Any]:
    row = db.get(Notification, notification_id)
    if row is None or row.user_id != user.id:
        raise not_found("That notification")
    row.is_read = True
    db.commit()
    return notification_out(row)


@router.post("/read-all", status_code=status.HTTP_204_NO_CONTENT)
def mark_all_read(user: User = Depends(current_user), db: Session = Depends(get_db)) -> None:
    db.execute(
        update(Notification)
        .where(Notification.user_id == user.id, Notification.is_read.is_(False))
        .values(is_read=True)
    )
    db.commit()


@router.delete("/{notification_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_notification(
    notification_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)
) -> None:
    row = db.get(Notification, notification_id)
    if row is None or row.user_id != user.id:
        raise not_found("That notification")
    db.delete(row)
    db.commit()


@router.get("/preferences", response_model=NotificationPreferences)
def get_preferences(user: User = Depends(current_user)) -> NotificationPreferences:
    return preferences_for(user)


@router.patch("/preferences", response_model=NotificationPreferences)
def update_preferences(
    body: NotificationPreferences, user: User = Depends(current_user), db: Session = Depends(get_db)
) -> NotificationPreferences:
    user.notification_preferences = body.model_dump()
    db.commit()
    return preferences_for(user)
