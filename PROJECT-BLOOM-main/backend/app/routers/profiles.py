"""User profiles, Bloom ID discovery, and privacy-scoped flowers & collections."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from ..access import (
    can_view_profile,
    friendship_between,
    not_found,
    privacy_for,
    relation_between,
    visibility_allows,
)
from ..db import get_db
from ..models import Album, FlowerDesign, Follow, Friendship, JournalEntry, User
from .reactions import reaction_summary
from ..security import current_user, normalize_bloom_id
from .friends import find_by_bloom_id

router = APIRouter(prefix="/api/profiles", tags=["profiles"])


def _friend_count(db: Session, user_id: int) -> int:
    return int(
        db.scalar(
            select(func.count(Friendship.id)).where(
                Friendship.status == "accepted",
                or_(Friendship.requester_id == user_id, Friendship.addressee_id == user_id),
            )
        )
        or 0
    )


def _shared_entry_out(entry: JournalEntry, reactions: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": entry.id,
        "entry_type": entry.entry_type,
        "title": entry.title,
        "caption": entry.caption,
        "notes": entry.notes,
        "taken_at": entry.taken_at,
        "recipe": entry.recipe,
        "photo_url": f"/api/media/{entry.photo_media_id}" if entry.photo_media_id else None,
        "visibility": entry.visibility,
        "album_ids": [a.id for a in entry.albums],
        "reactions": reactions,
    }


@router.get("/search")
def search_profiles(
    q: str = Query(min_length=1, max_length=48),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> list[dict[str, Any]]:
    needle = q.strip()
    if not needle:
        return []
    exact_id = normalize_bloom_id(needle)
    candidates: list[User] = []
    if exact_id:
        match = db.scalar(select(User).where(User.bloom_id == exact_id))
        if match is not None:
            candidates.append(match)
    else:
        rows = db.scalars(
            select(User)
            .where(func.lower(User.display_name).contains(needle.lower()))
            .order_by(User.display_name)
            .limit(40)
        ).all()
        candidates.extend(rows)

    results: list[dict[str, Any]] = []
    for candidate in candidates:
        if candidate.id == user.id:
            continue
        priv = privacy_for(candidate)
        relation = relation_between(db, user.id, candidate.id)
        if not exact_id and not priv.searchable and relation != "friend":
            continue
        visible = can_view_profile(db, candidate, user)
        results.append(
            {
                "bloom_id": candidate.bloom_id,
                "display_name": candidate.display_name,
                "avatar_url": f"/api/media/{candidate.avatar_media_id}" if visible and candidate.avatar_media_id else None,
                "relation": relation,
                "allow_friend_requests": priv.allow_friend_requests,
            }
        )
        if len(results) >= 20:
            break
    return results


@router.get("/{bloom_id}")
def get_profile(
    bloom_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)
) -> dict[str, Any]:
    target = find_by_bloom_id(db, bloom_id)
    if target is None:
        raise not_found("That profile")

    relation = relation_between(db, user.id, target.id)
    link = friendship_between(db, user.id, target.id) if target.id != user.id else None
    priv = privacy_for(target)
    visible = can_view_profile(db, target, user)
    is_following = (
        db.scalar(select(Follow.id).where(Follow.follower_id == user.id, Follow.following_id == target.id)) is not None
        if target.id != user.id
        else False
    )
    follows_you = (
        db.scalar(select(Follow.id).where(Follow.follower_id == target.id, Follow.following_id == user.id)) is not None
        if target.id != user.id
        else False
    )

    base: dict[str, Any] = {
        "bloom_id": target.bloom_id,
        "display_name": target.display_name,
        "is_you": target.id == user.id,
        "relation": relation,
        "is_following": is_following,
        "follows_you": follows_you,
        "request_id": link.id if link and link.status == "pending" else None,
        "can_view_profile": visible,
        "allow_friend_requests": priv.allow_friend_requests,
        "profile_visibility": priv.profile_visibility if target.id == user.id else None,
        "created_at": target.created_at,
    }
    if not visible:
        return {
            **base,
            "bio": "",
            "avatar_url": None,
            "friend_count": None,
            "follower_count": None,
            "following_count": None,
            "flowers": [],
            "albums": [],
            "entries": [],
        }

    visible_designs = [
        d
        for d in db.scalars(
            select(FlowerDesign).where(FlowerDesign.owner_id == target.id).order_by(FlowerDesign.updated_at.desc())
        ).all()
        if visibility_allows(db, target.id, d.visibility, user)
    ]
    d_reacts = reaction_summary(db, "design", [d.id for d in visible_designs], user.id)
    flowers = [
        {
            "id": d.id,
            "title": d.title,
            "recipe": d.recipe,
            "visibility": d.visibility,
            "updated_at": d.updated_at,
            "reactions": d_reacts.get(d.id, {"counts": {}, "total": 0, "my_reaction": None}),
        }
        for d in visible_designs
    ]

    all_entries = [
        e
        for e in db.scalars(
            select(JournalEntry)
            .where(JournalEntry.owner_id == target.id)
            .order_by(JournalEntry.taken_at.desc(), JournalEntry.id.desc())
        ).all()
        if visibility_allows(db, target.id, e.visibility, user)
    ]
    e_reacts = reaction_summary(db, "entry", [e.id for e in all_entries[:40]], user.id)
    follower_count = int(db.scalar(select(func.count(Follow.id)).where(Follow.following_id == target.id)) or 0)
    following_count = int(db.scalar(select(func.count(Follow.id)).where(Follow.follower_id == target.id)) or 0)

    albums = []
    for a in db.scalars(select(Album).where(Album.owner_id == target.id).order_by(Album.name)).all():
        if not visibility_allows(db, target.id, a.visibility, user):
            continue
        album_entries = [e for e in all_entries if any(ea.id == a.id for ea in e.albums)]
        albums.append(
            {
                "id": a.id,
                "name": a.name,
                "visibility": a.visibility,
                "entry_count": len(album_entries),
            }
        )

    return {
        **base,
        "bio": target.bio or "",
        "avatar_url": f"/api/media/{target.avatar_media_id}" if target.avatar_media_id else None,
        "friend_count": _friend_count(db, target.id),
        "follower_count": follower_count,
        "following_count": following_count,
        "flowers": flowers,
        "albums": albums,
        "entries": [_shared_entry_out(e, e_reacts.get(e.id, {"counts": {}, "total": 0, "my_reaction": None})) for e in all_entries[:40]],
    }
