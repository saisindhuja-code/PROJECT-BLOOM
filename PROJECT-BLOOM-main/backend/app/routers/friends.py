"""Bloom IDs and the friend network."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from ..access import can_view_profile, friendship_between, not_found, privacy_for, relation_between
from ..db import get_db
from ..models import Friendship, User
from ..schemas import FriendRequestIn
from ..security import current_user, normalize_bloom_id

router = APIRouter(prefix="/api", tags=["friends"])


def public(user: User) -> dict[str, str]:
    return {"bloom_id": user.bloom_id, "display_name": user.display_name}


def public_with_avatar(db: Session, target: User, viewer: User) -> dict[str, Any]:
    avatar_url = (
        f"/api/media/{target.avatar_media_id}"
        if target.avatar_media_id and can_view_profile(db, target, viewer)
        else None
    )
    return {**public(target), "avatar_url": avatar_url}


def find_by_bloom_id(db: Session, raw: str) -> User | None:
    bloom_id = normalize_bloom_id(raw)
    return db.scalar(select(User).where(User.bloom_id == bloom_id)) if bloom_id else None


@router.get("/users/lookup")
def lookup(bloom_id: str = Query(max_length=20), user: User = Depends(current_user), db: Session = Depends(get_db)):
    other = find_by_bloom_id(db, bloom_id)
    if other is None:
        raise not_found("No one with that Bloom ID")
    return {**public(other), "relation": relation_between(db, user.id, other.id)}


@router.get("/friends")
def friends(user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict[str, list[dict[str, Any]]]:
    links = db.scalars(
        select(Friendship).where(or_(Friendship.requester_id == user.id, Friendship.addressee_id == user.id))
    ).all()
    result: dict[str, list[dict[str, Any]]] = {"friends": [], "incoming": [], "outgoing": []}
    for link in links:
        other = link.addressee if link.requester_id == user.id else link.requester
        item = {"request_id": link.id, **public_with_avatar(db, other, user), "since": link.responded_at or link.created_at}
        if link.status == "accepted":
            result["friends"].append(item)
        elif link.addressee_id == user.id:
            result["incoming"].append(item)
        else:
            result["outgoing"].append(item)
    for items in result.values():
        items.sort(key=lambda i: i["display_name"].lower())
    return result


@router.post("/friends/requests", status_code=status.HTTP_201_CREATED)
def send_request(body: FriendRequestIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    other = find_by_bloom_id(db, body.bloom_id)
    if other is None:
        raise not_found("No one with that Bloom ID")
    if other.id == user.id:
        raise HTTPException(422, "That's your own Bloom ID.")
    link = friendship_between(db, user.id, other.id)
    if link is not None:
        if link.status == "accepted":
            raise HTTPException(status.HTTP_409_CONFLICT, "You're already friends.")
        if link.requester_id == other.id:
            link.status = "accepted"
            link.responded_at = datetime.now(timezone.utc)
            db.commit()
            return {"status": "accepted", **public(other)}
        raise HTTPException(status.HTTP_409_CONFLICT, "Your request is already waiting for them.")
    if not privacy_for(other).allow_friend_requests:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This person isn't accepting friend requests right now.")
    db.add(Friendship(requester_id=user.id, addressee_id=other.id))
    db.commit()
    return {"status": "pending", **public(other)}


def _incoming(db: Session, request_id: int, user: User) -> Friendship:
    link = db.get(Friendship, request_id)
    if link is None or link.addressee_id != user.id or link.status != "pending":
        raise not_found("That friend request")
    return link


@router.post("/friends/requests/{request_id}/accept")
def accept(request_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    link = _incoming(db, request_id, user)
    link.status = "accepted"
    link.responded_at = datetime.now(timezone.utc)
    db.commit()
    return {"status": "accepted", **public(link.requester)}


@router.post("/friends/requests/{request_id}/decline", status_code=status.HTTP_204_NO_CONTENT)
def decline(request_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)) -> None:
    db.delete(_incoming(db, request_id, user))
    db.commit()


@router.delete("/friends/requests/{request_id}", status_code=status.HTTP_204_NO_CONTENT)
def cancel(request_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)) -> None:
    link = db.get(Friendship, request_id)
    if link is None or link.requester_id != user.id or link.status != "pending":
        raise not_found("That friend request")
    db.delete(link)
    db.commit()


@router.delete("/friends/{bloom_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_friend(bloom_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)) -> None:
    other = find_by_bloom_id(db, bloom_id)
    link = friendship_between(db, user.id, other.id) if other else None
    if link is None or link.status != "accepted":
        raise not_found("That friend")
    db.delete(link)
    db.commit()
