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
