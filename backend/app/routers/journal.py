"""The Bloom Journal: entries, albums, search."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..access import active_membership, not_found, require_owned_media
from ..db import get_db
from ..models import Album, AlbumEntry, Contribution, JournalEntry, LiveCapture, Media, Project, User
from ..schemas import AlbumIn, JournalIn, JournalPatch
from ..security import current_user
from ..storage import storage

router = APIRouter(prefix="/api", tags=["journal"])


def entry_out(entry: JournalEntry) -> dict[str, Any]:
    return {
        "id": entry.id,
        "entry_type": entry.entry_type,
        "title": entry.title,
        "caption": entry.caption,
        "notes": entry.notes,
        "taken_at": entry.taken_at,
        "recipe": entry.recipe,
        "photo_url": f"/api/media/{entry.photo_media_id}" if entry.photo_media_id else None,
        "photo_media_id": entry.photo_media_id,
        "original_url": f"/api/media/{entry.original_media_id}" if entry.original_media_id else None,
        "original_media_id": entry.original_media_id,
        "edit_state": entry.edit_state,
        "project_id": entry.project_id,
        "participants": entry.participants or [],
        "album_ids": sorted(a.id for a in entry.albums),
        "created_at": entry.created_at,
        "updated_at": entry.updated_at,
    }


def _owned_entry(db: Session, entry_id: int, user: User) -> JournalEntry:
    entry = db.get(JournalEntry, entry_id)
    if entry is None or entry.owner_id != user.id:
        raise not_found("That journal entry")
    return entry


def _owned_albums(db: Session, album_ids: list[int], user: User) -> list[Album]:
    if not album_ids:
        return []
    albums = db.scalars(select(Album).where(Album.id.in_(set(album_ids)), Album.owner_id == user.id)).all()
    if len(albums) != len(set(album_ids)):
        raise not_found("That album")
    return list(albums)


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


# ---------------------------------------------------------------------------
# Entries
# ---------------------------------------------------------------------------


@router.get("/journal")
def list_entries(
    q: str = Query(default="", max_length=100),
    entry_type: str | None = Query(default=None, alias="type"),
    album_id: int | None = None,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> list[dict[str, Any]]:
    query = select(JournalEntry).where(JournalEntry.owner_id == user.id)
    if entry_type in {"flower", "photo", "composition"}:
        query = query.where(JournalEntry.entry_type == entry_type)
    if album_id is not None:
        query = query.join(AlbumEntry, AlbumEntry.entry_id == JournalEntry.id).where(AlbumEntry.album_id == album_id)
    entries = db.scalars(query.order_by(JournalEntry.taken_at.desc(), JournalEntry.id.desc())).all()
    needle = q.strip().lower()
    if needle:
        def matches(entry: JournalEntry) -> bool:
            word = (entry.recipe or {}).get("word", "")
            names = " ".join(p.get("display_name", "") for p in entry.participants or [] if isinstance(p, dict))
            theme = ((entry.edit_state or {}).get("theme") or {}).get("name", "")
            haystack = " ".join([entry.title, entry.caption, entry.notes, str(word), names, str(theme)]).lower()
            return needle in haystack

        entries = [e for e in entries if matches(e)]
    return [entry_out(e) for e in entries]


@router.post("/journal", status_code=status.HTTP_201_CREATED)
def create_entry(body: JournalIn, user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict[str, Any]:
    require_owned_media(db, body.photo_media_id, user)
    require_owned_media(db, body.original_media_id, user)
    if body.entry_type == "flower" and body.recipe is None:
        raise HTTPException(422, "A flower entry needs its recipe.")
    if body.entry_type in {"photo", "composition"} and body.photo_media_id is None:
        raise HTTPException(422, "This entry needs its finished image.")
    participants = None
    if body.project_id is not None:
        project = db.get(Project, body.project_id)
        if project is None or active_membership(db, body.project_id, user.id) is None:
            raise not_found("That project")
        participants = [
            {"bloom_id": m.user.bloom_id, "display_name": m.user.display_name}
            for m in project.members
            if m.status == "active"
        ]
    elif isinstance((body.edit_state or {}).get("participants"), list):
        # Live Bloom saves list who was in the room.
        participants = [
            {"bloom_id": str(p.get("bloom_id", ""))[:16], "display_name": str(p.get("display_name", ""))[:48]}
            for p in body.edit_state["participants"][:4]
            if isinstance(p, dict)
        ]
    entry = JournalEntry(
        owner_id=user.id,
        entry_type=body.entry_type,
        title=body.title.strip(),
        caption=body.caption.strip(),
        notes=body.notes,
        taken_at=body.taken_at or datetime.now(timezone.utc),
        recipe=body.recipe.model_dump() if body.recipe else None,
        photo_media_id=body.photo_media_id,
        original_media_id=body.original_media_id,
        edit_state=body.edit_state,
        project_id=body.project_id,
        participants=participants,
    )
    entry.albums = _owned_albums(db, body.album_ids, user)
    db.add(entry)
    db.commit()
    return entry_out(entry)


@router.get("/journal/{entry_id}")
def get_entry(entry_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict[str, Any]:
    return entry_out(_owned_entry(db, entry_id, user))


@router.patch("/journal/{entry_id}")
def update_entry(
    entry_id: int, body: JournalPatch, user: User = Depends(current_user), db: Session = Depends(get_db)
) -> dict[str, Any]:
    entry = _owned_entry(db, entry_id, user)
    released: list[int | None] = []
    doomed: list[str] = []
    if body.title is not None:
        entry.title = body.title.strip()
    if body.caption is not None:
        entry.caption = body.caption.strip()
    if body.notes is not None:
        entry.notes = body.notes
    if body.taken_at is not None:
        entry.taken_at = body.taken_at
    if body.recipe is not None:
        entry.recipe = body.recipe.model_dump()
    if body.photo_media_id is not None and body.photo_media_id != entry.photo_media_id:
        require_owned_media(db, body.photo_media_id, user)
        released.append(entry.photo_media_id)
        entry.photo_media_id = body.photo_media_id
    if body.original_media_id is not None and body.original_media_id != entry.original_media_id:
        require_owned_media(db, body.original_media_id, user)
        released.append(entry.original_media_id)
        entry.original_media_id = body.original_media_id
    if body.keep_original is False and entry.original_media_id is not None:
        released.append(entry.original_media_id)
        entry.original_media_id = None
    if body.edit_state is not None:
        entry.edit_state = body.edit_state
    if body.album_ids is not None:
        entry.albums = _owned_albums(db, body.album_ids, user)
    db.flush()
    for media_id in released:
        release_media(db, media_id, doomed)
    db.commit()
    for key in doomed:
        storage.delete(key)
    db.refresh(entry)
    return entry_out(entry)


@router.post("/journal/{entry_id}/duplicate", status_code=status.HTTP_201_CREATED)
def duplicate_entry(entry_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict[str, Any]:
    entry = _owned_entry(db, entry_id, user)
    copy = JournalEntry(
        owner_id=user.id,
        entry_type=entry.entry_type,
        title=(f"{entry.title} (copy)" if entry.title else "Copy")[:120],
        caption=entry.caption,
        notes=entry.notes,
        taken_at=entry.taken_at,
        recipe=entry.recipe,
        photo_media_id=entry.photo_media_id,
        original_media_id=entry.original_media_id,
        edit_state=entry.edit_state,
        project_id=entry.project_id,
        participants=entry.participants,
    )
    copy.albums = list(entry.albums)
    db.add(copy)
    db.commit()
    return entry_out(copy)


@router.delete("/journal/{entry_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_entry(entry_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)) -> None:
    entry = _owned_entry(db, entry_id, user)
    media_ids = [entry.photo_media_id, entry.original_media_id]
    doomed: list[str] = []
    db.delete(entry)
    db.flush()
    for media_id in media_ids:
        release_media(db, media_id, doomed)
    db.commit()
    for key in doomed:
        storage.delete(key)


# ---------------------------------------------------------------------------
# Albums (collections)
# ---------------------------------------------------------------------------


def album_out(db: Session, album: Album) -> dict[str, Any]:
    count = len(db.scalars(select(AlbumEntry.entry_id).where(AlbumEntry.album_id == album.id)).all())
    return {"id": album.id, "name": album.name, "entry_count": count, "created_at": album.created_at}


@router.get("/albums")
def list_albums(user: User = Depends(current_user), db: Session = Depends(get_db)) -> list[dict[str, Any]]:
    albums = db.scalars(select(Album).where(Album.owner_id == user.id).order_by(Album.name)).all()
    return [album_out(db, a) for a in albums]


@router.post("/albums", status_code=status.HTTP_201_CREATED)
def create_album(body: AlbumIn, user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict[str, Any]:
    album = Album(owner_id=user.id, name=body.name)
    db.add(album)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "You already have an album with that name.") from exc
    return album_out(db, album)


@router.patch("/albums/{album_id}")
def rename_album(
    album_id: int, body: AlbumIn, user: User = Depends(current_user), db: Session = Depends(get_db)
) -> dict[str, Any]:
    album = db.get(Album, album_id)
    if album is None or album.owner_id != user.id:
        raise not_found("That album")
    album.name = body.name
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "You already have an album with that name.") from exc
    return album_out(db, album)


@router.delete("/albums/{album_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_album(album_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)) -> None:
    album = db.get(Album, album_id)
    if album is None or album.owner_id != user.id:
        raise not_found("That album")
    db.delete(album)  # entries stay in the journal
    db.commit()
