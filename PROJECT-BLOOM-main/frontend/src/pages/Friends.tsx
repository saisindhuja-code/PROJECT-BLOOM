/** Bloom IDs and friends: add by ID, accept requests, remove friends. */
import { useCallback, useEffect, useState } from "react";
import { IconCopy, IconLive, IconTogether, IconTrash } from "../components/Icons";
import { Avatar, Empty, Loading, SignInNeeded } from "../components/ui";
import { api, errorMessage } from "../lib/api";
import { useRouter } from "../lib/router";
import { useSession } from "../lib/session";

interface FriendItem {
  request_id: number;
  bloom_id: string;
  display_name: string;
  since: string;
}

interface FriendsData {
  friends: FriendItem[];
  incoming: FriendItem[];
  outgoing: FriendItem[];
}

interface Lookup {
  bloom_id: string;
  display_name: string;
  relation: "none" | "self" | "friend" | "request-sent" | "request-received";
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
  const [code, setCode] = useState("");
  const [found, setFound] = useState<Lookup | null>(null);
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

  const lookup = async () => {
    setFound(null);
    setLookupError("");
    if (!code.trim()) return;
    try {
      setFound(await api<Lookup>(`/api/users/lookup?bloom_id=${encodeURIComponent(code.trim())}`));
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
      </div>

      <div className="columns">
        <div className="stack">
          <div className="id-card">
            <span className="eyebrow">Your Bloom ID</span>
            <span className="bloom-id">{user.bloom_id}</span>
            <p className="muted small">Give this to a friend. They type it below on their side to send you a request.</p>
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
              void lookup();
            }}
          >
            <h3>Add a friend</h3>
            <label className="field">
              <span>Their Bloom ID</span>
              <input
                type="text"
                value={code}
                placeholder="BLM-XXXX-XXXX"
                maxLength={20}
                autoCapitalize="characters"
                onChange={(e) => {
                  setCode(e.target.value);
                  setFound(null);
                  setLookupError("");
                }}
                style={{ fontFamily: "var(--mono)", letterSpacing: "0.08em" }}
              />
            </label>
            <button type="submit" className="btn small" style={{ justifySelf: "start" }} disabled={!code.trim()}>
              Find
            </button>
            {lookupError && <p className="form-error">{lookupError}</p>}
            {found && (
              <div className="person">
                <Avatar name={found.display_name} />
                <div className="who">
                  <strong>{found.display_name}</strong>
                  <span className="bloom-id">{found.bloom_id}</span>
                </div>
                {found.relation === "none" && (
                  <button
                    type="button"
                    className="btn small primary"
                    disabled={busy}
                    onClick={() =>
                      void act(async () => {
                        const result = await api<{ status: string }>("/api/friends/requests", { body: { bloom_id: found.bloom_id } });
                        setFound({ ...found, relation: result.status === "accepted" ? "friend" : "request-sent" });
                      }, "Request sent.")
                    }
                  >
                    Send request
                  </button>
                )}
                {found.relation === "self" && <span className="muted small">That's you</span>}
                {found.relation === "friend" && <span className="muted small">Already friends</span>}
                {found.relation === "request-sent" && <span className="muted small">Request sent</span>}
                {found.relation === "request-received" && <span className="muted small">They asked you, see below</span>}
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
                      <Avatar name={f.display_name} />
                      <div className="who">
                        <strong>{f.display_name}</strong>
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
                  <Empty title="No friends here yet">Share your Bloom ID, or add someone's.</Empty>
                ) : (
                  data.friends.map((f) => (
                    <div key={f.bloom_id} className="person">
                      <Avatar name={f.display_name} />
                      <div className="who">
                        <strong>{f.display_name}</strong>
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
                      <Avatar name={f.display_name} />
                      <div className="who">
                        <strong>{f.display_name}</strong>
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
