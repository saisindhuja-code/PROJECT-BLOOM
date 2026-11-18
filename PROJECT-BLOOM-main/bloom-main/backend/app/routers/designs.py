"""Saved flower designs (reusable recipes)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..access import not_found
from ..db import get_db
from ..models import FlowerDesign, User
from ..schemas import DesignIn, DesignOut
from ..security import current_user

router = APIRouter(prefix="/api/designs", tags=["designs"])


def design_out(design: FlowerDesign) -> DesignOut:
    return DesignOut(
        id=design.id,
        title=design.title,
        recipe=design.recipe,
        created_at=design.created_at,
        updated_at=design.updated_at,
    )


def _owned(db: Session, design_id: int, user: User) -> FlowerDesign:
    design = db.get(FlowerDesign, design_id)
    if design is None or design.owner_id != user.id:
        raise not_found("That design")
    return design


@router.get("", response_model=list[DesignOut])
def list_designs(user: User = Depends(current_user), db: Session = Depends(get_db)) -> list[DesignOut]:
    rows = db.scalars(
        select(FlowerDesign).where(FlowerDesign.owner_id == user.id).order_by(FlowerDesign.updated_at.desc())
    ).all()
    return [design_out(d) for d in rows]


@router.post("", response_model=DesignOut, status_code=status.HTTP_201_CREATED)
def create_design(body: DesignIn, user: User = Depends(current_user), db: Session = Depends(get_db)) -> DesignOut:
    design = FlowerDesign(
        owner_id=user.id,
        title=body.title.strip() or body.recipe.word,
        recipe=body.recipe.model_dump(),
    )
    db.add(design)
    db.commit()
    return design_out(design)


@router.get("/{design_id}", response_model=DesignOut)
def get_design(design_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)) -> DesignOut:
    return design_out(_owned(db, design_id, user))


@router.put("/{design_id}", response_model=DesignOut)
def update_design(
    design_id: int, body: DesignIn, user: User = Depends(current_user), db: Session = Depends(get_db)
) -> DesignOut:
    design = _owned(db, design_id, user)
    design.title = body.title.strip() or body.recipe.word
    design.recipe = body.recipe.model_dump()
    db.commit()
    return design_out(design)


@router.delete("/{design_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_design(design_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)) -> None:
    db.delete(_owned(db, design_id, user))
    db.commit()
