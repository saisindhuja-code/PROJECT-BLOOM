"""Accounts: sign up, sign in, sign out, profile settings, password & deletion."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..access import not_found, privacy_for, release_media, require_owned_media
from ..config import settings
from ..db import get_db
from ..models import Media, User
from ..schemas import (
    ChangePasswordIn,
    DeleteAccountIn,
    LoginIn,
    ProfileUpdate,
    RegisterIn,
    UserOut,
)
from ..security import (
    burn_password_check,
    check_login_rate,
    clear_session_cookie,
    current_user,
    hash_password,
    new_bloom_id,
    set_session_cookie,
    user_from_token,
    verify_password,
)
from ..storage import storage

router = APIRouter(prefix="/api/auth", tags=["auth"])


def user_out(user: User) -> UserOut:
    return UserOut(
        id=user.id,
        bloom_id=user.bloom_id,
        username=user.username,
        display_name=user.display_name,
        bio=user.bio or "",
        avatar_url=f"/api/media/{user.avatar_media_id}" if user.avatar_media_id else None,
        privacy_settings=privacy_for(user),
        created_at=user.created_at,
    )


@router.post("/register", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def register(body: RegisterIn, request: Request, response: Response, db: Session = Depends(get_db)) -> UserOut:
    check_login_rate(request)
    if db.scalar(select(User.id).where(User.username == body.username)) is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "That username is taken.")
    for _ in range(10):
        user = User(
            bloom_id=new_bloom_id(),
            username=body.username,
            display_name=body.display_name,
            password_hash=hash_password(body.password),
        )
        db.add(user)
        try:
            db.commit()
            break
        except IntegrityError:
            db.rollback()
            if db.scalar(select(User.id).where(User.username == body.username)) is not None:
                raise HTTPException(status.HTTP_409_CONFLICT, "That username is taken.") from None
    else:  # pragma: no cover
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "Could not create a Bloom ID. Try again.")
    set_session_cookie(response, user.id)
    return user_out(user)


@router.post("/login", response_model=UserOut)
def login(body: LoginIn, request: Request, response: Response, db: Session = Depends(get_db)) -> UserOut:
    check_login_rate(request)
    user = db.scalar(select(User).where(User.username == body.username.strip().lower()))
    if user is None:
        burn_password_check(body.password)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "That username and password don't match.")
    if not verify_password(body.password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "That username and password don't match.")
    set_session_cookie(response, user.id)
    return user_out(user)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(response: Response) -> Response:
    clear_session_cookie(response)
    response.status_code = status.HTTP_204_NO_CONTENT
    return response


@router.get("/session")
def session(request: Request, db: Session = Depends(get_db)) -> dict[str, UserOut | None]:
    """Who is signed in (or null). Never errors, so the app can check quietly on load."""
    user = user_from_token(db, request.cookies.get(settings.cookie_name))
    return {"user": user_out(user) if user else None}


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(current_user)) -> UserOut:
    return user_out(user)


@router.patch("/me", response_model=UserOut)
def update_me(body: ProfileUpdate, user: User = Depends(current_user), db: Session = Depends(get_db)) -> UserOut:
    old_avatar_id: int | None = None
    doomed: list[str] = []

    if body.display_name is not None:
        user.display_name = body.display_name
    if body.bio is not None:
        user.bio = body.bio
    if body.privacy_settings is not None:
        user.privacy_settings = body.privacy_settings.model_dump()

    if body.remove_avatar and user.avatar_media_id is not None:
        old_avatar_id = user.avatar_media_id
        user.avatar_media_id = None
    elif body.avatar_media_id is not None and body.avatar_media_id != user.avatar_media_id:
        media = require_owned_media(db, body.avatar_media_id, user)
        if media is not None and media.kind == "voice":
            raise not_found("That image")
        old_avatar_id = user.avatar_media_id
        user.avatar_media_id = body.avatar_media_id

    if old_avatar_id is not None:
        db.flush()
        release_media(db, old_avatar_id, doomed)
    db.commit()
    for key in doomed:
        storage.delete(key)
    db.refresh(user)
    return user_out(user)


@router.post("/change-password", status_code=status.HTTP_204_NO_CONTENT)
def change_password(
    body: ChangePasswordIn, user: User = Depends(current_user), db: Session = Depends(get_db)
) -> None:
    if not verify_password(body.current_password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Your current password doesn't match.")
    user.password_hash = hash_password(body.new_password)
    db.commit()


@router.post("/delete-account", status_code=status.HTTP_204_NO_CONTENT)
def delete_account(
    body: DeleteAccountIn,
    response: Response,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> None:
    if not verify_password(body.password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "That password doesn't match.")
    storage_keys = list(db.scalars(select(Media.storage_key).where(Media.owner_id == user.id)).all())
    db.delete(user)
    db.commit()
    for key in storage_keys:
        try:
            storage.delete(key)
        except Exception:
            pass
    clear_session_cookie(response)
