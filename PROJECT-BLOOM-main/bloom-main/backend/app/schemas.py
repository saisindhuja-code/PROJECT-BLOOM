"""Request/response shapes and validation."""

from __future__ import annotations

import re
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

HEX_COLOR = re.compile(r"^#[0-9a-fA-F]{6}$")
USERNAME = re.compile(r"^[a-z0-9_.]{3,32}$")


# ---------------------------------------------------------------------------
# Flower recipe (mirrors frontend/src/flower/recipe.ts)
# ---------------------------------------------------------------------------


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


# ---------------------------------------------------------------------------
# Users
# ---------------------------------------------------------------------------


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


# ---------------------------------------------------------------------------
# Designs
# ---------------------------------------------------------------------------


class DesignIn(BaseModel):
    title: str = Field(default="", max_length=80)
    recipe: FlowerRecipe


class DesignOut(BaseModel):
    id: int
    title: str
    recipe: dict[str, Any]
    created_at: datetime
    updated_at: datetime


# ---------------------------------------------------------------------------
# Media
# ---------------------------------------------------------------------------


class MediaOut(BaseModel):
    id: int
    kind: str
    url: str
    width: int
    height: int
    content_type: str


# ---------------------------------------------------------------------------
# Journal
# ---------------------------------------------------------------------------

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


class AlbumIn(BaseModel):
    name: str = Field(min_length=1, max_length=60)

    @field_validator("name")
    @classmethod
    def _name(cls, value: str) -> str:
        value = " ".join(value.split())
        if not value:
            raise ValueError("please name the album")
        return value


# ---------------------------------------------------------------------------
# Friends, projects, live
# ---------------------------------------------------------------------------


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


class ContributionItem(BaseModel):
    model_config = ConfigDict(extra="ignore")
    media_id: int | None = None
    recipe: FlowerRecipe | None = None
    # Photo framing inside the layout slot and flower overlay placement.
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
