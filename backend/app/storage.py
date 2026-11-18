"""
Where image files live. Local disk for development; the MediaStorage
interface lets a private cloud bucket (S3, R2, GCS...) replace it later
without touching the API code.
"""

from __future__ import annotations

import io
import secrets
from pathlib import Path
from typing import Protocol

from PIL import Image, UnidentifiedImageError

from .config import settings

ALLOWED_FORMATS = {"JPEG": "image/jpeg", "PNG": "image/png", "WEBP": "image/webp"}
EXTENSIONS = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}
MAX_PIXELS = 40_000_000

Image.MAX_IMAGE_PIXELS = MAX_PIXELS


class InvalidImage(ValueError):
    pass


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
        key = f"{secrets.token_hex(2)}/{secrets.token_urlsafe(18)}.{EXTENSIONS[content_type]}"
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
    """
    Keeps image bytes in the database (table media_blobs). Used on hosts
    without a lasting disk, such as Render's free plan, where local files
    vanish on every restart.
    """

    def _session(self):
        from .db import SessionLocal  # imported here to avoid a circular import

        return SessionLocal()

    def save(self, data: bytes, content_type: str) -> str:
        from .models import MediaBlob

        key = f"db/{secrets.token_urlsafe(18)}.{EXTENSIONS[content_type]}"
        with self._session() as db:
            db.add(MediaBlob(key=key, data=data))
            db.commit()
        return key

    def path_for(self, key: str) -> Path | None:
        return None  # served from memory, not from a file

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
        raise InvalidImage("The file is empty.")
    try:
        with Image.open(io.BytesIO(data)) as probe:
            fmt = probe.format or ""
            width, height = probe.size
            probe.verify()
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
        raise InvalidImage("That file is not a supported image.") from exc
    if fmt not in ALLOWED_FORMATS:
        raise InvalidImage("Please use a JPEG, PNG or WebP image.")
    if width * height > MAX_PIXELS:
        raise InvalidImage("That image is too large.")
    return ALLOWED_FORMATS[fmt], width, height
