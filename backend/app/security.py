"""Passwords, session cookies and the current-user dependency."""

from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
import time
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session

from .config import settings
from .db import get_db
from .models import User

# ---------------------------------------------------------------------------
# Passwords: scrypt from Python's standard library (memory-hard, salted).
# ---------------------------------------------------------------------------

_SCRYPT_N, _SCRYPT_R, _SCRYPT_P = 2**14, 8, 1


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=_SCRYPT_N, r=_SCRYPT_R, p=_SCRYPT_P, dklen=32)
    b64 = lambda raw: base64.b64encode(raw).decode()  # noqa: E731
    return f"scrypt${_SCRYPT_N}${_SCRYPT_R}${_SCRYPT_P}${b64(salt)}${b64(digest)}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algorithm, n, r, p, salt_b64, digest_b64 = stored.split("$")
        if algorithm != "scrypt":
            return False
        expected = base64.b64decode(digest_b64)
        actual = hashlib.scrypt(
            password.encode(), salt=base64.b64decode(salt_b64), n=int(n), r=int(r), p=int(p), dklen=len(expected)
        )
        return hmac.compare_digest(actual, expected)
    except (ValueError, TypeError):
        return False


# A real hash to compare against when the username does not exist, so a
# failed login takes the same time either way.
_DUMMY_HASH = hash_password(secrets.token_urlsafe(12))


def burn_password_check(password: str) -> None:
    verify_password(password, _DUMMY_HASH)


# ---------------------------------------------------------------------------
# Session cookie (a signed JWT, httpOnly so page scripts cannot read it).
# ---------------------------------------------------------------------------

_ALGORITHM = "HS256"


def create_session_token(user_id: int) -> str:
    now = datetime.now(timezone.utc)
    payload = {"sub": str(user_id), "iat": now, "exp": now + timedelta(days=settings.session_days)}
    return jwt.encode(payload, settings.secret_key, algorithm=_ALGORITHM)


def read_session_token(token: str | None) -> int | None:
    if not token:
        return None
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[_ALGORITHM])
        return int(payload["sub"])
    except (jwt.PyJWTError, KeyError, ValueError):
        return None


def set_session_cookie(response: Response, user_id: int) -> None:
    response.set_cookie(
        settings.cookie_name,
        create_session_token(user_id),
        max_age=settings.session_days * 86400,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        path="/",
    )


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(settings.cookie_name, path="/", httponly=True, samesite="lax", secure=settings.cookie_secure)


def user_from_token(db: Session, token: str | None) -> User | None:
    user_id = read_session_token(token)
    return db.get(User, user_id) if user_id is not None else None


def current_user(request: Request, db: Session = Depends(get_db)) -> User:
    user = user_from_token(db, request.cookies.get(settings.cookie_name))
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Please sign in.")
    return user


# ---------------------------------------------------------------------------
# Simple login rate limit (per IP address, in memory).
# ---------------------------------------------------------------------------

_attempts: dict[str, deque[float]] = defaultdict(deque)
_WINDOW_SECONDS = 300
_MAX_ATTEMPTS = 10


def check_login_rate(request: Request) -> None:
    key = request.client.host if request.client else "unknown"
    now = time.monotonic()
    attempts = _attempts[key]
    while attempts and now - attempts[0] > _WINDOW_SECONDS:
        attempts.popleft()
    if len(attempts) >= _MAX_ATTEMPTS:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Too many attempts. Please wait a few minutes.")
    attempts.append(now)


def reset_login_rate() -> None:
    _attempts.clear()


# ---------------------------------------------------------------------------
# Bloom IDs: short, readable and unique, e.g. BLM-7Q4K-2XRD
# ---------------------------------------------------------------------------

_ID_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"  # no 0/O, 1/I


def new_bloom_id() -> str:
    pick = lambda: "".join(secrets.choice(_ID_ALPHABET) for _ in range(4))  # noqa: E731
    return f"BLM-{pick()}-{pick()}"


def normalize_bloom_id(raw: str) -> str:
    cleaned = "".join(ch for ch in raw.upper() if ch.isalnum())
    if cleaned.startswith("BLM"):
        cleaned = cleaned[3:]
    if len(cleaned) != 8:
        return ""
    return f"BLM-{cleaned[:4]}-{cleaned[4:]}"
