/** Shared Bloom Chat types and API helpers. */
import type { ReactionKind, ReactionSummary } from "./api";

export type ChatKind = "dm" | "group" | "studio" | "project";

export interface ChatMember {
  bloom_id: string;
  display_name: string;
  avatar_url: string | null;
  online: boolean;
  role: "owner" | "admin" | "member";
  is_you: boolean;
  last_read_message_id: number | null;
}

export interface Conversation {
  id: number;
  kind: ChatKind;
  title: string;
  raw_title: string;
  description: string;
  avatar_url: string | null;
  my_role: "owner" | "admin" | "member";
  last_read_message_id: number | null;
  unread_count: number;
  online: boolean;
  members: ChatMember[];
  last_message: {
    id: number;
    kind: string;
    body: string;
    sender_name: string;
    created_at: string;
  } | null;
  updated_at: string;
}

export interface ChatMessage {
  id: number;
  conversation_id: number;
  sender: {
    bloom_id: string;
    display_name: string;
    avatar_url: string | null;
    is_you: boolean;
  };
  kind: "text" | "image" | "voice" | "sticker" | "shared" | "deleted";
  body: string;
  media_url: string | null;
  media_id: number | null;
  shared_ref: {
    type: "sticker" | "design" | "entry";
    id: number | string;
    label?: string;
    title?: string;
    caption?: string;
    entry_type?: string;
    recipe?: unknown;
  } | null;
  reply_to: {
    id: number;
    sender_name: string;
    kind: string;
    body: string;
  } | null;
  reactions: ReactionSummary;
  created_at: string;
  deleted: boolean;
}

export interface StudioRoomSummary {
  id: number;
  title: string;
  description: string;
  member_count: number;
  joined: boolean;
  updated_at: string;
}

export interface StickerItem {
  id: string;
  label: string;
}

export const CHAT_REACTION_KINDS: Array<{ kind: ReactionKind; label: string }> = [
  { kind: "heart", label: "Love" },
  { kind: "bloom", label: "Bloom" },
  { kind: "sparkle", label: "Sparkle" },
  { kind: "leaf", label: "Fresh" },
];

export function pickVoiceMime(): string {
  if (typeof MediaRecorder === "undefined") return "";
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/ogg", "audio/mp4"];
  return candidates.find((t) => MediaRecorder.isTypeSupported(t)) ?? "";
}
