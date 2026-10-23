"""Image uploads and private image delivery."""

from __future__ import annotations

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import FileResponse, Response
from sqlalchemy.orm import Session

from ..access import can_view_media, not_found
from ..config import settings
from ..db import get_db
from ..models import Media, User
from ..schemas import MediaOut
from ..security import current_user
from ..storage import InvalidImage, inspect_image, storage

router = APIRouter(prefix="/api/media", tags=["media"])

MEDIA_KINDS = {"original", "photo", "flower", "contribution", "capture"}


def media_out(media: Media) -> MediaOut:
    return MediaOut(
        id=media.id,
        kind=media.kind,
        url=f"/api/media/{media.id}",
        width=media.width,
        height=media.height,
        content_type=media.content_type,
    )


async def read_limited(upload: UploadFile) -> bytes:
    limit = settings.max_upload_mb * 1024 * 1024
    data = await upload.read(limit + 1)
    if len(data) > limit:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, f"Images must be under {settings.max_upload_mb} MB.")
    return data


def store_image(db: Session, owner: User, data: bytes, kind: str) -> Media:
    try:
        content_type, width, height = inspect_image(data)
    except InvalidImage as exc:
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


@router.post("", response_model=MediaOut, status_code=status.HTTP_201_CREATED)
async def upload_media(
    file: UploadFile = File(...),
    kind: str = Form("photo"),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> MediaOut:
    if kind not in MEDIA_KINDS:
        raise HTTPException(422, "Unknown image kind.")
    data = await read_limited(file)
    return media_out(store_image(db, user, data, kind))


@router.get("/{media_id}")
def get_media(media_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)) -> Response:
    media = db.get(Media, media_id)
    if media is None or not can_view_media(db, media, user):
        raise not_found("That image")
    path = storage.path_for(media.storage_key)
    # no-cache: the browser must ask again each time, so revoked access takes effect at once
    headers = {"Cache-Control": "private, no-cache", "X-Content-Type-Options": "nosniff"}
    if path is not None:
        return FileResponse(path, media_type=media.content_type, headers=headers)
    try:  # non-local storage backends
        return Response(storage.read(media.storage_key), media_type=media.content_type, headers=headers)
    except FileNotFoundError as exc:
        raise not_found("That image") from exc
