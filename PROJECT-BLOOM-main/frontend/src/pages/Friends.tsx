/** Bloom IDs, user search, profiles and friends. */
import { useCallback, useEffect, useState } from "react";
import { IconCopy, IconLive, IconTogether, IconTrash } from "../components/Icons";
import { Avatar, Empty, Loading, SignInNeeded } from "../components/ui";
import { api, errorMessage } from "../lib/api";
import { Link, useRouter } from "../lib/router";
import { useSession } from "../lib/session";

interface FriendItem {
  request_id: number;
  bloom_id: string;
  display_name: string;
  avatar_url?: string | null;
  since: string;
}

interface FriendsData {
  friends: FriendItem[];
  incoming: FriendItem[];
  outgoing: FriendItem[];
}

interface SearchResult {
  bloom_id: string;
  display_name: string;
  avatar_url: string | null;
  relation: "none" | "self" | "friend" | "request-sent" | "request-received";
  allow_friend_requests: boolean;
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
  const { user, toast } = useSession();
  const { navigate } = useRouter();
  const { data, error, reload } = useFriends();
  const [queryText, setQueryText] = useState("");
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [lookupError, setLookupError] = useState("");
  const [busy, setBusy] = useState(false);

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
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  };

  const search = async () => {
    setResults(null);
    setLookupError("");
    const q = queryText.trim();
    if (!q) return;
    try {
      const found = await api<SearchResult[]>(`/api/profiles/search?q=${encodeURIComponent(q)}`);
      setResults(found);
      if (found.length === 0) setLookupError("No matching user found.");
    } catch (e) {
      setLookupError(errorMessage(e));
    }
  };

  const startLive = (bloomId: string) =>
    act(async () => {
      const room = await api<{ id: string }>("/api/live/rooms", { body: { friend_bloom_id: bloomId } });
      navigate(`/live/${room.id}`);
    });

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Bloom Together · friends</p>
          <h1>
            The people you <span className="flourish">grow with</span>
          </h1>
        </div>
        <Link to={`/profile/${user.bloom_id}`} className="btn small">
          View my profile
        </Link>
      </div>

      <div className="columns">
        <div className="stack">
          <div className="id-card">
            <span className="eyebrow">Your Bloom ID</span>
            <span className="bloom-id">{user.bloom_id}</span>
            <p className="muted small">Give this to a friend. They can search by Bloom ID or name to view your profile and send a request.</p>
            <button
              type="button"
              className="btn small"
              style={{ justifySelf: "start" }}
              onClick={() => void navigator.clipboard?.writeText(user.bloom_id).then(() => toast("Bloom ID copied."), () => toast("Couldn't copy.", "error"))}
            >
              <IconCopy /> Copy my ID
            </button>
          </div>

          <form
            className="panel stack"
            onSubmit={(e) => {
              e.preventDefault();
              void search();
            }}
          >
            <h3>Find someone</h3>
            <label className="field">
              <span>Bloom ID or name</span>
              <input
                type="text"
                value={queryText}
                placeholder="BLM-XXXX-XXXX or display name"
                maxLength={48}
                onChange={(e) => {
                  setQueryText(e.target.value);
                  setResults(null);
                  setLookupError("");
                }}
              />
            </label>
            <button type="submit" className="btn small" style={{ justifySelf: "start" }} disabled={!queryText.trim()}>
              Search
            </button>
            {lookupError && <p className="form-error">{lookupError}</p>}
            {results && results.length > 0 && (
              <div className="stack tight">
                {results.map((found) => (
                  <div key={found.bloom_id} className="person">
                    <Avatar name={found.display_name} src={found.avatar_url} />
                    <div className="who">
                      <Link to={`/profile/${found.bloom_id}`} style={{ textDecoration: "none", color: "inherit" }}>
                        <strong>{found.display_name}</strong>
                      </Link>
                      <span className="bloom-id">{found.bloom_id}</span>
                    </div>
                    <Link to={`/profile/${found.bloom_id}`} className="btn small quiet">
                      Profile
                    </Link>
                    {found.relation === "none" && found.allow_friend_requests && (
                      <button
                        type="button"
                        className="btn small primary"
                        disabled={busy}
                        onClick={() =>
                          void act(async () => {
                            const result = await api<{ status: string }>("/api/friends/requests", { body: { bloom_id: found.bloom_id } });
                            setResults((list) =>
                              list ? list.map((r) => (r.bloom_id === found.bloom_id ? { ...r, relation: result.status === "accepted" ? "friend" : "request-sent" } : r)) : list,
                            );
                          }, "Request sent.")
                        }
                      >
                        Add
                      </button>
                    )}
                    {found.relation === "friend" && <span className="muted small">Friends</span>}
                    {found.relation === "request-sent" && <span className="muted small">Sent</span>}
                    {found.relation === "request-received" && <span className="muted small">Asked you</span>}
                  </div>
                ))}
              </div>
            )}
          </form>
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
                      <Avatar name={f.display_name} src={f.avatar_url} />
                      <div className="who">
                        <Link to={`/profile/${f.bloom_id}`} style={{ textDecoration: "none", color: "inherit" }}>
                          <strong>{f.display_name}</strong>
                        </Link>
                        <span className="bloom-id">{f.bloom_id}</span>
                      </div>
                      <button type="button" className="btn small primary" disabled={busy} onClick={() => void act(() => api(`/api/friends/requests/${f.request_id}/accept`, { method: "POST" }), `You and ${f.display_name} are friends now.`)}>
                        Accept
                      </button>
                      <button type="button" className="btn small quiet" disabled={busy} onClick={() => void act(() => api(`/api/friends/requests/${f.request_id}/decline`, { method: "POST" }))}>
                        Decline
                      </button>
                    </div>
                  ))}
                </section>
              )}
              <section className="panel">
                <h3>Friends</h3>
                {data.friends.length === 0 ? (
                  <Empty title="No friends here yet">Share your Bloom ID, or search for someone.</Empty>
                ) : (
                  data.friends.map((f) => (
                    <div key={f.bloom_id} className="person">
                      <Avatar name={f.display_name} src={f.avatar_url} />
                      <div className="who">
                        <Link to={`/profile/${f.bloom_id}`} style={{ textDecoration: "none", color: "inherit" }}>
                          <strong>{f.display_name}</strong>
                        </Link>
                        <span className="bloom-id">{f.bloom_id}</span>
                      </div>
                      <button type="button" className="btn icon small quiet" title="Make something together" aria-label={`Make something together with ${f.display_name}`} onClick={() => navigate(`/together?with=${encodeURIComponent(f.bloom_id)}`)}>
                        <IconTogether />
                      </button>
                      <button type="button" className="btn icon small quiet" title="Start a live room" aria-label={`Start a live room with ${f.display_name}`} disabled={busy} onClick={() => void startLive(f.bloom_id)}>
                        <IconLive />
                      </button>
                      <button
                        type="button"
                        className="btn icon small quiet danger"
                        title="Remove friend"
                        aria-label={`Remove ${f.display_name}`}
                        disabled={busy}
                        onClick={() => {
                          if (window.confirm(`Remove ${f.display_name} from your friends? Shared projects stay until you leave them.`)) {
                            void act(() => api(`/api/friends/${encodeURIComponent(f.bloom_id)}`, { method: "DELETE" }), "Removed.");
                          }
                        }}
                      >
                        <IconTrash />
                      </button>
                    </div>
                  ))
                )}
              </section>
              {data.outgoing.length > 0 && (
                <section className="panel">
                  <h3>Requests you sent</h3>
                  {data.outgoing.map((f) => (
                    <div key={f.request_id} className="person">
                      <Avatar name={f.display_name} src={f.avatar_url} />
                      <div className="who">
                        <Link to={`/profile/${f.bloom_id}`} style={{ textDecoration: "none", color: "inherit" }}>
                          <strong>{f.display_name}</strong>
                        </Link>
                        <span className="bloom-id">{f.bloom_id}</span>
                      </div>
                      <button type="button" className="btn small quiet" disabled={busy} onClick={() => void act(() => api(`/api/friends/requests/${f.request_id}`, { method: "DELETE" }), "Request cancelled.")}>
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
    </main>
  );
}
