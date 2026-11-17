"""Reactions on shared flower designs and journal entries."""

from __future__ import annotations

from collections import defaultdict
from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..access import not_found, visibility_allows
from ..db import get_db
from ..models import FlowerDesign, JournalEntry, Reaction, User
from ..notifications import emit_notification, push_pending
from ..schemas import ReactionIn
from ..security import current_user

router = APIRouter(prefix="/api/reactions", tags=["reactions"])


def reaction_summary(
    db: Session, target_type: str, target_ids: list[int], viewer_id: int
) -> dict[int, dict[str, Any]]:
    result: dict[int, dict[str, Any]] = {
        tid: {"counts": {}, "total": 0, "my_reaction": None} for tid in target_ids
    }
    if not target_ids:
        return result
    rows = db.scalars(
        select(Reaction).where(Reaction.target_type == target_type, Reaction.target_id.in_(target_ids))
    ).all()
    counts_by_id: dict[int, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for row in rows:
        counts_by_id[row.target_id][row.kind] += 1
        result[row.target_id]["total"] += 1
        if row.user_id == viewer_id:
            result[row.target_id]["my_reaction"] = row.kind
    for tid, counts in counts_by_id.items():
        result[tid]["counts"] = dict(counts)
    return result


def _load_target(db: Session, target_type: str, target_id: int, viewer: User) -> tuple[int, str, str]:
    if target_type == "design":
        design = db.get(FlowerDesign, target_id)
        if design is None or not visibility_allows(db, design.owner_id, design.visibility, viewer):
            raise not_found("That flower")
        owner = db.get(User, design.owner_id)
        return design.owner_id, design.title or "your flower", f"/profile/{owner.bloom_id if owner else ''}"
    entry = db.get(JournalEntry, target_id)
    if entry is None or not visibility_allows(db, entry.owner_id, entry.visibility, viewer):
        raise not_found("That entry")
    return entry.owner_id, entry.title or "your journal page", f"/journal/{entry.id}"


@router.post("")
def toggle_reaction(body: ReactionIn, user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict[str, Any]:
    owner_id, label, owner_link = _load_target(db, body.target_type, body.target_id, user)
    existing = db.scalar(
        select(Reaction).where(
            Reaction.user_id == user.id,
            Reaction.target_type == body.target_type,
            Reaction.target_id == body.target_id,
        )
    )
    ev = None
    if existing is not None:
        if existing.kind == body.kind:
            db.delete(existing)
        else:
            existing.kind = body.kind
    else:
        db.add(
            Reaction(
                user_id=user.id,
                target_type=body.target_type,
                target_id=body.target_id,
                kind=body.kind,
            )
        )
        owner = db.get(User, owner_id)
        if owner is not None:
            ev = emit_notification(
                db,
                owner,
                user,
                kind="reaction",
                title=f"{user.display_name} reacted ({body.kind}) to {label}",
                link=owner_link,
                target_type=body.target_type,
                target_id=body.target_id,
            )
    db.commit()
    push_pending([ev])
    return reaction_summary(db, body.target_type, [body.target_id], user.id)[body.target_id]
