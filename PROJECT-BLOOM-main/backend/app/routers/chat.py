"""
Unified Bloom Chat API:
- Personal Chats (dm): friends-only 1-to-1 threads
- Group Chats (group): private multi-member groups with roles & avatar
- Studio Chat (studio): discoverable creative community rooms
"""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_, select, update
from sqlalchemy.orm import Session

from ..access import (
    are_friends,
    can_view_profile,
    not_found,
    privacy_for,
    release_media,
    require_owned_media,
    visibility_allows,
)
from ..db import get_db
from ..models import (
    Conversation,
    ConversationMember,
    FlowerDesign,
    JournalEntry,
    Message,
    MessageReaction,
    Notification,
    User,
    utcnow,
)
from ..notifications import emit_notification, push_pending
from ..realtime import broadcast_channel_sync, connection_hub, notify_user_sync
from ..schemas import (
    DmCreateIn,
    GroupCreateIn,
    GroupPatchIn,
    GroupRoleIn,
    MessageReactionIn,
    MessageSendIn,
    StudioCreateIn,
)
from ..security import current_user
from ..storage import storage
from .friends import find_by_bloom_id

router = APIRouter(prefix="/api/chat", tags=["chat"])

STICKERS = [
    {"id": "rose", "label": "Rose"},
    {"id": "tulip", "label": "Tulip"},
    {"id": "daisy", "label": "Daisy"},
    {"id": "crescent", "label": "Moon"},
    {"id": "heartburst", "label": "Heart"},
    {"id": "sparkle", "label": "Sparkle"},
]
STICKER_MAP = {s["id"]: s for s in STICKERS}


def _member_row(db: Session, conversation_id: int, user_id: int) -> ConversationMember | None:
    return db.scalar(
        select(ConversationMember).where(
            ConversationMember.conversation_id == conversation_id,
            ConversationMember.user_id == user_id,
        )
    )


def _require_member(db: Session, conversation_id: int, user: User) -> tuple[Conversation, ConversationMember]:
    conv = db.get(Conversation, conversation_id)
    member = _member_row(db, conversation_id, user.id) if conv is not None else None
    if conv is None or member is None:
        raise not_found("That conversation")
    return conv, member


def _user_summary(db: Session, target: User, viewer: User) -> dict[str, Any]:
    show_av = target.id == viewer.id or can_view_profile(db, target, viewer) or are_friends(db, viewer.id, target.id)
    priv = privacy_for(target)
    return {
        "bloom_id": target.bloom_id,
        "display_name": target.display_name,
        "avatar_url": f"/api/media/{target.avatar_media_id}" if show_av and target.avatar_media_id else None,
        "online": bool(priv.show_online_status and connection_hub.is_online(target.id)),
    }


def _reaction_map(db: Session, message_ids: list[int], viewer_id: int) -> dict[int, dict[str, Any]]:
    out: dict[int, dict[str, Any]] = {mid: {"counts": {}, "total": 0, "my_reaction": None} for mid in message_ids}
    if not message_ids:
        return out
    rows = db.scalars(select(MessageReaction).where(MessageReaction.message_id.in_(message_ids))).all()
    counts: dict[int, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for r in rows:
        counts[r.message_id][r.kind] += 1
        out[r.message_id]["total"] += 1
        if r.user_id == viewer_id:
            out[r.message_id]["my_reaction"] = r.kind
    for mid, c in counts.items():
        out[mid]["counts"] = dict(c)
    return out


def _message_out(
    msg: Message,
    viewer_id: int,
    reactions: dict[str, Any],
    reply_msg: Message | None = None,
) -> dict[str, Any]:
    deleted = msg.deleted_at is not None
    return {
        "id": msg.id,
        "conversation_id": msg.conversation_id,
        "sender": (
            {
                "bloom_id": msg.sender.bloom_id,
                "display_name": msg.sender.display_name,
                "avatar_url": f"/api/media/{msg.sender.avatar_media_id}" if msg.sender.avatar_media_id else None,
                "is_you": msg.sender_id == viewer_id,
            }
            if msg.sender is not None
            else {"bloom_id": "", "display_name": "Former user", "avatar_url": None, "is_you": False}
        ),
        "kind": "deleted" if deleted else msg.kind,
        "body": "" if deleted else msg.body,
        "media_url": None if deleted or not msg.media_id else f"/api/media/{msg.media_id}",
        "media_id": None if deleted else msg.media_id,
        "shared_ref": None if deleted else msg.shared_ref,
        "reply_to": (
            {
                "id": reply_msg.id,
                "sender_name": reply_msg.sender.display_name if reply_msg.sender else "Former user",
                "kind": "deleted" if reply_msg.deleted_at else reply_msg.kind,
                "body": "" if reply_msg.deleted_at else reply_msg.body[:120],
            }
            if reply_msg is not None
            else None
        ),
        "reactions": reactions,
        "created_at": msg.created_at,
        "deleted": deleted,
    }


def _unread_count(db: Session, conv_id: int, member: ConversationMember) -> int:
    q = select(func.count(Message.id)).where(
        Message.conversation_id == conv_id,
        Message.deleted_at.is_(None),
        or_(Message.sender_id.is_(None), Message.sender_id != member.user_id),
    )
    if member.last_read_message_id is not None:
        q = q.where(Message.id > member.last_read_message_id)
    return int(db.scalar(q) or 0)


def _conversation_out(db: Session, conv: Conversation, viewer: User, me_member: ConversationMember) -> dict[str, Any]:
    members = sorted(conv.members, key=lambda m: (m.role != "owner", m.id))
    last_msg = db.scalar(
        select(Message)
        .where(Message.conversation_id == conv.id, Message.deleted_at.is_(None))
        .order_by(Message.id.desc())
        .limit(1)
    )
    other_member = next((m for m in members if m.user_id != viewer.id), None)
    if conv.kind == "dm" and other_member is not None:
        other_info = _user_summary(db, other_member.user, viewer)
        display_title = other_info["display_name"]
        avatar_url = other_info["avatar_url"]
        other_online = other_info["online"]
    else:
        display_title = conv.title or "Conversation"
        avatar_url = f"/api/media/{conv.avatar_media_id}" if conv.avatar_media_id else None
        other_online = False

    return {
        "id": conv.id,
        "kind": conv.kind,
        "title": display_title,
        "raw_title": conv.title,
        "description": conv.description,
        "avatar_url": avatar_url,
        "my_role": me_member.role,
        "last_read_message_id": me_member.last_read_message_id,
        "unread_count": _unread_count(db, conv.id, me_member),
        "online": other_online,
        "members": [
            {
                **_user_summary(db, m.user, viewer),
                "role": m.role,
                "is_you": m.user_id == viewer.id,
                "last_read_message_id": m.last_read_message_id,
            }
            for m in members
        ],
        "last_message": (
            {
                "id": last_msg.id,
                "kind": last_msg.kind,
                "body": last_msg.body[:120],
                "sender_name": last_msg.sender.display_name if last_msg.sender else "Former user",
                "created_at": last_msg.created_at,
            }
            if last_msg is not None
            else None
        ),
        "updated_at": conv.updated_at,
    }


@router.get("/stickers")
def list_stickers(user: User = Depends(current_user)) -> list[dict[str, str]]:
    return STICKERS


@router.get("/unread-total")
def unread_total(user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict[str, int]:
    memberships = db.scalars(select(ConversationMember).where(ConversationMember.user_id == user.id)).all()
    total = sum(_unread_count(db, m.conversation_id, m) for m in memberships)
    return {"unread_count": total}


@router.get("/conversations")
def list_conversations(
    kind: str | None = Query(default=None),
    q: str = Query(default="", max_length=80),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> list[dict[str, Any]]:
    query = (
        select(Conversation, ConversationMember)
        .join(ConversationMember, ConversationMember.conversation_id == Conversation.id)
        .where(ConversationMember.user_id == user.id)
    )
    if kind in {"dm", "group", "studio", "project"}:
        query = query.where(Conversation.kind == kind)
    else:
        query = query.where(Conversation.kind.in_(["dm", "group", "studio"]))
    rows = db.execute(query.order_by(Conversation.updated_at.desc(), Conversation.id.desc())).all()

    needle = q.strip().lower()
    matching_conv_ids: set[int] = set()
    if needle:
        conv_ids = [conv.id for conv, _ in rows]
        if conv_ids:
            matching_conv_ids = set(
                db.scalars(
                    select(Message.conversation_id).where(
                        Message.conversation_id.in_(conv_ids),
                        Message.deleted_at.is_(None),
                        func.lower(Message.body).contains(needle),
                    )
                ).all()
            )

    out: list[dict[str, Any]] = []
    for conv, member in rows:
        item = _conversation_out(db, conv, user, member)
        if needle:
            names = " ".join(m["display_name"] for m in item["members"])
            haystack = f"{item['title']} {item['description']} {names}".lower()
            if needle not in haystack and conv.id not in matching_conv_ids:
                continue
        out.append(item)
    return out


@router.get("/conversations/{conversation_id}")
def get_conversation(
    conversation_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)
) -> dict[str, Any]:
    conv, member = _require_member(db, conversation_id, user)
    return _conversation_out(db, conv, user, member)


@router.post("/dm", status_code=status.HTTP_201_CREATED)
def open_dm(body: DmCreateIn, user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict[str, Any]:
    other = find_by_bloom_id(db, body.bloom_id)
    if other is None:
        raise not_found("No one with that Bloom ID")
    if other.id == user.id:
        raise HTTPException(422, "You can't start a private chat with yourself.")
    if not are_friends(db, user.id, other.id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Personal Chats are for friends. Add them by Bloom ID first.")
    dm_key = f"{min(user.id, other.id)}:{max(user.id, other.id)}"
    existing = db.scalar(select(Conversation).where(Conversation.dm_key == dm_key))
    if existing is not None:
        member = _member_row(db, existing.id, user.id)
        if member is None:
            member = ConversationMember(conversation_id=existing.id, user_id=user.id, role="member")
            db.add(member)
            db.commit()
            db.refresh(existing)
        return _conversation_out(db, existing, user, member)

    conv = Conversation(kind="dm", title="", dm_key=dm_key, created_by=user.id)
    conv.members.append(ConversationMember(user_id=user.id, role="member"))
    conv.members.append(ConversationMember(user_id=other.id, role="member"))
    db.add(conv)
    db.commit()
    db.refresh(conv)
    return _conversation_out(db, conv, user, _member_row(db, conv.id, user.id))


@router.post("/groups", status_code=status.HTTP_201_CREATED)
def create_group(body: GroupCreateIn, user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict[str, Any]:
    if body.avatar_media_id is not None:
        m = require_owned_media(db, body.avatar_media_id, user)
        if m is not None and m.kind == "voice":
            raise not_found("That image")
    conv = Conversation(
        kind="group",
        title=body.title,
        description=body.description.strip(),
        avatar_media_id=body.avatar_media_id,
        created_by=user.id,
    )
    conv.members.append(ConversationMember(user_id=user.id, role="owner"))
    added_users: list[User] = []
    seen = {user.id}
    for raw_id in body.member_bloom_ids:
        friend = find_by_bloom_id(db, raw_id)
        if friend is None or friend.id in seen:
            continue
        if not are_friends(db, user.id, friend.id):
            raise HTTPException(422, "You can only invite friends to a private group.")
        seen.add(friend.id)
        conv.members.append(ConversationMember(user_id=friend.id, role="member"))
        added_users.append(friend)
    db.add(conv)
    db.flush()
    events = [
        emit_notification(
            db,
            friend,
            user,
            kind="group_message",
            title=f"{user.display_name} added you to “{conv.title}”",
            link=f"/together/{conv.project_id}" if conv.kind == "project" and conv.project_id else f"/chat/{conv.id}",
            target_type="conversation",
            target_id=conv.id,
        )
        for friend in added_users
    ]
    db.commit()
    db.refresh(conv)
    push_pending(events)
    return _conversation_out(db, conv, user, _member_row(db, conv.id, user.id))


def _require_group_manager(db: Session, conv_id: int, user: User) -> tuple[Conversation, ConversationMember]:
    conv, me = _require_member(db, conv_id, user)
    if conv.kind not in {"group", "studio"}:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This conversation cannot be edited like a group.")
    if me.role not in {"owner", "admin"}:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only group owners or admins can do that.")
    return conv, me


@router.patch("/groups/{conversation_id}")
def update_group(
    conversation_id: int, body: GroupPatchIn, user: User = Depends(current_user), db: Session = Depends(get_db)
) -> dict[str, Any]:
    conv, me = _require_group_manager(db, conversation_id, user)
    old_avatar_id: int | None = None
    doomed: list[str] = []
    if body.title is not None:
        conv.title = body.title
    if body.description is not None:
        conv.description = body.description.strip()
    if body.remove_avatar and conv.avatar_media_id is not None:
        old_avatar_id = conv.avatar_media_id
        conv.avatar_media_id = None
    elif body.avatar_media_id is not None and body.avatar_media_id != conv.avatar_media_id:
        m = require_owned_media(db, body.avatar_media_id, user)
        if m is not None and m.kind == "voice":
            raise not_found("That image")
        old_avatar_id = conv.avatar_media_id
        conv.avatar_media_id = body.avatar_media_id
    conv.updated_at = utcnow()
    if old_avatar_id is not None:
        db.flush()
        release_media(db, old_avatar_id, doomed)
    db.commit()
    for key in doomed:
        storage.delete(key)
    db.refresh(conv)
    return _conversation_out(db, conv, user, me)


@router.post("/groups/{conversation_id}/members")
def invite_group_member(
    conversation_id: int, body: DmCreateIn, user: User = Depends(current_user), db: Session = Depends(get_db)
) -> dict[str, Any]:
    conv, me = _require_group_manager(db, conversation_id, user)
    target = find_by_bloom_id(db, body.bloom_id)
    if target is None or (conv.kind == "group" and not are_friends(db, user.id, target.id)):
        raise HTTPException(422, "You can only add friends to a private group.")
    if _member_row(db, conv.id, target.id) is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "They're already in this group.")
    conv.members.append(ConversationMember(conversation_id=conv.id, user_id=target.id, role="member"))
    ev = emit_notification(
        db,
        target,
        user,
        kind="group_message" if conv.kind == "group" else "studio_message",
        title=f"{user.display_name} added you to “{conv.title}”",
        link=f"/chat/{conv.id}",
        target_type="conversation",
        target_id=conv.id,
    )
    db.commit()
    db.refresh(conv)
    push_pending([ev])
    return _conversation_out(db, conv, user, me)


@router.patch("/groups/{conversation_id}/members/{bloom_id}")
def set_member_role(
    conversation_id: int,
    bloom_id: str,
    body: GroupRoleIn,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    conv, me = _require_group_manager(db, conversation_id, user)
    if me.role != "owner":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the group owner can change roles.")
    target_user = find_by_bloom_id(db, bloom_id)
    target_member = _member_row(db, conv.id, target_user.id) if target_user else None
    if target_member is None:
        raise not_found("That member")
    if target_member.role == "owner":
        raise HTTPException(422, "Cannot change the owner's role.")
    target_member.role = body.role
    db.commit()
    db.refresh(conv)
    return _conversation_out(db, conv, user, me)


@router.delete("/groups/{conversation_id}/members/{bloom_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_group_member(
    conversation_id: int, bloom_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)
) -> None:
    conv, me = _require_group_manager(db, conversation_id, user)
    target_user = find_by_bloom_id(db, bloom_id)
    target_member = _member_row(db, conv.id, target_user.id) if target_user else None
    if target_member is None:
        raise not_found("That member")
    if target_member.role == "owner":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "The owner cannot be removed.")
    if me.role == "admin" and target_member.role != "member":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Admins can only remove regular members.")
    db.delete(target_member)
    db.commit()


@router.post("/groups/{conversation_id}/leave", status_code=status.HTTP_204_NO_CONTENT)
def leave_group(conversation_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)) -> None:
    conv, me = _require_member(db, conversation_id, user)
    if conv.kind not in {"group", "studio"}:
        raise HTTPException(422, "You can only leave group or Studio conversations.")
    others = [m for m in sorted(conv.members, key=lambda m: (m.role != "admin", m.id)) if m.user_id != user.id]
    if me.role == "owner" and others:
        others[0].role = "owner"
    db.delete(me)
    if not others:
        avatar_id = conv.avatar_media_id
        msg_media_ids = list(
            db.scalars(select(Message.media_id).where(Message.conversation_id == conv.id, Message.media_id.is_not(None))).all()
        )
        db.delete(conv)
        doomed: list[str] = []
        db.flush()
        for mid in [avatar_id, *msg_media_ids]:
            release_media(db, mid, doomed)
        db.commit()
        for key in doomed:
            storage.delete(key)
        return
    db.commit()


@router.get("/studio/directory")
def studio_directory(
    q: str = Query(default="", max_length=60),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> list[dict[str, Any]]:
    rows = db.scalars(
        select(Conversation).where(Conversation.kind == "studio").order_by(Conversation.updated_at.desc())
    ).all()
    needle = q.strip().lower()
    out: list[dict[str, Any]] = []
    for conv in rows:
        if needle and needle not in f"{conv.title} {conv.description}".lower():
            continue
        joined = any(m.user_id == user.id for m in conv.members)
        out.append(
            {
                "id": conv.id,
                "title": conv.title,
                "description": conv.description,
                "member_count": len(conv.members),
                "joined": joined,
                "updated_at": conv.updated_at,
            }
        )
    return out


@router.post("/studio", status_code=status.HTTP_201_CREATED)
def create_studio_room(
    body: StudioCreateIn, user: User = Depends(current_user), db: Session = Depends(get_db)
) -> dict[str, Any]:
    conv = Conversation(
        kind="studio",
        title=body.title,
        description=body.description.strip(),
        created_by=user.id,
    )
    conv.members.append(ConversationMember(user_id=user.id, role="owner"))
    db.add(conv)
    db.commit()
    db.refresh(conv)
    return _conversation_out(db, conv, user, _member_row(db, conv.id, user.id))


@router.post("/studio/{conversation_id}/join")
def join_studio_room(
    conversation_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)
) -> dict[str, Any]:
    conv = db.get(Conversation, conversation_id)
    if conv is None or conv.kind != "studio":
        raise not_found("That Studio Chat room")
    existing = _member_row(db, conv.id, user.id)
    if existing is None:
        existing = ConversationMember(conversation_id=conv.id, user_id=user.id, role="member")
        db.add(existing)
        db.commit()
        db.refresh(conv)
    return _conversation_out(db, conv, user, existing)


@router.get("/conversations/{conversation_id}/messages")
def list_messages(
    conversation_id: int,
    before_id: int | None = None,
    after_id: int | None = None,
    limit: int = Query(default=40, ge=1, le=100),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    conv, _member = _require_member(db, conversation_id, user)
    query = select(Message).where(Message.conversation_id == conv.id)
    if after_id is not None:
        rows = db.scalars(query.where(Message.id > after_id).order_by(Message.id.asc()).limit(limit)).all()
        has_more = len(rows) == limit
    else:
        if before_id is not None:
            query = query.where(Message.id < before_id)
        rows = db.scalars(query.order_by(Message.id.desc()).limit(limit + 1)).all()
        has_more = len(rows) > limit
        rows = list(reversed(rows[:limit]))

    reply_ids = {m.reply_to_id for m in rows if m.reply_to_id is not None}
    replies = (
        {r.id: r for r in db.scalars(select(Message).where(Message.id.in_(reply_ids))).all()}
        if reply_ids
        else {}
    )
    reacts = _reaction_map(db, [m.id for m in rows], user.id)
    return {
        "items": [
            _message_out(m, user.id, reacts.get(m.id, {"counts": {}, "total": 0, "my_reaction": None}), replies.get(m.reply_to_id))
            for m in rows
        ],
        "has_more": has_more,
    }


def _build_shared_ref(db: Session, share_type: str, share_id: int, user: User) -> tuple[dict[str, Any], int | None]:
    if share_type == "design":
        design = db.get(FlowerDesign, share_id)
        if design is None or not visibility_allows(db, design.owner_id, design.visibility, user):
            raise not_found("That flower")
        return {"type": "design", "id": design.id, "title": design.title, "recipe": design.recipe}, None
    entry = db.get(JournalEntry, share_id)
    if entry is None or entry.deleted_at is not None or not visibility_allows(db, entry.owner_id, entry.visibility, user):
        raise not_found("That journal entry")
    return (
        {
            "type": "entry",
            "id": entry.id,
            "entry_type": entry.entry_type,
            "title": entry.title,
            "caption": entry.caption,
            "recipe": entry.recipe,
        },
        entry.photo_media_id,
    )


@router.post("/conversations/{conversation_id}/messages", status_code=status.HTTP_201_CREATED)
def send_message(
    conversation_id: int, body: MessageSendIn, user: User = Depends(current_user), db: Session = Depends(get_db)
) -> dict[str, Any]:
    conv, me = _require_member(db, conversation_id, user)
    text = body.body.strip()
    media_id: int | None = None
    shared_ref: dict[str, Any] | None = None

    if body.kind == "text":
        if not text:
            raise HTTPException(422, "Message cannot be empty.")
    elif body.kind in {"image", "voice"}:
        media = require_owned_media(db, body.media_id, user)
        if media is None:
            raise HTTPException(422, "This message needs its uploaded file.")
        if body.kind == "voice" and media.kind != "voice":
            raise HTTPException(422, "Invalid voice upload.")
        if body.kind == "image" and media.kind == "voice":
            raise HTTPException(422, "Invalid image upload.")
        media_id = media.id
    elif body.kind == "sticker":
        if not body.sticker_id or body.sticker_id not in STICKER_MAP:
            raise HTTPException(422, "Unknown sticker.")
        shared_ref = {"type": "sticker", **STICKER_MAP[body.sticker_id]}
    elif body.kind == "shared":
        if not body.share_type or body.share_id is None:
            raise HTTPException(422, "Choose a flower or journal page to share.")
        shared_ref, shared_photo_id = _build_shared_ref(db, body.share_type, body.share_id, user)
        media_id = shared_photo_id

    reply_msg: Message | None = None
    if body.reply_to_id is not None:
        reply_msg = db.get(Message, body.reply_to_id)
        if reply_msg is None or reply_msg.conversation_id != conv.id:
            raise not_found("That message")

    msg = Message(
        conversation_id=conv.id,
        sender_id=user.id,
        reply_to_id=reply_msg.id if reply_msg else None,
        kind=body.kind,
        body=text,
        media_id=media_id,
        shared_ref=shared_ref,
    )
    db.add(msg)
    conv.updated_at = utcnow()
    db.flush()
    me.last_read_message_id = msg.id

    notif_kind = (
        "message"
        if conv.kind == "dm"
        else "group_message"
        if conv.kind == "group"
        else "project_activity"
        if conv.kind == "project"
        else "studio_message"
    )
    notif_title = (
        f"New message from {user.display_name}"
        if conv.kind == "dm"
        else f"{user.display_name} in {conv.title or 'Bloom Chat'}"
    )
    preview = text[:120] if text else (
        f"Shared {(shared_ref or {}).get('title', 'a creation')}" if body.kind == "shared" else f"Sent a {body.kind}"
    )
    events = [
        emit_notification(
            db,
            m.user,
            user,
            kind=notif_kind,
            title=notif_title,
            body=preview,
            link=f"/chat/{conv.id}",
            target_type="conversation",
            target_id=conv.id,
        )
        for m in conv.members
        if m.user_id != user.id
    ]
    db.commit()
    db.refresh(msg)

    payload_for_channel = {
        "type": "chat.message",
        "conversation_id": conv.id,
        "message": _message_out(msg, 0, {"counts": {}, "total": 0, "my_reaction": None}, reply_msg),
    }
    broadcast_channel_sync(f"conv:{conv.id}", payload_for_channel)
    for m in conv.members:
        if m.user_id != user.id:
            notify_user_sync(m.user_id, {"type": "chat.unread", "conversation_id": conv.id})
    push_pending(events)

    return _message_out(msg, user.id, {"counts": {}, "total": 0, "my_reaction": None}, reply_msg)


@router.post("/conversations/{conversation_id}/read")
def mark_conversation_read(
    conversation_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)
) -> dict[str, Any]:
    conv, me = _require_member(db, conversation_id, user)
    latest_id = db.scalar(select(func.max(Message.id)).where(Message.conversation_id == conv.id))
    if latest_id is not None and (me.last_read_message_id is None or latest_id > me.last_read_message_id):
        me.last_read_message_id = latest_id
    db.execute(
        update(Notification)
        .where(
            Notification.user_id == user.id,
            Notification.target_type == "conversation",
            Notification.target_id == str(conv.id),
            Notification.is_read.is_(False),
        )
        .values(is_read=True)
    )
    db.commit()
    broadcast_channel_sync(
        f"conv:{conv.id}",
        {
            "type": "chat.read",
            "conversation_id": conv.id,
            "bloom_id": user.bloom_id,
            "last_read_message_id": me.last_read_message_id,
        },
    )
    return {"last_read_message_id": me.last_read_message_id}


@router.post("/messages/{message_id}/react")
def react_message(
    message_id: int, body: MessageReactionIn, user: User = Depends(current_user), db: Session = Depends(get_db)
) -> dict[str, Any]:
    msg = db.get(Message, message_id)
    if msg is None or msg.deleted_at is not None:
        raise not_found("That message")
    _require_member(db, msg.conversation_id, user)
    existing = db.scalar(
        select(MessageReaction).where(MessageReaction.message_id == msg.id, MessageReaction.user_id == user.id)
    )
    if existing is not None:
        if existing.kind == body.kind:
            db.delete(existing)
        else:
            existing.kind = body.kind
    else:
        db.add(MessageReaction(message_id=msg.id, user_id=user.id, kind=body.kind))
    db.commit()
    summary = _reaction_map(db, [msg.id], user.id)[msg.id]
    broadcast_channel_sync(
        f"conv:{msg.conversation_id}",
        {"type": "chat.reaction", "conversation_id": msg.conversation_id, "message_id": msg.id, "reactions": summary},
    )
    return summary


@router.delete("/messages/{message_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_message(message_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)) -> None:
    msg = db.get(Message, message_id)
    if msg is None or msg.deleted_at is not None:
        raise not_found("That message")
    conv, me = _require_member(db, msg.conversation_id, user)
    if msg.sender_id != user.id and me.role not in {"owner", "admin"}:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You can only delete your own messages.")
    old_media_id = msg.media_id
    msg.deleted_at = datetime.now(timezone.utc)
    msg.body = ""
    msg.media_id = None
    msg.shared_ref = None
    doomed: list[str] = []
    db.flush()
    if old_media_id is not None:
        release_media(db, old_media_id, doomed)
    db.commit()
    for key in doomed:
        storage.delete(key)
    broadcast_channel_sync(
        f"conv:{conv.id}",
        {"type": "chat.deleted", "conversation_id": conv.id, "message_id": msg.id},
    )
