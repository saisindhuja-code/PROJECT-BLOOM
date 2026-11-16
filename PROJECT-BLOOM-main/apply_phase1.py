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
        if old not in text:
            if new in text:
                print(f"Skipped {rel} (step {idx} already present)")
                continue
            raise RuntimeError(f"Could not find target block #{idx} in {rel}")
        text = text.replace(old, new, 1)
    path.write_text(text, encoding="utf-8")
    print(f"Patched {rel}")


def main() -> None:
    if not (ROOT / "backend" / "app").is_dir() or not (ROOT / "frontend" / "src").is_dir():
        sys.exit("Run apply_phase1.py directly inside PROJECT-BLOOM-main.")

    # ------------------------------------------------------------------
    # Backend: config, models, schemas, security, storage, access, realtime, main
    # ------------------------------------------------------------------

    write_full(
        "backend/app/config.py",
        r'''
"""
Settings come from environment variables (or a .env file in the backend
folder). Nothing secret is hard-coded. See .env.example for every option.
"""

from __future__ import annotations

import logging
import os
import secrets
from dataclasses import dataclass, field
from pathlib import Path

try:  # python-dotenv is optional at runtime
    from dotenv import load_dotenv
except ImportError:  # pragma: no cover
    load_dotenv = None

BACKEND_DIR = Path(__file__).resolve().parent.parent
log = logging.getLogger("bloom")

if load_dotenv is not None:
    load_dotenv(BACKEND_DIR / ".env")


def _list(value: str | None) -> list[str]:
    return [item.strip() for item in (value or "").split(",") if item.strip()]


def _bool(value: str | None, default: bool) -> bool:
    if value is None or value == "":
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _resolve(path_value: str) -> Path:
    path = Path(path_value)
    return path if path.is_absolute() else (BACKEND_DIR / path).resolve()


def _secret_key(env: str, data_dir: Path) -> str:
    """
    BLOOM_SECRET_KEY signs login sessions. In production it MUST be set.
    In development a random key is generated once and kept in data/ so you
    stay signed in across restarts (that file is git-ignored).
    """
    configured = os.getenv("BLOOM_SECRET_KEY", "").strip()
    if configured:
        if len(configured) < 32:
            raise RuntimeError("BLOOM_SECRET_KEY must be at least 32 characters long.")
        return configured
    if env == "production":
        raise RuntimeError("BLOOM_SECRET_KEY is required when BLOOM_ENV=production.")
    key_file = data_dir / "dev-secret.key"
    if key_file.exists():
        return key_file.read_text().strip()
    data_dir.mkdir(parents=True, exist_ok=True)
    key = secrets.token_urlsafe(48)
    key_file.write_text(key)
    log.warning("BLOOM_SECRET_KEY not set: generated a development key in %s", key_file)
    return key


@dataclass(frozen=True)
class Settings:
    env: str
    data_dir: Path
    database_url: str
    media_dir: Path
    secret_key: str
    allowed_origins: list[str]
    cookie_secure: bool
    session_days: int
    max_upload_mb: int
    max_voice_mb: int
    max_json_mb: int
    auto_migrate: bool
    stun_urls: list[str]
    turn_urls: list[str]
    turn_username: str
    turn_credential: str
    turn_shared_secret: str
    frontend_dist: Path
    storage_backend: str
    cookie_name: str = field(default="bloom_session")


def load_settings() -> Settings:
    env = os.getenv("BLOOM_ENV", "development").strip().lower()
    data_dir = _resolve(os.getenv("BLOOM_DATA_DIR", "data"))
    data_dir.mkdir(parents=True, exist_ok=True)
    default_db = f"sqlite:///{(data_dir / 'bloom.db').as_posix()}"
    database_url = os.getenv("DATABASE_URL", "").strip() or default_db
    if database_url.startswith("postgres://"):  # common hosting shorthand
        database_url = "postgresql+psycopg://" + database_url[len("postgres://"):]
    elif database_url.startswith("postgresql://"):
        database_url = "postgresql+psycopg://" + database_url[len("postgresql://"):]
    media_dir = _resolve(os.getenv("BLOOM_MEDIA_DIR", str(data_dir / "media")))
    media_dir.mkdir(parents=True, exist_ok=True)
    return Settings(
        env=env,
        data_dir=data_dir,
        database_url=database_url,
        media_dir=media_dir,
        secret_key=_secret_key(env, data_dir),
        allowed_origins=_list(os.getenv("BLOOM_ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173")),
        cookie_secure=_bool(os.getenv("BLOOM_COOKIE_SECURE"), env == "production"),
        session_days=int(os.getenv("BLOOM_SESSION_DAYS", "30")),
        max_upload_mb=max(1, int(os.getenv("BLOOM_MAX_UPLOAD_MB", "20"))),
        max_voice_mb=max(1, int(os.getenv("BLOOM_MAX_VOICE_MB", "10"))),
        max_json_mb=max(1, int(os.getenv("BLOOM_MAX_JSON_MB", "2"))),
        auto_migrate=_bool(os.getenv("BLOOM_AUTO_MIGRATE"), True),
        stun_urls=_list(os.getenv("STUN_URLS", "stun:stun.l.google.com:19302")),
        turn_urls=_list(os.getenv("TURN_URLS")),
        turn_username=os.getenv("TURN_USERNAME", ""),
        turn_credential=os.getenv("TURN_CREDENTIAL", ""),
        turn_shared_secret=os.getenv("TURN_SHARED_SECRET", ""),
        frontend_dist=_resolve(os.getenv("BLOOM_FRONTEND_DIST", "../frontend/dist")),
        storage_backend=os.getenv("BLOOM_STORAGE", "local").strip().lower(),
    )


settings = load_settings()
''',
    )

    write_full(
        "backend/app/models.py",
        r'''
"""Database tables. Every private thing has an owner_id and is checked on access."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import (
    JSON,
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
    password_hash: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class FlowerDesign(Base):
    __tablename__ = "flower_designs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(80))
    recipe: Mapped[dict[str, Any]] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class Media(Base):
    """An uploaded image or voice note. Private to its owner unless shared."""

    __tablename__ = "media"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(20))  # original | photo | flower | contribution | capture | avatar | sticker | chat_image | voice
    storage_key: Mapped[str] = mapped_column(String(255), unique=True)
    content_type: Mapped[str] = mapped_column(String(40))
    width: Mapped[int] = mapped_column(Integer)
    height: Mapped[int] = mapped_column(Integer)
    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    size_bytes: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class MediaBlob(Base):
    """Media bytes, when BLOOM_STORAGE=database (hosts without a lasting disk)."""

    __tablename__ = "media_blobs"

    key: Mapped[str] = mapped_column(String(255), primary_key=True)
    data: Mapped[bytes] = mapped_column(LargeBinary)


class Album(Base):
    __tablename__ = "albums"
    __table_args__ = (UniqueConstraint("owner_id", "name", name="uq_album_owner_name"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(60))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class JournalEntry(Base):
    __tablename__ = "journal_entries"
    __table_args__ = (Index("ix_journal_entries_owner_taken", "owner_id", "taken_at"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    entry_type: Mapped[str] = mapped_column(String(20))  # flower | photo | composition
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
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    albums: Mapped[list[Album]] = relationship(secondary="album_entries", lazy="selectin")


class AlbumEntry(Base):
    __tablename__ = "album_entries"

    album_id: Mapped[int] = mapped_column(ForeignKey("albums.id", ondelete="CASCADE"), primary_key=True)
    entry_id: Mapped[int] = mapped_column(ForeignKey("journal_entries.id", ondelete="CASCADE"), primary_key=True)


class Friendship(Base):
    """A friend request; status becomes 'accepted' when the other person agrees."""

    __tablename__ = "friendships"
    __table_args__ = (UniqueConstraint("requester_id", "addressee_id", name="uq_friend_pair"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    requester_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    addressee_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    status: Mapped[str] = mapped_column(String(12), default="pending")  # pending | accepted
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    responded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    requester: Mapped[User] = relationship(foreign_keys=[requester_id], lazy="joined")
    addressee: Mapped[User] = relationship(foreign_keys=[addressee_id], lazy="joined")


class Project(Base):
    """A private shared creation (Bloom Together)."""

    __tablename__ = "projects"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(80))
    mode: Mapped[str] = mapped_column(String(12))  # twin | two | moment
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
    role: Mapped[str] = mapped_column(String(10))  # owner | member
    status: Mapped[str] = mapped_column(String(10))  # invited | active
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    project: Mapped[Project] = relationship(back_populates="members")
    user: Mapped[User] = relationship(lazy="joined")


class Contribution(Base):
    """One participant's photos and flowers in a shared project, with their own crop/position settings."""

    __tablename__ = "contributions"
    __table_args__ = (UniqueConstraint("project_id", "user_id", name="uq_contribution_member"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    items: Mapped[list[Any]] = mapped_column(JSON, default=list)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    project: Mapped[Project] = relationship(back_populates="contributions")


class LiveRoom(Base):
    """A private Live Bloom room between two friends."""

    __tablename__ = "live_rooms"

    id: Mapped[str] = mapped_column(String(24), primary_key=True)
    host_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    guest_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    status: Mapped[str] = mapped_column(String(10), default="open")  # open | closed
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    host: Mapped[User] = relationship(foreign_keys=[host_id], lazy="joined")
    guest: Mapped[User] = relationship(foreign_keys=[guest_id], lazy="joined")


class LiveCapture(Base):
    """A photo a participant chose to share inside a live room."""

    __tablename__ = "live_captures"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    room_id: Mapped[str] = mapped_column(ForeignKey("live_rooms.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    media_id: Mapped[int] = mapped_column(ForeignKey("media.id", ondelete="CASCADE"), index=True)
    round_id: Mapped[str] = mapped_column(String(24))
    placement: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
''',
    )

    write_full(
        "backend/migrations/versions/0003_phase1_foundation.py",
        r'''
"""phase 1 foundation: audio duration and query indexes

Revision ID: 0003
Revises: 0002
Create Date: 2026-11-16 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0003'
down_revision: Union[str, Sequence[str], None] = '0002'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('media', schema=None) as batch_op:
        batch_op.add_column(sa.Column('duration_ms', sa.Integer(), nullable=True))

    with op.batch_alter_table('journal_entries', schema=None) as batch_op:
        batch_op.create_index('ix_journal_entries_owner_taken', ['owner_id', 'taken_at'], unique=False)

    with op.batch_alter_table('live_captures', schema=None) as batch_op:
        batch_op.create_index('ix_live_captures_media_id', ['media_id'], unique=False)


def downgrade() -> None:
    with op.batch_alter_table('live_captures', schema=None) as batch_op:
        batch_op.drop_index('ix_live_captures_media_id')

    with op.batch_alter_table('journal_entries', schema=None) as batch_op:
        batch_op.drop_index('ix_journal_entries_owner_taken')

    with op.batch_alter_table('media', schema=None) as batch_op:
        batch_op.drop_column('duration_ms')
''',
    )

    write_full(
        "backend/app/schemas.py",
        r'''
"""Request/response shapes and validation."""

from __future__ import annotations

import json
import re
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

HEX_COLOR = re.compile(r"^#[0-9a-fA-F]{6}$")
USERNAME = re.compile(r"^[a-z0-9_.]{3,32}$")
MAX_STATE_JSON_BYTES = 64 * 1024


def _validate_state_size(value: dict[str, Any] | None) -> dict[str, Any] | None:
    if value is None:
        return None
    if len(json.dumps(value, separators=(",", ":"))) > MAX_STATE_JSON_BYTES:
        raise ValueError("saved settings are too large")
    return value


class FlowerColors(BaseModel):
    model_config = ConfigDict(extra="ignore")
    ring1: str = "#ffe6f2"
    ring2: str = "#ffb3d9"
    ring3: str = "#ff66b2"
    ring4: str = "#ff1493"
    ring5: str = "#c71585"
    green: str = "#2e8b57"
    hearts: str = "#ff99cc"
    background: str = "#180018"

    @field_validator("*")
    @classmethod
    def _hex(cls, value: str) -> str:
        if not isinstance(value, str) or not HEX_COLOR.match(value):
            raise ValueError("colours must look like #ff66b2")
        return value.lower()


class FlowerRecipe(BaseModel):
    model_config = ConfigDict(extra="ignore")
    format: Literal["bloom-flower"] = "bloom-flower"
    version: Literal[1] = 1
    word: str = Field(min_length=1, max_length=24)
    shape: Literal["flower", "heart", "heartburst", "star", "butterfly", "infinity", "moon"] = "flower"
    colors: FlowerColors = Field(default_factory=FlowerColors)
    petalSize: float = Field(default=1, ge=0.6, le=1.5)
    petalCount: float = Field(default=1, ge=0.5, le=2)
    rotation: float = Field(default=0, ge=-180, le=180)
    showStem: bool = True
    showLeaves: bool = True
    showHearts: bool = True
    decoration: str = Field(default="♡", min_length=1, max_length=6)
    decorCount: int = Field(default=12, ge=0, le=40)
    seed: int = Field(default=20250101, ge=0, le=2**32 - 1)

    @field_validator("word")
    @classmethod
    def _word(cls, value: str) -> str:
        cleaned = " ".join(value.split())
        cleaned = "".join(ch for ch in cleaned if ch.isprintable())
        if not cleaned:
            raise ValueError("the word cannot be empty")
        return cleaned


class RegisterIn(BaseModel):
    username: str
    display_name: str = Field(min_length=1, max_length=48)
    password: str = Field(min_length=8, max_length=200)

    @field_validator("username")
    @classmethod
    def _username(cls, value: str) -> str:
        value = value.strip().lower()
        if not USERNAME.match(value):
            raise ValueError("use 3-32 letters, numbers, dots or underscores")
        return value

    @field_validator("display_name")
    @classmethod
    def _display(cls, value: str) -> str:
        value = " ".join(value.split())
        if not value:
            raise ValueError("please add a name")
        return value


class LoginIn(BaseModel):
    username: str = Field(max_length=64)
    password: str = Field(max_length=200)


class UserOut(BaseModel):
    id: int
    bloom_id: str
    username: str
    display_name: str
    created_at: datetime


class PublicUser(BaseModel):
    """What other people may see about you."""

    bloom_id: str
    display_name: str


class ProfileUpdate(BaseModel):
    display_name: str = Field(min_length=1, max_length=48)


class DesignIn(BaseModel):
    title: str = Field(default="", max_length=80)
    recipe: FlowerRecipe


class DesignOut(BaseModel):
    id: int
    title: str
    recipe: dict[str, Any]
    created_at: datetime
    updated_at: datetime


class MediaOut(BaseModel):
    id: int
    kind: str
    url: str
    width: int
    height: int
    duration_ms: int | None = None
    content_type: str


EntryType = Literal["flower", "photo", "composition"]


class JournalIn(BaseModel):
    entry_type: EntryType
    title: str = Field(default="", max_length=120)
    caption: str = Field(default="", max_length=500)
    notes: str = Field(default="", max_length=10_000)
    taken_at: datetime | None = None
    recipe: FlowerRecipe | None = None
    photo_media_id: int | None = None
    original_media_id: int | None = None
    edit_state: dict[str, Any] | None = None
    project_id: int | None = None
    album_ids: list[int] = Field(default_factory=list, max_length=50)

    @field_validator("edit_state")
    @classmethod
    def _edit_state_size(cls, value: dict[str, Any] | None) -> dict[str, Any] | None:
        return _validate_state_size(value)


class JournalPatch(BaseModel):
    title: str | None = Field(default=None, max_length=120)
    caption: str | None = Field(default=None, max_length=500)
    notes: str | None = Field(default=None, max_length=10_000)
    taken_at: datetime | None = None
    recipe: FlowerRecipe | None = None
    photo_media_id: int | None = None
    original_media_id: int | None = None
    keep_original: bool | None = None
    edit_state: dict[str, Any] | None = None
    album_ids: list[int] | None = Field(default=None, max_length=50)

    @field_validator("edit_state")
    @classmethod
    def _edit_state_size(cls, value: dict[str, Any] | None) -> dict[str, Any] | None:
        return _validate_state_size(value)


class AlbumIn(BaseModel):
    name: str = Field(min_length=1, max_length=60)

    @field_validator("name")
    @classmethod
    def _name(cls, value: str) -> str:
        value = " ".join(value.split())
        if not value:
            raise ValueError("please name the album")
        return value


class FriendRequestIn(BaseModel):
    bloom_id: str = Field(max_length=20)


ProjectMode = Literal["twin", "two", "moment"]
Layout = Literal["side-by-side", "stacked", "polaroid-pair", "scrapbook", "diagonal", "overlap"]


class ProjectIn(BaseModel):
    title: str = Field(min_length=1, max_length=80)
    mode: ProjectMode
    invite_bloom_id: str | None = Field(default=None, max_length=20)
    shared_recipe: FlowerRecipe | None = None


class ProjectPatch(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=80)
    layout: Layout | None = None
    theme_state: dict[str, Any] | None = None
    shared_recipe: FlowerRecipe | None = None

    @field_validator("theme_state")
    @classmethod
    def _theme_state_size(cls, value: dict[str, Any] | None) -> dict[str, Any] | None:
        return _validate_state_size(value)


class ContributionItem(BaseModel):
    model_config = ConfigDict(extra="ignore")
    media_id: int | None = None
    recipe: FlowerRecipe | None = None
    photo: dict[str, float] = Field(default_factory=dict)
    flower: dict[str, float] = Field(default_factory=dict)

    @field_validator("photo", "flower")
    @classmethod
    def _numbers(cls, value: dict[str, float]) -> dict[str, float]:
        if len(value) > 16:
            raise ValueError("too many settings")
        return {str(k)[:20]: float(v) for k, v in value.items()}


class ContributionIn(BaseModel):
    items: list[ContributionItem] = Field(default_factory=list, max_length=4)


class LiveRoomIn(BaseModel):
    friend_bloom_id: str = Field(max_length=20)
''',
    )

    write_full(
        "backend/app/security.py",
        r'''
"""Passwords, session cookies and the current-user dependency."""

from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
import time
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session

from .config import settings
from .db import get_db
from .models import User

_SCRYPT_N, _SCRYPT_R, _SCRYPT_P = 2**14, 8, 1


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=_SCRYPT_N, r=_SCRYPT_R, p=_SCRYPT_P, dklen=32)
    b64 = lambda raw: base64.b64encode(raw).decode()  # noqa: E731
    return f"scrypt${_SCRYPT_N}${_SCRYPT_R}${_SCRYPT_P}${b64(salt)}${b64(digest)}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algorithm, n, r, p, salt_b64, digest_b64 = stored.split("$")
        if algorithm != "scrypt":
            return False
        expected = base64.b64decode(digest_b64)
        actual = hashlib.scrypt(
            password.encode(), salt=base64.b64decode(salt_b64), n=int(n), r=int(r), p=int(p), dklen=len(expected)
        )
        return hmac.compare_digest(actual, expected)
    except (ValueError, TypeError):
        return False


_DUMMY_HASH = hash_password(secrets.token_urlsafe(12))


def burn_password_check(password: str) -> None:
    verify_password(password, _DUMMY_HASH)


_ALGORITHM = "HS256"


def create_session_token(user_id: int) -> str:
    now = datetime.now(timezone.utc)
    payload = {"sub": str(user_id), "iat": now, "exp": now + timedelta(days=settings.session_days)}
    return jwt.encode(payload, settings.secret_key, algorithm=_ALGORITHM)


def read_session_token(token: str | None) -> int | None:
    if not token:
        return None
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[_ALGORITHM])
        return int(payload["sub"])
    except (jwt.PyJWTError, KeyError, ValueError):
        return None


def set_session_cookie(response: Response, user_id: int) -> None:
    response.set_cookie(
        settings.cookie_name,
        create_session_token(user_id),
        max_age=settings.session_days * 86400,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        path="/",
    )


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(settings.cookie_name, path="/", httponly=True, samesite="lax", secure=settings.cookie_secure)


def user_from_token(db: Session, token: str | None) -> User | None:
    user_id = read_session_token(token)
    return db.get(User, user_id) if user_id is not None else None


def current_user(request: Request, db: Session = Depends(get_db)) -> User:
    user = user_from_token(db, request.cookies.get(settings.cookie_name))
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Please sign in.")
    return user


_attempts: dict[str, deque[float]] = defaultdict(deque)
_WINDOW_SECONDS = 300
_MAX_ATTEMPTS = 10


def check_login_rate(request: Request) -> None:
    key = request.client.host if request.client else "unknown"
    now = time.monotonic()
    if len(_attempts) > 1000:
        stale = [k for k, q in _attempts.items() if not q or now - q[-1] > _WINDOW_SECONDS]
        for k in stale:
            del _attempts[k]
    attempts = _attempts[key]
    while attempts and now - attempts[0] > _WINDOW_SECONDS:
        attempts.popleft()
    if len(attempts) >= _MAX_ATTEMPTS:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Too many attempts. Please wait a few minutes.")
    attempts.append(now)


def reset_login_rate() -> None:
    _attempts.clear()


_ID_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"


def new_bloom_id() -> str:
    pick = lambda: "".join(secrets.choice(_ID_ALPHABET) for _ in range(4))  # noqa: E731
    return f"BLM-{pick()}-{pick()}"


def normalize_bloom_id(raw: str) -> str:
    cleaned = "".join(ch for ch in raw.upper() if ch.isalnum())
    if cleaned.startswith("BLM"):
        cleaned = cleaned[3:]
    if len(cleaned) != 8:
        return ""
    return f"BLM-{cleaned[:4]}-{cleaned[4:]}"
''',
    )

    write_full(
        "backend/app/storage.py",
        r'''
"""
Where image and voice note files live. Local disk for development;
DatabaseStorage for ephemeral hosts; MediaStorage interface ready for cloud
object storage.

All uploads are validated by inspecting the actual file bytes rather than
trusting client filenames or Content-Type headers.
"""

from __future__ import annotations

import io
import secrets
from pathlib import Path
from typing import Protocol

from PIL import Image, UnidentifiedImageError

from .config import settings

ALLOWED_FORMATS = {"JPEG": "image/jpeg", "PNG": "image/png", "WEBP": "image/webp"}
ALLOWED_AUDIO_TYPES = {"audio/webm", "audio/ogg", "audio/mp4", "audio/wav"}
EXTENSIONS = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "audio/webm": "webm",
    "audio/ogg": "ogg",
    "audio/mp4": "m4a",
    "audio/wav": "wav",
}
MAX_PIXELS = 40_000_000

Image.MAX_IMAGE_PIXELS = MAX_PIXELS


class InvalidMedia(ValueError):
    pass


# Backward-compatible alias
InvalidImage = InvalidMedia


class MediaStorage(Protocol):
    def save(self, data: bytes, content_type: str) -> str: ...

    def path_for(self, key: str) -> Path | None: ...

    def read(self, key: str) -> bytes: ...

    def delete(self, key: str) -> None: ...


class LocalStorage:
    """Files under BLOOM_MEDIA_DIR, named with random keys (never user input)."""

    def __init__(self, root: Path) -> None:
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)

    def _path(self, key: str) -> Path:
        path = (self.root / key).resolve()
        if self.root.resolve() not in path.parents:
            raise ValueError("Invalid storage key")
        return path

    def save(self, data: bytes, content_type: str) -> str:
        ext = EXTENSIONS[content_type]
        key = f"{secrets.token_hex(2)}/{secrets.token_urlsafe(18)}.{ext}"
        path = self._path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        return key

    def path_for(self, key: str) -> Path | None:
        path = self._path(key)
        return path if path.exists() else None

    def read(self, key: str) -> bytes:
        return self._path(key).read_bytes()

    def delete(self, key: str) -> None:
        path = self._path(key)
        if path.exists():
            path.unlink()


class DatabaseStorage:
    """Keeps media bytes in the database (table media_blobs)."""

    def _session(self):
        from .db import SessionLocal

        return SessionLocal()

    def save(self, data: bytes, content_type: str) -> str:
        from .models import MediaBlob

        ext = EXTENSIONS[content_type]
        key = f"db/{secrets.token_urlsafe(18)}.{ext}"
        with self._session() as db:
            db.add(MediaBlob(key=key, data=data))
            db.commit()
        return key

    def path_for(self, key: str) -> Path | None:
        return None

    def read(self, key: str) -> bytes:
        from .models import MediaBlob

        with self._session() as db:
            blob = db.get(MediaBlob, key)
            if blob is None:
                raise FileNotFoundError(key)
            return blob.data

    def delete(self, key: str) -> None:
        from .models import MediaBlob

        with self._session() as db:
            blob = db.get(MediaBlob, key)
            if blob is not None:
                db.delete(blob)
                db.commit()


storage: MediaStorage = DatabaseStorage() if settings.storage_backend == "database" else LocalStorage(settings.media_dir)


def inspect_image(data: bytes) -> tuple[str, int, int]:
    """Checks that the bytes really are a JPEG/PNG/WebP image. Returns (content_type, width, height)."""
    if not data:
        raise InvalidMedia("The file is empty.")
    try:
        with Image.open(io.BytesIO(data)) as probe:
            fmt = probe.format or ""
            width, height = probe.size
            probe.verify()
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
        raise InvalidMedia("That file is not a supported image.") from exc
    if fmt not in ALLOWED_FORMATS:
        raise InvalidMedia("Please use a JPEG, PNG or WebP image.")
    if width * height > MAX_PIXELS:
        raise InvalidMedia("That image is too large.")
    return ALLOWED_FORMATS[fmt], width, height


_WEBM_VIDEO_CODECS = (b"V_VP8", b"V_VP9", b"V_AV1", b"V_MPEG4", b"V_THEORA")
_MP4_AUDIO_BRANDS = (b"M4A ", b"mp42", b"isom", b"iso2", b"mp41")
_MP4_VIDEO_CODECS = (b"avc1", b"hvc1", b"hev1", b"vp09", b"av01")


def inspect_audio(data: bytes) -> str:
    """
    Verifies container magic bytes and audio track headers for voice messages
    (WebM/Opus, Ogg/Opus/Vorbis, MP4/M4A audio, or WAV). Rejects video tracks,
    scripts, and unverified containers.
    """
    if len(data) < 28:
        raise InvalidMedia("That voice recording is empty or incomplete.")
    head = data[:16384]

    # 1. WebM audio (Chrome/Edge/Android MediaRecorder)
    if head.startswith(b"\x1a\x45\xdf\xa3"):
        if b"webm" not in head[:128]:
            raise InvalidMedia("Unsupported Matroska container.")
        if any(v in head for v in _WEBM_VIDEO_CODECS):
            raise InvalidMedia("Voice messages cannot contain video tracks.")
        if b"A_OPUS" not in head and b"A_VORBIS" not in head:
            raise InvalidMedia("WebM voice messages must use Opus or Vorbis audio.")
        return "audio/webm"

    # 2. Ogg audio (Firefox MediaRecorder)
    if head.startswith(b"OggS\x00"):
        if b"\x80theora" in head[:512]:
            raise InvalidMedia("Voice messages cannot contain video tracks.")
        if b"OpusHead" not in head[:512] and b"\x01vorbis" not in head[:512]:
            raise InvalidMedia("Ogg voice messages must use Opus or Vorbis audio.")
        return "audio/ogg"

    # 3. MP4 / M4A audio (Safari / iOS MediaRecorder)
    if len(head) >= 24 and head[4:8] == b"ftyp":
        brands = head[8:64]
        if not any(b in brands for b in _MP4_AUDIO_BRANDS):
            raise InvalidMedia("Unsupported MP4 audio brand.")
        if any(v in head for v in _MP4_VIDEO_CODECS):
            raise InvalidMedia("Voice messages cannot contain video tracks.")
        if b"mp4a" not in head and b"alac" not in head and b"Opus" not in head:
            raise InvalidMedia("MP4 voice messages must contain an audio track.")
        return "audio/mp4"

    # 4. RIFF WAVE
    if head[:4] == b"RIFF" and head[8:12] == b"WAVE" and b"fmt " in head[12:128]:
        return "audio/wav"

    raise InvalidMedia("Unsupported voice recording format. Use WebM, Ogg, M4A or WAV audio.")
''',
    )

    write_full(
        "backend/app/access.py",
        r'''
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
            owner_still_member = active_membership(db, project_id, media.owner_id)
            if owner_still_member is not None:
                return True
    capture = db.scalar(
        select(LiveCapture)
        .join(LiveRoom, LiveRoom.id == LiveCapture.room_id)
        .where(
            LiveCapture.media_id == media.id,
            or_(LiveRoom.host_id == user.id, LiveRoom.guest_id == user.id),
        )
    )
    return capture is not None


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
    if still_used or in_capture or in_contribution:
        return
    doomed.append(media.storage_key)
    db.delete(media)
''',
    )

    write_full(
        "backend/app/realtime.py",
        r'''
"""
Shared WebSocket hub for Bloom 2.0 real-time features:
- Authenticated user sockets (notifications, presence, multi-tab updates)
- Channel subscriptions (Bloom Chat conversations, Bloom Together projects)
- Shared WebSocket Origin validation
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections import defaultdict
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from fastapi.concurrency import run_in_threadpool

from .config import settings
from .db import SessionLocal
from .security import user_from_token

router = APIRouter(tags=["realtime"])
log = logging.getLogger("bloom.realtime")

MAX_WS_MESSAGE_BYTES = 64 * 1024


def ws_origin_allowed(websocket: WebSocket) -> bool:
    origin = websocket.headers.get("origin")
    if origin is None:
        return True  # non-browser clients send no Origin; they still require a valid session cookie
    host = websocket.headers.get("host", "")
    if origin.split("://", 1)[-1] == host:
        return True
    return origin in settings.allowed_origins


class ConnectionHub:
    """In-memory pub/sub manager for authenticated users and channel rooms."""

    def __init__(self) -> None:
        self._user_sockets: dict[int, set[WebSocket]] = defaultdict(set)
        self._channels: dict[str, set[WebSocket]] = defaultdict(set)
        self._socket_channels: dict[WebSocket, set[str]] = defaultdict(set)
        self._lock = asyncio.Lock()

    def is_online(self, user_id: int) -> bool:
        return bool(self._user_sockets.get(user_id))

    def online_user_ids(self, user_ids: list[int]) -> list[int]:
        return [uid for uid in user_ids if self.is_online(uid)]

    async def connect(self, user_id: int, socket: WebSocket) -> None:
        async with self._lock:
            self._user_sockets[user_id].add(socket)

    async def disconnect(self, user_id: int, socket: WebSocket) -> list[str]:
        async with self._lock:
            sockets = self._user_sockets.get(user_id)
            if sockets:
                sockets.discard(socket)
                if not sockets:
                    del self._user_sockets[user_id]
            channels = list(self._socket_channels.pop(socket, ()))
            for ch in channels:
                members = self._channels.get(ch)
                if members:
                    members.discard(socket)
                    if not members:
                        del self._channels[ch]
            return channels

    async def subscribe(self, channel: str, socket: WebSocket) -> None:
        async with self._lock:
            self._channels[channel].add(socket)
            self._socket_channels[socket].add(channel)

    async def unsubscribe(self, channel: str, socket: WebSocket) -> None:
        async with self._lock:
            members = self._channels.get(channel)
            if members:
                members.discard(socket)
                if not members:
                    del self._channels[channel]
            chans = self._socket_channels.get(socket)
            if chans:
                chans.discard(channel)

    async def send_socket(self, socket: WebSocket, message: dict[str, Any]) -> bool:
        try:
            await socket.send_text(json.dumps(message, default=str))
            return True
        except Exception:
            return False

    async def send_user(self, user_id: int, message: dict[str, Any]) -> None:
        sockets = list(self._user_sockets.get(user_id, ()))
        for sock in sockets:
            await self.send_socket(sock, message)

    async def broadcast_channel(
        self, channel: str, message: dict[str, Any], exclude: WebSocket | None = None
    ) -> None:
        sockets = list(self._channels.get(channel, ()))
        for sock in sockets:
            if sock is not exclude:
                await self.send_socket(sock, message)


connection_hub = ConnectionHub()


def _authenticate_ws(token: str | None) -> tuple[int, str, str] | None:
    with SessionLocal() as db:
        user = user_from_token(db, token)
        if user is None:
            return None
        return user.id, user.bloom_id, user.display_name


@router.websocket("/api/ws")
async def user_socket(websocket: WebSocket) -> None:
    """Persistent authenticated user socket for real-time Bloom 2.0 events."""
    if not ws_origin_allowed(websocket):
        await websocket.close(code=4003, reason="Origin not allowed")
        return
    auth = await run_in_threadpool(_authenticate_ws, websocket.cookies.get(settings.cookie_name))
    if auth is None:
        await websocket.close(code=4003, reason="Authentication required")
        return
    user_id, bloom_id, _display_name = auth
    await websocket.accept()
    await connection_hub.connect(user_id, websocket)
    await connection_hub.send_socket(websocket, {"type": "ready", "bloom_id": bloom_id})
    try:
        while True:
            raw = await websocket.receive_text()
            if len(raw) > MAX_WS_MESSAGE_BYTES:
                continue
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue
            if not isinstance(msg, dict):
                continue
            if msg.get("type") == "ping":
                await connection_hub.send_socket(websocket, {"type": "pong"})
    except WebSocketDisconnect:
        pass
    except Exception:  # pragma: no cover
        log.exception("realtime socket error")
    finally:
        await connection_hub.disconnect(user_id, websocket)
''',
    )

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
from .routers import auth, designs, friends, inbox, journal, live, media, projects

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
    # Cross-site request forgery guard: browsers cannot add custom headers to
    # cross-site form posts, so every state-changing API call must carry one.
    if request.url.path.startswith("/api/") and request.method in UNSAFE_METHODS:
        if request.headers.get("x-bloom-client") != "1":
            return JSONResponse({"detail": "Missing X-Bloom-Client header."}, status_code=403)
        # Bound JSON/non-upload request size to prevent memory exhaustion.
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


for module in (auth, designs, media, journal, friends, projects, live, inbox, realtime):
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

    write_full(
        "backend/app/routers/media.py",
        r'''
"""Image and voice-note uploads and private media delivery."""

from __future__ import annotations

import re

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile, status
from fastapi.responses import FileResponse, Response
from sqlalchemy.orm import Session

from ..access import can_view_media, not_found
from ..config import settings
from ..db import get_db
from ..models import Media, User
from ..schemas import MediaOut
from ..security import current_user
from ..storage import InvalidMedia, inspect_audio, inspect_image, storage

router = APIRouter(prefix="/api/media", tags=["media"])

IMAGE_KINDS = {"original", "photo", "flower", "contribution", "capture", "avatar", "sticker", "chat_image"}
MEDIA_KINDS = IMAGE_KINDS | {"voice"}
RANGE_HEADER = re.compile(r"^bytes=(\d*)-(\d*)$")


def media_out(media: Media) -> MediaOut:
    return MediaOut(
        id=media.id,
        kind=media.kind,
        url=f"/api/media/{media.id}",
        width=media.width,
        height=media.height,
        duration_ms=media.duration_ms,
        content_type=media.content_type,
    )


async def read_limited(upload: UploadFile, max_mb: int) -> bytes:
    limit = max_mb * 1024 * 1024
    data = await upload.read(limit + 1)
    if len(data) > limit:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, f"Files of this kind must be under {max_mb} MB.")
    return data


def store_image(db: Session, owner: User, data: bytes, kind: str) -> Media:
    try:
        content_type, width, height = inspect_image(data)
    except InvalidMedia as exc:
        raise HTTPException(422, str(exc)) from exc
    key = storage.save(data, content_type)
    media = Media(
        owner_id=owner.id,
        kind=kind,
        storage_key=key,
        content_type=content_type,
        width=width,
        height=height,
        size_bytes=len(data),
    )
    db.add(media)
    db.commit()
    return media


def store_voice(db: Session, owner: User, data: bytes, duration_ms: int | None = None) -> Media:
    try:
        content_type = inspect_audio(data)
    except InvalidMedia as exc:
        raise HTTPException(422, str(exc)) from exc
    if duration_ms is not None:
        duration_ms = max(0, min(duration_ms, 10 * 60 * 1000))  # cap reported duration at 10 min
    key = storage.save(data, content_type)
    media = Media(
        owner_id=owner.id,
        kind="voice",
        storage_key=key,
        content_type=content_type,
        width=0,
        height=0,
        duration_ms=duration_ms,
        size_bytes=len(data),
    )
    db.add(media)
    db.commit()
    return media


@router.post("", response_model=MediaOut, status_code=status.HTTP_201_CREATED)
async def upload_media(
    file: UploadFile = File(...),
    kind: str = Form("photo"),
    duration_ms: int | None = Form(None),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> MediaOut:
    if kind not in MEDIA_KINDS:
        raise HTTPException(422, "Unknown media kind.")
    if kind == "voice":
        data = await read_limited(file, settings.max_voice_mb)
        return media_out(store_voice(db, user, data, duration_ms))
    data = await read_limited(file, settings.max_upload_mb)
    return media_out(store_image(db, user, data, kind))


@router.get("/{media_id}")
def get_media(
    media_id: int, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)
) -> Response:
    media = db.get(Media, media_id)
    if media is None or not can_view_media(db, media, user):
        raise not_found("That image")
    path = storage.path_for(media.storage_key)
    headers = {
        "Cache-Control": "private, no-cache",
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": "inline",
    }
    if path is not None:
        return FileResponse(path, media_type=media.content_type, headers=headers)
    try:
        raw = storage.read(media.storage_key)
    except FileNotFoundError as exc:
        raise not_found("That image") from exc

    total = len(raw)
    range_header = request.headers.get("range")
    if range_header and total > 0:
        match = RANGE_HEADER.match(range_header.strip())
        if not match or (not match.group(1) and not match.group(2)):
            raise HTTPException(status.HTTP_416_RANGE_NOT_SATISFIABLE, headers={"Content-Range": f"bytes */{total}"})
        start_str, end_str = match.group(1), match.group(2)
        if start_str:
            start = int(start_str)
            end = min(int(end_str), total - 1) if end_str else total - 1
        else:
            suffix = int(end_str)
            if suffix <= 0:
                raise HTTPException(status.HTTP_416_RANGE_NOT_SATISFIABLE, headers={"Content-Range": f"bytes */{total}"})
            start = max(0, total - suffix)
            end = total - 1
        if start >= total or start > end:
            raise HTTPException(status.HTTP_416_RANGE_NOT_SATISFIABLE, headers={"Content-Range": f"bytes */{total}"})
        chunk = raw[start : end + 1]
        return Response(
            chunk,
            status_code=status.HTTP_206_PARTIAL_CONTENT,
            media_type=media.content_type,
            headers={**headers, "Accept-Ranges": "bytes", "Content-Range": f"bytes {start}-{end}/{total}"},
        )
    return Response(raw, media_type=media.content_type, headers={**headers, "Accept-Ranges": "bytes"})
''',
    )

    patch(
        "backend/app/routers/journal.py",
        [
            (
                r'''from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..access import active_membership, not_found, require_owned_media
from ..db import get_db
from ..models import Album, AlbumEntry, Contribution, JournalEntry, LiveCapture, Media, Project, User''',
                r'''from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..access import active_membership, not_found, release_media, require_owned_media
from ..db import get_db
from ..models import Album, AlbumEntry, JournalEntry, Project, User''',
            ),
            (
                r'''def release_media(db: Session, media_id: int | None, doomed: list[str]) -> None:
    """
    Removes an image once nothing refers to it any more. The stored file's key
    is added to `doomed`; delete those only after the database commit.
    """
    if media_id is None:
        return
    media = db.get(Media, media_id)
    if media is None:
        return
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
    if still_used or in_capture or in_contribution:
        return
    doomed.append(media.storage_key)
    db.delete(media)


''',
                "",
            ),
        ],
    )

    write_full(
        "backend/app/routers/projects.py",
        r'''
"""
Bloom Together: private shared projects for two friends.

Modes
- twin:   one shared flower design, each person adds their own photo
- two:    each person adds their own flower and photo
- moment: each person adds up to four photos and/or flowers
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..access import are_friends, not_found, release_media, require_active_member, require_owned_media
from ..db import get_db
from ..models import Contribution, Project, ProjectMember, User, utcnow
from ..schemas import ContributionIn, FriendRequestIn, ProjectIn, ProjectPatch
from ..security import current_user
from ..storage import storage
from .friends import find_by_bloom_id

router = APIRouter(prefix="/api/projects", tags=["projects"])

MAX_MEMBERS = 2
MAX_ITEMS = {"twin": 1, "two": 1, "moment": 4}


def _membership(project: Project, user_id: int) -> ProjectMember | None:
    return next((m for m in project.members if m.user_id == user_id), None)


def _is_active(project: Project, user_id: int) -> bool:
    member = _membership(project, user_id)
    return member is not None and member.status == "active"


def project_out(project: Project, viewer: User) -> dict[str, Any]:
    mine = _membership(project, viewer.id)
    base = {
        "id": project.id,
        "title": project.title,
        "mode": project.mode,
        "owner": {"bloom_id": project.owner.bloom_id, "display_name": project.owner.display_name},
        "is_owner": project.owner_id == viewer.id,
        "my_status": mine.status if mine else None,
        "created_at": project.created_at,
        "updated_at": project.updated_at,
    }
    if mine is None or mine.status != "active":
        return base
    names = {m.user_id: m.user for m in project.members}
    return {
        **base,
        "layout": project.layout,
        "theme_state": project.theme_state,
        "shared_recipe": project.shared_recipe,
        "members": [
            {
                "bloom_id": m.user.bloom_id,
                "display_name": m.user.display_name,
                "role": m.role,
                "status": m.status,
                "is_you": m.user_id == viewer.id,
            }
            for m in sorted(project.members, key=lambda m: (m.role != "owner", m.id))
        ],
        "contributions": [
            {
                "bloom_id": names[c.user_id].bloom_id,
                "display_name": names[c.user_id].display_name,
                "is_you": c.user_id == viewer.id,
                "items": [
                    {**item, "media_url": f"/api/media/{item['media_id']}" if item.get("media_id") else None}
                    for item in c.items or []
                ],
                "updated_at": c.updated_at,
            }
            for c in project.contributions
            if c.user_id in names and _is_active(project, c.user_id)
        ],
    }


def _owned_project(db: Session, project_id: int, user: User) -> Project:
    project = db.get(Project, project_id)
    if project is None or project.owner_id != user.id:
        raise not_found("That project")
    return project


def _invite(db: Session, project: Project, inviter: User, raw_bloom_id: str) -> None:
    friend = find_by_bloom_id(db, raw_bloom_id)
    if friend is None or not are_friends(db, inviter.id, friend.id):
        raise HTTPException(422, "You can only invite friends. Add them by Bloom ID first.")
    if _membership(project, friend.id) is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "They're already part of this project.")
    if len(project.members) >= MAX_MEMBERS:
        raise HTTPException(status.HTTP_409_CONFLICT, "A Bloom Together project is for two people.")
    project.members.append(ProjectMember(user_id=friend.id, role="member", status="invited"))


def _release_ids(db: Session, media_ids: set[int]) -> None:
    if not media_ids:
        return
    doomed: list[str] = []
    db.flush()
    for media_id in media_ids:
        release_media(db, media_id, doomed)
    db.commit()
    for key in doomed:
        storage.delete(key)


@router.get("")
def list_projects(user: User = Depends(current_user), db: Session = Depends(get_db)) -> list[dict[str, Any]]:
    projects = db.scalars(
        select(Project)
        .join(ProjectMember, ProjectMember.project_id == Project.id)
        .where(ProjectMember.user_id == user.id)
        .order_by(Project.updated_at.desc())
    ).all()
    return [project_out(p, user) for p in projects]


@router.post("", status_code=status.HTTP_201_CREATED)
def create_project(body: ProjectIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    project = Project(
        owner_id=user.id,
        title=body.title.strip(),
        mode=body.mode,
        shared_recipe=body.shared_recipe.model_dump() if body.shared_recipe else None,
        layout="side-by-side",
    )
    project.members.append(ProjectMember(user_id=user.id, role="owner", status="active"))
    db.add(project)
    db.flush()
    if body.invite_bloom_id:
        _invite(db, project, user, body.invite_bloom_id)
    db.commit()
    db.refresh(project)
    return project_out(project, user)


@router.get("/{project_id}")
def get_project(project_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    project = db.get(Project, project_id)
    if project is None or _membership(project, user.id) is None:
        raise not_found("That project")
    return project_out(project, user)


@router.patch("/{project_id}")
def update_project(
    project_id: int, body: ProjectPatch, user: User = Depends(current_user), db: Session = Depends(get_db)
):
    project = require_active_member(db, project_id, user)
    if body.title is not None:
        if project.owner_id != user.id:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the person who started the project can rename it.")
        project.title = body.title.strip()
    if body.layout is not None:
        project.layout = body.layout
    if body.theme_state is not None:
        project.theme_state = body.theme_state
    if body.shared_recipe is not None:
        project.shared_recipe = body.shared_recipe.model_dump()
    db.commit()
    db.refresh(project)
    return project_out(project, user)


@router.post("/{project_id}/invite")
def invite(project_id: int, body: FriendRequestIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    project = _owned_project(db, project_id, user)
    _invite(db, project, user, body.bloom_id)
    db.commit()
    db.refresh(project)
    return project_out(project, user)


@router.post("/{project_id}/accept")
def accept_invite(project_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    project = db.get(Project, project_id)
    member = _membership(project, user.id) if project else None
    if member is None or member.status != "invited":
        raise not_found("That invitation")
    member.status = "active"
    db.commit()
    db.refresh(project)
    return project_out(project, user)


def _remove_member(db: Session, project: Project, member: ProjectMember) -> set[int]:
    contribution = db.scalar(
        select(Contribution).where(Contribution.project_id == project.id, Contribution.user_id == member.user_id)
    )
    released: set[int] = set()
    if contribution is not None:
        released = {item["media_id"] for item in contribution.items or [] if item.get("media_id")}
        db.delete(contribution)
    project.members.remove(member)
    return released


@router.post("/{project_id}/decline", status_code=status.HTTP_204_NO_CONTENT)
def decline_invite(project_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)) -> None:
    project = db.get(Project, project_id)
    member = _membership(project, user.id) if project else None
    if member is None or member.status != "invited":
        raise not_found("That invitation")
    released = _remove_member(db, project, member)
    if released:
        _release_ids(db, released)
    else:
        db.commit()


@router.post("/{project_id}/leave", status_code=status.HTTP_204_NO_CONTENT)
def leave(project_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)) -> None:
    project = db.get(Project, project_id)
    member = _membership(project, user.id) if project else None
    if member is None:
        raise not_found("That project")
    if member.role == "owner":
        raise HTTPException(status.HTTP_409_CONFLICT, "You started this project. Close it instead of leaving.")
    released = _remove_member(db, project, member)
    if released:
        _release_ids(db, released)
    else:
        db.commit()


@router.delete("/{project_id}/members/{bloom_id}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_member(
    project_id: int, bloom_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)
) -> None:
    project = _owned_project(db, project_id, user)
    member = next((m for m in project.members if m.user.bloom_id == bloom_id and m.role != "owner"), None)
    if member is None:
        raise not_found("That member")
    released = _remove_member(db, project, member)
    if released:
        _release_ids(db, released)
    else:
        db.commit()


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
def close_project(project_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)) -> None:
    project = _owned_project(db, project_id, user)
    released = {
        item["media_id"]
        for c in project.contributions
        for item in c.items or []
        if item.get("media_id")
    }
    db.delete(project)
    if released:
        _release_ids(db, released)
    else:
        db.commit()


@router.put("/{project_id}/contribution")
def save_contribution(
    project_id: int, body: ContributionIn, user: User = Depends(current_user), db: Session = Depends(get_db)
):
    project = require_active_member(db, project_id, user)
    if len(body.items) > MAX_ITEMS[project.mode]:
        raise HTTPException(422, "Too many pictures for this mode.")
    items: list[dict[str, Any]] = []
    for item in body.items:
        require_owned_media(db, item.media_id, user)
        if item.media_id is None and item.recipe is None:
            continue
        items.append(
            {
                "media_id": item.media_id,
                "recipe": item.recipe.model_dump() if item.recipe and project.mode != "twin" else None,
                "photo": item.photo,
                "flower": item.flower,
            }
        )
    contribution = db.scalar(
        select(Contribution).where(Contribution.project_id == project.id, Contribution.user_id == user.id)
    )
    old_ids: set[int] = set()
    if contribution is None:
        contribution = Contribution(project_id=project.id, user_id=user.id, items=items)
        db.add(contribution)
    else:
        old_ids = {item["media_id"] for item in contribution.items or [] if item.get("media_id")}
        contribution.items = items
    new_ids = {item["media_id"] for item in items if item.get("media_id")}
    project.updated_at = utcnow()
    contribution.updated_at = utcnow()
    removed_ids = old_ids - new_ids
    if removed_ids:
        _release_ids(db, removed_ids)
    else:
        db.commit()
    db.refresh(project)
    return project_out(project, user)
''',
    )

    write_full(
        "backend/app/routers/live.py",
        r'''
"""
Live Bloom: private real-time rooms for two friends.
Uses shared origin checks from app.realtime.
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import json
import logging
import secrets
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect, status
from fastapi.concurrency import run_in_threadpool
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from ..access import are_friends, not_found, release_media
from ..config import settings
from ..db import SessionLocal, get_db
from ..models import LiveCapture, LiveRoom, Media, User
from ..realtime import MAX_WS_MESSAGE_BYTES, ws_origin_allowed
from ..schemas import LiveRoomIn
from ..security import current_user, user_from_token
from ..storage import storage
from .friends import find_by_bloom_id

router = APIRouter(prefix="/api/live", tags=["live"])
log = logging.getLogger("bloom.live")

MAX_MESSAGE_BYTES = MAX_WS_MESSAGE_BYTES


def room_out(room: LiveRoom, viewer: User) -> dict[str, Any]:
    other = room.guest if room.host_id == viewer.id else room.host
    return {
        "id": room.id,
        "status": room.status,
        "is_host": room.host_id == viewer.id,
        "friend": {"bloom_id": other.bloom_id, "display_name": other.display_name},
        "created_at": room.created_at,
        "online": hub.online_bloom_ids(room.id),
    }


def _member_room(db: Session, room_id: str, user: User) -> LiveRoom:
    room = db.get(LiveRoom, room_id)
    if room is None or user.id not in (room.host_id, room.guest_id):
        raise not_found("That live room")
    return room


@router.get("/ice")
def ice_config(user: User = Depends(current_user)) -> dict[str, Any]:
    servers: list[dict[str, Any]] = []
    if settings.stun_urls:
        servers.append({"urls": settings.stun_urls})
    if settings.turn_urls:
        if settings.turn_shared_secret:
            username = f"{int(time.time()) + 6 * 3600}:{user.bloom_id}"
            digest = hmac.new(settings.turn_shared_secret.encode(), username.encode(), hashlib.sha1).digest()
            servers.append({"urls": settings.turn_urls, "username": username, "credential": base64.b64encode(digest).decode()})
        elif settings.turn_username and settings.turn_credential:
            servers.append(
                {"urls": settings.turn_urls, "username": settings.turn_username, "credential": settings.turn_credential}
            )
    return {"iceServers": servers, "hasTurn": any("username" in s for s in servers)}


@router.get("/rooms")
def list_rooms(user: User = Depends(current_user), db: Session = Depends(get_db)) -> list[dict[str, Any]]:
    rooms = db.scalars(
        select(LiveRoom)
        .where(LiveRoom.status == "open", or_(LiveRoom.host_id == user.id, LiveRoom.guest_id == user.id))
        .order_by(LiveRoom.created_at.desc())
    ).all()
    return [room_out(r, user) for r in rooms]


@router.post("/rooms", status_code=status.HTTP_201_CREATED)
def create_room(body: LiveRoomIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    friend = find_by_bloom_id(db, body.friend_bloom_id)
    if friend is None or not are_friends(db, user.id, friend.id):
        raise HTTPException(422, "Live rooms are for friends. Add them by Bloom ID first.")
    existing = db.scalar(
        select(LiveRoom).where(
            LiveRoom.status == "open",
            or_(
                (LiveRoom.host_id == user.id) & (LiveRoom.guest_id == friend.id),
                (LiveRoom.host_id == friend.id) & (LiveRoom.guest_id == user.id),
            ),
        )
    )
    if existing is not None:
        return room_out(existing, user)
    room = LiveRoom(id=secrets.token_urlsafe(9), host_id=user.id, guest_id=friend.id)
    db.add(room)
    db.commit()
    return room_out(room, user)


@router.get("/rooms/{room_id}")
def get_room(room_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return room_out(_member_room(db, room_id, user), user)


@router.post("/rooms/{room_id}/close")
async def close_room(room_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    room = _member_room(db, room_id, user)
    room.status = "closed"
    room.closed_at = datetime.now(timezone.utc)
    captures = db.scalars(select(LiveCapture).where(LiveCapture.room_id == room_id)).all()
    media_ids = {c.media_id for c in captures}
    for capture in captures:
        db.delete(capture)
    doomed: list[str] = []
    if media_ids:
        db.flush()
        for media_id in media_ids:
            release_media(db, media_id, doomed)
    db.commit()
    for key in doomed:
        storage.delete(key)
    await hub.close_room(room_id, "The room was closed.")
    return room_out(room, user)


@dataclass
class Peer:
    user_id: int
    bloom_id: str
    display_name: str
    socket: WebSocket


@dataclass
class RoomState:
    peers: dict[int, Peer] = field(default_factory=dict)
    shared: dict[str, Any] = field(default_factory=dict)
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)


class LiveHub:
    def __init__(self) -> None:
        self.rooms: dict[str, RoomState] = {}

    def online_bloom_ids(self, room_id: str) -> list[str]:
        room = self.rooms.get(room_id)
        return [p.bloom_id for p in room.peers.values()] if room else []

    async def send(self, peer: Peer, message: dict[str, Any]) -> None:
        try:
            await peer.socket.send_text(json.dumps(message, default=str))
        except Exception:
            pass

    async def broadcast(self, room_id: str, message: dict[str, Any], exclude: int | None = None) -> None:
        room = self.rooms.get(room_id)
        if not room:
            return
        for peer in list(room.peers.values()):
            if peer.user_id != exclude:
                await self.send(peer, message)

    async def join(self, room_id: str, peer: Peer) -> RoomState:
        room = self.rooms.setdefault(room_id, RoomState())
        async with room.lock:
            old = room.peers.get(peer.user_id)
            room.peers[peer.user_id] = peer
        if old is not None:
            try:
                await old.socket.close(code=4001, reason="Opened in another tab")
            except Exception:
                pass
        return room

    async def leave(self, room_id: str, peer: Peer) -> None:
        room = self.rooms.get(room_id)
        if not room:
            return
        async with room.lock:
            if room.peers.get(peer.user_id) is peer:
                del room.peers[peer.user_id]
            empty = not room.peers
        if empty:
            self.rooms.pop(room_id, None)
        else:
            await self.broadcast(room_id, {"type": "peer-left", "bloom_id": peer.bloom_id})

    async def close_room(self, room_id: str, reason: str) -> None:
        room = self.rooms.pop(room_id, None)
        if not room:
            return
        for peer in list(room.peers.values()):
            await self.send(peer, {"type": "closed", "reason": reason})
            try:
                await peer.socket.close(code=4004, reason="Room closed")
            except Exception:
                pass


hub = LiveHub()

ALLOWED_STATE_KEYS = {"recipe", "theme", "layout", "mode"}


def _clean_placement(raw: Any) -> dict[str, float] | None:
    if not isinstance(raw, dict):
        return None
    clean: dict[str, float] = {}
    for key, value in list(raw.items())[:16]:
        if isinstance(value, (int, float)) and not isinstance(value, bool) and abs(value) < 1e6:
            clean[str(key)[:20]] = float(value)
    return clean


def _load_member(room_id: str, token: str | None) -> tuple[User, LiveRoom] | None:
    with SessionLocal() as db:
        user = user_from_token(db, token)
        if user is None:
            return None
        room = db.get(LiveRoom, room_id)
        if room is None or room.status != "open" or user.id not in (room.host_id, room.guest_id):
            return None
        db.expunge_all()
        return user, room


def _record_capture(room_id: str, user_id: int, media_id: int, round_id: str, placement: dict[str, float] | None) -> bool:
    with SessionLocal() as db:
        media = db.get(Media, media_id)
        if media is None or media.owner_id != user_id:
            return False
        db.add(LiveCapture(room_id=room_id, user_id=user_id, media_id=media_id, round_id=round_id[:24], placement=placement))
        db.commit()
        return True


def _room_captures(room_id: str) -> list[dict[str, Any]]:
    with SessionLocal() as db:
        rows = db.execute(
            select(LiveCapture, User.bloom_id)
            .join(User, User.id == LiveCapture.user_id)
            .where(LiveCapture.room_id == room_id)
            .order_by(LiveCapture.id)
        ).all()
        return [
            {
                "round_id": c.round_id,
                "bloom_id": bloom_id,
                "media_id": c.media_id,
                "media_url": f"/api/media/{c.media_id}",
                "placement": c.placement,
            }
            for c, bloom_id in rows
        ]


@router.websocket("/ws/{room_id}")
async def live_socket(websocket: WebSocket, room_id: str) -> None:
    if not ws_origin_allowed(websocket):
        await websocket.close(code=4003, reason="Origin not allowed")
        return
    member = await run_in_threadpool(_load_member, room_id, websocket.cookies.get(settings.cookie_name))
    if member is None:
        await websocket.close(code=4003, reason="Not allowed in this room")
        return
    user, room_row = member
    await websocket.accept()
    peer = Peer(user.id, user.bloom_id, user.display_name, websocket)
    room = await hub.join(room_id, peer)
    others = [p for p in room.peers.values() if p.user_id != user.id]
    await hub.send(
        peer,
        {
            "type": "welcome",
            "you": {"bloom_id": user.bloom_id, "display_name": user.display_name},
            "polite": user.id == room_row.guest_id,
            "peers": [{"bloom_id": p.bloom_id, "display_name": p.display_name} for p in others],
            "state": room.shared,
            "captures": await run_in_threadpool(_room_captures, room_id),
        },
    )
    await hub.broadcast(
        room_id,
        {"type": "peer-joined", "peer": {"bloom_id": user.bloom_id, "display_name": user.display_name}},
        exclude=user.id,
    )
    try:
        while True:
            raw = await websocket.receive_text()
            if len(raw) > MAX_MESSAGE_BYTES:
                continue
            try:
                message = json.loads(raw)
            except json.JSONDecodeError:
                continue
            if not isinstance(message, dict):
                continue
            kind = message.get("type")
            if kind == "ping":
                await hub.send(peer, {"type": "pong"})
            elif kind == "signal":
                await hub.broadcast(
                    room_id, {"type": "signal", "from": user.bloom_id, "data": message.get("data")}, exclude=user.id
                )
            elif kind == "devices":
                await hub.broadcast(
                    room_id,
                    {
                        "type": "devices",
                        "bloom_id": user.bloom_id,
                        "camera": bool(message.get("camera")),
                        "mic": bool(message.get("mic")),
                    },
                    exclude=user.id,
                )
            elif kind == "state":
                patch = message.get("patch")
                if isinstance(patch, dict):
                    own_key = f"placement:{user.bloom_id}"
                    clean = {k: v for k, v in patch.items() if k in ALLOWED_STATE_KEYS or k == own_key}
                    if clean:
                        candidate = {**room.shared, **clean}
                        if len(json.dumps(candidate, default=str)) <= MAX_MESSAGE_BYTES:
                            room.shared.update(clean)
                            await hub.broadcast(room_id, {"type": "state", "state": room.shared, "by": user.bloom_id})
            elif kind == "capture":
                round_id = str(message.get("round_id", ""))[:24]
                try:
                    seconds = min(max(int(message.get("seconds", 3)), 0), 10)
                except (TypeError, ValueError):
                    seconds = 3
                if round_id:
                    await hub.broadcast(
                        room_id,
                        {
                            "type": "capture",
                            "round_id": round_id,
                            "seconds": seconds,
                            "by": user.bloom_id,
                            "together": bool(message.get("together", True)),
                        },
                    )
            elif kind == "captured":
                round_id = str(message.get("round_id", ""))[:24]
                media_id = message.get("media_id")
                placement = _clean_placement(message.get("placement"))
                if round_id and isinstance(media_id, int) and not isinstance(media_id, bool):
                    ok = await run_in_threadpool(_record_capture, room_id, user.id, media_id, round_id, placement)
                    if ok:
                        await hub.broadcast(
                            room_id,
                            {
                                "type": "captured",
                                "round_id": round_id,
                                "bloom_id": user.bloom_id,
                                "media_id": media_id,
                                "media_url": f"/api/media/{media_id}",
                                "placement": placement,
                            },
                        )
    except WebSocketDisconnect:
        pass
    except Exception:  # pragma: no cover
        log.exception("live socket error")
    finally:
        await hub.leave(room_id, peer)
''',
    )

    # ------------------------------------------------------------------
    # Backend tests: Phase 1 test suite
    # ------------------------------------------------------------------

    phase1_test = r'''
    def test_05_phase1_foundation_audio_security_and_ws(self) -> None:
        a, me_a = self.client("voice_user", "Voice User")
        b, _ = self.client("voice_stranger", "Stranger")

        ogg_opus = b"OggS\x00\x02" + b"\x00" * 22 + b"OpusHead" + b"\x00" * 32
        webm_opus = b"\x1a\x45\xdf\xa3" + b"\x00" * 16 + b"webm" + b"\x00" * 20 + b"A_OPUS" + b"\x00" * 32
        m4a_audio = b"\x00\x00\x00\x18ftypM4A \x00\x00\x00\x00M4A isom" + b"\x00" * 16 + b"mp4a" + b"\x00" * 16
        wav_audio = b"RIFF\x24\x00\x00\x00WAVEfmt " + b"\x00" * 32

        for fname, blob, expected_ct in [
            ("v.ogg", ogg_opus, "audio/ogg"),
            ("v.webm", webm_opus, "audio/webm"),
            ("v.m4a", m4a_audio, "audio/mp4"),
            ("v.wav", wav_audio, "audio/wav"),
        ]:
            up = a.post("/api/media", files={"file": (fname, blob, "application/octet-stream")}, data={"kind": "voice", "duration_ms": "2450"})
            self.assertEqual(up.status_code, 201, up.text)
            info = up.json()
            self.assertEqual(info["content_type"], expected_ct)
            self.assertEqual(info["duration_ms"], 2450)
            r_full = a.get(info["url"])
            self.assertEqual(r_full.status_code, 200)
            self.assertEqual(r_full.headers.get("x-content-type-options"), "nosniff")
            r_range = a.get(info["url"], headers={"Range": "bytes=0-9"})
            self.assertIn(r_range.status_code, (200, 206))
            if r_range.status_code == 206:
                self.assertEqual(len(r_range.content), 10)
            self.assertEqual(b.get(info["url"]).status_code, 404)

        webm_video = b"\x1a\x45\xdf\xa3" + b"\x00" * 16 + b"webm" + b"\x00" * 10 + b"V_VP9" + b"A_OPUS" + b"\x00" * 16
        self.assertEqual(a.post("/api/media", files={"file": ("bad.webm", webm_video, "audio/webm")}, data={"kind": "voice"}).status_code, 422)
        self.assertEqual(a.post("/api/media", files={"file": ("x.ogg", b"<script>alert(1)</script>" * 3, "audio/ogg")}, data={"kind": "voice"}).status_code, 422)
        self.assertEqual(a.post("/api/media", files={"file": ("a.ogg", ogg_opus, "audio/ogg")}, data={"kind": "photo"}).status_code, 422)

        huge_state = a.post("/api/journal", json={"entry_type": "flower", "recipe": recipe("big"), "edit_state": {"pad": "x" * 70_000}})
        self.assertEqual(huge_state.status_code, 422)
        huge_body = a.post("/api/journal", content=b'{"title":"' + b"a" * (2 * 1024 * 1024 + 50) + b'"}', headers={"Content-Type": "application/json", **HEADERS})
        self.assertEqual(huge_body.status_code, 413)

        with live_server() as base:
            ws_url = base.replace("http", "ws") + "/api/ws"
            with ws_connect(ws_url, a) as ws:
                ready = recv(ws)
                self.assertEqual(ready["type"], "ready")
                self.assertEqual(ready["bloom_id"], me_a["bloom_id"])
                send(ws, {"type": "ping"})
                self.assertEqual(recv(ws)["type"], "pong")
            anon = TestClient(app, headers=HEADERS)
            with self.assertRaises(Exception):
                with ws_connect(ws_url, anon) as ws_anon:
                    recv(ws_anon)
            with self.assertRaises(Exception):
                with ws_connect(ws_url, a, origin="https://evil.example") as ws_bad:
                    recv(ws_bad)
'''

    test_path = ROOT / "backend" / "tests" / "test_api.py"
    test_text = test_path.read_text(encoding="utf-8")
    if "def test_05_phase1_foundation_audio_security_and_ws" not in test_text:
        marker = 'if __name__ == "__main__":'
        if marker not in test_text:
            raise RuntimeError("Could not find __main__ marker in backend/tests/test_api.py")
        test_text = test_text.replace(marker, phase1_test.lstrip("\n") + "\n\n" + marker, 1)
        test_path.write_text(test_text, encoding="utf-8")
        print("Patched backend/tests/test_api.py")
    else:
        print("Skipped backend/tests/test_api.py (test_05 already present)")

    # ------------------------------------------------------------------
    # Frontend: Phase 1 bug fixes & MediaInfo duration_ms type
    # ------------------------------------------------------------------

    patch(
        "frontend/src/lib/api.ts",
        [
            (
                r'''export function blobToImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("That file could not be opened as an image."));
    };
    image.src = url;
  });
}''',
                r'''export function blobToImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("That file could not be opened as an image."));
    };
    image.src = url;
  });
}''',
            ),
            (
                r'''export interface MediaInfo {
  id: number;
  kind: string;
  url: string;
  width: number;
  height: number;
  content_type: string;
}''',
                r'''export interface MediaInfo {
  id: number;
  kind: string;
  url: string;
  width: number;
  height: number;
  duration_ms?: number | null;
  content_type: string;
}''',
            ),
        ],
    )

    patch(
        "frontend/src/components/RecipePicker.tsx",
        [
            (
                'import { useEffect, useState } from "react";\nimport type { FlowerRecipe } from "../flower/recipe";',
                'import { useEffect, useState } from "react";\nimport type { FlowerRecipe } from "../flower/recipe";\nimport { Link } from "../lib/router";',
            ),
            ('<a href="/studio">Grow one in the Studio</a>', '<Link to="/studio">Grow one in the Studio</Link>'),
        ],
    )

    patch(
        "frontend/src/components/ui.tsx",
        [
            (
                'import { useEffect, useId, useRef, type ReactNode } from "react";\nimport { useSession } from "../lib/session";',
                'import { useEffect, useId, useRef, type ReactNode } from "react";\nimport { Link } from "../lib/router";\nimport { useSession } from "../lib/session";',
            ),
            (
                r'''      {serverOnline && (
        <div className="btn-row">
          <a className="btn primary" href="/signin">
            Sign in
          </a>
          <a className="btn" href="/signup">
            Create an account
          </a>
        </div>
      )}''',
                r'''      {serverOnline && (
        <div className="btn-row">
          <Link className="btn primary" to="/signin">
            Sign in
          </Link>
          <Link className="btn" to="/signup">
            Create an account
          </Link>
        </div>
      )}''',
            ),
        ],
    )

    patch(
        "frontend/src/components/CameraView.tsx",
        [
            (
                '  const tracker = useRef<HandTracker | null>(null);\n  const placementRef = useRef(placement);\n  placementRef.current = placement;\n  const mirrored = facing === "user";',
                '  const tracker = useRef<HandTracker | null>(null);\n  const countdownTimer = useRef<number>(0);\n  const placementRef = useRef(placement);\n  placementRef.current = placement;\n  const mirrored = facing === "user";\n\n  useEffect(() => () => window.clearInterval(countdownTimer.current), []);',
            ),
            (
                r'''    if (!timer) return go();
    let left = timer;
    setCountdown(left);
    const tick = window.setInterval(() => {
      left -= 1;
      setCountdown(left);
      if (left <= 0) {
        window.clearInterval(tick);
        go();
      }
    }, 1000);''',
                r'''    if (!timer) return go();
    window.clearInterval(countdownTimer.current);
    let left = timer;
    setCountdown(left);
    countdownTimer.current = window.setInterval(() => {
      left -= 1;
      setCountdown(left);
      if (left <= 0) {
        window.clearInterval(countdownTimer.current);
        go();
      }
    }, 1000);''',
            ),
            (
                '<input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => void upload(e.target.files?.[0])} />',
                '<input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ""; void upload(file); }} />',
            ),
        ],
    )

    patch(
        "frontend/src/pages/Cam.tsx",
        [
            (
                '  useNavigationGuard(Boolean(photo) && history.canUndo && !saving, "Leave without saving this photo?");',
                '  useNavigationGuard(Boolean(photo) && (!editing || history.canUndo) && !saving, "Leave without saving this photo?");',
            ),
            (
                r'''  const save = async (details: SaveDetails) => {
    if (!photo) return;
    setSaving(true);
    const final = await canvasToBlob(renderFinal(photo, edit, date), "image/jpeg", 0.92);
    const editState = {
      version: 1,
      theme: { ...edit.theme, name: themeById(edit.theme.preset).name },
      overlay: edit.overlay,
      photo: { width: photo.width, height: photo.height },
    };
    try {
      if (editing) {
        const keepOriginal = details.keepOriginal && Boolean(editing.originalUrl);
        const entry = await storeFor(editing.id, store).updateEntry(editing.id, {
          title: details.title,
          caption: details.caption,
          notes: details.notes,
          taken_at: isoFromLocalInput(details.takenAt),
          recipe: edit.recipe ?? undefined,
          photo: final,
          edit_state: editState,
          album_ids: details.albumIds,
          keep_original: keepOriginal ? undefined : false,
        });
        toast("Journal entry updated.");
        setPhoto(null);
        navigate(`/journal/${entry.id}`);
      } else {
        const original = details.keepOriginal ? await canvasToBlob(toCanvas(photo, 4096), "image/jpeg", 0.95) : null;
        const entry = await store.createEntry({
          entry_type: "photo",
          title: details.title,
          caption: details.caption,
          notes: details.notes,
          taken_at: isoFromLocalInput(details.takenAt),
          recipe: edit.recipe,
          photo: final,
          original,
          edit_state: editState,
          album_ids: details.albumIds,
        });
        toast("Saved to your journal.");
        setPhoto(null);
        navigate(`/journal/${entry.id}`);
      }
    } finally {
      setSaving(false);
      setPreview(null);
    }
  };''',
                r'''  const save = async (details: SaveDetails) => {
    if (!photo) return;
    setSaving(true);
    try {
      const final = await canvasToBlob(renderFinal(photo, edit, date), "image/jpeg", 0.92);
      const editState = {
        version: 1,
        theme: { ...edit.theme, name: themeById(edit.theme.preset).name },
        overlay: edit.overlay,
        photo: { width: photo.width, height: photo.height },
      };
      if (editing) {
        const keepOriginal = details.keepOriginal && Boolean(editing.originalUrl);
        const entry = await storeFor(editing.id, store).updateEntry(editing.id, {
          title: details.title,
          caption: details.caption,
          notes: details.notes,
          taken_at: isoFromLocalInput(details.takenAt),
          recipe: edit.recipe ?? undefined,
          photo: final,
          edit_state: editState,
          album_ids: details.albumIds,
          keep_original: keepOriginal ? undefined : false,
        });
        toast("Journal entry updated.");
        setPreview(null);
        setPhoto(null);
        navigate(`/journal/${entry.id}`);
      } else {
        const original = details.keepOriginal ? await canvasToBlob(toCanvas(photo, 4096), "image/jpeg", 0.95) : null;
        const entry = await store.createEntry({
          entry_type: "photo",
          title: details.title,
          caption: details.caption,
          notes: details.notes,
          taken_at: isoFromLocalInput(details.takenAt),
          recipe: edit.recipe,
          photo: final,
          original,
          edit_state: editState,
          album_ids: details.albumIds,
        });
        toast("Saved to your journal.");
        setPreview(null);
        setPhoto(null);
        navigate(`/journal/${entry.id}`);
      }
    } finally {
      setSaving(false);
    }
  };''',
            ),
        ],
    )

    patch(
        "frontend/src/pages/Project.tsx",
        [
            (
                r'''              <div className="layout-picker">
                {LAYOUTS.map((l) => (
                  <button key={l.id} type="button" aria-pressed={layout === l.id} title={l.hint} onClick={() => void patchProject({ layout: l.id })}>
                    {l.name}
                  </button>
                ))}
              </div>''',
                r'''              <div className="layout-picker">
                {LAYOUTS.map((l) => {
                  const unavailable =
                    (l.id === "diagonal" && items.length !== 2) ||
                    (l.id === "overlap" && items.length < 2);
                  return (
                    <button
                      key={l.id}
                      type="button"
                      aria-pressed={spec.id === l.id}
                      disabled={unavailable}
                      title={
                        unavailable
                          ? l.id === "diagonal"
                            ? "Diagonal works with 2 pictures"
                            : "Picture in picture needs at least 2 pictures"
                          : l.hint
                      }
                      onClick={() => void patchProject({ layout: l.id })}
                    >
                      {l.name}
                    </button>
                  );
                })}
              </div>''',
            ),
            (
                '<input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => void onUpload(e.target.files?.[0])} />',
                '<input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ""; void onUpload(file); }} />',
            ),
        ],
    )

    patch(
        "frontend/src/pages/LiveRoom.tsx",
        [
            (
                'import { IconJournal, IconMic, IconMicOff, IconVideo, IconVideoOff } from "../components/Icons";',
                'import { IconFlip, IconJournal, IconMic, IconMicOff, IconVideo, IconVideoOff } from "../components/Icons";',
            ),
            (
                'import { cameraProblem, captureFrame } from "../cam/camera";',
                'import { cameraProblem, captureFrame, hasMultipleCameras, type Facing } from "../cam/camera";',
            ),
            (
                r'''  const camOnRef = useRef(camOn);
  camOnRef.current = camOn;''',
                r'''  const [facing, setFacing] = useState<Facing>("user");
  const [canFlip, setCanFlip] = useState(false);
  const countdownTimer = useRef<number>(0);
  const mirrored = facing === "user";
  const camOnRef = useRef(camOn);
  camOnRef.current = camOn;''',
            ),
            (
                r'''  // Release the camera and microphone only when leaving the room.
  useEffect(
    () => () => {
      tracks.current.audio?.stop();
      tracks.current.video?.stop();
    },
    [],
  );''',
                r'''  // Release the camera, microphone, and timers when leaving the room.
  useEffect(
    () => () => {
      window.clearInterval(countdownTimer.current);
      tracks.current.audio?.stop();
      tracks.current.video?.stop();
    },
    [],
  );''',
            ),
            (
                r'''  // --- devices --------------------------------------------------------------
  const busyDevice = useRef({ audio: false, video: false });
  const toggleDevice = async (kind: "video" | "audio") => {
    if (busyDevice.current[kind]) return;
    busyDevice.current[kind] = true;
    setDeviceError("");
    try {
      const current = tracks.current[kind];
      if (current) {
        current.stop();
        tracks.current[kind] = null;
        await session.current?.setTrack(kind, null);
      } else {
        try {
          const media = await navigator.mediaDevices.getUserMedia(
            kind === "video"
              ? { video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 960 } } }
              : { audio: { echoCancellation: true, noiseSuppression: true } },
          );
          tracks.current[kind] = media.getTracks()[0];
          await session.current?.setTrack(kind, tracks.current[kind]);
        } catch (e) {
          setDeviceError(kind === "video" ? cameraProblem(e) : "The microphone couldn't be started. Check your browser's permission for this site.");
        }
      }
      // Your own preview shows only the camera (never play your own microphone back).
      setLocalStream(tracks.current.video ? new MediaStream([tracks.current.video]) : null);
      setCamOn(Boolean(tracks.current.video));
      setMicOn(Boolean(tracks.current.audio));
    } finally {
      busyDevice.current[kind] = false;
    }
  };''',
                r'''  // --- devices --------------------------------------------------------------
  const busyDevice = useRef({ audio: false, video: false });
  const openVideoTrack = async (which: Facing) => {
    const media = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: which }, width: { ideal: 1280 }, height: { ideal: 960 } },
    });
    tracks.current.video = media.getTracks()[0];
    await session.current?.setTrack("video", tracks.current.video);
    setCanFlip(await hasMultipleCameras());
  };

  const toggleDevice = async (kind: "video" | "audio") => {
    if (busyDevice.current[kind]) return;
    busyDevice.current[kind] = true;
    setDeviceError("");
    try {
      const current = tracks.current[kind];
      if (current) {
        current.stop();
        tracks.current[kind] = null;
        await session.current?.setTrack(kind, null);
      } else {
        try {
          if (kind === "video") {
            await openVideoTrack(facing);
          } else {
            const media = await navigator.mediaDevices.getUserMedia({
              audio: { echoCancellation: true, noiseSuppression: true },
            });
            tracks.current.audio = media.getTracks()[0];
            await session.current?.setTrack("audio", tracks.current.audio);
          }
        } catch (e) {
          setDeviceError(kind === "video" ? cameraProblem(e) : "The microphone couldn't be started. Check your browser's permission for this site.");
        }
      }
      // Your own preview shows only the camera (never play your own microphone back).
      setLocalStream(tracks.current.video ? new MediaStream([tracks.current.video]) : null);
      setCamOn(Boolean(tracks.current.video));
      setMicOn(Boolean(tracks.current.audio));
    } finally {
      busyDevice.current[kind] = false;
    }
  };

  const flipCamera = async () => {
    if (!camOn || busyDevice.current.video) return;
    busyDevice.current.video = true;
    setDeviceError("");
    const next: Facing = facing === "user" ? "environment" : "user";
    try {
      tracks.current.video?.stop();
      await openVideoTrack(next);
      setFacing(next);
      setLocalStream(tracks.current.video ? new MediaStream([tracks.current.video]) : null);
    } catch (e) {
      setDeviceError(cameraProblem(e));
      setLocalStream(null);
      setCamOn(false);
    } finally {
      busyDevice.current.video = false;
    }
  };''',
            ),
            (
                r'''  // --- capture --------------------------------------------------------------
  const runCapture = (roundId: string, seconds: number, together: boolean, by: string) => {
    const mine = by === me?.bloom_id;
    if (!together && !mine) {
      toast("Your friend took a photo of themselves.");
      return;
    }
    let left = seconds;
    setCountdown(left);
    const tick = window.setInterval(() => {
      left -= 1;
      setCountdown(Math.max(0, left));
      if (left <= 0) {
        window.clearInterval(tick);
        void takeMyPhoto(roundId);
      }
    }, 1000);
  };

  const takeMyPhoto = async (roundId: string) => {
    const video = localVideo.current;
    if (!camOnRef.current || !video || !video.videoWidth) {
      toast("Your camera is off, so you're not in this photo.", "error");
      return;
    }
    try {
      const shot = captureFrame(video, true);''',
                r'''  // --- capture --------------------------------------------------------------
  const runCapture = (roundId: string, seconds: number, together: boolean, by: string) => {
    const mine = by === me?.bloom_id;
    if (!together && !mine) {
      toast("Your friend took a photo of themselves.");
      return;
    }
    window.clearInterval(countdownTimer.current);
    if (seconds <= 0) {
      setCountdown(0);
      void takeMyPhoto(roundId);
      return;
    }
    let left = seconds;
    setCountdown(left);
    countdownTimer.current = window.setInterval(() => {
      left -= 1;
      setCountdown(Math.max(0, left));
      if (left <= 0) {
        window.clearInterval(countdownTimer.current);
        void takeMyPhoto(roundId);
      }
    }, 1000);
  };

  const takeMyPhoto = async (roundId: string) => {
    const video = localVideo.current;
    if (!camOnRef.current || !video || !video.videoWidth) {
      toast("Your camera is off, so you're not in this photo.", "error");
      return;
    }
    try {
      const shot = captureFrame(video, mirrored);''',
            ),
            (
                '<video ref={localVideo} autoPlay playsInline muted style={{ transform: "scaleX(-1)" }} />',
                '<video ref={localVideo} autoPlay playsInline muted style={{ transform: mirrored ? "scaleX(-1)" : undefined }} />',
            ),
            (
                r'''          <div className="device-buttons">
            <button type="button" className="round-btn" aria-pressed={camOn} onClick={() => void toggleDevice("video")} aria-label={camOn ? "Turn camera off" : "Turn camera on"} title={camOn ? "Turn camera off" : "Turn camera on"} disabled={ended}>
              {camOn ? <IconVideo /> : <IconVideoOff />}
            </button>
            <button type="button" className="round-btn" aria-pressed={micOn} onClick={() => void toggleDevice("audio")} aria-label={micOn ? "Mute microphone" : "Turn microphone on"} title={micOn ? "Mute microphone" : "Turn microphone on"} disabled={ended}>
              {micOn ? <IconMic /> : <IconMicOff />}
            </button>
          </div>''',
                r'''          <div className="device-buttons">
            <button type="button" className="round-btn" aria-pressed={camOn} onClick={() => void toggleDevice("video")} aria-label={camOn ? "Turn camera off" : "Turn camera on"} title={camOn ? "Turn camera off" : "Turn camera on"} disabled={ended}>
              {camOn ? <IconVideo /> : <IconVideoOff />}
            </button>
            <button type="button" className="round-btn" aria-pressed={micOn} onClick={() => void toggleDevice("audio")} aria-label={micOn ? "Mute microphone" : "Turn microphone on"} title={micOn ? "Mute microphone" : "Turn microphone on"} disabled={ended}>
              {micOn ? <IconMic /> : <IconMicOff />}
            </button>
            {camOn && canFlip && (
              <button type="button" className="round-btn" aria-pressed={facing === "environment"} onClick={() => void flipCamera()} aria-label="Flip camera" title="Flip camera" disabled={ended}>
                <IconFlip />
              </button>
            )}
          </div>''',
            ),
        ],
    )

    patch(
        "frontend/src/pages/Studio.tsx",
        [
            (
                r'''  // Opening /studio?design=s:12 loads that design.
  useEffect(() => {
    const wanted = query.get("design");
    const match = wanted && designs.find((d) => d.id === wanted);
    if (match) {
      growFlower(match.recipe);
      setDraftWord(match.recipe.word);
      setDesignId(match.id);
      setTitle(match.title);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [designs]);''',
                r'''  const wantedDesign = query.get("design");

  // Opening /studio?design=s:12 loads that design.
  useEffect(() => {
    const match = wantedDesign && designs.find((d) => d.id === wantedDesign);
    if (match) {
      growFlower(match.recipe);
      setDraftWord(match.recipe.word);
      setDesignId(match.id);
      setTitle(match.title);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [designs, wantedDesign]);''',
            ),
            (
                "const drawing = buildFlower(transparent ? { ...recipe } : recipe);",
                "const drawing = buildFlower(recipe);",
            ),
            (
                '<input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={(e) => void openRecipe(e.target.files?.[0])} />',
                '<input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ""; void openRecipe(file); }} />',
            ),
        ],
    )

    print("\nPhase 1 changes written successfully. Run backend & frontend checks next.")


if __name__ == "__main__":
    main()


