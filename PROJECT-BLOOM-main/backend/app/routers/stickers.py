"""Reusable user-uploaded stickers for the Scrapbook Editor."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..access import not_found, release_media, require_owned_media
from ..db import get_db
from ..models import Sticker, User
from ..schemas import StickerIn
from ..security import current_user
from ..storage import storage

router = APIRouter(prefix="/api/stickers", tags=["stickers"])


def sticker_out(s: Sticker) -> dict[str, Any]:
    return {
        "id": s.id,
        "name": s.name,
        "media_id": s.media_id,
        "url": f"/api/media/{s.media_id}",
        "created_at": s.created_at,
    }


@router.get("")
def list_stickers(user: User = Depends(current_user), db: Session = Depends(get_db)) -> list[dict[str, Any]]:
    rows = db.scalars(
        select(Sticker).where(Sticker.owner_id == user.id).order_by(Sticker.created_at.desc(), Sticker.id.desc())
    ).all()
    return [sticker_out(r) for r in rows]


@router.post("", status_code=status.HTTP_201_CREATED)
def create_sticker(body: StickerIn, user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict[str, Any]:
    media = require_owned_media(db, body.media_id, user)
    if media is None or media.kind == "voice":
        raise not_found("That image")
    sticker = Sticker(owner_id=user.id, name=body.name, media_id=media.id)
    db.add(sticker)
    db.commit()
    db.refresh(sticker)
    return sticker_out(sticker)


@router.delete("/{sticker_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_sticker(sticker_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)) -> None:
    sticker = db.get(Sticker, sticker_id)
    if sticker is None or sticker.owner_id != user.id:
        raise not_found("That sticker")
    media_id = sticker.media_id
    doomed: list[str] = []
    db.delete(sticker)
    db.flush()
    release_media(db, media_id, doomed)
    db.commit()
    for key in doomed:
        storage.delete(key)
