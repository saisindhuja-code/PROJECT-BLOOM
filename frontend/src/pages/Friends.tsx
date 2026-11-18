/**
 * Phase 2 & 3: Bloom IDs, People Discovery, Profiles (privacy-aware),
 * Friends + Follow Social Graph, and direct Chat links.
 */
import { useCallback, useEffect, useState } from "react";
import { FlowerPreview } from "../components/FlowerPreview";
import { IconChat, IconCopy, IconLive, IconTogether, IconTrash } from "../components/Icons";
import { Avatar, Empty, Loading, Modal, SignInNeeded } from "../components/ui";
import { normalizeRecipe } from "../flower/recipe";
import { api, errorMessage, type DiscoverUser, type PublicUser, type UserProfile } from "../lib/api";
import { useRouter } from "../lib/router";
import { useSession } from "../lib/session";

interface FriendItem {
  request_id: number;
  bloom_id: string;
  display_name: string;
  avatar_recipe?: Record<string, unknown> | null;
  online?: boolean;
  since: string;
}

interface FriendsData {
  friends: FriendItem[];
  incoming: FriendItem[];
  outgoing: FriendItem[];
}

interface SocialGraph {
  followers: PublicUser[];
  following: PublicUser[];
}

export function useFriends() {
  const { user, refreshInbox } = useSession();
  const [data, setData] = useState<FriendsData | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(() => {
    if (!user) return Promise.resolve();
    return api<FriendsData>("/api/friends")
      .then((d) => {
        setData(d);
        setError("");
        refreshInbox();
      })
      .catch((e) => setError(errorMessage(e)));
  }, [user, refreshInbox]);
  useEffect(() => {
    void load();
  }, [load]);
  return { data, error, reload: load };
}

export function FriendsPage() {
  const { user, toast, onlineFriends } = useSession();
  const { navigate } = useRouter();
  const { data, error, reload } = useFriends();
  const [graph, setGraph] = useState<SocialGraph>({ followers: [], following: [] });
  const [search, setSearch] = useState("");
  const [discoverResults, setDiscoverResults] = useState<DiscoverUser[]>([]);
  const [discoverBusy, setDiscoverBusy] = useState(false);
  const [tab, setTab] = useState<"friends" | "following" | "followers">("friends");
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [busy, setBusy] = useState(false);

  const loadGraph = useCallback(() => {
    if (!user) return;
    api<SocialGraph>("/api/social/graph").then(setGraph).catch(() => undefined);
  }, [user]);

  useEffect(() => {
    loadGraph();
  }, [loadGraph]);

  const runDiscover = useCallback(
    async (q: string) => {
      if (!user) return;
      setDiscoverBusy(true);
      try {
        const list = await api<DiscoverUser[]>(`/api/users/discover?q=${encodeURIComponent(q.trim())}`);
        setDiscoverResults(list);
      } catch {
        setDiscoverResults([]);
      } finally {
        setDiscoverBusy(false);
      }
    },
    [user],
  );

  useEffect(() => {
    if (!user) return;
    const timer = window.setTimeout(() => void runDiscover(search), 220);
    return () => window.clearTimeout(timer);
  }, [user, search, runDiscover]);

  if (!user) {
    return (
      <main className="page">
        <SignInNeeded what="Friends" />
      </main>
    );
  }

  const act = async (task: () => Promise<unknown>, message?: string) => {
    setBusy(true);
    try {
      await task();
      if (message) toast(message);
      await reload();
      loadGraph();
      await runDiscover(search);
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  };

  const openProfile = async (bloomId: string) => {
    try {
      setProfile(await api<UserProfile>(`/api/users/${encodeURIComponent(bloomId)}/profile`));
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  const toggleFollow = (bloomId: string, currentlyFollowing: boolean) =>
    act(
      async () => {
        await api(`/api/social/follow/${encodeURIComponent(bloomId)}`, {
          method: currentlyFollowing ? "DELETE" : "POST",
        });
        if (profile && profile.bloom_id === bloomId) {
          setProfile(await api<UserProfile>(`/api/users/${encodeURIComponent(bloomId)}/profile`));
        }
      },
      currentlyFollowing ? "Unfollowed." : "Following!",
    );

  const openDm = async (bloomId: string) => {
    setBusy(true);
    try {
      const thread = await api<{ id: number }>("/api/chats/dm", { body: { bloom_id: bloomId } });
      setProfile(null);
      navigate(`/chat/${thread.id}`);
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  };

  const startLive = (bloomId: string) =>
    act(async () => {
      const room = await api<{ id: string }>("/api/live/rooms", { body: { friend_bloom_id: bloomId } });
      navigate(`/live/${room.id}`);
    });

  const isFollowingId = (bloomId: string) => graph.following.some((u) => u.bloom_id === bloomId);

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">04 · Friends & Discovery</p>
          <h1>
            The people you <span className="flourish">grow with</span>
          </h1>
        </div>
      </div>

      <div className="columns">
        <div className="stack">
          <div className="id-card">
            <span className="eyebrow">Your Bloom ID</span>
            <span className="bloom-id">{user.bloom_id}</span>
            <p className="muted small">Share your Bloom ID so friends can find you, follow your blooms, or start a chat.</p>
            <button
              type="button"
              className="btn small"
              style={{ justifySelf: "start" }}
              onClick={() =>
                void navigator.clipboard?.writeText(user.bloom_id).then(
                  () => toast("Bloom ID copied."),
                  () => toast("Couldn't copy.", "error"),
                )
              }
            >
              <IconCopy /> Copy my ID
            </button>
          </div>

          <section className="panel stack">
            <header>
              <h3>Find people</h3>
              <span className="eyebrow">Bloom ID or name</span>
            </header>
            <input
              type="search"
              value={search}
              placeholder="Search by name, word, or BLM-XXXX-XXXX…"
              onChange={(e) => setSearch(e.target.value)}
            />
            {discoverBusy && discoverResults.length === 0 ? (
              <Loading label="Searching Bloom" />
            ) : discoverResults.length === 0 ? (
              <p className="muted small">No matching Bloom accounts found. Try pasting their exact Bloom ID.</p>
            ) : (
              <div className="stack tight">
                {discoverResults.map((person) => (
                  <div key={person.bloom_id} className="person">
                    <Avatar name={person.display_name} />
                    <div className="who" style={{ cursor: "pointer" }} onClick={() => void openProfile(person.bloom_id)}>
                      <strong>
                        {person.display_name}
                        {(person.online || onlineFriends.has(person.bloom_id)) && (
                          <span className="online-dot" title="Online now" />
                        )}
                      </strong>
                      <span className="bloom-id">
                        {person.bloom_id}
                        {person.favorite_word ? ` · “${person.favorite_word}”` : ""}
                      </span>
                    </div>
                    <button
                      type="button"
                      className={`btn small ${person.following ? "quiet" : ""}`}
                      disabled={busy}
                      onClick={() => void toggleFollow(person.bloom_id, person.following)}
                    >
                      {person.following ? "Following" : "Follow"}
                    </button>
                    {person.relation === "none" ? (
                      <button
                        type="button"
                        className="btn small primary"
                        disabled={busy}
                        onClick={() =>
                          void act(
                            () => api("/api/friends/requests", { body: { bloom_id: person.bloom_id } }),
                            "Friend request sent.",
                          )
                        }
                      >
                        Add friend
                      </button>
                    ) : person.relation === "friend" ? (
                      <button
                        type="button"
                        className="btn icon small quiet"
                        title="Send message"
                        onClick={() => void openDm(person.bloom_id)}
                      >
                        <IconChat />
                      </button>
                    ) : (
                      <span className="muted small">{person.relation === "request-sent" ? "Pending" : "Invited you"}</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        <div className="stack">
          {error && <p className="notice error">{error}</p>}
          {!data ? (
            <Loading />
          ) : (
            <>
              {data.incoming.length > 0 && (
                <section className="panel">
                  <h3>Waiting for you</h3>
                  {data.incoming.map((f) => (
                    <div key={f.request_id} className="person">
                      <Avatar name={f.display_name} />
                      <div className="who" style={{ cursor: "pointer" }} onClick={() => void openProfile(f.bloom_id)}>
                        <strong>{f.display_name}</strong>
                        <span className="bloom-id">{f.bloom_id}</span>
                      </div>
                      <button
                        type="button"
                        className="btn small primary"
                        disabled={busy}
                        onClick={() =>
                          void act(
                            () => api(`/api/friends/requests/${f.request_id}/accept`, { method: "POST" }),
                            `You and ${f.display_name} are friends now.`,
                          )
                        }
                      >
                        Accept
                      </button>
                      <button
                        type="button"
                        className="btn small quiet"
                        disabled={busy}
                        onClick={() => void act(() => api(`/api/friends/requests/${f.request_id}/decline`, { method: "POST" }))}
                      >
                        Decline
                      </button>
                    </div>
                  ))}
                </section>
              )}

              <section className="panel stack">
                <div className="segmented" role="tablist" aria-label="Social graph">
                  <button type="button" role="tab" aria-pressed={tab === "friends"} onClick={() => setTab("friends")}>
                    Friends ({data.friends.length})
                  </button>
                  <button type="button" role="tab" aria-pressed={tab === "following"} onClick={() => setTab("following")}>
                    Following ({graph.following.length})
                  </button>
                  <button type="button" role="tab" aria-pressed={tab === "followers"} onClick={() => setTab("followers")}>
                    Followers ({graph.followers.length})
                  </button>
                </div>

                {tab === "friends" &&
                  (data.friends.length === 0 ? (
                    <Empty title="No friends here yet">Share your Bloom ID, or search above to connect.</Empty>
                  ) : (
                    data.friends.map((f) => {
                      const online = Boolean(f.online || onlineFriends.has(f.bloom_id));
                      return (
                        <div key={f.bloom_id} className="person">
                          <Avatar name={f.display_name} />
                          <div className="who" style={{ cursor: "pointer" }} onClick={() => void openProfile(f.bloom_id)}>
                            <strong>
                              {f.display_name}
                              {online && <span className="online-dot" title="Online now" />}
                            </strong>
                            <span className="bloom-id">{f.bloom_id}</span>
                          </div>
                          <button
                            type="button"
                            className="btn icon small quiet"
                            title="Direct message"
                            aria-label={`Message ${f.display_name}`}
                            disabled={busy}
                            onClick={() => void openDm(f.bloom_id)}
                          >
                            <IconChat />
                          </button>
                          <button
                            type="button"
                            className="btn icon small quiet"
                            title="Make something together"
                            aria-label={`Make something together with ${f.display_name}`}
                            onClick={() => navigate(`/together?with=${encodeURIComponent(f.bloom_id)}`)}
                          >
                            <IconTogether />
                          </button>
                          <button
                            type="button"
                            className="btn icon small quiet"
                            title="Start a live room"
                            aria-label={`Start a live room with ${f.display_name}`}
                            disabled={busy}
                            onClick={() => void startLive(f.bloom_id)}
                          >
                            <IconLive />
                          </button>
                          <button
                            type="button"
                            className="btn icon small quiet danger"
                            title="Remove friend"
                            aria-label={`Remove ${f.display_name}`}
                            disabled={busy}
                            onClick={() => {
                              if (window.confirm(`Remove ${f.display_name} from your friends?`)) {
                                void act(() => api(`/api/friends/${encodeURIComponent(f.bloom_id)}`, { method: "DELETE" }), "Removed.");
                              }
                            }}
                          >
                            <IconTrash />
                          </button>
                        </div>
                      );
                    })
                  ))}

                {tab === "following" &&
                  (graph.following.length === 0 ? (
                    <Empty title="Not following anyone yet">Follow people you discover to keep up with their blooms.</Empty>
                  ) : (
                    graph.following.map((u) => (
                      <div key={u.bloom_id} className="person">
                        <Avatar name={u.display_name} />
                        <div className="who" style={{ cursor: "pointer" }} onClick={() => void openProfile(u.bloom_id)}>
                          <strong>{u.display_name}</strong>
                          <span className="bloom-id">{u.bloom_id}</span>
                        </div>
                        <button type="button" className="btn small quiet" disabled={busy} onClick={() => void toggleFollow(u.bloom_id, true)}>
                          Unfollow
                        </button>
                      </div>
                    ))
                  ))}

                {tab === "followers" &&
                  (graph.followers.length === 0 ? (
                    <Empty title="No followers yet">Share your Bloom ID to let people follow you.</Empty>
                  ) : (
                    graph.followers.map((u) => {
                      const followingBack = isFollowingId(u.bloom_id);
                      return (
                        <div key={u.bloom_id} className="person">
                          <Avatar name={u.display_name} />
                          <div className="who" style={{ cursor: "pointer" }} onClick={() => void openProfile(u.bloom_id)}>
                            <strong>{u.display_name}</strong>
                            <span className="bloom-id">{u.bloom_id}</span>
                          </div>
                          <button
                            type="button"
                            className={`btn small ${followingBack ? "quiet" : ""}`}
                            disabled={busy}
                            onClick={() => void toggleFollow(u.bloom_id, followingBack)}
                          >
                            {followingBack ? "Following" : "Follow back"}
                          </button>
                        </div>
                      );
                    })
                  ))}
              </section>

              {data.outgoing.length > 0 && (
                <section className="panel">
                  <h3>Requests you sent</h3>
                  {data.outgoing.map((f) => (
                    <div key={f.request_id} className="person">
                      <Avatar name={f.display_name} />
                      <div className="who">
                        <strong>{f.display_name}</strong>
                        <span className="bloom-id">{f.bloom_id}</span>
                      </div>
                      <button
                        type="button"
                        className="btn small quiet"
                        disabled={busy}
                        onClick={() => void act(() => api(`/api/friends/requests/${f.request_id}`, { method: "DELETE" }), "Request cancelled.")}
                      >
                        Cancel
                      </button>
                    </div>
                  ))}
                </section>
              )}
            </>
          )}
        </div>
      </div>

      {profile && (
        <Modal title={profile.display_name} onClose={() => setProfile(null)}>
          <div className="stack">
            <div className="row" style={{ alignItems: "center", gap: 14 }}>
              {profile.avatar_recipe ? (
                <div className="avatar-flower-preview">
                  <FlowerPreview recipe={{ ...normalizeRecipe(profile.avatar_recipe), showHearts: false, showStem: false }} framing="tight" />
                </div>
              ) : (
                <Avatar name={profile.display_name} />
              )}
              <div>
                <div className="bloom-id">{profile.bloom_id}</div>
                <p className="muted small">
                  {profile.online ? "Online now" : "Offline"}
                  {profile.follows_you ? " · Follows you" : ""}
                </p>
              </div>
            </div>

            {profile.profile_locked ? (
              <p className="notice">This user's profile details are private.</p>
            ) : (
              <>
                {profile.bio && <p>{profile.bio}</p>}
                {profile.favorite_word && (
                  <p className="muted small">
                    Signature word: <strong>“{profile.favorite_word}”</strong>
                  </p>
                )}
                <div className="profile-stats">
                  <span><strong>{profile.stats.friends}</strong> friends</span>
                  <span><strong>{profile.stats.followers}</strong> followers</span>
                  <span><strong>{profile.stats.following}</strong> following</span>
                </div>
              </>
            )}

            <div className="btn-row">
              {profile.relation !== "self" && (
                <button
                  type="button"
                  className={`btn small ${profile.following ? "quiet" : ""}`}
                  disabled={busy}
                  onClick={() => void toggleFollow(profile.bloom_id, profile.following)}
                >
                  {profile.following ? "Following" : "Follow"}
                </button>
              )}
              {profile.relation === "none" && (
                <button
                  type="button"
                  className="btn small primary"
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      await api("/api/friends/requests", { body: { bloom_id: profile.bloom_id } });
                      setProfile(await api<UserProfile>(`/api/users/${encodeURIComponent(profile.bloom_id)}/profile`));
                    }, "Friend request sent.")
                  }
                >
                  Add friend
                </button>
              )}
              {profile.allow_dm && profile.relation !== "self" && (
                <button type="button" className="btn small" disabled={busy} onClick={() => void openDm(profile.bloom_id)}>
                  <IconChat /> Message
                </button>
              )}
            </div>
          </div>
        </Modal>
      )}
    </main>
  );
}
