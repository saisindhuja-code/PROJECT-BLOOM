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
        max_upload_mb=int(os.getenv("BLOOM_MAX_UPLOAD_MB", "20")),
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
