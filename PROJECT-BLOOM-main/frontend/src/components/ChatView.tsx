/** Reusable real-time conversation stream + composer (Bloom Chat & Phase 8 Together Chat). */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
                  {msg.shared_ref.type === "design" && Boolean(msg.shared_ref.recipe) && (
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
