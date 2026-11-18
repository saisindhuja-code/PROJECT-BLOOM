"""Social feed of shared flowers and journal creations from friends & followed users."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from ..access import can_view_profile, visibility_allows
from ..db import get_db
from ..models import FlowerDesign, Follow, Friendship, JournalEntry, User
from ..security import current_user
from .reactions import reaction_summary

router = APIRouter(prefix="/api/social", tags=["social"])


@router.get("/feed")
def feed(
    kind: str = Query(default="all"),
    limit: int = Query(default=30, ge=1, le=60),
    offset: int = Query(default=0, ge=0),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    friend_links = db.scalars(
        select(Friendship).where(
            Friendship.status == "accepted",
            or_(Friendship.requester_id == user.id, Friendship.addressee_id == user.id),
        )
    ).all()
    friend_ids = {l.addressee_id if l.requester_id == user.id else l.requester_id for l in friend_links}
    following_ids = set(db.scalars(select(Follow.following_id).where(Follow.follower_id == user.id)).all())

    candidate_owner_ids = list(friend_ids | following_ids | {user.id})
    owners = {
        u.id: u
        for u in db.scalars(select(User).where(User.id.in_(candidate_owner_ids))).all()
    }

    items: list[dict[str, Any]] = []
    if kind in {"all", "designs"}:
        designs = db.scalars(
            select(FlowerDesign)
            .where(FlowerDesign.owner_id.in_(candidate_owner_ids), FlowerDesign.visibility.in_(["friends", "public"]))
            .order_by(FlowerDesign.updated_at.desc())
            .limit(80)
        ).all()
        visible_designs = [d for d in designs if visibility_allows(db, d.owner_id, d.visibility, user)]
        d_reacts = reaction_summary(db, "design", [d.id for d in visible_designs], user.id)
        for d in visible_designs:
            owner = owners[d.owner_id]
            av = f"/api/media/{owner.avatar_media_id}" if owner.avatar_media_id and can_view_profile(db, owner, user) else None
            items.append(
                {
                    "item_type": "design",
                    "id": d.id,
                    "title": d.title,
                    "recipe": d.recipe,
                    "visibility": d.visibility,
                    "timestamp": d.updated_at,
                    "author": {"bloom_id": owner.bloom_id, "display_name": owner.display_name, "avatar_url": av},
                    "is_you": owner.id == user.id,
                    "reactions": d_reacts.get(d.id, {"counts": {}, "total": 0, "my_reaction": None}),
                }
            )

    if kind in {"all", "entries"}:
        entries = db.scalars(
            select(JournalEntry)
            .where(JournalEntry.owner_id.in_(candidate_owner_ids), JournalEntry.deleted_at.is_(None), JournalEntry.visibility.in_(["friends", "public"]))
            .order_by(JournalEntry.taken_at.desc(), JournalEntry.id.desc())
            .limit(80)
        ).all()
        visible_entries = [e for e in entries if visibility_allows(db, e.owner_id, e.visibility, user)]
        e_reacts = reaction_summary(db, "entry", [e.id for e in visible_entries], user.id)
        for e in visible_entries:
            owner = owners[e.owner_id]
            av = f"/api/media/{owner.avatar_media_id}" if owner.avatar_media_id and can_view_profile(db, owner, user) else None
            items.append(
                {
                    "item_type": "entry",
                    "id": e.id,
                    "entry_type": e.entry_type,
                    "title": e.title,
                    "caption": e.caption,
                    "notes": e.notes,
                    "recipe": e.recipe,
                    "photo_url": f"/api/media/{e.photo_media_id}" if e.photo_media_id else None,
                    "participants": e.participants or [],
                    "visibility": e.visibility,
                    "timestamp": e.taken_at,
                    "author": {"bloom_id": owner.bloom_id, "display_name": owner.display_name, "avatar_url": av},
                    "is_you": owner.id == user.id,
                    "reactions": e_reacts.get(e.id, {"counts": {}, "total": 0, "my_reaction": None}),
                }
            )

    items.sort(key=lambda item: item["timestamp"], reverse=True)
    page = items[offset : offset + limit]
    return {"items": page, "has_more": len(items) > offset + limit}
