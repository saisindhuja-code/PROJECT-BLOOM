"""Permission checks and shared media cleanup. Private by default."""

from __future__ import annotations

from fastapi import HTTPException, status
from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session

from .models import (
    Contribution,
    Friendship,
    JournalEntry,
    LiveCapture,
    LiveRoom,
    Media,
    Project,
    ProjectMember,
    User,
)
from .schemas import PrivacySettings


def not_found(what: str = "That item") -> HTTPException:
    return HTTPException(status.HTTP_404_NOT_FOUND, f"{what} was not found.")


def privacy_for(user: User) -> PrivacySettings:
    try:
        return PrivacySettings.model_validate(user.privacy_settings or {})
    except Exception:
        return PrivacySettings()


def friendship_between(db: Session, a: int, b: int) -> Friendship | None:
    return db.scalar(
        select(Friendship).where(
            or_(
                and_(Friendship.requester_id == a, Friendship.addressee_id == b),
                and_(Friendship.requester_id == b, Friendship.addressee_id == a),
            )
        )
    )


def relation_between(db: Session, viewer_id: int, target_id: int) -> str:
    if viewer_id == target_id:
        return "self"
    link = friendship_between(db, viewer_id, target_id)
    if link is None:
        return "none"
    if link.status == "accepted":
        return "friend"
    return "request-sent" if link.requester_id == viewer_id else "request-received"


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


def visibility_allows(db: Session, owner_id: int, visibility: str, viewer: User) -> bool:
    if viewer.id == owner_id:
        return True
    if visibility == "public":
        return True
    if visibility == "friends":
        return are_friends(db, owner_id, viewer.id)
    return False


def can_view_profile(db: Session, target: User, viewer: User) -> bool:
    if viewer.id == target.id:
        return True
    vis = privacy_for(target).profile_visibility
    return visibility_allows(db, target.id, vis, viewer)


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

    # Profile avatar: visible when the owner's profile is visible to the viewer.
    if media.kind == "avatar":
        owner = db.get(User, media.owner_id)
        if owner is not None and owner.avatar_media_id == media.id:
            return can_view_profile(db, owner, user)

    # Shared through a project contribution.
    shared_projects = db.scalars(
        select(Contribution.project_id)
        .join(
            ProjectMember,
            and_(
                ProjectMember.project_id == Contribution.project_id,
                ProjectMember.user_id == user.id,
                ProjectMember.status == "active",
            ),
        )
        .where(Contribution.user_id == media.owner_id)
    ).all()
    for project_id in shared_projects:
        contribution = db.scalar(
            select(Contribution).where(Contribution.project_id == project_id, Contribution.user_id == media.owner_id)
        )
        if contribution and any(item.get("media_id") == media.id for item in contribution.items or []):
            if active_membership(db, project_id, media.owner_id) is not None:
                return True

    # Shared inside a live room.
    capture = db.scalar(
        select(LiveCapture)
        .join(LiveRoom, LiveRoom.id == LiveCapture.room_id)
        .where(
            LiveCapture.media_id == media.id,
            or_(LiveRoom.host_id == user.id, LiveRoom.guest_id == user.id),
        )
    )
    if capture is not None:
        return True

    # Public or friends-shared journal entry finished photo (never original_media_id).
    entries = db.scalars(
        select(JournalEntry).where(
            JournalEntry.photo_media_id == media.id,
            JournalEntry.visibility.in_(["public", "friends"]),
        )
    ).all()
    for entry in entries:
        if visibility_allows(db, entry.owner_id, entry.visibility, user):
            return True

    return False


def release_media(db: Session, media_id: int | None, doomed: list[str]) -> None:
    """
    Removes an upload once nothing refers to it any more. The stored file's key
    is added to `doomed`; delete those only after the database commit.
    """
    if media_id is None:
        return
    media = db.get(Media, media_id)
    if media is None:
        return
    used_as_avatar = db.scalar(select(User.id).where(User.avatar_media_id == media_id))
    still_used = db.scalar(
        select(JournalEntry.id).where(
            or_(JournalEntry.photo_media_id == media_id, JournalEntry.original_media_id == media_id)
        )
    )
    in_capture = db.scalar(select(LiveCapture.id).where(LiveCapture.media_id == media_id))
    in_contribution = any(
        item.get("media_id") == media_id
        for contribution in db.scalars(select(Contribution).where(Contribution.user_id == media.owner_id))
        for item in contribution.items or []
    )
    if used_as_avatar or still_used or in_capture or in_contribution:
        return
    doomed.append(media.storage_key)
    db.delete(media)
