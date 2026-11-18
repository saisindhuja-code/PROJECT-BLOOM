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

from ..access import are_friends, not_found, require_active_member, require_owned_media
from ..db import get_db
from ..models import Contribution, Project, ProjectMember, User, utcnow
from ..schemas import ContributionIn, ProjectIn, ProjectPatch
from ..security import current_user
from .friends import find_by_bloom_id

router = APIRouter(prefix="/api/projects", tags=["projects"])

MAX_MEMBERS = 2
MAX_ITEMS = {"twin": 1, "two": 1, "moment": 4}


def _membership(project: Project, user_id: int) -> ProjectMember | None:
    return next((m for m in project.members if m.user_id == user_id), None)


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
            if c.user_id in names and _membership(project, c.user_id).status == "active"
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
def invite(project_id: int, body: dict[str, str], user: User = Depends(current_user), db: Session = Depends(get_db)):
    project = _owned_project(db, project_id, user)
    _invite(db, project, user, str(body.get("bloom_id", ""))[:20])
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


def _remove_member(db: Session, project: Project, member: ProjectMember) -> None:
    contribution = db.scalar(
        select(Contribution).where(Contribution.project_id == project.id, Contribution.user_id == member.user_id)
    )
    if contribution is not None:
        db.delete(contribution)  # their photos stop being visible to the project
    project.members.remove(member)


@router.post("/{project_id}/decline", status_code=status.HTTP_204_NO_CONTENT)
def decline_invite(project_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)) -> None:
    project = db.get(Project, project_id)
    member = _membership(project, user.id) if project else None
    if member is None or member.status != "invited":
        raise not_found("That invitation")
    _remove_member(db, project, member)
    db.commit()


@router.post("/{project_id}/leave", status_code=status.HTTP_204_NO_CONTENT)
def leave(project_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)) -> None:
    project = db.get(Project, project_id)
    member = _membership(project, user.id) if project else None
    if member is None:
        raise not_found("That project")
    if member.role == "owner":
        raise HTTPException(status.HTTP_409_CONFLICT, "You started this project. Close it instead of leaving.")
    _remove_member(db, project, member)
    db.commit()


@router.delete("/{project_id}/members/{bloom_id}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_member(
    project_id: int, bloom_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)
) -> None:
    project = _owned_project(db, project_id, user)
    member = next((m for m in project.members if m.user.bloom_id == bloom_id and m.role != "owner"), None)
    if member is None:
        raise not_found("That member")
    _remove_member(db, project, member)
    db.commit()


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
def close_project(project_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)) -> None:
    db.delete(_owned_project(db, project_id, user))
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
    if contribution is None:
        contribution = Contribution(project_id=project.id, user_id=user.id, items=items)
        db.add(contribution)
    else:
        contribution.items = items
    project.updated_at = utcnow()
    contribution.updated_at = utcnow()
    db.commit()
    db.refresh(project)
    return project_out(project, user)
