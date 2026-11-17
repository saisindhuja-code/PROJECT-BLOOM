"""Phase 4B (Frontend 3-Column Bloom Chat) implementation script for Bloom 2.0."""

from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent


def write_full(rel: str, content: str) -> None:
    path = ROOT / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content.lstrip("\n"), encoding="utf-8")
    print(f"Wrote   {rel}")


def patch(rel: str, replacements: list[tuple[str, str]]) -> None:
    path = ROOT / rel
    if not path.exists():
        raise FileNotFoundError(f"Missing expected file: {path}")
    text = path.read_text(encoding="utf-8")
    for idx, (old, new) in enumerate(replacements, start=1):
        if new in text:
            print(f"Skipped {rel} (step {idx} already present)")
            continue
        if old not in text:
            raise RuntimeError(f"Could not find target block #{idx} in {rel}")
        text = text.replace(old, new, 1)
    path.write_text(text, encoding="utf-8")
    print(f"Patched {rel}")


def main() -> None:
    if not (ROOT / "frontend" / "src").is_dir():
        sys.exit("Run apply_phase4_frontend.py directly inside PROJECT-BLOOM-main.")

    # 1. Icons.tsx: Add chat-related icons
    patch(
        "frontend/src/components/Icons.tsx",
        [
            (
                "export function BloomMark(p: IconProps) {",
                r'''export const IconChat = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 6.5h14a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5H9.5L5 21v-3.5A1.5 1.5 0 0 1 3.5 16V8A1.5 1.5 0 0 1 5 6.5Z" />
  </Svg>
);

export const IconSend = (p: IconProps) => (
  <Svg {...p}>
    <path d="M21 4 10 14M21 4l-6 17-5-7-7-5 18-5Z" />
  </Svg>
);

export const IconReply = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 14 4 9l5-5" />
    <path d="M4 9h10a6 6 0 0 1 6 6v3" />
  </Svg>
);

export const IconImage = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <circle cx="8.5" cy="10" r="1.5" />
    <path d="m21 15-4.5-4.5L9 18" />
  </Svg>
);

export const IconUsers = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="9" cy="8.5" r="3" />
    <path d="M3.5 19c.6-3 2.8-4.5 5.5-4.5s4.9 1.5 5.5 4.5" />
    <circle cx="16.5" cy="9.5" r="2.2" />
    <path d="M15.5 14.5c2.2.2 4 1.5 4.5 4" />
  </Svg>
);

export function BloomMark(p: IconProps) {''',
            ),
        ],
    )

    # 2. lib/session.tsx: Add unreadChat, sendWs, subscribeWs
    write_full(
        "frontend/src/lib/session.tsx",
        r'''
/**
 * App-wide session: signed-in user, server status, storage backend,
 * inbox, real-time notifications + chat events over /api/ws, and toasts.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { defaultRecipe, normalizeRecipe, type FlowerRecipe } from "../flower/recipe";
import { API_BASE, ApiError, api, type AppNotification, type User } from "./api";
import { localStore, serverStore, type BloomStore } from "./store";

export interface Inbox {
  friend_requests: Array<{ request_id: number; bloom_id: string; display_name: string }>;
  project_invites: Array<{ id: number; title: string; mode: string; owner: string }>;
  live_invites: Array<{ id: string; friend: { bloom_id: string; display_name: string } }>;
  count: number;
}

interface Toast {
  id: number;
  text: string;
  tone: "info" | "error";
}

export type WsEvent = Record<string, unknown> & { type?: string };
type WsListener = (event: WsEvent) => void;

interface SessionValue {
  ready: boolean;
  user: User | null;
  serverOnline: boolean;
  deviceMode: boolean;
  store: BloomStore;
  inbox: Inbox | null;
  refreshInbox: () => void;
  notifications: AppNotification[];
  unreadNotifications: number;
  refreshNotifications: () => void;
  setNotificationsState: (
    updater: (list: AppNotification[]) => AppNotification[],
    unreadDeltaOrValue?: number,
    exactUnread?: boolean,
  ) => void;
  unreadChat: number;
  refreshUnreadChat: () => void;
  sendWs: (msg: Record<string, unknown>) => void;
  subscribeWs: (listener: WsListener) => () => void;
  signIn: (username: string, password: string) => Promise<void>;
  signUp: (username: string, displayName: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  useThisDevice: () => void;
  setUser: (user: User) => void;
  recipe: FlowerRecipe;
  setRecipe: (recipe: FlowerRecipe) => void;
  hasFlower: boolean;
  growFlower: (recipe: FlowerRecipe) => void;
  growCount: number;
  toast: (text: string, tone?: "info" | "error") => void;
  toasts: Toast[];
  dismissToast: (id: number) => void;
}

const SessionContext = createContext<SessionValue | null>(null);

const RECIPE_KEY = "bloom.currentRecipe";
const DEVICE_KEY = "bloom.deviceMode";
const GROWN_KEY = "bloom.hasFlower";

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* storage unavailable */
  }
}

function loadRecipe(): FlowerRecipe {
  const saved = readStorage(RECIPE_KEY);
  if (!saved) return defaultRecipe();
  try {
    return normalizeRecipe(JSON.parse(saved));
  } catch {
    return defaultRecipe();
  }
}

function userWsUrl(): string {
  const base = API_BASE || window.location.origin;
  const url = new URL("/api/ws", base);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [user, setUserState] = useState<User | null>(null);
  const [serverOnline, setServerOnline] = useState(true);
  const [deviceChoice, setDeviceChoice] = useState(() => readStorage(DEVICE_KEY) === "1");
  const [inbox, setInbox] = useState<Inbox | null>(null);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [unreadChat, setUnreadChat] = useState(0);
  const [recipe, setRecipeState] = useState<FlowerRecipe>(loadRecipe);
  const [hasFlower, setHasFlower] = useState(() => readStorage(GROWN_KEY) === "1");
  const [growCount, setGrowCount] = useState(0);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);
  const wsRef = useRef<WebSocket | null>(null);
  const wsListeners = useRef<Set<WsListener>>(new Set());

  const toast = useCallback((text: string, tone: "info" | "error" = "info") => {
    const id = ++toastId.current;
    setToasts((list) => [...list.slice(-2), { id, text, tone }]);
    window.setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), tone === "error" ? 6000 : 3500);
  }, []);

  const dismissToast = useCallback((id: number) => setToasts((list) => list.filter((t) => t.id !== id)), []);

  useEffect(() => {
    let cancelled = false;
    api<{ user: User | null }>("/api/auth/session")
      .then(({ user: me }) => {
        if (!cancelled) {
          setUserState(me);
          setServerOnline(true);
        }
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setServerOnline(!(error instanceof ApiError && error.isOffline));
      })
      .finally(() => !cancelled && setReady(true));
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshInbox = useCallback(() => {
    if (!user) return;
    api<Inbox>("/api/inbox")
      .then((data) => {
        setInbox(data);
        setServerOnline(true);
      })
      .catch((error: unknown) => {
        if (error instanceof ApiError && error.isOffline) setServerOnline(false);
        if (error instanceof ApiError && error.status === 401) setUserState(null);
      });
  }, [user]);

  const refreshNotifications = useCallback(() => {
    if (!user) return;
    api<{ items: AppNotification[]; unread_count: number }>("/api/notifications?limit=40")
      .then((data) => {
        setNotifications(data.items);
        setUnreadNotifications(data.unread_count);
      })
      .catch(() => undefined);
  }, [user]);

  const refreshUnreadChat = useCallback(() => {
    if (!user) return;
    api<{ unread_count: number }>("/api/chat/unread-total")
      .then((data) => setUnreadChat(data.unread_count))
      .catch(() => undefined);
  }, [user]);

  const setNotificationsState = useCallback(
    (updater: (list: AppNotification[]) => AppNotification[], unreadDeltaOrValue?: number, exactUnread = false) => {
      setNotifications(updater);
      if (unreadDeltaOrValue !== undefined) {
        if (exactUnread) setUnreadNotifications(Math.max(0, unreadDeltaOrValue));
        else setUnreadNotifications((n) => Math.max(0, n + unreadDeltaOrValue));
      }
    },
    [],
  );

  const sendWs = useCallback((msg: Record<string, unknown>) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }, []);

  const subscribeWs = useCallback((listener: WsListener) => {
    wsListeners.current.add(listener);
    return () => {
      wsListeners.current.delete(listener);
    };
  }, []);

  useEffect(() => {
    if (!user) {
      setInbox(null);
      setNotifications([]);
      setUnreadNotifications(0);
      setUnreadChat(0);
      return;
    }
    refreshInbox();
    refreshNotifications();
    refreshUnreadChat();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        refreshInbox();
        refreshNotifications();
        refreshUnreadChat();
      }
    }, 20000);

    let closed = false;
    let pingTimer = 0;
    let retryTimer = 0;
    let retries = 0;

    const connectWs = () => {
      if (closed) return;
      let ws: WebSocket;
      try {
        ws = new WebSocket(userWsUrl());
      } catch {
        return;
      }
      wsRef.current = ws;
      ws.onopen = () => {
        retries = 0;
        window.clearInterval(pingTimer);
        pingTimer = window.setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "ping" }));
        }, 25000);
      };
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(String(event.data)) as WsEvent;
          wsListeners.current.forEach((fn) => fn(msg));
          if (msg.type === "notification" && msg.notification) {
            const incoming = msg.notification as AppNotification;
            setNotifications((list) => [incoming, ...list.filter((n) => n.id !== incoming.id)]);
            setUnreadNotifications((n) => n + 1);
            refreshInbox();
            if (!window.location.pathname.startsWith("/chat")) {
              toast(incoming.title);
            }
          } else if (msg.type === "chat.unread") {
            refreshUnreadChat();
          }
        } catch {
          /* ignore malformed frames */
        }
      };
      ws.onclose = (ev) => {
        window.clearInterval(pingTimer);
        if (wsRef.current === ws) wsRef.current = null;
        if (closed || ev.code === 4003) return;
        const delay = Math.min(30000, 1500 * 2 ** retries++);
        retryTimer = window.setTimeout(connectWs, delay);
      };
    };

    connectWs();

    return () => {
      closed = true;
      window.clearInterval(timer);
      window.clearInterval(pingTimer);
      window.clearTimeout(retryTimer);
      wsRef.current?.close(1000, "unmount");
      wsRef.current = null;
    };
  }, [user, refreshInbox, refreshNotifications, refreshUnreadChat, toast]);

  const signIn = useCallback(async (username: string, password: string) => {
    const me = await api<User>("/api/auth/login", { body: { username, password } });
    setUserState(me);
    setServerOnline(true);
    setDeviceChoice(false);
    writeStorage(DEVICE_KEY, null);
  }, []);

  const signUp = useCallback(async (username: string, displayName: string, password: string) => {
    const me = await api<User>("/api/auth/register", { body: { username, display_name: displayName, password } });
    setUserState(me);
    setServerOnline(true);
    setDeviceChoice(false);
    writeStorage(DEVICE_KEY, null);
  }, []);

  const signOut = useCallback(async () => {
    try {
      await api("/api/auth/logout", { method: "POST" });
    } finally {
      setUserState(null);
    }
  }, []);

  const useThisDevice = useCallback(() => {
    setDeviceChoice(true);
    writeStorage(DEVICE_KEY, "1");
  }, []);

  const setRecipe = useCallback((next: FlowerRecipe) => {
    setRecipeState(next);
    writeStorage(RECIPE_KEY, JSON.stringify(next));
  }, []);

  const growFlower = useCallback((next: FlowerRecipe) => {
    setRecipeState(next);
    writeStorage(RECIPE_KEY, JSON.stringify(next));
    setHasFlower(true);
    writeStorage(GROWN_KEY, "1");
    setGrowCount((n) => n + 1);
  }, []);

  const deviceMode = !user && (deviceChoice || !serverOnline);
  const store: BloomStore = user ? serverStore : localStore;

  const value = useMemo<SessionValue>(
    () => ({
      ready,
      user,
      serverOnline,
      deviceMode,
      store,
      inbox,
      refreshInbox,
      notifications,
      unreadNotifications,
      refreshNotifications,
      setNotificationsState,
      unreadChat,
      refreshUnreadChat,
      sendWs,
      subscribeWs,
      signIn,
      signUp,
      signOut,
      useThisDevice,
      setUser: setUserState,
      recipe,
      setRecipe,
      hasFlower,
      growFlower,
      growCount,
      toast,
      toasts,
      dismissToast,
    }),
    [
      ready,
      user,
      serverOnline,
      deviceMode,
      store,
      inbox,
      refreshInbox,
      notifications,
      unreadNotifications,
      refreshNotifications,
      setNotificationsState,
      unreadChat,
      refreshUnreadChat,
      sendWs,
      subscribeWs,
      signIn,
      signUp,
      signOut,
      useThisDevice,
      recipe,
      setRecipe,
      hasFlower,
      growFlower,
      growCount,
      toast,
      toasts,
      dismissToast,
    ],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession must be used inside SessionProvider");
  return value;
}
''',
    )

    # 3. lib/chat.ts
    write_full(
        "frontend/src/lib/chat.ts",
        r'''
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
''',
    )

    # 4. components/ChatView.tsx
    write_full(
        "frontend/src/components/ChatView.tsx",
        r'''
/** Reusable real-time conversation stream + composer (Bloom Chat & Phase 8 Together Chat). */
import { useCallback, useEffect, useRef, useState } from "react";
import { defaultRecipe, normalizeRecipe } from "../flower/recipe";
import { api, errorMessage, mediaUrl, uploadImage, type ReactionKind } from "../lib/api";
import { pickVoiceMime, type ChatMessage, type Conversation, type StickerItem } from "../lib/chat";
import { Link, useRouter } from "../lib/router";
import { useSession } from "../lib/session";
import type { JournalEntry, SavedDesign } from "../lib/store";
import { FlowerPreview } from "./FlowerPreview";
import { IconFlower, IconHeart, IconImage, IconLeaf, IconMic, IconReply, IconSend, IconSparkle, IconTrash, IconUsers, IconX } from "./Icons";
import { Avatar, Loading, Modal, formatDate } from "./ui";

const STICKER_RECIPES: Record<string, ReturnType<typeof defaultRecipe>> = {
  rose: { ...defaultRecipe("rose"), shape: "flower" },
  tulip: { ...defaultRecipe("bloom"), shape: "flower", petalCount: 0.7 },
  daisy: { ...defaultRecipe("daisy"), shape: "flower", colors: { ...defaultRecipe().colors, ring1: "#fff8d6", ring2: "#ffe8a3", ring3: "#ffffff", ring4: "#f6d3dc", ring5: "#e7a3b5" } },
  crescent: { ...defaultRecipe("moon"), shape: "moon" },
  heartburst: { ...defaultRecipe("love"), shape: "heartburst" },
  sparkle: { ...defaultRecipe("shine"), shape: "star" },
};

const REACTION_ICONS: Array<{ kind: ReactionKind; Icon: typeof IconHeart; label: string }> = [
  { kind: "heart", Icon: IconHeart, label: "Love" },
  { kind: "bloom", Icon: IconFlower, label: "Bloom" },
  { kind: "sparkle", Icon: IconSparkle, label: "Sparkle" },
  { kind: "leaf", Icon: IconLeaf, label: "Fresh" },
];

export function ChatView({
  conversation,
  onUpdated,
  onOpenInfo,
  onBack,
}: {
  conversation: Conversation;
  onUpdated: () => void;
  onOpenInfo?: () => void;
  onBack?: () => void;
}) {
  const { user, store, sendWs, subscribeWs, toast, growFlower, refreshUnreadChat, refreshNotifications } = useSession();
  const { navigate } = useRouter();
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [text, setText] = useState("");
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [sending, setSending] = useState(false);
  const [typingUsers, setTypingUsers] = useState<Map<string, string>>(new Map());
  const [shareOpen, setShareOpen] = useState(false);
  const [stickers, setStickers] = useState<StickerItem[]>([]);
  const [designs, setDesigns] = useState<SavedDesign[]>([]);
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);

  const listRef = useRef<HTMLDivElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const typingTimer = useRef<number>(0);
  const isTypingSent = useRef(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordStreamRef = useRef<MediaStream | null>(null);
  const recordChunksRef = useRef<Blob[]>([]);
  const recordStartRef = useRef<number>(0);
  const recordTickRef = useRef<number>(0);
  const lastMsgIdRef = useRef<number | null>(null);

  const channel = `conv:${conversation.id}`;

  const markRead = useCallback(() => {
    api(`/api/chat/conversations/${conversation.id}/read`, { method: "POST" })
      .then(() => {
        refreshUnreadChat();
        refreshNotifications();
        onUpdated();
      })
      .catch(() => undefined);
  }, [conversation.id, refreshUnreadChat, refreshNotifications, onUpdated]);

  const scrollToBottom = () => {
    window.requestAnimationFrame(() => {
      const el = listRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  };

  useEffect(() => {
    let cancelled = false;
    setMessages(null);
    setReplyTo(null);
    setTypingUsers(new Map());
    api<{ items: ChatMessage[]; has_more: boolean }>(`/api/chat/conversations/${conversation.id}/messages?limit=40`)
      .then((res) => {
        if (cancelled) return;
        setMessages(res.items);
        setHasMore(res.has_more);
        lastMsgIdRef.current = res.items.length ? res.items[res.items.length - 1].id : null;
        markRead();
        scrollToBottom();
      })
      .catch((e) => {
        if (cancelled) return;
        setMessages([]);
        toast(errorMessage(e), "error");
      });
    return () => {
      cancelled = true;
    };
  }, [conversation.id, markRead, toast]);

  useEffect(() => {
    sendWs({ type: "subscribe", channel });
    const unsub = subscribeWs((ev) => {
      if (ev.type === "ready") {
        sendWs({ type: "subscribe", channel });
        const after = lastMsgIdRef.current;
        if (after) {
          api<{ items: ChatMessage[] }>(`/api/chat/conversations/${conversation.id}/messages?after_id=${after}`)
            .then((res) => {
              if (res.items.length) {
                setMessages((list) => {
                  const existing = new Set((list ?? []).map((m) => m.id));
                  const merged = [...(list ?? []), ...res.items.filter((m) => !existing.has(m.id))];
                  lastMsgIdRef.current = merged[merged.length - 1]?.id ?? after;
                  return merged;
                });
                markRead();
                scrollToBottom();
              }
            })
            .catch(() => undefined);
        }
        return;
      }
      if (ev.conversation_id !== conversation.id && ev.channel !== channel) return;

      if (ev.type === "chat.message" && ev.message) {
        const incoming = ev.message as ChatMessage;
        const normalized: ChatMessage = {
          ...incoming,
          sender: { ...incoming.sender, is_you: incoming.sender.bloom_id === user?.bloom_id },
        };
        setMessages((list) => {
          const base = list ?? [];
          if (base.some((m) => m.id === normalized.id)) return base;
          const next = [...base, normalized];
          lastMsgIdRef.current = normalized.id;
          return next;
        });
        setTypingUsers((m) => {
          const copy = new Map(m);
          copy.delete(normalized.sender.bloom_id);
          return copy;
        });
        if (!normalized.sender.is_you) markRead();
        scrollToBottom();
        onUpdated();
      } else if (ev.type === "chat.reaction") {
        const mid = Number(ev.message_id);
        setMessages((list) =>
          list ? list.map((m) => (m.id === mid ? { ...m, reactions: ev.reactions as ChatMessage["reactions"] } : m)) : list,
        );
      } else if (ev.type === "chat.deleted") {
        const mid = Number(ev.message_id);
        setMessages((list) =>
          list ? list.map((m) => (m.id === mid ? { ...m, deleted: true, kind: "deleted", body: "", media_url: null, shared_ref: null } : m)) : list,
        );
      } else if (ev.type === "chat.read") {
        onUpdated();
      } else if (ev.type === "typing") {
        const bid = String(ev.bloom_id ?? "");
        const name = String(ev.display_name ?? "");
        if (!bid || bid === user?.bloom_id) return;
        setTypingUsers((prev) => {
          const next = new Map(prev);
          if (ev.active) next.set(bid, name);
          else next.delete(bid);
          return next;
        });
      }
    });

    return () => {
      unsub();
      if (isTypingSent.current) {
        sendWs({ type: "typing", channel, active: false });
        isTypingSent.current = false;
      }
      sendWs({ type: "unsubscribe", channel });
    };
  }, [conversation.id, channel, sendWs, subscribeWs, user?.bloom_id, markRead, onUpdated]);

  useEffect(() => {
    return () => {
      window.clearInterval(recordTickRef.current);
      window.clearTimeout(typingTimer.current);
      recorderRef.current?.stop();
      recordStreamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const loadOlder = async () => {
    if (!messages?.length || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const firstId = messages[0].id;
      const res = await api<{ items: ChatMessage[]; has_more: boolean }>(
        `/api/chat/conversations/${conversation.id}/messages?before_id=${firstId}&limit=40`,
      );
      setMessages((list) => [...res.items, ...(list ?? [])]);
      setHasMore(res.has_more);
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setLoadingOlder(false);
    }
  };

  const onTextChange = (val: string) => {
    setText(val);
    if (!isTypingSent.current) {
      isTypingSent.current = true;
      sendWs({ type: "typing", channel, active: true });
    }
    window.clearTimeout(typingTimer.current);
    typingTimer.current = window.setTimeout(() => {
      if (isTypingSent.current) {
        isTypingSent.current = false;
        sendWs({ type: "typing", channel, active: false });
      }
    }, 2500);
  };

  const sendPost = async (body: Record<string, unknown>) => {
    setSending(true);
    try {
      const sent = await api<ChatMessage>(`/api/chat/conversations/${conversation.id}/messages`, { body });
      setMessages((list) => [...(list ?? []), { ...sent, sender: { ...sent.sender, is_you: true } }]);
      lastMsgIdRef.current = sent.id;
      setText("");
      setReplyTo(null);
      scrollToBottom();
      onUpdated();
      if (isTypingSent.current) {
        isTypingSent.current = false;
        sendWs({ type: "typing", channel, active: false });
      }
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setSending(false);
    }
  };

  const sendText = () => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    void sendPost({ kind: "text", body: trimmed, reply_to_id: replyTo?.id });
  };

  const uploadAndSendImage = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast("Please choose a JPEG, PNG or WebP image.", "error");
      return;
    }
    try {
      const media = await uploadImage(file, "chat_image", file.name);
      await sendPost({ kind: "image", media_id: media.id, reply_to_id: replyTo?.id });
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  const startVoiceRecording = async () => {
    const mime = pickVoiceMime();
    if (!mime) {
      toast("Voice recording is not supported in this browser.", "error");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordStreamRef.current = stream;
      recordChunksRef.current = [];
      const recorder = new MediaRecorder(stream, { mimeType: mime });
      recorderRef.current = recorder;
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) recordChunksRef.current.push(e.data);
      };
      recorder.start(100);
      recordStartRef.current = Date.now();
      setRecording(true);
      setRecordSeconds(0);
      recordTickRef.current = window.setInterval(() => {
        setRecordSeconds(Math.round((Date.now() - recordStartRef.current) / 1000));
      }, 1000);
    } catch (e) {
      toast("Microphone access was declined.", "error");
    }
  };

  const stopVoiceRecording = async (send: boolean) => {
    window.clearInterval(recordTickRef.current);
    const recorder = recorderRef.current;
    if (!recorder) return;
    const durationMs = Date.now() - recordStartRef.current;
    setRecording(false);
    setRecordSeconds(0);
    const stopped = new Promise<Blob>((resolve) => {
      recorder.onstop = () => {
        const mime = recorder.mimeType || "audio/webm";
        resolve(new Blob(recordChunksRef.current, { type: mime }));
      };
    });
    recorder.stop();
    recordStreamRef.current?.getTracks().forEach((t) => t.stop());
    recorderRef.current = null;
    recordStreamRef.current = null;

    if (!send || durationMs < 500) return;
    const audioBlob = await stopped;
    try {
      const ext = audioBlob.type.includes("ogg") ? "ogg" : audioBlob.type.includes("mp4") ? "m4a" : "webm";
      const form = new FormData();
      form.append("file", audioBlob, `voice.${ext}`);
      form.append("kind", "voice");
      form.append("duration_ms", String(durationMs));
      const media = await api<{ id: number }>("/api/media", { form });
      await sendPost({ kind: "voice", media_id: media.id, reply_to_id: replyTo?.id });
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  const openSharePicker = async () => {
    setShareOpen(true);
    try {
      const [stk, dsg, ent] = await Promise.all([
        api<StickerItem[]>("/api/chat/stickers"),
        store.listDesigns(),
        store.listEntries({ type: "" }),
      ]);
      setStickers(stk);
      setDesigns(dsg);
      setEntries(ent.filter((e) => e.visibility === "friends" || e.visibility === "public"));
    } catch {
      /* ignore */
    }
  };

  const toggleMsgReaction = async (msgId: number, kind: ReactionKind) => {
    try {
      const next = await api<ChatMessage["reactions"]>(`/api/chat/messages/${msgId}/react`, { body: { kind } });
      setMessages((list) => (list ? list.map((m) => (m.id === msgId ? { ...m, reactions: next } : m)) : list));
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  const deleteMsg = async (msgId: number) => {
    if (!window.confirm("Delete this message?")) return;
    try {
      await api(`/api/chat/messages/${msgId}`, { method: "DELETE" });
      setMessages((list) =>
        list ? list.map((m) => (m.id === msgId ? { ...m, deleted: true, kind: "deleted", body: "", media_url: null, shared_ref: null } : m)) : list,
      );
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  const typingArray = useMemo(() => Array.from(typingUsers.values()), [typingUsers]);

  return (
    <div className="chat-view">
      <header className="chat-header">
        <div className="row" style={{ gap: 10, flex: 1 }}>
          {onBack && (
            <button type="button" className="btn icon small quiet mobile-back-btn" aria-label="Back to conversations" onClick={onBack}>
              ✕
            </button>
          )}
          <Avatar name={conversation.title} src={conversation.avatar_url} />
          <div className="chat-title-box">
            <div className="row" style={{ gap: 8 }}>
              <h3>{conversation.title}</h3>
              {conversation.kind === "dm" && conversation.online && <span className="online-dot" title="Online" />}
            </div>
            <span className="muted small">
              {conversation.kind === "dm"
                ? conversation.online ? "Online" : "Direct message"
                : `${conversation.members.length} members · ${conversation.kind === "studio" ? "Studio room" : "Group"}`}
            </span>
          </div>
        </div>
        {conversation.kind !== "dm" && onOpenInfo && (
          <button type="button" className="btn icon small quiet" aria-label="Group info & members" onClick={onOpenInfo}>
            <IconUsers />
          </button>
        )}
      </header>

      <div ref={listRef} className="chat-messages">
        {hasMore && (
          <button type="button" className="btn small quiet load-older-btn" disabled={loadingOlder} onClick={() => void loadOlder()}>
            {loadingOlder ? <span className="spinner" /> : "Load older messages"}
          </button>
        )}
        {messages === null ? (
          <Loading label="Opening conversation" />
        ) : messages.length === 0 ? (
          <div className="chat-empty">
            <IconFlower />
            <p className="muted">No messages yet. Say hello or share a flower!</p>
          </div>
        ) : (
          messages.map((msg) => (
            <div key={msg.id} className={`msg-bubble${msg.sender.is_you ? " mine" : ""}${msg.deleted ? " deleted" : ""}`}>
              {!msg.sender.is_you && conversation.kind !== "dm" && (
                <span className="msg-sender">{msg.sender.display_name}</span>
              )}
              {msg.reply_to && (
                <div className="msg-reply-quote">
                  <strong>{msg.reply_to.sender_name}</strong>
                  <span>{msg.reply_to.kind === "deleted" ? "Message deleted" : msg.reply_to.body || `[${msg.reply_to.kind}]`}</span>
                </div>
              )}
              {msg.kind === "text" && <p className="msg-text">{msg.body}</p>}
              {msg.kind === "image" && msg.media_url && (
                <img className="msg-media-img" src={mediaUrl(msg.media_url)!} alt="" loading="lazy" />
              )}
              {msg.kind === "voice" && msg.media_url && (
                <audio className="msg-audio" controls src={mediaUrl(msg.media_url)!} preload="none" />
              )}
              {msg.kind === "sticker" && msg.shared_ref && (
                <div className="msg-sticker">
                  <FlowerPreview
                    recipe={STICKER_RECIPES[String(msg.shared_ref.id)] ?? defaultRecipe("bloom")}
                    label={msg.shared_ref.label ?? "Sticker"}
                  />
                  <span className="eyebrow">{msg.shared_ref.label}</span>
                </div>
              )}
              {msg.kind === "shared" && msg.shared_ref && (
                <div className="msg-shared-card">
                  {msg.shared_ref.type === "design" && msg.shared_ref.recipe && (
                    <>
                      <FlowerPreview recipe={normalizeRecipe(msg.shared_ref.recipe)} />
                      <div className="row between">
                        <strong>{msg.shared_ref.title}</strong>
                        <button
                          type="button"
                          className="btn small quiet"
                          onClick={() => {
                            growFlower(normalizeRecipe(msg.shared_ref!.recipe));
                            navigate("/studio");
                          }}
                        >
                          Studio
                        </button>
                      </div>
                    </>
                  )}
                  {msg.shared_ref.type === "entry" && (
                    <>
                      {msg.media_url && <img src={mediaUrl(msg.media_url)!} alt="" />}
                      <div className="row between">
                        <div>
                          <strong>{msg.shared_ref.title}</strong>
                          {msg.shared_ref.caption && <span className="muted small">{msg.shared_ref.caption}</span>}
                        </div>
                        <Link to={`/journal/${msg.shared_ref.id}`} className="btn small quiet">
                          Journal
                        </Link>
                      </div>
                    </>
                  )}
                </div>
              )}
              {msg.kind === "deleted" && <p className="muted small italic">This message was deleted.</p>}

              <div className="msg-footer">
                <span className="msg-time">{formatDate(msg.created_at)}</span>
                {!msg.deleted && (
                  <div className="msg-actions">
                    <button type="button" className="btn icon small quiet" title="Reply" onClick={() => setReplyTo(msg)}>
                      <IconReply />
                    </button>
                    <div className="msg-reaction-picker">
                      {REACTION_ICONS.map(({ kind, Icon, label }) => (
                        <button
                          key={kind}
                          type="button"
                          className={`btn icon small quiet${msg.reactions?.my_reaction === kind ? " active" : ""}`}
                          title={label}
                          onClick={() => void toggleMsgReaction(msg.id, kind)}
                        >
                          <Icon width={12} height={12} />
                        </button>
                      ))}
                    </div>
                    {(msg.sender.is_you || conversation.my_role === "owner" || conversation.my_role === "admin") && (
                      <button type="button" className="btn icon small quiet danger" title="Delete" onClick={() => void deleteMsg(msg.id)}>
                        <IconTrash />
                      </button>
                    )}
                  </div>
                )}
              </div>

              {msg.reactions && msg.reactions.total > 0 && (
                <div className="msg-reactions-pills">
                  {REACTION_ICONS.map(({ kind, Icon }) => {
                    const count = msg.reactions.counts[kind] ?? 0;
                    if (count === 0) return null;
                    return (
                      <button
                        key={kind}
                        type="button"
                        className={`reaction-pill${msg.reactions.my_reaction === kind ? " mine" : ""}`}
                        onClick={() => void toggleMsgReaction(msg.id, kind)}
                      >
                        <Icon width={11} height={11} />
                        <span>{count}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {typingArray.length > 0 && (
        <div className="typing-indicator">
          <span>{typingArray.join(", ")} {typingArray.length === 1 ? "is" : "are"} typing…</span>
        </div>
      )}

      {replyTo && (
        <div className="reply-preview-bar">
          <div className="reply-preview-content">
            <span className="eyebrow">Replying to {replyTo.sender.display_name}</span>
            <p className="small">{replyTo.body || `[${replyTo.kind}]`}</p>
          </div>
          <button type="button" className="btn icon small quiet" onClick={() => setReplyTo(null)}>
            <IconX />
          </button>
        </div>
      )}

      {recording ? (
        <div className="voice-record-bar">
          <span className="record-dot" />
          <span>Recording voice note… {recordSeconds}s</span>
          <div className="btn-row" style={{ marginLeft: "auto" }}>
            <button type="button" className="btn small quiet" onClick={() => void stopVoiceRecording(false)}>
              Cancel
            </button>
            <button type="button" className="btn small primary" onClick={() => void stopVoiceRecording(true)}>
              Send voice note
            </button>
          </div>
        </div>
      ) : (
        <div className="chat-composer">
          <button type="button" className="btn icon quiet" title="Share flower, photo or sticker" onClick={() => void openSharePicker()}>
            <IconFlower />
          </button>
          <button type="button" className="btn icon quiet" title="Attach picture" onClick={() => imageInput.current?.click()}>
            <IconImage />
          </button>
          <input
            ref={imageInput}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              void uploadAndSendImage(file);
            }}
          />
          <button type="button" className="btn icon quiet" title="Record voice note" onClick={() => void startVoiceRecording()}>
            <IconMic />
          </button>
          <input
            type="text"
            className="chat-input"
            placeholder="Write a message…"
            value={text}
            maxLength={4000}
            onChange={(e) => onTextChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                sendText();
              }
            }}
          />
          <button type="button" className="btn icon primary" disabled={!text.trim() || sending} onClick={sendText}>
            <IconSend />
          </button>
        </div>
      )}

      {shareOpen && (
        <Modal title="Share in chat" onClose={() => setShareOpen(false)} wide>
          <div className="stack" style={{ gap: 24 }}>
            <div>
              <h3>Botanical stickers</h3>
              <div className="sticker-grid">
                {stickers.map((stk) => (
                  <button
                    key={stk.id}
                    type="button"
                    className="sticker-btn"
                    onClick={() => {
                      setShareOpen(false);
                      void sendPost({ kind: "sticker", sticker_id: stk.id, reply_to_id: replyTo?.id });
                    }}
                  >
                    <FlowerPreview recipe={STICKER_RECIPES[stk.id] ?? defaultRecipe("bloom")} label={stk.label} />
                    <span>{stk.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {designs.length > 0 && (
              <div>
                <h3>Share your flowers</h3>
                <div className="design-list">
                  {designs.slice(0, 10).map((d) => (
                    <div key={d.id} className="person">
                      <div style={{ width: 44, height: 44, flex: "none" }}>
                        <FlowerPreview recipe={d.recipe} />
                      </div>
                      <div className="who">
                        <strong>{d.title}</strong>
                        <span className="eyebrow">{d.visibility}</span>
                      </div>
                      <button
                        type="button"
                        className="btn small primary"
                        onClick={() => {
                          setShareOpen(false);
                          void sendPost({ kind: "shared", share_type: "design", share_id: Number(d.id.replace(/^s:/, "")), reply_to_id: replyTo?.id });
                        }}
                      >
                        Share
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {entries.length > 0 && (
              <div>
                <h3>Share journal creations</h3>
                <div className="design-list">
                  {entries.slice(0, 10).map((e) => (
                    <div key={e.id} className="person">
                      <div style={{ width: 44, height: 44, flex: "none", overflow: "hidden", borderRadius: 4 }}>
                        {e.photoUrl ? <img src={mediaUrl(e.photoUrl)!} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : e.recipe ? <FlowerPreview recipe={e.recipe} /> : null}
                      </div>
                      <div className="who">
                        <strong>{e.title || "Untitled"}</strong>
                        <span className="eyebrow">{e.visibility} · {e.entry_type}</span>
                      </div>
                      <button
                        type="button"
                        className="btn small primary"
                        onClick={() => {
                          setShareOpen(false);
                          void sendPost({ kind: "shared", share_type: "entry", share_id: Number(e.id.replace(/^s:/, "")), reply_to_id: replyTo?.id });
                        }}
                      >
                        Share
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
''',
    )

    # 5. pages/Chat.tsx: 3-column desktop / responsive mobile Chat page
    write_full(
        "frontend/src/pages/Chat.tsx",
        r'''
/** Three-column Bloom Chat page (Personal DMs, Group Chats & Studio Chat). */
import { useCallback, useEffect, useState } from "react";
import { ChatView } from "../components/ChatView";
import { IconChat, IconPlus, IconUsers } from "../components/Icons";
import { Avatar, Empty, Loading, Modal, SignInNeeded, formatDate } from "../components/ui";
import { api, errorMessage } from "../lib/api";
import type { ChatKind, Conversation, StudioRoomSummary } from "../lib/chat";
import { Link, useRouter } from "../lib/router";
import { useSession } from "../lib/session";
import { useFriends } from "./Friends";

export function ChatPage({ conversationId }: { conversationId?: string }) {
  const { user, toast } = useSession();
  const { navigate } = useRouter();
  const { data: friendsData } = useFriends();
  const [kindFilter, setKindFilter] = useState<ChatKind | "all">("all");
  const [query, setQuery] = useState("");
  const [conversations, setConversations] = useState<Conversation[] | null>(null);
  const [activeConv, setActiveConv] = useState<Conversation | null>(null);
  const [newDmOpen, setNewDmOpen] = useState(false);
  const [newGroupOpen, setNewGroupOpen] = useState(false);
  const [newStudioOpen, setNewStudioOpen] = useState(false);
  const [studioDirectoryOpen, setStudioDirectoryOpen] = useState(false);
  const [studioRooms, setStudioRooms] = useState<StudioRoomSummary[]>([]);
  const [infoOpen, setInfoOpen] = useState(false);
  const [groupTitle, setGroupTitle] = useState("");
  const [groupDesc, setGroupDesc] = useState("");
  const [selectedFriends, setSelectedFriends] = useState<string[]>([]);
  const [studioTitle, setStudioTitle] = useState("");
  const [studioDesc, setStudioDesc] = useState("");
  const [busy, setBusy] = useState(false);

  const loadConversations = useCallback(() => {
    if (!user) return Promise.resolve();
    const params = new URLSearchParams();
    if (kindFilter !== "all") params.set("kind", kindFilter);
    if (query.trim()) params.set("q", query.trim());
    return api<Conversation[]>(`/api/chat/conversations?${params}`)
      .then((res) => {
        setConversations(res);
        if (conversationId) {
          const match = res.find((c) => c.id === Number(conversationId));
          if (match) setActiveConv(match);
        } else if (!activeConv && res.length > 0 && window.innerWidth >= 900) {
          setActiveConv(res[0]);
        }
      })
      .catch((e) => {
        setConversations([]);
        toast(errorMessage(e), "error");
      });
  }, [user, kindFilter, query, conversationId, activeConv, toast]);

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    if (conversationId && conversations) {
      const match = conversations.find((c) => c.id === Number(conversationId));
      if (match) setActiveConv(match);
    }
  }, [conversationId, conversations]);

  if (!user) {
    return (
      <main className="page">
        <SignInNeeded what="Bloom Chat" />
      </main>
    );
  }

  const openDmWithFriend = async (bloomId: string) => {
    setBusy(true);
    try {
      const conv = await api<Conversation>("/api/chat/dm", { body: { bloom_id: bloomId } });
      setNewDmOpen(false);
      setActiveConv(conv);
      navigate(`/chat/${conv.id}`);
      void loadConversations();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  };

  const createGroupChat = async () => {
    if (!groupTitle.trim()) return;
    setBusy(true);
    try {
      const conv = await api<Conversation>("/api/chat/groups", {
        body: { title: groupTitle.trim(), description: groupDesc.trim(), member_bloom_ids: selectedFriends },
      });
      setNewGroupOpen(false);
      setGroupTitle("");
      setGroupDesc("");
      setSelectedFriends([]);
      setActiveConv(conv);
      navigate(`/chat/${conv.id}`);
      void loadConversations();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  };

  const createStudio = async () => {
    if (!studioTitle.trim()) return;
    setBusy(true);
    try {
      const conv = await api<Conversation>("/api/chat/studio", {
        body: { title: studioTitle.trim(), description: studioDesc.trim() },
      });
      setNewStudioOpen(false);
      setStudioTitle("");
      setStudioDesc("");
      setActiveConv(conv);
      navigate(`/chat/${conv.id}`);
      void loadConversations();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  };

  const openStudioDirectory = async () => {
    setStudioDirectoryOpen(true);
    try {
      const rooms = await api<StudioRoomSummary[]>("/api/chat/studio/directory");
      setStudioRooms(rooms);
    } catch {
      /* ignore */
    }
  };

  const joinStudio = async (roomId: number) => {
    try {
      const conv = await api<Conversation>(`/api/chat/studio/${roomId}/join`, { method: "POST" });
      setStudioDirectoryOpen(false);
      setActiveConv(conv);
      navigate(`/chat/${conv.id}`);
      void loadConversations();
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  return (
    <main className="page chat-page">
      <div className="chat-layout">
        <aside className="chat-nav-col">
          <div className="chat-nav-header">
            <span className="wordmark" style={{ fontSize: 24 }}>bloom chat</span>
          </div>
          <div className="chat-nav-items">
            <button type="button" className={`chat-nav-link${kindFilter === "all" ? " active" : ""}`} onClick={() => setKindFilter("all")}>
              <IconChat /> All Conversations
            </button>
            <button type="button" className={`chat-nav-link${kindFilter === "dm" ? " active" : ""}`} onClick={() => setKindFilter("dm")}>
              <IconChat /> Personal Chats
            </button>
            <button type="button" className={`chat-nav-link${kindFilter === "group" ? " active" : ""}`} onClick={() => setKindFilter("group")}>
              <IconUsers /> Group Chats
            </button>
            <button type="button" className={`chat-nav-link${kindFilter === "studio" ? " active" : ""}`} onClick={() => setKindFilter("studio")}>
              <IconChat /> Studio Chat
            </button>
          </div>
          <div className="chat-nav-actions">
            <button type="button" className="btn small primary" style={{ width: "100%" }} onClick={() => setNewDmOpen(true)}>
              <IconPlus /> New DM
            </button>
            <button type="button" className="btn small" style={{ width: "100%" }} onClick={() => setNewGroupOpen(true)}>
              <IconUsers /> New Group
            </button>
            <button type="button" className="btn small quiet" style={{ width: "100%" }} onClick={() => void openStudioDirectory()}>
              Studio Rooms
            </button>
          </div>
        </aside>

        <section className={`chat-list-col${activeConv ? " has-active" : ""}`}>
          <div className="chat-list-header">
            <input
              type="search"
              placeholder="Search conversations…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="chat-conversation-items">
            {conversations === null ? (
              <Loading label="Loading chats" />
            ) : conversations.length === 0 ? (
              <Empty title="No chats found">Start a DM with a friend or create a group!</Empty>
            ) : (
              conversations.map((conv) => (
                <button
                  key={conv.id}
                  type="button"
                  className={`chat-item-row${activeConv?.id === conv.id ? " active" : ""}`}
                  onClick={() => {
                    setActiveConv(conv);
                    navigate(`/chat/${conv.id}`);
                  }}
                >
                  <div className="chat-item-avatar-wrap">
                    <Avatar name={conv.title} src={conv.avatar_url} />
                    {conv.kind === "dm" && conv.online && <span className="online-dot" />}
                  </div>
                  <div className="chat-item-details">
                    <div className="row between">
                      <strong className="chat-item-title">{conv.title}</strong>
                      <span className="chat-item-time">{formatDate(conv.updated_at)}</span>
                    </div>
                    <div className="row between">
                      <span className="chat-item-snippet">
                        {conv.last_message ? `${conv.last_message.sender_name}: ${conv.last_message.body || `[${conv.last_message.kind}]`}` : "No messages yet"}
                      </span>
                      {conv.unread_count > 0 && <span className="badge">{conv.unread_count}</span>}
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </section>

        <section className={`chat-main-col${!activeConv ? " empty-main" : ""}`}>
          {activeConv ? (
            <ChatView
              conversation={activeConv}
              onUpdated={() => void loadConversations()}
              onOpenInfo={() => setInfoOpen(true)}
              onBack={() => setActiveConv(null)}
            />
          ) : (
            <Empty title="Select a conversation">Choose someone from the list or start a new chat to begin.</Empty>
          )}
        </section>
      </div>

      {newDmOpen && (
        <Modal title="Start a Personal Chat" onClose={() => setNewDmOpen(false)}>
          <div className="stack">
            <p className="muted small">You can chat directly with anyone on your friends list.</p>
            {!friendsData || friendsData.friends.length === 0 ? (
              <Empty title="No friends yet" action={<Link to="/friends" className="btn small primary">Add friends</Link>}>
                Add friends by Bloom ID first to message them.
              </Empty>
            ) : (
              <div className="design-list">
                {friendsData.friends.map((f) => (
                  <div key={f.bloom_id} className="person">
                    <Avatar name={f.display_name} src={f.avatar_url} />
                    <div className="who">
                      <strong>{f.display_name}</strong>
                      <span className="bloom-id">{f.bloom_id}</span>
                    </div>
                    <button type="button" className="btn small primary" disabled={busy} onClick={() => void openDmWithFriend(f.bloom_id)}>
                      Chat
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Modal>
      )}

      {newGroupOpen && (
        <Modal title="Create a Group Chat" onClose={() => setNewGroupOpen(false)}>
          <form className="stack" onSubmit={(e) => { e.preventDefault(); void createGroupChat(); }}>
            <label className="field">
              <span>Group Name</span>
              <input type="text" required maxLength={80} placeholder="e.g. Botanical Studio" value={groupTitle} onChange={(e) => setGroupTitle(e.target.value)} />
            </label>
            <label className="field">
              <span>Description</span>
              <input type="text" maxLength={300} placeholder="What is this group about?" value={groupDesc} onChange={(e) => setGroupDesc(e.target.value)} />
            </label>
            <div>
              <span className="label">Invite Friends</span>
              <div className="chips" style={{ marginTop: 8 }}>
                {friendsData?.friends.map((f) => {
                  const selected = selectedFriends.includes(f.bloom_id);
                  return (
                    <button
                      key={f.bloom_id}
                      type="button"
                      className="chip"
                      aria-pressed={selected}
                      onClick={() => {
                        setSelectedFriends((list) => selected ? list.filter((id) => id !== f.bloom_id) : [...list, f.bloom_id]);
                      }}
                    >
                      {f.display_name}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="btn-row">
              <button type="submit" className="btn primary" disabled={!groupTitle.trim() || busy}>
                Create Group
              </button>
              <button type="button" className="btn quiet" onClick={() => setNewGroupOpen(false)}>
                Cancel
              </button>
            </div>
          </form>
        </Modal>
      )}

      {studioDirectoryOpen && (
        <Modal title="Studio Chat Rooms" onClose={() => setStudioDirectoryOpen(false)} wide>
          <div className="stack">
            <div className="row between">
              <p className="muted small">Community creative rooms for everyone on Bloom.</p>
              <button type="button" className="btn small primary" onClick={() => { setStudioDirectoryOpen(false); setNewStudioOpen(true); }}>
                <IconPlus /> Create Studio Room
              </button>
            </div>
            {studioRooms.length === 0 ? (
              <Empty title="No community rooms yet">Be the first to start a Studio Room!</Empty>
            ) : (
              <div className="design-list">
                {studioRooms.map((r) => (
                  <div key={r.id} className="person">
                    <div className="who">
                      <strong>{r.title}</strong>
                      <span className="muted small">{r.description || "Community creative room"} · {r.member_count} members</span>
                    </div>
                    {r.joined ? (
                      <button
                        type="button"
                        className="btn small"
                        onClick={() => {
                          setStudioDirectoryOpen(false);
                          navigate(`/chat/${r.id}`);
                        }}
                      >
                        Open
                      </button>
                    ) : (
                      <button type="button" className="btn small primary" onClick={() => void joinStudio(r.id)}>
                        Join
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </Modal>
      )}

      {newStudioOpen && (
        <Modal title="Create a Studio Room" onClose={() => setNewStudioOpen(false)}>
          <form className="stack" onSubmit={(e) => { e.preventDefault(); void createStudio(); }}>
            <label className="field">
              <span>Studio Room Name</span>
              <input type="text" required maxLength={80} placeholder="e.g. Y2K Film Presets" value={studioTitle} onChange={(e) => setStudioTitle(e.target.value)} />
            </label>
            <label className="field">
              <span>Description</span>
              <input type="text" maxLength={300} placeholder="What will people create and discuss here?" value={studioDesc} onChange={(e) => setStudioDesc(e.target.value)} />
            </label>
            <div className="btn-row">
              <button type="submit" className="btn primary" disabled={!studioTitle.trim() || busy}>
                Create Studio Room
              </button>
              <button type="button" className="btn quiet" onClick={() => setNewStudioOpen(false)}>
                Cancel
              </button>
            </div>
          </form>
        </Modal>
      )}

      {infoOpen && activeConv && (
        <Modal title="Group Info" onClose={() => setInfoOpen(false)}>
          <div className="stack">
            <div className="row" style={{ gap: 14 }}>
              <Avatar name={activeConv.title} src={activeConv.avatar_url} />
              <div>
                <h3>{activeConv.title}</h3>
                {activeConv.description && <p className="muted small">{activeConv.description}</p>}
              </div>
            </div>

            <div>
              <p className="eyebrow" style={{ marginBottom: 8 }}>Members ({activeConv.members.length})</p>
              <div className="design-list">
                {activeConv.members.map((m) => (
                  <div key={m.bloom_id} className="person">
                    <Avatar name={m.display_name} src={m.avatar_url} />
                    <div className="who">
                      <strong>{m.display_name} {m.is_you && <span className="muted small">(you)</span>}</strong>
                      <span className="bloom-id">{m.bloom_id} · {m.role}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="btn-row">
              <button
                type="button"
                className="btn small quiet danger"
                onClick={async () => {
                  if (!window.confirm("Leave this group?")) return;
                  try {
                    await api(`/api/chat/groups/${activeConv.id}/leave`, { method: "POST" });
                    setInfoOpen(false);
                    setActiveConv(null);
                    void loadConversations();
                  } catch (e) {
                    toast(errorMessage(e), "error");
                  }
                }}
              >
                Leave Group
              </button>
            </div>
          </div>
        </Modal>
      )}
    </main>
  );
}
''',
    )

    # 6. Profile.tsx: Add direct "Message" button if friends
    patch(
        "frontend/src/pages/Profile.tsx",
        [
            (
                '<button type="button" className="btn" onClick={() => navigate(`/together?with=${encodeURIComponent(profile.bloom_id)}`)}>',
                r'''<button
                    type="button"
                    className="btn primary"
                    onClick={async () => {
                      try {
                        const conv = await api<{ id: number }>("/api/chat/dm", { body: { bloom_id: profile.bloom_id } });
                        navigate(`/chat/${conv.id}`);
                      } catch (e) {
                        toast(errorMessage(e), "error");
                      }
                    }}
                  >
                    <IconChat /> Message
                  </button>
                  <button type="button" className="btn" onClick={() => navigate(`/together?with=${encodeURIComponent(profile.bloom_id)}`)}>''',
            ),
        ],
    )

    # 7. Friends.tsx: Add direct message button
    patch(
        "frontend/src/pages/Friends.tsx",
        [
            (
                'import { IconCopy, IconLive, IconTogether, IconTrash } from "../components/Icons";',
                'import { IconChat, IconCopy, IconLive, IconTogether, IconTrash } from "../components/Icons";',
            ),
            (
                r'''                      <button type="button" className="btn icon small quiet" title="Make something together" aria-label={`Make something together with ${f.display_name}`} onClick={() => navigate(`/together?with=${encodeURIComponent(f.bloom_id)}`)}>
                        <IconTogether />
                      </button>''',
                r'''                      <button
                        type="button"
                        className="btn icon small quiet"
                        title="Direct message"
                        aria-label={`Chat with ${f.display_name}`}
                        onClick={async () => {
                          try {
                            const conv = await api<{ id: number }>("/api/chat/dm", { body: { bloom_id: f.bloom_id } });
                            navigate(`/chat/${conv.id}`);
                          } catch (e) {
                            toast(errorMessage(e), "error");
                          }
                        }}
                      >
                        <IconChat />
                      </button>
                      <button type="button" className="btn icon small quiet" title="Make something together" aria-label={`Make something together with ${f.display_name}`} onClick={() => navigate(`/together?with=${encodeURIComponent(f.bloom_id)}`)}>
                        <IconTogether />
                      </button>''',
            ),
        ],
    )

    # 8. App.tsx: Add routes for /chat and /chat/:id, plus header icon with badge
    patch(
        "frontend/src/App.tsx",
        [
            (
                'import { BloomMark, IconBell, IconCamera, IconFlower, IconInbox, IconJournal, IconLive, IconTogether, IconUser } from "./components/Icons";',
                'import { BloomMark, IconBell, IconCamera, IconChat, IconFlower, IconInbox, IconJournal, IconLive, IconTogether, IconUser } from "./components/Icons";',
            ),
            (
                'import { CamPage } from "./pages/Cam";',
                'import { CamPage } from "./pages/Cam";\nimport { ChatPage } from "./pages/Chat";',
            ),
            (
                '  { path: "/friends", render: () => <FriendsPage /> },',
                '  { path: "/friends", render: () => <FriendsPage /> },\n  { path: "/chat", render: () => <ChatPage /> },\n  { path: "/chat/:id", render: (p) => <ChatPage conversationId={p.id} /> },',
            ),
            (
                '  const { user, inbox, unreadNotifications, serverOnline, deviceMode, ready } = useSession();',
                '  const { user, inbox, unreadNotifications, unreadChat, serverOnline, deviceMode, ready } = useSession();',
            ),
            (
                r'''          {user && (
            <>
              <Link to="/notifications" className="btn icon quiet inbox-button" aria-label={`Notifications, ${unreadNotifications} unread`}>''',
                r'''          {user && (
            <>
              <Link to="/chat" className="btn icon quiet inbox-button" aria-label={`Chat, ${unreadChat} unread`}>
                <IconChat />
                {unreadChat > 0 && <span className="badge">{unreadChat}</span>}
              </Link>
              <Link to="/notifications" className="btn icon quiet inbox-button" aria-label={`Notifications, ${unreadNotifications} unread`}>''',
            ),
        ],
    )

    # 9. styles/app.css: Append Phase 4 chat styles
    app_css = ROOT / "frontend" / "src" / "styles" / "app.css"
    css_text = app_css.read_text(encoding="utf-8")
    extra_chat_css = r'''
/* ---------------------------------------------------------------------
   Bloom Chat (3-column layout)
   --------------------------------------------------------------------- */

.chat-page {
  padding-bottom: 20px;
}

.chat-layout {
  display: grid;
  grid-template-columns: 200px 300px minmax(0, 1fr);
  height: calc(100vh - var(--header-h) - 40px);
  background: var(--plum-900);
  border: 1px solid var(--line);
  border-radius: var(--radius-l);
  overflow: hidden;
}

.chat-nav-col {
  border-right: 1px solid var(--line);
  display: flex;
  flex-direction: column;
  padding: 18px 12px;
  background: var(--plum-950);
}

.chat-nav-header {
  padding-bottom: 16px;
  border-bottom: 1px solid var(--line);
  margin-bottom: 14px;
}

.chat-nav-items {
  display: grid;
  gap: 4px;
  flex: 1;
}

.chat-nav-link {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: var(--radius-s);
  border: none;
  background: transparent;
  color: var(--ink-soft);
  font: 500 13.5px var(--body);
  cursor: pointer;
  text-align: left;
  transition: all 0.15s;
}

.chat-nav-link:hover {
  color: var(--cream);
  background: var(--plum-850);
}

.chat-nav-link.active {
  color: var(--cream);
  background: var(--plum-800);
}

.chat-nav-actions {
  display: grid;
  gap: 8px;
  padding-top: 14px;
  border-top: 1px solid var(--line);
}

.chat-list-col {
  border-right: 1px solid var(--line);
  display: flex;
  flex-direction: column;
  background: var(--plum-900);
  overflow-y: auto;
}

.chat-list-header {
  padding: 14px 12px;
  border-bottom: 1px solid var(--line);
}

.chat-conversation-items {
  flex: 1;
  overflow-y: auto;
}

.chat-item-row {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 12px 14px;
  border: none;
  border-bottom: 1px solid var(--line);
  background: transparent;
  color: inherit;
  cursor: pointer;
  text-align: left;
  font: inherit;
  transition: background 0.15s;
}

.chat-item-row:hover {
  background: var(--plum-850);
}

.chat-item-row.active {
  background: var(--plum-800);
}

.chat-item-avatar-wrap {
  position: relative;
  flex: none;
}

.online-dot {
  position: absolute;
  right: -2px;
  bottom: -2px;
  width: 11px;
  height: 11px;
  border-radius: 50%;
  background: var(--sage);
  border: 2px solid var(--plum-900);
}

.chat-item-details {
  flex: 1;
  min-width: 0;
  display: grid;
  gap: 3px;
}

.chat-item-title {
  color: var(--cream);
  font-size: 14.5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chat-item-time {
  font-family: var(--mono);
  font-size: 10px;
  color: var(--ink-faint);
  flex: none;
}

.chat-item-snippet {
  font-size: 12.5px;
  color: var(--ink-soft);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chat-main-col {
  display: flex;
  flex-direction: column;
  background: var(--night);
  position: relative;
}

.chat-main-col.empty-main {
  display: grid;
  place-items: center;
}

.chat-view {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.chat-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 18px;
  border-bottom: 1px solid var(--line);
  background: var(--plum-900);
}

.mobile-back-btn {
  display: none;
}

.chat-title-box h3 {
  font-size: 16px;
  line-height: 1.2;
}

.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 20px 24px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.chat-empty {
  margin: auto;
  display: grid;
  place-items: center;
  gap: 12px;
  text-align: center;
}

.chat-empty svg {
  width: 48px;
  height: 48px;
  color: var(--rose);
}

.load-older-btn {
  align-self: center;
  margin-bottom: 12px;
}

.msg-bubble {
  max-width: 72%;
  align-self: flex-start;
  padding: 10px 14px;
  border-radius: 14px 14px 14px 2px;
  background: var(--plum-850);
  border: 1px solid var(--line);
  position: relative;
  word-break: break-word;
}

.msg-bubble.mine {
  align-self: flex-end;
  border-radius: 14px 14px 2px 14px;
  background: var(--plum-700);
  border-color: rgba(231, 163, 181, 0.25);
}

.msg-bubble.deleted {
  opacity: 0.6;
}

.msg-sender {
  display: block;
  font-size: 11px;
  color: var(--rose);
  font-weight: 600;
  margin-bottom: 4px;
}

.msg-reply-quote {
  padding: 4px 8px;
  border-left: 2px solid var(--rose);
  background: rgba(0, 0, 0, 0.2);
  border-radius: 2px;
  margin-bottom: 6px;
  font-size: 12px;
  display: grid;
}

.msg-text {
  font-size: 14.5px;
  line-height: 1.45;
  white-space: pre-wrap;
}

.msg-media-img {
  max-width: 320px;
  border-radius: 8px;
  display: block;
  margin: 4px 0;
}

.msg-audio {
  width: 240px;
  height: 38px;
  margin: 4px 0;
}

.msg-sticker {
  width: 140px;
  display: grid;
  justify-items: center;
  gap: 4px;
}

.msg-shared-card {
  display: grid;
  gap: 8px;
  padding: 8px;
  border-radius: 8px;
  background: var(--plum-900);
  border: 1px solid var(--line);
  margin-top: 4px;
}

.msg-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 4px;
}

.msg-time {
  font-family: var(--mono);
  font-size: 10px;
  color: var(--ink-faint);
}

.msg-actions {
  display: none;
  align-items: center;
  gap: 4px;
}

.msg-bubble:hover .msg-actions {
  display: flex;
}

.msg-reaction-picker {
  display: flex;
  gap: 2px;
}

.msg-reactions-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 6px;
}

.reaction-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 7px;
  border-radius: 999px;
  background: var(--plum-900);
  border: 1px solid var(--line);
  color: var(--ink-soft);
  font-size: 11px;
  cursor: pointer;
}

.reaction-pill.mine {
  border-color: var(--rose);
  color: var(--cream);
}

.typing-indicator {
  padding: 4px 24px;
  font-size: 12px;
  color: var(--ink-faint);
  font-style: italic;
}

.reply-preview-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 18px;
  background: var(--plum-850);
  border-top: 1px solid var(--line);
}

.voice-record-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 18px;
  background: var(--plum-800);
  border-top: 1px solid var(--line);
}

.record-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--danger);
  animation: pulse 1s infinite;
}

.chat-composer {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 18px;
  border-top: 1px solid var(--line);
  background: var(--plum-900);
}

.chat-input {
  flex: 1;
  min-height: 40px !important;
  border-radius: 999px !important;
  padding: 8px 18px !important;
}

.sticker-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(90px, 1fr));
  gap: 12px;
}

.sticker-btn {
  display: grid;
  justify-items: center;
  gap: 6px;
  padding: 8px;
  border-radius: var(--radius);
  border: 1px solid var(--line);
  background: var(--field);
  color: var(--cream);
  cursor: pointer;
}

.sticker-btn:hover {
  border-color: var(--rose);
}

@media (max-width: 900px) {
  .chat-layout {
    grid-template-columns: 1fr;
    height: calc(100vh - var(--header-h) - var(--tabbar-h) - 10px);
  }
  .chat-nav-col {
    display: none;
  }
  .chat-list-col.has-active {
    display: none;
  }
  .chat-main-col.empty-main {
    display: none;
  }
  .mobile-back-btn {
    display: inline-flex;
  }
}
'''
    if ".chat-layout {" not in css_text:
        css_text += "\n" + extra_chat_css.lstrip("\n")
        app_css.write_text(css_text, encoding="utf-8")
        print("Patched frontend/src/styles/app.css")
    else:
        print("Skipped frontend/src/styles/app.css (already present)")

    print("\nPhase 4B (Frontend) applied successfully.")


if __name__ == "__main__":
    main()