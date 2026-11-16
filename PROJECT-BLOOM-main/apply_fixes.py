"""Apply all Bloom bug fixes inside the PROJECT-BLOOM-main directory."""

from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent


def write_full(rel: str, content: str) -> None:
    path = ROOT / rel
    if not path.exists():
        raise FileNotFoundError(f"Missing expected file: {path}")
    path.write_text(content.lstrip("\n"), encoding="utf-8")
    print(f"Updated {rel}")


def patch(rel: str, replacements: list[tuple[str, str]]) -> None:
    path = ROOT / rel
    if not path.exists():
        raise FileNotFoundError(f"Missing expected file: {path}")
    text = path.read_text(encoding="utf-8")
    for idx, (old, new) in enumerate(replacements, start=1):
        if old not in text:
            if new in text:
                print(f"Already patched step {idx} in {rel}")
                continue
            raise RuntimeError(f"Could not find target block #{idx} in {rel}")
        text = text.replace(old, new, 1)
    path.write_text(text, encoding="utf-8")
    print(f"Patched {rel}")


def main() -> None:
    if not (ROOT / "backend" / "app").is_dir() or not (ROOT / "frontend" / "src").is_dir():
        sys.exit("Put apply_fixes.py directly inside the PROJECT-BLOOM-main folder and run it from there.")

    # 1. backend/app/access.py (shared release_media)
    write_full(
        "backend/app/access.py",
        '''
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
    # Shared through a project: the media is in someone's contribution and
    # both people are active members of that project.
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


def release_media(db: Session, media_id: int | None, doomed: list[str]) -> None:
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
    )

    # 2. backend/app/schemas.py (size limits on edit_state / theme_state)
    patch(
        "backend/app/schemas.py",
        [
            (
                "import re\nfrom datetime import datetime\nfrom typing import Any, Literal",
                "import json\nimport re\nfrom datetime import datetime\nfrom typing import Any, Literal",
            ),
            (
                'HEX_COLOR = re.compile(r"^#[0-9a-fA-F]{6}$")',
                'HEX_COLOR = re.compile(r"^#[0-9a-fA-F]{6}$")\nMAX_STATE_JSON_BYTES = 64 * 1024\n\n\ndef _validate_state_size(value: dict[str, Any] | None) -> dict[str, Any] | None:\n    if value is None:\n        return None\n    if len(json.dumps(value, separators=(",", ":"))) > MAX_STATE_JSON_BYTES:\n        raise ValueError("saved settings are too large")\n    return value',
            ),
            (
                """class JournalIn(BaseModel):
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
    album_ids: list[int] | None = Field(default=None, max_length=50)""",
                """class JournalIn(BaseModel):
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
        return _validate_state_size(value)""",
            ),
            (
                """class ProjectPatch(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=80)
    layout: Layout | None = None
    theme_state: dict[str, Any] | None = None
    shared_recipe: FlowerRecipe | None = None""",
                """class ProjectPatch(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=80)
    layout: Layout | None = None
    theme_state: dict[str, Any] | None = None
    shared_recipe: FlowerRecipe | None = None

    @field_validator("theme_state")
    @classmethod
    def _theme_state_size(cls, value: dict[str, Any] | None) -> dict[str, Any] | None:
        return _validate_state_size(value)""",
            ),
        ],
    )

    # 3. backend/app/security.py (prune stale rate-limit buckets)
    patch(
        "backend/app/security.py",
        [
            (
                """def check_login_rate(request: Request) -> None:
    key = request.client.host if request.client else "unknown"
    now = time.monotonic()
    attempts = _attempts[key]
    while attempts and now - attempts[0] > _WINDOW_SECONDS:
        attempts.popleft()
    if len(attempts) >= _MAX_ATTEMPTS:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Too many attempts. Please wait a few minutes.")
    attempts.append(now)""",
                """def check_login_rate(request: Request) -> None:
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
    attempts.append(now)""",
            ),
        ],
    )

    # 4. backend/app/routers/journal.py (use shared release_media)
    patch(
        "backend/app/routers/journal.py",
        [
            (
                """from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..access import active_membership, not_found, require_owned_media
from ..db import get_db
from ..models import Album, AlbumEntry, Contribution, JournalEntry, LiveCapture, Media, Project, User""",
                """from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..access import active_membership, not_found, release_media, require_owned_media
from ..db import get_db
from ..models import Album, AlbumEntry, JournalEntry, Project, User""",
            ),
            (
                """def release_media(db: Session, media_id: int | None, doomed: list[str]) -> None:
    \"\"\"
    Removes an image once nothing refers to it any more. The stored file's key
    is added to `doomed`; delete those only after the database commit.
    \"\"\"
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


""",
                "",
            ),
        ],
    )

    # 5. backend/app/routers/projects.py
    write_full(
        "backend/app/routers/projects.py",
        '''
"""
Bloom Together: private shared projects for two friends.

Modes
- twin:   one shared flower design, each person adds their own photo
- two:    each person adds their own flower and photo
- moment: each person adds up to four photos and/or flowers

Everyone works at their own pace; nothing requires both people online.
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
        return base  # invitations only show who is asking and what for
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
        db.delete(contribution)  # their photos stop being visible to the project
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
        require_owned_media(db, item.media_id, user)  # you can only share your own photos
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

    # 6. backend/app/routers/live.py
    patch(
        "backend/app/routers/live.py",
        [
            (
                "from ..access import are_friends, not_found\nfrom ..config import settings\nfrom ..db import SessionLocal, get_db\nfrom ..models import LiveCapture, LiveRoom, Media, User\nfrom ..schemas import LiveRoomIn\nfrom ..security import current_user, user_from_token",
                "from ..access import are_friends, not_found, release_media\nfrom ..config import settings\nfrom ..db import SessionLocal, get_db\nfrom ..models import LiveCapture, LiveRoom, Media, User\nfrom ..schemas import LiveRoomIn\nfrom ..security import current_user, user_from_token\nfrom ..storage import storage",
            ),
            (
                """@router.post("/rooms/{room_id}/close")
async def close_room(room_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    room = _member_room(db, room_id, user)
    room.status = "closed"
    room.closed_at = datetime.now(timezone.utc)
    db.commit()
    await hub.close_room(room_id, "The room was closed.")
    return room_out(room, user)""",
                """@router.post("/rooms/{room_id}/close")
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
    return room_out(room, user)""",
            ),
            (
                """            elif kind == "state":
                patch = message.get("patch")
                if isinstance(patch, dict):
                    # Shared keys anyone may change, plus your own flower placement.
                    own_key = f"placement:{user.bloom_id}"
                    clean = {k: v for k, v in patch.items() if k in ALLOWED_STATE_KEYS or k == own_key}
                    room.shared.update(clean)
                    await hub.broadcast(room_id, {"type": "state", "state": room.shared, "by": user.bloom_id})
            elif kind == "capture":
                round_id = str(message.get("round_id", ""))[:24]
                seconds = min(max(int(message.get("seconds", 3)), 0), 10)
                if round_id:
                    await hub.broadcast(
                        room_id,
                        {"type": "capture", "round_id": round_id, "seconds": seconds, "by": user.bloom_id,
                         "together": bool(message.get("together", True))},
                    )
            elif kind == "captured":
                round_id = str(message.get("round_id", ""))[:24]
                media_id = message.get("media_id")
                placement = _clean_placement(message.get("placement"))
                if round_id and isinstance(media_id, int):""",
                """            elif kind == "state":
                patch = message.get("patch")
                if isinstance(patch, dict):
                    # Shared keys anyone may change, plus your own flower placement.
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
                        {"type": "capture", "round_id": round_id, "seconds": seconds, "by": user.bloom_id,
                         "together": bool(message.get("together", True))},
                    )
            elif kind == "captured":
                round_id = str(message.get("round_id", ""))[:24]
                media_id = message.get("media_id")
                placement = _clean_placement(message.get("placement"))
                if round_id and isinstance(media_id, int) and not isinstance(media_id, bool):""",
            ),
        ],
    )

    # 7. backend/tests/test_api.py
    patch(
        "backend/tests/test_api.py",
        [
            (
                '        # flower entry needs a recipe\n        self.assertEqual(client.post("/api/journal", json={"entry_type": "flower"}).status_code, 422)',
                '        # flower entry needs a recipe\n        self.assertEqual(client.post("/api/journal", json={"entry_type": "flower"}).status_code, 422)\n        # oversized edit_state is rejected\n        huge = client.post("/api/journal", json={"entry_type": "flower", "recipe": recipe("big"), "edit_state": {"pad": "x" * 70_000}})\n        self.assertEqual(huge.status_code, 422)',
            ),
            (
                '        self.assertEqual(a.delete(f"/api/projects/{pid}").status_code, 204)',
                '        self.assertEqual(a.delete(f"/api/projects/{pid}").status_code, 204)\n        self.assertEqual(a.get(photo_a["url"]).status_code, 404)',
            ),
            (
                '        self.assertEqual(a.post(f"/api/live/rooms/{room[\'id\']}/close").json()["status"], "closed")',
                '        self.assertEqual(a.post(f"/api/live/rooms/{room[\'id\']}/close").json()["status"], "closed")\n        self.assertEqual(b.get(capture["url"]).status_code, 404)',
            ),
        ],
    )

    # 8. frontend/src/lib/api.ts
    patch(
        "frontend/src/lib/api.ts",
        [
            (
                """export function blobToImage(blob: Blob): Promise<HTMLImageElement> {
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
}""",
                """export function blobToImage(blob: Blob): Promise<HTMLImageElement> {
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
}""",
            ),
        ],
    )

    # 9. frontend/src/components/RecipePicker.tsx
    patch(
        "frontend/src/components/RecipePicker.tsx",
        [
            (
                'import { useEffect, useState } from "react";\nimport type { FlowerRecipe } from "../flower/recipe";',
                'import { useEffect, useState } from "react";\nimport type { FlowerRecipe } from "../flower/recipe";\nimport { Link } from "../lib/router";',
            ),
            (
                '<a href="/studio">Grow one in the Studio</a>',
                '<Link to="/studio">Grow one in the Studio</Link>',
            ),
        ],
    )

    # 10. frontend/src/components/ui.tsx
    patch(
        "frontend/src/components/ui.tsx",
        [
            (
                'import { useEffect, useId, useRef, type ReactNode } from "react";\nimport { useSession } from "../lib/session";',
                'import { useEffect, useId, useRef, type ReactNode } from "react";\nimport { Link } from "../lib/router";\nimport { useSession } from "../lib/session";',
            ),
            (
                """      {serverOnline && (
        <div className="btn-row">
          <a className="btn primary" href="/signin">
            Sign in
          </a>
          <a className="btn" href="/signup">
            Create an account
          </a>
        </div>
      )}""",
                """      {serverOnline && (
        <div className="btn-row">
          <Link className="btn primary" to="/signin">
            Sign in
          </Link>
          <Link className="btn" to="/signup">
            Create an account
          </Link>
        </div>
      )}""",
            ),
        ],
    )

    # 11. frontend/src/components/CameraView.tsx
    patch(
        "frontend/src/components/CameraView.tsx",
        [
            (
                "  const tracker = useRef<HandTracker | null>(null);\n  const placementRef = useRef(placement);\n  placementRef.current = placement;\n  const mirrored = facing === \"user\";",
                "  const tracker = useRef<HandTracker | null>(null);\n  const countdownTimer = useRef<number>(0);\n  const placementRef = useRef(placement);\n  placementRef.current = placement;\n  const mirrored = facing === \"user\";\n\n  useEffect(() => () => window.clearInterval(countdownTimer.current), []);",
            ),
            (
                """    if (!timer) return go();
    let left = timer;
    setCountdown(left);
    const tick = window.setInterval(() => {
      left -= 1;
      setCountdown(left);
      if (left <= 0) {
        window.clearInterval(tick);
        go();
      }
    }, 1000);""",
                """    if (!timer) return go();
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
    }, 1000);""",
            ),
            (
                '<input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => void upload(e.target.files?.[0])} />',
                '<input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ""; void upload(file); }} />',
            ),
        ],
    )

    # 12. frontend/src/pages/Cam.tsx
    patch(
        "frontend/src/pages/Cam.tsx",
        [
            (
                '  useNavigationGuard(Boolean(photo) && history.canUndo && !saving, "Leave without saving this photo?");',
                '  useNavigationGuard(Boolean(photo) && (!editing || history.canUndo) && !saving, "Leave without saving this photo?");',
            ),
            (
                """  const save = async (details: SaveDetails) => {
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
  };""",
                """  const save = async (details: SaveDetails) => {
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
  };""",
            ),
        ],
    )

    # 13. frontend/src/pages/Project.tsx
    patch(
        "frontend/src/pages/Project.tsx",
        [
            (
                """              <div className="layout-picker">
                {LAYOUTS.map((l) => (
                  <button key={l.id} type="button" aria-pressed={layout === l.id} title={l.hint} onClick={() => void patchProject({ layout: l.id })}>
                    {l.name}
                  </button>
                ))}
              </div>""",
                """              <div className="layout-picker">
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
              </div>""",
            ),
            (
                '<input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => void onUpload(e.target.files?.[0])} />',
                '<input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ""; void onUpload(file); }} />',
            ),
        ],
    )

    # 14. frontend/src/pages/LiveRoom.tsx
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
                """  const camOnRef = useRef(camOn);
  camOnRef.current = camOn;""",
                """  const [facing, setFacing] = useState<Facing>("user");
  const [canFlip, setCanFlip] = useState(false);
  const countdownTimer = useRef<number>(0);
  const mirrored = facing === "user";
  const camOnRef = useRef(camOn);
  camOnRef.current = camOn;""",
            ),
            (
                """  // Release the camera and microphone only when leaving the room.
  useEffect(
    () => () => {
      tracks.current.audio?.stop();
      tracks.current.video?.stop();
    },
    [],
  );""",
                """  // Release the camera, microphone, and timers when leaving the room.
  useEffect(
    () => () => {
      window.clearInterval(countdownTimer.current);
      tracks.current.audio?.stop();
      tracks.current.video?.stop();
    },
    [],
  );""",
            ),
            (
                """  // --- devices --------------------------------------------------------------
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
  };""",
                """  // --- devices --------------------------------------------------------------
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
  };""",
            ),
            (
                """  // --- capture --------------------------------------------------------------
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
      const shot = captureFrame(video, true);""",
                """  // --- capture --------------------------------------------------------------
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
      const shot = captureFrame(video, mirrored);""",
            ),
            (
                '<video ref={localVideo} autoPlay playsInline muted style={{ transform: "scaleX(-1)" }} />',
                '<video ref={localVideo} autoPlay playsInline muted style={{ transform: mirrored ? "scaleX(-1)" : undefined }} />',
            ),
            (
                """          <div className="device-buttons">
            <button type="button" className="round-btn" aria-pressed={camOn} onClick={() => void toggleDevice("video")} aria-label={camOn ? "Turn camera off" : "Turn camera on"} title={camOn ? "Turn camera off" : "Turn camera on"} disabled={ended}>
              {camOn ? <IconVideo /> : <IconVideoOff />}
            </button>
            <button type="button" className="round-btn" aria-pressed={micOn} onClick={() => void toggleDevice("audio")} aria-label={micOn ? "Mute microphone" : "Turn microphone on"} title={micOn ? "Mute microphone" : "Turn microphone on"} disabled={ended}>
              {micOn ? <IconMic /> : <IconMicOff />}
            </button>
          </div>""",
                """          <div className="device-buttons">
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
          </div>""",
            ),
        ],
    )

    # 15. frontend/src/pages/Studio.tsx
    patch(
        "frontend/src/pages/Studio.tsx",
        [
            (
                """  // Opening /studio?design=s:12 loads that design.
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
  }, [designs]);""",
                """  const wantedDesign = query.get("design");

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
  }, [designs, wantedDesign]);""",
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

    print("\nAll fixes applied cleanly. You can now delete apply_fixes.py.")


if __name__ == "__main__":
    main()