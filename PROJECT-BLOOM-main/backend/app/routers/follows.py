"""One-way following relationships."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..access import can_view_profile, not_found
from ..db import get_db
from ..models import Follow, User
from ..notifications import emit_notification, push_pending
from ..security import current_user
from .friends import find_by_bloom_id, public_with_avatar

router = APIRouter(prefix="/api/follows", tags=["follows"])


@router.get("")
def list_follows(user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict[str, list[dict[str, Any]]]:
    following_rows = db.scalars(
        select(Follow).where(Follow.follower_id == user.id).order_by(Follow.created_at.desc())
    ).all()
    follower_rows = db.scalars(
        select(Follow).where(Follow.following_id == user.id).order_by(Follow.created_at.desc())
    ).all()
    return {
        "following": [
            {**public_with_avatar(db, row.following, user), "since": row.created_at}
            for row in following_rows
        ],
        "followers": [
            {**public_with_avatar(db, row.follower, user), "since": row.created_at}
            for row in follower_rows
        ],
    }


@router.post("/{bloom_id}", status_code=status.HTTP_201_CREATED)
def follow_user(bloom_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict[str, Any]:
    target = find_by_bloom_id(db, bloom_id)
    if target is None or not can_view_profile(db, target, user):
        raise not_found("That profile")
    if target.id == user.id:
        raise HTTPException(422, "You can't follow yourself.")
    existing = db.scalar(
        select(Follow).where(Follow.follower_id == user.id, Follow.following_id == target.id)
    )
    if existing is not None:
        return {"following": True, "bloom_id": target.bloom_id}
    db.add(Follow(follower_id=user.id, following_id=target.id))
    ev = emit_notification(
        db,
        target,
        user,
        kind="follow",
        title=f"{user.display_name} started following you",
        link=f"/profile/{user.bloom_id}",
        target_type="user",
        target_id=user.bloom_id,
    )
    db.commit()
    push_pending([ev])
    return {"following": True, "bloom_id": target.bloom_id}


@router.delete("/{bloom_id}", status_code=status.HTTP_204_NO_CONTENT)
def unfollow_user(bloom_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)) -> None:
    target = find_by_bloom_id(db, bloom_id)
    if target is None:
        raise not_found("That profile")
    existing = db.scalar(
        select(Follow).where(Follow.follower_id == user.id, Follow.following_id == target.id)
    )
    if existing is None:
        raise not_found("That follow")
    db.delete(existing)
    db.commit()
