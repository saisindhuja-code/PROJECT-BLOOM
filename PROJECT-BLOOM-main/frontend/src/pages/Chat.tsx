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
  const { navigate, query: urlQuery } = useRouter();
  const { data: friendsData } = useFriends();
  const tabParam = urlQuery.get("tab");
  const initialKind: ChatKind | "all" =
    tabParam === "dm" || tabParam === "group" || tabParam === "studio" ? tabParam : "all";
  const [kindFilter, setKindFilter] = useState<ChatKind | "all">(initialKind);

  useEffect(() => {
    if (tabParam === "dm" || tabParam === "group" || tabParam === "studio") {
      setKindFilter(tabParam);
    }
  }, [tabParam]);
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
