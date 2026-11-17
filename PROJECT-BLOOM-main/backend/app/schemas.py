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

Visibility = Literal["private", "friends", "public"]


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


PetalStyle = Literal["classic", "pointed", "wavy", "chrysanthemum", "dahlia"]
ArrangementKind = Literal["rings", "spiral", "burst"]
BgStyle = Literal["solid", "radial", "studio", "paper"]


class FlowerRecipe(BaseModel):
    model_config = ConfigDict(extra="ignore")
    format: Literal["bloom-flower"] = "bloom-flower"
    version: int = Field(default=1, ge=1, le=2)
    word: str = Field(min_length=1, max_length=24)
    shape: Literal["flower", "heart", "heartburst", "star", "butterfly", "infinity", "moon"] = "flower"
    petalStyle: PetalStyle = "classic"
    arrangement: ArrangementKind = "rings"
    centerText: str = Field(default="", max_length=32)
    stemMessage: str = Field(default="", max_length=48)
    themeId: str = Field(default="", max_length=32)
    bgStyle: BgStyle = "solid"
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

    @field_validator("centerText", "stemMessage")
    @classmethod
    def _clean_text(cls, value: str) -> str:
        cleaned = " ".join(value.split())
        return "".join(ch for ch in cleaned if ch.isprintable())

    @field_validator("word")
    @classmethod
    def _word(cls, value: str) -> str:
        cleaned = " ".join(value.split())
        cleaned = "".join(ch for ch in cleaned if ch.isprintable())
        if not cleaned:
            raise ValueError("the word cannot be empty")
        return cleaned


class PrivacySettings(BaseModel):
    model_config = ConfigDict(extra="ignore")
    profile_visibility: Visibility = "friends"
    searchable: bool = True
    show_online_status: bool = True
    allow_friend_requests: bool = True


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
    bio: str = ""
    avatar_url: str | None = None
    privacy_settings: PrivacySettings = Field(default_factory=PrivacySettings)
    created_at: datetime


class PublicUser(BaseModel):
    """What other people may see about you."""

    bloom_id: str
    display_name: str


class ProfileUpdate(BaseModel):
    display_name: str | None = Field(default=None, min_length=1, max_length=48)
    bio: str | None = Field(default=None, max_length=500)
    avatar_media_id: int | None = None
    remove_avatar: bool = False
    privacy_settings: PrivacySettings | None = None

    @field_validator("display_name")
    @classmethod
    def _display(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = " ".join(value.split())
        if not cleaned:
            raise ValueError("please add a name")
        return cleaned

    @field_validator("bio")
    @classmethod
    def _bio(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return value.strip()


class ChangePasswordIn(BaseModel):
    current_password: str = Field(min_length=1, max_length=200)
    new_password: str = Field(min_length=8, max_length=200)


class DeleteAccountIn(BaseModel):
    password: str = Field(min_length=1, max_length=200)


class DesignIn(BaseModel):
    title: str = Field(default="", max_length=80)
    recipe: FlowerRecipe
    visibility: Visibility = "private"


class DesignOut(BaseModel):
    id: int
    title: str
    recipe: dict[str, Any]
    visibility: str = "private"
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
    visibility: Visibility = "private"

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
    visibility: Visibility | None = None

    @field_validator("edit_state")
    @classmethod
    def _edit_state_size(cls, value: dict[str, Any] | None) -> dict[str, Any] | None:
        return _validate_state_size(value)


class AlbumIn(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    visibility: Visibility = "private"

    @field_validator("name")
    @classmethod
    def _name(cls, value: str) -> str:
        value = " ".join(value.split())
        if not value:
            raise ValueError("please name the album")
        return value


class AlbumPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=60)
    visibility: Visibility | None = None

    @field_validator("name")
    @classmethod
    def _name(cls, value: str | None) -> str | None:
        if value is None:
            return None
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
    live: bool = True
MessageKind = Literal["text", "image", "voice", "sticker", "shared"]
GroupRole = Literal["owner", "admin", "member"]


class DmCreateIn(BaseModel):
    bloom_id: str = Field(max_length=20)


class GroupCreateIn(BaseModel):
    title: str = Field(min_length=1, max_length=80)
    description: str = Field(default="", max_length=300)
    member_bloom_ids: list[str] = Field(default_factory=list, max_length=30)
    avatar_media_id: int | None = None

    @field_validator("title")
    @classmethod
    def _title(cls, value: str) -> str:
        cleaned = " ".join(value.split())
        if not cleaned:
            raise ValueError("please name the group")
        return cleaned


class GroupPatchIn(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=80)
    description: str | None = Field(default=None, max_length=300)
    avatar_media_id: int | None = None
    remove_avatar: bool = False

    @field_validator("title")
    @classmethod
    def _title(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = " ".join(value.split())
        if not cleaned:
            raise ValueError("please name the group")
        return cleaned


class GroupRoleIn(BaseModel):
    role: Literal["admin", "member"]


class StudioCreateIn(BaseModel):
    title: str = Field(min_length=1, max_length=80)
    description: str = Field(default="", max_length=300)

    @field_validator("title")
    @classmethod
    def _title(cls, value: str) -> str:
        cleaned = " ".join(value.split())
        if not cleaned:
            raise ValueError("please name the Studio room")
        return cleaned


class MessageSendIn(BaseModel):
    kind: MessageKind = "text"
    body: str = Field(default="", max_length=4000)
    media_id: int | None = None
    reply_to_id: int | None = None
    sticker_id: str | None = Field(default=None, max_length=40)
    share_type: Literal["design", "entry"] | None = None
    share_id: int | None = None


class MessageReactionIn(BaseModel):
    kind: ReactionKind
