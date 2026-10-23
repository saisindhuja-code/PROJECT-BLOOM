"""A small summary of things waiting for you (friend requests, invitations)."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Friendship, LiveRoom, Project, ProjectMember, User
from ..security import current_user
from .live import hub

router = APIRouter(prefix="/api", tags=["inbox"])


@router.get("/inbox")
def inbox(user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict[str, Any]:
    requests = db.scalars(
        select(Friendship).where(Friendship.addressee_id == user.id, Friendship.status == "pending")
    ).all()
    invites = db.scalars(
        select(Project)
        .join(ProjectMember, ProjectMember.project_id == Project.id)
        .where(ProjectMember.user_id == user.id, ProjectMember.status == "invited")
    ).all()
    rooms = db.scalars(select(LiveRoom).where(LiveRoom.guest_id == user.id, LiveRoom.status == "open")).all()
    live = [
        {"id": r.id, "friend": {"bloom_id": r.host.bloom_id, "display_name": r.host.display_name}}
        for r in rooms
        if r.host.bloom_id in hub.online_bloom_ids(r.id)
    ]
    return {
        "friend_requests": [
            {"request_id": f.id, "bloom_id": f.requester.bloom_id, "display_name": f.requester.display_name}
            for f in requests
        ],
        "project_invites": [
            {"id": p.id, "title": p.title, "mode": p.mode, "owner": p.owner.display_name} for p in invites
        ],
        "live_invites": live,
        "count": len(requests) + len(invites) + len(live),
    }
