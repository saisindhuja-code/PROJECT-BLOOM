/**
 * Phase 4 & 9: Unified Bloom Chat (3-Column Responsive Workspace)
 *   - Left: Thread list (All / DMs / Groups / Studio / Projects), Search, + New DM, + New Group
 *   - Center: Live WS conversation stream, typing indicator, reply quotes, interactive flower cards
 *             ("Grow in Studio", "Use in Cam", "Save to Journal"), emoji reactions, & image attachments
 *   - Right: Context drawer with Members, Online dots, Shared Flowers & Media gallery, and quick collab links
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlowerPreview } from "../components/FlowerPreview";
import {
  IconCamera,
  IconFlower,
  IconJournal,
  IconLive,
  IconPlus,
  IconSend,
  IconTogether,
  IconUpload,
  IconX,
} from "../components/Icons";
import { ReactionsBar } from "../components/ReactionsBar";
import { Avatar, Empty, Loading, Modal, SignInNeeded, formatDate } from "../components/ui";
import { normalizeRecipe, type FlowerRecipe } from "../flower/recipe";
import { api, errorMessage, mediaUrl, uploadImage, type ChatMessage, type ChatThread } from "../lib/api";
import { useRouter } from "../lib/router";
import { useSession } from "../lib/session";
import { useFriends } from "./Friends";

type FilterTab = "all" | "dm" | "group" | "studio" | "project";

export function ChatPage({ id }: { id?: number }) {
  const { user, toast, ws, refreshInbox, onlineFriends, recipe: studioRecipe, hasFlower, growFlower, store } = useSession();
  const { navigate } = useRouter();
  const { data: friendsData } = useFriends();

  const [threads, setThreads] = useState<ChatThread[] | null>(null);
  const [activeId, setActiveId] = useState<number | null>(id ?? null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);

  const [filterTab, setFilterTab] = useState<FilterTab>("all");
  const [search, setSearch] = useState("");
  const [text, setText] = useState("");
  const [attachFlower, setAttachFlower] = useState<FlowerRecipe | null>(null);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [sending, setSending] = useState(false);
  const [typingBy, setTypingBy] = useState<string | null>(null);
  const [showContextMobile, setShowContextMobile] = useState(false);

  // Modals for New DM / New Group
  const [dmModal, setDmModal] = useState(false);
  const [dmBloomId, setDmBloomId] = useState("");
  const [groupModal, setGroupModal] = useState(false);
  const [groupTitle, setGroupTitle] = useState("");
  const [groupSelected, setGroupSelected] = useState<string[]>([]);

  const fileInput = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const typingTimer = useRef<number | null>(null);

  const loadThreads = useCallback(async () => {
    if (!user) return;
    try {
      const list = await api<ChatThread[]>("/api/chats");
      setThreads(list);
      if (id) {
        setActiveId(id);
      } else if (!activeId && list.length > 0) {
        setActiveId(list[0].id);
      }
    } catch (e) {
      toast(errorMessage(e), "error");
      setThreads([]);
    }
  }, [user, id, activeId, toast]);

  useEffect(() => {
    if (user) void loadThreads();
  }, [user, loadThreads]);

  useEffect(() => {
    if (id) setActiveId(id);
  }, [id]);

  // Fetch messages + mark read when activeId changes
  useEffect(() => {
    if (!user || !activeId) return;
    let cancelled = false;
    setLoadingMessages(true);
    setTypingBy(null);
    api<ChatMessage[]>(`/api/chats/${activeId}/messages`)
      .then((msgs) => {
        if (cancelled) return;
        setMessages(msgs);
        void api(`/api/chats/${activeId}/read`, { method: "POST" }).then(() => {
          setThreads((prev) => prev?.map((t) => (t.id === activeId ? { ...t, unread: 0 } : t)) ?? null);
          refreshInbox();
        });
      })
      .catch((e) => !cancelled && toast(errorMessage(e), "error"))
      .finally(() => !cancelled && setLoadingMessages(false));

    return () => {
      cancelled = true;
    };
  }, [user, activeId, refreshInbox, toast]);

  // Real-time WebSocket subscription for active chat
  useEffect(() => {
    if (!user || !activeId) return;
    const ch = `chat:${activeId}`;
    ws.subscribe(ch);
    const off = ws.onEvent((ev) => {
      if (ev.type === "chat:message" && ev.chatId === activeId && ev.message) {
        const msg = ev.message as ChatMessage;
        setMessages((list) => (list.some((m) => m.id === msg.id) ? list : [...list, msg]));
        void api(`/api/chats/${activeId}/read`, { method: "POST" });
        setThreads((prev) =>
          prev?.map((t) => (t.id === activeId ? { ...t, last_message: msg, unread: 0, updated_at: msg.created_at } : t)) ?? null,
        );
      } else if (ev.type === "chat:reaction" && ev.chatId === activeId) {
        const messageId = Number(ev.messageId);
        const updatedReactions = ev.reactions as ChatMessage["reactions"] | undefined;
        if (updatedReactions) {
          setMessages((list) =>
            list.map((m) => (m.id === messageId ? { ...m, reactions: updatedReactions } : m)),
          );
        }
      } else if (ev.type === "chat:typing" && ev.chatId === activeId) {
        const name = String(ev.display_name ?? "Someone");
        const active = Boolean(ev.active);
        setTypingBy(active ? name : null);
        if (active) {
          if (typingTimer.current) window.clearTimeout(typingTimer.current);
          typingTimer.current = window.setTimeout(() => setTypingBy(null), 3500);
        }
      } else if (ev.type === "chat:notify") {
        void loadThreads();
      }
    });
    return () => {
      off();
      ws.unsubscribe(ch);
    };
  }, [user, activeId, ws, loadThreads]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length, activeId]);

  const activeThread = useMemo(() => threads?.find((t) => t.id === activeId) ?? null, [threads, activeId]);

  const filteredThreads = useMemo(() => {
    if (!threads) return [];
    const q = search.trim().toLowerCase();
    return threads
      .filter((t) => filterTab === "all" || t.type === filterTab)
      .filter((t) => !q || t.title.toLowerCase().includes(q) || t.members.some((m) => m.display_name.toLowerCase().includes(q)));
  }, [threads, filterTab, search]);

  const sharedFlowers = useMemo(
    () =>
      messages
        .filter((m) => Boolean(m.flower_recipe))
        .map((m) => ({ id: m.id, sender: m.sender.display_name, recipe: normalizeRecipe(m.flower_recipe) }))
        .reverse(),
    [messages],
  );

  const sharedPhotos = useMemo(
    () =>
      messages
        .filter((m) => Boolean(m.media_url))
        .map((m) => ({ id: m.id, sender: m.sender.display_name, url: mediaUrl(m.media_url)! }))
        .reverse(),
    [messages],
  );

  if (!user) {
    return (
      <main className="page">
        <SignInNeeded what="Bloom Chat" />
      </main>
    );
  }

  const selectThread = (chatId: number) => {
    setActiveId(chatId);
    setReplyTo(null);
    navigate(`/chat/${chatId}`, { replace: true });
  };

  const sendMessage = async (mediaId?: number) => {
    if (!activeThread) return;
    if (!text.trim() && !attachFlower && !mediaId) return;
    setSending(true);
    try {
      const msg = await api<ChatMessage>(`/api/chats/${activeThread.id}/messages`, {
        body: {
          text: text.trim(),
          flower_recipe: attachFlower ?? undefined,
          media_id: mediaId ?? undefined,
          reply_to_id: replyTo?.id ?? undefined,
        },
      });
      setMessages((list) => [...list, msg]);
      setText("");
      setAttachFlower(null);
      setReplyTo(null);
      ws.sendTyping(activeThread.id, false);
      setThreads((prev) =>
        prev?.map((t) => (t.id === activeThread.id ? { ...t, last_message: msg, updated_at: msg.created_at } : t)) ?? null,
      );
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setSending(false);
    }
  };

  const handlePhotoUpload = async (file: File | undefined) => {
    if (!file || !activeThread) return;
    setSending(true);
    try {
      const media = await uploadImage(file, "photo", file.name || "chat-photo.jpg");
      await sendMessage(media.id);
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setSending(false);
    }
  };

  const startDm = async (bloomId: string) => {
    try {
      const thread = await api<ChatThread>("/api/chats/dm", { body: { bloom_id: bloomId } });
      setDmModal(false);
      setDmBloomId("");
      await loadThreads();
      selectThread(thread.id);
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  const createGroup = async () => {
    if (!groupTitle.trim()) return;
    try {
      const thread = await api<ChatThread>("/api/chats/group", {
        body: { title: groupTitle.trim(), member_bloom_ids: groupSelected },
      });
      setGroupModal(false);
      setGroupTitle("");
      setGroupSelected([]);
      await loadThreads();
      selectThread(thread.id);
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  const saveFlowerToJournal = async (rec: FlowerRecipe) => {
    try {
      await store.createEntry({ entry_type: "flower", title: rec.word, recipe: rec });
      toast(`Saved “${rec.word}” to your journal.`);
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  const dmPartner = activeThread?.type === "dm" ? activeThread.members.find((m) => !m.is_you) : null;

  return (
    <main className="page chat-page">
      <div className="chat-shell">
        {/* Column 1: Threads */}
        <aside className="chat-sidebar" aria-label="Conversations">
          <div className="chat-sidebar-head">
            <div>
              <p className="eyebrow">06 · Bloom Chat</p>
              <h2>Conversations</h2>
            </div>
            <div className="btn-row">
              <button type="button" className="btn small" onClick={() => setDmModal(true)}>
                <IconPlus /> DM
              </button>
              <button type="button" className="btn small quiet" onClick={() => setGroupModal(true)}>
                <IconPlus /> Group
              </button>
            </div>
          </div>

          <input
            type="search"
            placeholder="Filter conversations…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ marginBottom: 8 }}
          />

          <div className="chips" role="tablist" aria-label="Chat folders" style={{ marginBottom: 10 }}>
            {(
              [
                { id: "all", label: "All" },
                { id: "dm", label: "DMs" },
                { id: "group", label: "Groups" },
                { id: "studio", label: "Studio" },
                { id: "project", label: "Together" },
              ] as Array<{ id: FilterTab; label: string }>
            ).map((t) => (
              <button key={t.id} type="button" className="chip" aria-pressed={filterTab === t.id} onClick={() => setFilterTab(t.id)}>
                {t.label}
              </button>
            ))}
          </div>

          <div className="thread-list">
            {threads === null ? (
              <Loading label="Opening chats" />
            ) : filteredThreads.length === 0 ? (
              <Empty title="No conversations">Start a direct message or visit Studio Lounge.</Empty>
            ) : (
              filteredThreads.map((t) => {
                const other = t.type === "dm" ? t.members.find((m) => !m.is_you) : null;
                const isOnline = other ? Boolean(other.online || onlineFriends.has(other.bloom_id)) : false;
                return (
                  <button
                    key={t.id}
                    type="button"
                    className={`thread-row${t.id === activeId ? " active" : ""}`}
                    onClick={() => selectThread(t.id)}
                  >
                    <Avatar name={t.title} />
                    <div className="thread-meta">
                      <div className="thread-top">
                        <strong>
                          {t.type === "studio" ? "🌸 " : ""}
                          {t.title}
                          {isOnline && <span className="online-dot" />}
                        </strong>
                        {t.unread > 0 && <span className="badge">{t.unread}</span>}
                      </div>
                      <span className="thread-preview muted small">
                        {t.last_message
                          ? t.last_message.text || (t.last_message.flower_recipe ? "🌸 Shared a flower" : "📷 Shared a photo")
                          : t.type === "studio"
                            ? "Community flower lounge"
                            : "No messages yet"}
                      </span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        {/* Column 2: Active Conversation */}
        <section className="chat-main" aria-label="Messages">
          {!activeThread ? (
            <div style={{ margin: "auto" }}>
              <Empty title="Pick a conversation">Choose a friend, group, or the Studio Lounge on the left.</Empty>
            </div>
          ) : (
            <>
              <header className="chat-main-head">
                <div>
                  <h3>
                    {activeThread.type === "studio" ? "🌸 " : ""}
                    {activeThread.title}
                  </h3>
                  <p className="muted small">
                    {activeThread.type === "studio"
                      ? "Open space for everyone growing flowers"
                      : activeThread.type === "project"
                        ? "Linked to your Bloom Together project"
                        : `${activeThread.members.length} members`}
                  </p>
                </div>
                <button
                  type="button"
                  className="btn small quiet"
                  onClick={() => setShowContextMobile((v) => !v)}
                >
                  {showContextMobile ? "Hide details" : "Details & shared"}
                </button>
              </header>

              <div className="chat-stream" ref={scrollRef}>
                {loadingMessages ? (
                  <Loading label="Loading messages" />
                ) : messages.length === 0 ? (
                  <Empty title="Say hello">Send a note, grow a flower in Studio, or share a snapshot.</Empty>
                ) : (
                  messages.map((m) => {
                    const flower = m.flower_recipe ? normalizeRecipe(m.flower_recipe) : null;
                    return (
                      <article key={m.id} className={`chat-bubble${m.is_you ? " you" : ""}`}>
                        <div className="bubble-head">
                          <strong>{m.is_you ? "You" : m.sender.display_name}</strong>
                          <span className="muted small">{formatDate(m.created_at)}</span>
                        </div>
                        {m.reply_to && (
                          <div className="reply-quote">
                            <span>Replying to {m.reply_to.sender_name}:</span> {m.reply_to.text || "flower"}
                          </div>
                        )}
                        {m.text && <p className="bubble-text">{m.text}</p>}
                        {m.media_url && (
                          <div className="bubble-media">
                            <img src={mediaUrl(m.media_url)!} alt="Shared photo" loading="lazy" />
                          </div>
                        )}
                        {flower && (
                          <div className="bubble-flower">
                            <div className="bubble-flower-plate">
                              <FlowerPreview recipe={flower} framing="window" />
                            </div>
                            <div className="btn-row" style={{ marginTop: 8 }}>
                              <button
                                type="button"
                                className="btn small"
                                onClick={() => {
                                  growFlower(flower);
                                  navigate("/studio");
                                }}
                              >
                                <IconFlower /> Grow in Studio
                              </button>
                              <button
                                type="button"
                                className="btn small quiet"
                                onClick={() => {
                                  growFlower(flower);
                                  navigate("/cam");
                                }}
                              >
                                <IconCamera /> Use in Cam
                              </button>
                              <button
                                type="button"
                                className="btn small quiet"
                                onClick={() => void saveFlowerToJournal(flower)}
                              >
                                <IconJournal /> Save
                              </button>
                            </div>
                          </div>
                        )}
                        <div className="bubble-foot">
                          <ReactionsBar targetType="message" targetId={m.id} initial={m.reactions} compact />
                          <button type="button" className="btn small quiet" onClick={() => setReplyTo(m)}>
                            Reply
                          </button>
                        </div>
                      </article>
                    );
                  })
                )}
              </div>

              {typingBy && <div className="typing-note muted small">{typingBy} is typing…</div>}

              <footer className="chat-composer">
                {replyTo && (
                  <div className="composer-banner">
                    <span>
                      Replying to <strong>{replyTo.sender.display_name}</strong>: {replyTo.text.slice(0, 60) || "flower"}
                    </span>
                    <button type="button" className="btn icon small quiet" onClick={() => setReplyTo(null)}>
                      <IconX />
                    </button>
                  </div>
                )}
                {attachFlower && (
                  <div className="composer-banner">
                    <span>
                      Attaching flower <strong>“{attachFlower.word}”</strong>
                    </span>
                    <button type="button" className="btn icon small quiet" onClick={() => setAttachFlower(null)}>
                      <IconX />
                    </button>
                  </div>
                )}
                <form
                  className="composer-row"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void sendMessage();
                  }}
                >
                  <button
                    type="button"
                    className="btn icon small quiet"
                    title="Attach current Studio flower"
                    onClick={() => {
                      if (!hasFlower) {
                        toast("Grow a flower in Studio first to attach it.", "info");
                        return;
                      }
                      setAttachFlower(studioRecipe);
                    }}
                  >
                    <IconFlower />
                  </button>
                  <button
                    type="button"
                    className="btn icon small quiet"
                    title="Send a photo"
                    onClick={() => fileInput.current?.click()}
                  >
                    <IconUpload />
                  </button>
                  <input
                    ref={fileInput}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    hidden
                    onChange={(e) => void handlePhotoUpload(e.target.files?.[0])}
                  />
                  <input
                    type="text"
                    value={text}
                    placeholder="Write a message or attach a flower…"
                    onChange={(e) => {
                      setText(e.target.value);
                      ws.sendTyping(activeThread.id, Boolean(e.target.value.trim()));
                    }}
                  />
                  <button
                    type="submit"
                    className="btn primary small"
                    disabled={sending || (!text.trim() && !attachFlower)}
                  >
                    <IconSend /> Send
                  </button>
                </form>
              </footer>
            </>
          )}
        </section>

        {/* Column 3: Context Drawer */}
        <aside className={`chat-context${showContextMobile ? " open" : ""}`} aria-label="Thread details">
          {activeThread ? (
            <div className="stack">
              {dmPartner && (
                <section className="sheet-section">
                  <header>
                    <h3>Collaborate</h3>
                  </header>
                  <div className="btn-row">
                    <button
                      type="button"
                      className="btn small"
                      onClick={() => navigate(`/together?with=${encodeURIComponent(dmPartner.bloom_id)}`)}
                    >
                      <IconTogether /> Make together
                    </button>
                    <button
                      type="button"
                      className="btn small"
                      onClick={async () => {
                        try {
                          const room = await api<{ id: string }>("/api/live/rooms", {
                            body: { friend_bloom_id: dmPartner.bloom_id },
                          });
                          navigate(`/live/${room.id}`);
                        } catch (e) {
                          toast(errorMessage(e), "error");
                        }
                      }}
                    >
                      <IconLive /> Start Live
                    </button>
                  </div>
                </section>
              )}

              {activeThread.type !== "studio" && (
                <section className="sheet-section">
                  <header>
                    <h3>Members</h3>
                  </header>
                  <div className="stack tight">
                    {activeThread.members.map((m) => (
                      <div key={m.bloom_id} className="person">
                        <Avatar name={m.display_name} />
                        <div className="who">
                          <strong>
                            {m.display_name} {m.is_you && <span className="muted small">(you)</span>}
                            {(m.online || onlineFriends.has(m.bloom_id)) && <span className="online-dot" />}
                          </strong>
                          <span className="bloom-id">{m.bloom_id}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              <section className="sheet-section">
                <header>
                  <h3>Shared flowers ({sharedFlowers.length})</h3>
                </header>
                {sharedFlowers.length === 0 ? (
                  <p className="muted small">Flowers sent in this chat appear here.</p>
                ) : (
                  <div className="shared-grid">
                    {sharedFlowers.slice(0, 6).map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        className="shared-tile"
                        title={`“${item.recipe.word}” by ${item.sender} — open in Studio`}
                        onClick={() => {
                          growFlower(item.recipe);
                          navigate("/studio");
                        }}
                      >
                        <FlowerPreview recipe={item.recipe} framing="tight" />
                        <span className="small">“{item.recipe.word}”</span>
                      </button>
                    ))}
                  </div>
                )}
              </section>

              <section className="sheet-section">
                <header>
                  <h3>Shared photos ({sharedPhotos.length})</h3>
                </header>
                {sharedPhotos.length === 0 ? (
                  <p className="muted small">Photos shared here will collect in this gallery.</p>
                ) : (
                  <div className="shared-grid">
                    {sharedPhotos.slice(0, 6).map((p) => (
                      <div key={p.id} className="shared-tile">
                        <img src={p.url} alt={`Photo by ${p.sender}`} loading="lazy" />
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          ) : (
            <p className="muted small">Thread info and shared flowers appear here.</p>
          )}
        </aside>
      </div>

      {dmModal && (
        <Modal title="New direct message" onClose={() => setDmModal(false)}>
          <div className="stack">
            {friendsData && friendsData.friends.length > 0 && (
              <div className="stack tight">
                <span className="label">Your friends</span>
                {friendsData.friends.map((f) => (
                  <button
                    key={f.bloom_id}
                    type="button"
                    className="person"
                    style={{ textAlign: "left", width: "100%" }}
                    onClick={() => void startDm(f.bloom_id)}
                  >
                    <Avatar name={f.display_name} />
                    <div className="who">
                      <strong>{f.display_name}</strong>
                      <span className="bloom-id">{f.bloom_id}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
            <form
              className="stack tight"
              onSubmit={(e) => {
                e.preventDefault();
                if (dmBloomId.trim()) void startDm(dmBloomId.trim());
              }}
            >
              <label className="field">
                <span>Or message by Bloom ID</span>
                <input
                  type="text"
                  value={dmBloomId}
                  placeholder="BLM-XXXX-XXXX"
                  onChange={(e) => setDmBloomId(e.target.value)}
                />
              </label>
              <button type="submit" className="btn primary" disabled={!dmBloomId.trim()}>
                Start chat
              </button>
            </form>
          </div>
        </Modal>
      )}

      {groupModal && (
        <Modal title="New group chat" onClose={() => setGroupModal(false)}>
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              void createGroup();
            }}
          >
            <label className="field">
              <span>Group name</span>
              <input
                type="text"
                value={groupTitle}
                maxLength={60}
                placeholder="Sunday Flower Club"
                onChange={(e) => setGroupTitle(e.target.value)}
              />
            </label>
            <div className="stack tight">
              <span className="label">Add friends</span>
              {!friendsData || friendsData.friends.length === 0 ? (
                <p className="muted small">Add friends first to invite them into a group.</p>
              ) : (
                friendsData.friends.map((f) => {
                  const checked = groupSelected.includes(f.bloom_id);
                  return (
                    <label key={f.bloom_id} className="row" style={{ gap: 10, alignItems: "center", cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          setGroupSelected((prev) =>
                            prev.includes(f.bloom_id) ? prev.filter((x) => x !== f.bloom_id) : [...prev, f.bloom_id],
                          )
                        }
                      />
                      <span>{f.display_name}</span>
                      <span className="bloom-id">{f.bloom_id}</span>
                    </label>
                  );
                })
              )}
            </div>
            <button type="submit" className="btn primary" disabled={!groupTitle.trim()}>
              Create group
            </button>
          </form>
        </Modal>
      )}
    </main>
  );
}
