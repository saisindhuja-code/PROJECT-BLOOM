"""Permission checks shared by the routers. Private by default."""

from __future__ import annotations

from fastapi import HTTPException, status
from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session

from .models import (
    Contribution,
    Friendship,
    LiveCapture,
    LiveRoom,
    Media,
    Project,
    ProjectMember,
    User,
)


def not_found(what: str = "That item") -> HTTPException:
    # 404 instead of 403 so people cannot probe for other users' private items.
    return HTTPException(status.HTTP_404_NOT_FOUND, f"{what} was not found.")


def are_friends(db: Session, a: int, b: int) -> bool:
    return (
        db.scalar(
            select(Friendship.id).where(
                Friendship.status == "accepted",
                or_(
                    and_(Friendship.requester_id == a, Friendship.addressee_id == b),
                    and_(Friendship.requester_id == b, Friendship.addressee_id == a),
                ),
            )
        )
        is not None
    )


def active_membership(db: Session, project_id: int, user_id: int) -> ProjectMember | None:
    return db.scalar(
        select(ProjectMember).where(
            ProjectMember.project_id == project_id,
            ProjectMember.user_id == user_id,
            ProjectMember.status == "active",
        )
    )


def require_active_member(db: Session, project_id: int, user: User) -> Project:
    project = db.get(Project, project_id)
    if project is None or active_membership(db, project_id, user.id) is None:
        raise not_found("That project")
    return project


def require_owned_media(db: Session, media_id: int | None, user: User) -> Media | None:
    if media_id is None:
        return None
    media = db.get(Media, media_id)
    if media is None or media.owner_id != user.id:
        raise not_found("That image")
    return media


def can_view_media(db: Session, media: Media, user: User) -> bool:
    if media.owner_id == user.id:
        return True
    # Shared through a project: the media is in someone's contribution and
    # both people are active members of that project.
    shared_projects = db.scalars(
        select(Contribution.project_id).join(
            ProjectMember,
            and_(
                ProjectMember.project_id == Contribution.project_id,
                ProjectMember.user_id == user.id,
                ProjectMember.status == "active",
            ),
        ).where(Contribution.user_id == media.owner_id)
    ).all()
    for project_id in shared_projects:
        contribution = db.scalar(
            select(Contribution).where(Contribution.project_id == project_id, Contribution.user_id == media.owner_id)
        )
        if contribution and any(item.get("media_id") == media.id for item in contribution.items or []):
            owner_still_member = active_membership(db, project_id, media.owner_id)
            if owner_still_member is not None:
                return True
    # Shared inside a live room that both people belong to.
    capture = db.scalar(
        select(LiveCapture)
        .join(LiveRoom, LiveRoom.id == LiveCapture.room_id)
        .where(
            LiveCapture.media_id == media.id,
            or_(LiveRoom.host_id == user.id, LiveRoom.guest_id == user.id),
        )
    )
    return capture is not None
