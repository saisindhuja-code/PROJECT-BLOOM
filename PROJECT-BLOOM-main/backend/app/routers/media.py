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
