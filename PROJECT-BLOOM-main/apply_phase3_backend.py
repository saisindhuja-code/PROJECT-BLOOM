"""Phase 3A (Backend) implementation script for Bloom 2.0."""

from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent


def write_full(rel: str, content: str) -> None:
    path = ROOT / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content.lstrip("\n"), encoding="utf-8")
    print(f"Wrote   {rel}")


def patch(rel: str, replacements: list[tuple[str, str]]) -> None:
    path = ROOT / rel
    if not path.exists():
        raise FileNotFoundError(f"Missing expected file: {path}")
    text = path.read_text(encoding="utf-8")
    for idx, (old, new) in enumerate(replacements, start=1):
        if new in text:
            print(f"Skipped {rel} (step {idx} already present)")
            continue
        if old not in text:
            raise RuntimeError(f"Could not find target block #{idx} in {rel}")
        text = text.replace(old, new, 1)
    path.write_text(text, encoding="utf-8")
    print(f"Patched {rel}")


def main() -> None:
    if not (ROOT / "backend" / "app").is_dir():
        sys.exit("Run apply_phase3_backend.py directly inside PROJECT-BLOOM-main.")

    # 1. models.py (includes Follow, Reaction, Notification)
    write_full(
        "backend/app/models.py",
        r'''
"""Database tables. Every private thing has an owner_id and is checked on access."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    bloom_id: Mapped[str] = mapped_column(String(16), unique=True, index=True)
    username: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    display_name: Mapped[str] = mapped_column(String(48))
    bio: Mapped[str] = mapped_column(String(500), default="")
    avatar_media_id: Mapped[int | None] = mapped_column(ForeignKey("media.id", ondelete="SET NULL"), nullable=True)
    privacy_settings: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    notification_preferences: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    password_hash: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class FlowerDesign(Base):
    __tablename__ = "flower_designs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(80))
    recipe: Mapped[dict[str, Any]] = mapped_column(JSON)
    visibility: Mapped[str] = mapped_column(String(12), default="private")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class Media(Base):
    __tablename__ = "media"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(20))
    storage_key: Mapped[str] = mapped_column(String(255), unique=True)
    content_type: Mapped[str] = mapped_column(String(40))
    width: Mapped[int] = mapped_column(Integer)
    height: Mapped[int] = mapped_column(Integer)
    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    size_bytes: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class MediaBlob(Base):
    __tablename__ = "media_blobs"

    key: Mapped[str] = mapped_column(String(255), primary_key=True)
    data: Mapped[bytes] = mapped_column(LargeBinary)


class Album(Base):
    __tablename__ = "albums"
    __table_args__ = (UniqueConstraint("owner_id", "name", name="uq_album_owner_name"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(60))
    visibility: Mapped[str] = mapped_column(String(12), default="private")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class JournalEntry(Base):
    __tablename__ = "journal_entries"
    __table_args__ = (Index("ix_journal_entries_owner_taken", "owner_id", "taken_at"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    entry_type: Mapped[str] = mapped_column(String(20))
    title: Mapped[str] = mapped_column(String(120), default="")
    caption: Mapped[str] = mapped_column(String(500), default="")
    notes: Mapped[str] = mapped_column(Text, default="")
    taken_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    recipe: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    photo_media_id: Mapped[int | None] = mapped_column(ForeignKey("media.id", ondelete="SET NULL"), nullable=True)
    original_media_id: Mapped[int | None] = mapped_column(ForeignKey("media.id", ondelete="SET NULL"), nullable=True)
    edit_state: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    project_id: Mapped[int | None] = mapped_column(ForeignKey("projects.id", ondelete="SET NULL"), nullable=True)
    participants: Mapped[list[Any] | None] = mapped_column(JSON, nullable=True)
    visibility: Mapped[str] = mapped_column(String(12), default="private")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    albums: Mapped[list[Album]] = relationship(secondary="album_entries", lazy="selectin")


class AlbumEntry(Base):
    __tablename__ = "album_entries"

    album_id: Mapped[int] = mapped_column(ForeignKey("albums.id", ondelete="CASCADE"), primary_key=True)
    entry_id: Mapped[int] = mapped_column(ForeignKey("journal_entries.id", ondelete="CASCADE"), primary_key=True)


class Friendship(Base):
    __tablename__ = "friendships"
    __table_args__ = (UniqueConstraint("requester_id", "addressee_id", name="uq_friend_pair"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    requester_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    addressee_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    status: Mapped[str] = mapped_column(String(12), default="pending")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    responded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    requester: Mapped[User] = relationship(foreign_keys=[requester_id], lazy="joined")
    addressee: Mapped[User] = relationship(foreign_keys=[addressee_id], lazy="joined")


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(80))
    mode: Mapped[str] = mapped_column(String(12))
    shared_recipe: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    layout: Mapped[str] = mapped_column(String(24), default="side-by-side")
    theme_state: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    owner: Mapped[User] = relationship(lazy="joined")
    members: Mapped[list[ProjectMember]] = relationship(
        back_populates="project", cascade="all, delete-orphan", lazy="selectin"
    )
    contributions: Mapped[list[Contribution]] = relationship(
        back_populates="project", cascade="all, delete-orphan", lazy="selectin"
    )


class ProjectMember(Base):
    __tablename__ = "project_members"
    __table_args__ = (UniqueConstraint("project_id", "user_id", name="uq_project_member"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    role: Mapped[str] = mapped_column(String(10))
    status: Mapped[str] = mapped_column(String(10))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    project: Mapped[Project] = relationship(back_populates="members")
    user: Mapped[User] = relationship(lazy="joined")


class Contribution(Base):
    __tablename__ = "contributions"
    __table_args__ = (UniqueConstraint("project_id", "user_id", name="uq_contribution_member"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    items: Mapped[list[Any]] = mapped_column(JSON, default=list)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    project: Mapped[Project] = relationship(back_populates="contributions")


class LiveRoom(Base):
    __tablename__ = "live_rooms"

    id: Mapped[str] = mapped_column(String(24), primary_key=True)
    host_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    guest_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    status: Mapped[str] = mapped_column(String(10), default="open")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    host: Mapped[User] = relationship(foreign_keys=[host_id], lazy="joined")
    guest: Mapped[User] = relationship(foreign_keys=[guest_id], lazy="joined")


class LiveCapture(Base):
    __tablename__ = "live_captures"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    room_id: Mapped[str] = mapped_column(ForeignKey("live_rooms.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    media_id: Mapped[int] = mapped_column(ForeignKey("media.id", ondelete="CASCADE"), index=True)
    round_id: Mapped[str] = mapped_column(String(24))
    placement: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Follow(Base):
    """One-way following relationship."""

    __tablename__ = "follows"
    __table_args__ = (UniqueConstraint("follower_id", "following_id", name="uq_follow_pair"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    follower_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    following_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    follower: Mapped[User] = relationship(foreign_keys=[follower_id], lazy="joined")
    following: Mapped[User] = relationship(foreign_keys=[following_id], lazy="joined")


class Reaction(Base):
    """One reaction per user on a shared flower design or journal entry."""

    __tablename__ = "reactions"
    __table_args__ = (
        UniqueConstraint("user_id", "target_type", "target_id", name="uq_reaction_user_target"),
        Index("ix_reactions_target", "target_type", "target_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    target_type: Mapped[str] = mapped_column(String(16))  # design | entry
    target_id: Mapped[int] = mapped_column(Integer)
    kind: Mapped[str] = mapped_column(String(16))  # heart | bloom | sparkle | leaf
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Notification(Base):
    """Persistent real-time notification."""

    __tablename__ = "notifications"
    __table_args__ = (Index("ix_notifications_user_read_created", "user_id", "is_read", "created_at"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    actor_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    kind: Mapped[str] = mapped_column(String(24))
    title: Mapped[str] = mapped_column(String(120))
    body: Mapped[str] = mapped_column(String(300), default="")
    link: Mapped[str] = mapped_column(String(200), default="")
    target_type: Mapped[str | None] = mapped_column(String(24), nullable=True)
    target_id: Mapped[str | None] = mapped_column(String(48), nullable=True)
    is_read: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    actor: Mapped[User | None] = relationship(foreign_keys=[actor_id], lazy="joined")
''',
    )

    # 2. migration 0005
    write_full(
        "backend/migrations/versions/0005_phase3_social_notifications.py",
        r'''
"""phase 3: follows, reactions, persistent notifications and preferences

Revision ID: 0005
Revises: 0004
Create Date: 2026-11-16 02:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0005'
down_revision: Union[str, Sequence[str], None] = '0004'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.add_column(
            sa.Column('notification_preferences', sa.JSON(), nullable=False, server_default=sa.text("'{}'"))
        )

    op.create_table(
        'follows',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('follower_id', sa.Integer(), nullable=False),
        sa.Column('following_id', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['follower_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['following_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('follower_id', 'following_id', name='uq_follow_pair'),
    )
    with op.batch_alter_table('follows', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_follows_follower_id'), ['follower_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_follows_following_id'), ['following_id'], unique=False)

    op.create_table(
        'reactions',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('target_type', sa.String(length=16), nullable=False),
        sa.Column('target_id', sa.Integer(), nullable=False),
        sa.Column('kind', sa.String(length=16), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('user_id', 'target_type', 'target_id', name='uq_reaction_user_target'),
    )
    with op.batch_alter_table('reactions', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_reactions_user_id'), ['user_id'], unique=False)
        batch_op.create_index('ix_reactions_target', ['target_type', 'target_id'], unique=False)

    op.create_table(
        'notifications',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('actor_id', sa.Integer(), nullable=True),
        sa.Column('kind', sa.String(length=24), nullable=False),
        sa.Column('title', sa.String(length=120), nullable=False),
        sa.Column('body', sa.String(length=300), nullable=False),
        sa.Column('link', sa.String(length=200), nullable=False),
        sa.Column('target_type', sa.String(length=24), nullable=True),
        sa.Column('target_id', sa.String(length=48), nullable=True),
        sa.Column('is_read', sa.Boolean(), nullable=False, server_default=sa.text('0')),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['actor_id'], ['users.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    with op.batch_alter_table('notifications', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_notifications_user_id'), ['user_id'], unique=False)
        batch_op.create_index('ix_notifications_user_read_created', ['user_id', 'is_read', 'created_at'], unique=False)


def downgrade() -> None:
    with op.batch_alter_table('notifications', schema=None) as batch_op:
        batch_op.drop_index('ix_notifications_user_read_created')
        batch_op.drop_index(batch_op.f('ix_notifications_user_id'))
    op.drop_table('notifications')

    with op.batch_alter_table('reactions', schema=None) as batch_op:
        batch_op.drop_index('ix_reactions_target')
        batch_op.drop_index(batch_op.f('ix_reactions_user_id'))
    op.drop_table('reactions')

    with op.batch_alter_table('follows', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_follows_following_id'))
        batch_op.drop_index(batch_op.f('ix_follows_follower_id'))
    op.drop_table('follows')

    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.drop_column('notification_preferences')
''',
    )

    # 3. schemas.py
    patch(
        "backend/app/schemas.py",
        [
            (
                "class LiveRoomIn(BaseModel):\n    friend_bloom_id: str = Field(max_length=20)",
                r'''class LiveRoomIn(BaseModel):
    friend_bloom_id: str = Field(max_length=20)


ReactionKind = Literal["heart", "bloom", "sparkle", "leaf"]
ReactionTarget = Literal["design", "entry"]


class ReactionIn(BaseModel):
    target_type: ReactionTarget
    target_id: int
    kind: ReactionKind


class NotificationPreferences(BaseModel):
    model_config = ConfigDict(extra="ignore")
    friend_requests: bool = True
    follows: bool = True
    reactions: bool = True
    messages: bool = True
    projects: bool = True
    live: bool = True''',
            ),
        ],
    )

    # 4. realtime.py
    patch(
        "backend/app/realtime.py",
        [
            ("import asyncio\nimport json\nimport logging", "import asyncio\nimport json\nimport logging\n\nimport anyio"),
            (
                "connection_hub = ConnectionHub()",
                r'''connection_hub = ConnectionHub()


def notify_user_sync(user_id: int, message: dict[str, Any]) -> None:
    if not connection_hub.is_online(user_id):
        return
    try:
        anyio.from_thread.run(connection_hub.send_user, user_id, message)
    except Exception:
        pass


async def notify_user_async(user_id: int, message: dict[str, Any]) -> None:
    if connection_hub.is_online(user_id):
        await connection_hub.send_user(user_id, message)''',
            ),
        ],
    )

    # 5. notifications.py
    write_full(
        "backend/app/notifications.py",
        r'''
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
''',
    )

    # 6. routers/notifications.py
    write_full(
        "backend/app/routers/notifications.py",
        r'''
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
''',
    )

    # 7. routers/follows.py
    write_full(
        "backend/app/routers/follows.py",
        r'''
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
''',
    )

    # 8. routers/reactions.py
    write_full(
        "backend/app/routers/reactions.py",
        r'''
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
''',
    )

    # 9. routers/social.py
    write_full(
        "backend/app/routers/social.py",
        r'''
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
            .where(JournalEntry.owner_id.in_(candidate_owner_ids), JournalEntry.visibility.in_(["friends", "public"]))
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
''',
    )

    # 10. routers/friends.py
    patch(
        "backend/app/routers/friends.py",
        [
            (
                "from ..models import Friendship, User",
                "from ..models import Friendship, User\nfrom ..notifications import emit_notification, push_pending",
            ),
            (
                """        if link.requester_id == other.id:
            link.status = "accepted"
            link.responded_at = datetime.now(timezone.utc)
            db.commit()
            return {"status": "accepted", **public(other)}""",
                """        if link.requester_id == other.id:
            link.status = "accepted"
            link.responded_at = datetime.now(timezone.utc)
            ev = emit_notification(
                db, other, user,
                kind="friend_accepted",
                title=f"{user.display_name} accepted your friend request",
                link=f"/profile/{user.bloom_id}",
                target_type="user",
                target_id=user.bloom_id,
            )
            db.commit()
            push_pending([ev])
            return {"status": "accepted", **public(other)}""",
            ),
            (
                """    db.add(Friendship(requester_id=user.id, addressee_id=other.id))
    db.commit()
    return {"status": "pending", **public(other)}""",
                """    db.add(Friendship(requester_id=user.id, addressee_id=other.id))
    ev = emit_notification(
        db, other, user,
        kind="friend_request",
        title=f"{user.display_name} sent you a friend request",
        link="/friends",
        target_type="user",
        target_id=user.bloom_id,
    )
    db.commit()
    push_pending([ev])
    return {"status": "pending", **public(other)}""",
            ),
            (
                """    link.status = "accepted"
    link.responded_at = datetime.now(timezone.utc)
    db.commit()
    return {"status": "accepted", **public(link.requester)}""",
                """    link.status = "accepted"
    link.responded_at = datetime.now(timezone.utc)
    ev = emit_notification(
        db, link.requester, user,
        kind="friend_accepted",
        title=f"{user.display_name} accepted your friend request",
        link=f"/profile/{user.bloom_id}",
        target_type="user",
        target_id=user.bloom_id,
    )
    db.commit()
    push_pending([ev])
    return {"status": "accepted", **public(link.requester)}""",
            ),
        ],
    )

    # 11. routers/profiles.py
    patch(
        "backend/app/routers/profiles.py",
        [
            (
                "from ..models import Album, FlowerDesign, Friendship, JournalEntry, User",
                "from ..models import Album, FlowerDesign, Follow, Friendship, JournalEntry, User\nfrom .reactions import reaction_summary",
            ),
            (
                "def _shared_entry_out(entry: JournalEntry) -> dict[str, Any]:",
                "def _shared_entry_out(entry: JournalEntry, reactions: dict[str, Any]) -> dict[str, Any]:",
            ),
            (
                '        "album_ids": [a.id for a in entry.albums],\n    }',
                '        "album_ids": [a.id for a in entry.albums],\n        "reactions": reactions,\n    }',
            ),
            (
                """    relation = relation_between(db, user.id, target.id)
    link = friendship_between(db, user.id, target.id) if target.id != user.id else None
    priv = privacy_for(target)
    visible = can_view_profile(db, target, user)""",
                """    relation = relation_between(db, user.id, target.id)
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
    )""",
            ),
            (
                """        "relation": relation,
        "request_id": link.id if link and link.status == "pending" else None,
        "can_view_profile": visible,""",
                """        "relation": relation,
        "is_following": is_following,
        "follows_you": follows_you,
        "request_id": link.id if link and link.status == "pending" else None,
        "can_view_profile": visible,""",
            ),
            (
                """            "bio": "",
            "avatar_url": None,
            "friend_count": None,
            "flowers": [],
            "albums": [],
            "entries": [],""",
                """            "bio": "",
            "avatar_url": None,
            "friend_count": None,
            "follower_count": None,
            "following_count": None,
            "flowers": [],
            "albums": [],
            "entries": [],""",
            ),
            (
                """    flowers = [
        {
            "id": d.id,
            "title": d.title,
            "recipe": d.recipe,
            "visibility": d.visibility,
            "updated_at": d.updated_at,
        }
        for d in db.scalars(
            select(FlowerDesign).where(FlowerDesign.owner_id == target.id).order_by(FlowerDesign.updated_at.desc())
        ).all()
        if visibility_allows(db, target.id, d.visibility, user)
    ]

    all_entries = [
        e
        for e in db.scalars(
            select(JournalEntry)
            .where(JournalEntry.owner_id == target.id)
            .order_by(JournalEntry.taken_at.desc(), JournalEntry.id.desc())
        ).all()
        if visibility_allows(db, target.id, e.visibility, user)
    ]""",
                """    visible_designs = [
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
    following_count = int(db.scalar(select(func.count(Follow.id)).where(Follow.follower_id == target.id)) or 0)""",
            ),
            (
                """        "friend_count": _friend_count(db, target.id),
        "flowers": flowers,
        "albums": albums,
        "entries": [_shared_entry_out(e) for e in all_entries[:40]],""",
                """        "friend_count": _friend_count(db, target.id),
        "follower_count": follower_count,
        "following_count": following_count,
        "flowers": flowers,
        "albums": albums,
        "entries": [_shared_entry_out(e, e_reacts.get(e.id, {"counts": {}, "total": 0, "my_reaction": None})) for e in all_entries[:40]],""",
            ),
        ],
    )

    # 12. routers/projects.py
    patch(
        "backend/app/routers/projects.py",
        [
            (
                "from ..models import Contribution, Project, ProjectMember, User, utcnow",
                "from ..models import Contribution, Project, ProjectMember, User, utcnow\nfrom ..notifications import emit_notification, push_pending",
            ),
            (
                '    project.members.append(ProjectMember(user_id=friend.id, role="member", status="invited"))',
                '    project.members.append(ProjectMember(user_id=friend.id, role="member", status="invited"))\n    return friend',
            ),
            (
                "def _invite(db: Session, project: Project, inviter: User, raw_bloom_id: str) -> None:",
                "def _invite(db: Session, project: Project, inviter: User, raw_bloom_id: str) -> User:",
            ),
            (
                """    if body.invite_bloom_id:
        _invite(db, project, user, body.invite_bloom_id)
    db.commit()""",
                """    invited_user = None
    if body.invite_bloom_id:
        invited_user = _invite(db, project, user, body.invite_bloom_id)
    ev = None
    if invited_user is not None:
        ev = emit_notification(
            db, invited_user, user,
            kind="project_invite",
            title=f"{user.display_name} invited you to “{project.title}”",
            link=f"/together/{project.id}",
            target_type="project",
            target_id=project.id,
        )
    db.commit()
    push_pending([ev])""",
            ),
            (
                """def invite(project_id: int, body: FriendRequestIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    project = _owned_project(db, project_id, user)
    _invite(db, project, user, body.bloom_id)
    db.commit()
    db.refresh(project)
    return project_out(project, user)""",
                """def invite(project_id: int, body: FriendRequestIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    project = _owned_project(db, project_id, user)
    invited_user = _invite(db, project, user, body.bloom_id)
    ev = emit_notification(
        db, invited_user, user,
        kind="project_invite",
        title=f"{user.display_name} invited you to “{project.title}”",
        link=f"/together/{project.id}",
        target_type="project",
        target_id=project.id,
    )
    db.commit()
    push_pending([ev])
    db.refresh(project)
    return project_out(project, user)""",
            ),
            (
                """    member.status = "active"
    db.commit()""",
                """    member.status = "active"
    ev = emit_notification(
        db, project.owner, user,
        kind="project_activity",
        title=f"{user.display_name} joined “{project.title}”",
        link=f"/together/{project.id}",
        target_type="project",
        target_id=project.id,
    )
    db.commit()
    push_pending([ev])""",
            ),
            (
                """    removed_ids = old_ids - new_ids
    if removed_ids:
        _release_ids(db, removed_ids)
    else:
        db.commit()""",
                """    events = [
        emit_notification(
            db, m.user, user,
            kind="project_activity",
            title=f"{user.display_name} updated their part in “{project.title}”",
            link=f"/together/{project.id}",
            target_type="project",
            target_id=project.id,
        )
        for m in project.members
        if m.status == "active" and m.user_id != user.id
    ]
    removed_ids = old_ids - new_ids
    if removed_ids:
        _release_ids(db, removed_ids)
    else:
        db.commit()
    push_pending(events)""",
            ),
        ],
    )

    # 13. routers/live.py
    patch(
        "backend/app/routers/live.py",
        [
            (
                "from ..models import LiveCapture, LiveRoom, Media, User",
                "from ..models import LiveCapture, LiveRoom, Media, User\nfrom ..notifications import emit_notification, push_pending",
            ),
            (
                """    room = LiveRoom(id=secrets.token_urlsafe(9), host_id=user.id, guest_id=friend.id)
    db.add(room)
    db.commit()
    return room_out(room, user)""",
                """    room = LiveRoom(id=secrets.token_urlsafe(9), host_id=user.id, guest_id=friend.id)
    db.add(room)
    ev = emit_notification(
        db, friend, user,
        kind="live_invite",
        title=f"{user.display_name} opened a Live Bloom room with you",
        link=f"/live/{room.id}",
        target_type="room",
        target_id=room.id,
    )
    db.commit()
    push_pending([ev])
    return room_out(room, user)""",
            ),
        ],
    )

    # 14. main.py
    write_full(
        "backend/app/main.py",
        r'''
"""
Bloom backend entry point.

    uvicorn app.main:app --reload --port 8000

In development the React app runs on Vite (port 5173) and proxies /api here.
For a single-server deployment, build the frontend (npm run build) and this
app serves frontend/dist as well.
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

from . import realtime
from .config import BACKEND_DIR, settings
from .routers import (
    auth,
    designs,
    follows,
    friends,
    inbox,
    journal,
    live,
    media,
    notifications,
    profiles,
    projects,
    reactions,
    social,
)

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
log = logging.getLogger("bloom")


def run_migrations() -> None:
    from alembic import command
    from alembic.config import Config

    config = Config(str(BACKEND_DIR / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND_DIR / "migrations"))
    config.set_main_option("sqlalchemy.url", settings.database_url.replace("%", "%%"))
    command.upgrade(config, "head")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    if settings.auto_migrate:
        run_migrations()
    log.info("Bloom backend ready (env=%s, database=%s)", settings.env, settings.database_url.split("://")[0])
    yield


app = FastAPI(title="Bloom", version="2.0.0", lifespan=lifespan, docs_url="/api/docs", openapi_url="/api/openapi.json")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["Content-Type", "X-Bloom-Client", "Range"],
)

UNSAFE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


@app.middleware("http")
async def protect_requests(request: Request, call_next):
    if request.url.path.startswith("/api/") and request.method in UNSAFE_METHODS:
        if request.headers.get("x-bloom-client") != "1":
            return JSONResponse({"detail": "Missing X-Bloom-Client header."}, status_code=403)
        content_type = (request.headers.get("content-type") or "").lower()
        if not content_type.startswith("multipart/form-data"):
            limit = settings.max_json_mb * 1024 * 1024
            try:
                content_length = int(request.headers.get("content-length") or 0)
            except ValueError:
                content_length = 0
            if content_length > limit:
                return JSONResponse({"detail": "Request payload is too large."}, status_code=413)
            body = await request.body()
            if len(body) > limit:
                return JSONResponse({"detail": "Request payload is too large."}, status_code=413)
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "same-origin")
    response.headers.setdefault("Permissions-Policy", "camera=(self), microphone=(self), geolocation=()")
    return response


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


for module in (
    auth,
    designs,
    media,
    journal,
    friends,
    profiles,
    follows,
    reactions,
    notifications,
    social,
    projects,
    live,
    inbox,
    realtime,
):
    app.include_router(module.router)


dist: Path = settings.frontend_dist
if (dist / "index.html").exists():

    @app.get("/{full_path:path}", include_in_schema=False)
    def spa(full_path: str):
        if full_path.startswith("api/"):
            return JSONResponse({"detail": "Not found."}, status_code=404)
        candidate = (dist / full_path).resolve()
        if full_path and dist.resolve() in candidate.parents and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(dist / "index.html")
''',
    )

    # 15. tests/test_api.py (append test_07)
    phase3_test = r'''
    def test_07_phase3_follows_reactions_feed_and_notifications(self) -> None:
        a, me_a = self.client("fiona", "Fiona")
        b, me_b = self.client("george", "George")
        c, me_c = self.client("hana", "Hana")

        a.patch("/api/auth/me", json={"privacy_settings": {"profile_visibility": "public", "searchable": True, "show_online_status": True, "allow_friend_requests": True}})
        c.patch("/api/auth/me", json={"privacy_settings": {"profile_visibility": "private", "searchable": False, "show_online_status": True, "allow_friend_requests": True}})

        self.assertEqual(b.post(f"/api/follows/{me_c['bloom_id']}").status_code, 404)
        self.assertEqual(b.post(f"/api/follows/{me_b['bloom_id']}").status_code, 422)
        self.assertEqual(b.post(f"/api/follows/{me_a['bloom_id']}").status_code, 201)
        self.assertEqual(len(b.get("/api/follows").json()["following"]), 1)
        self.assertEqual(len(a.get("/api/follows").json()["followers"]), 1)

        notifs_a = a.get("/api/notifications").json()
        self.assertGreaterEqual(notifs_a["unread_count"], 1)
        self.assertEqual(notifs_a["items"][0]["kind"], "follow")

        d_priv = a.post("/api/designs", json={"title": "QuietLily", "recipe": recipe("quiet"), "visibility": "private"}).json()
        d_pub = a.post("/api/designs", json={"title": "SunLily", "recipe": recipe("sun"), "visibility": "public"}).json()
        d_friends = a.post("/api/designs", json={"title": "MateLily", "recipe": recipe("mate"), "visibility": "friends"}).json()

        self.assertEqual(b.post("/api/reactions", json={"target_type": "design", "target_id": d_priv["id"], "kind": "heart"}).status_code, 404)
        self.assertEqual(b.post("/api/reactions", json={"target_type": "design", "target_id": d_friends["id"], "kind": "heart"}).status_code, 404)

        feed_b = b.get("/api/social/feed").json()["items"]
        self.assertEqual([i["title"] for i in feed_b], ["SunLily"])

        with live_server() as base:
            ws_url = base.replace("http", "ws") + "/api/ws"
            with ws_connect(ws_url, a) as ws_a:
                self.assertEqual(recv(ws_a)["type"], "ready")
                r = b.post("/api/reactions", json={"target_type": "design", "target_id": d_pub["id"], "kind": "bloom"})
                self.assertEqual(r.status_code, 200)
                self.assertEqual(r.json()["total"], 1)
                self.assertEqual(r.json()["my_reaction"], "bloom")
                pushed = recv(ws_a)
                self.assertEqual(pushed["type"], "notification")
                self.assertEqual(pushed["notification"]["kind"], "reaction")

        r2 = b.post("/api/reactions", json={"target_type": "design", "target_id": d_pub["id"], "kind": "bloom"})
        self.assertEqual(r2.json()["total"], 0)
        self.assertIsNone(r2.json()["my_reaction"])

        nid = a.get("/api/notifications").json()["items"][0]["id"]
        self.assertTrue(a.post(f"/api/notifications/{nid}/read").json()["is_read"])
        self.assertEqual(a.post("/api/notifications/read-all").status_code, 204)
        self.assertEqual(a.get("/api/notifications").json()["unread_count"], 0)

        a.patch("/api/notifications/preferences", json={"friend_requests": True, "follows": False, "reactions": True, "messages": True, "projects": True, "live": True})
        b.delete(f"/api/follows/{me_a['bloom_id']}")
        b.post(f"/api/follows/{me_a['bloom_id']}")
        self.assertEqual(a.get("/api/notifications").json()["unread_count"], 0)
'''

    test_path = ROOT / "backend" / "tests" / "test_api.py"
    test_text = test_path.read_text(encoding="utf-8")
    if "def test_07_phase3_follows_reactions_feed_and_notifications" not in test_text:
        marker = 'if __name__ == "__main__":'
        if marker not in test_text:
            raise RuntimeError("Could not find __main__ marker in backend/tests/test_api.py")
        test_text = test_text.replace(marker, phase3_test.lstrip("\n") + "\n\n" + marker, 1)
        test_path.write_text(test_text, encoding="utf-8")
        print("Patched backend/tests/test_api.py")
    else:
        print("Skipped backend/tests/test_api.py (test_07 already present)")

    print("\nPhase 3A (Backend) applied successfully.")


if __name__ == "__main__":
    main()