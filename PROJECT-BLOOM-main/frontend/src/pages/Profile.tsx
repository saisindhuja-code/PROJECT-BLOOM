/** Public / friends-scoped user profile by Bloom ID. */
import { useCallback, useEffect, useState } from "react";
import { FlowerPreview } from "../components/FlowerPreview";
import { IconArrowLeft, IconEdit, IconFlower, IconLive, IconTogether } from "../components/Icons";
import { Avatar, Empty, Loading, Modal, SignInNeeded, formatDate } from "../components/ui";
import { normalizeRecipe, type FlowerRecipe } from "../flower/recipe";
import { api, errorMessage, mediaUrl } from "../lib/api";
import { Link, useRouter } from "../lib/router";
import { useSession } from "../lib/session";

interface ProfileFlower {
  id: number;
  title: string;
  recipe: unknown;
  visibility: string;
  updated_at: string;
}

interface ProfileAlbum {
  id: number;
  name: string;
  visibility: string;
  entry_count: number;
}

interface ProfileEntry {
  id: number;
  entry_type: "flower" | "photo" | "composition";
  title: string;
  caption: string;
  notes: string;
  taken_at: string;
  recipe: unknown;
  photo_url: string | null;
  visibility: string;
  album_ids: number[];
}

interface ProfileData {
  bloom_id: string;
  display_name: string;
  is_you: boolean;
  relation: "self" | "friend" | "request-sent" | "request-received" | "none";
  request_id: number | null;
  can_view_profile: boolean;
  allow_friend_requests: boolean;
  profile_visibility: string | null;
  bio: string;
  avatar_url: string | null;
  friend_count: number | null;
  created_at: string;
  flowers: ProfileFlower[];
  albums: ProfileAlbum[];
  entries: ProfileEntry[];
}

export function ProfilePage({ bloomId }: { bloomId?: string }) {
  const { user, toast, growFlower, refreshInbox } = useSession();
  const { navigate } = useRouter();
  const targetId = bloomId || user?.bloom_id || "";
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [selectedAlbumId, setSelectedAlbumId] = useState<number | null>(null);
  const [openEntry, setOpenEntry] = useState<ProfileEntry | null>(null);

  const load = useCallback(() => {
    if (!user || !targetId) return Promise.resolve();
    return api<ProfileData>(`/api/profiles/${encodeURIComponent(targetId)}`)
      .then((d) => {
        setProfile(d);
        setError("");
      })
      .catch((e) => setError(errorMessage(e)));
  }, [user, targetId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!user) {
    return (
      <main className="page">
        <SignInNeeded what="Profiles" />
      </main>
    );
  }
  if (error) {
    return (
      <main className="page">
        <p className="notice error">{error}</p>
        <p style={{ marginTop: 14 }}>
          <Link to="/friends">Back to Friends</Link>
        </p>
      </main>
    );
  }
  if (!profile) {
    return (
      <main className="page">
        <Loading label="Opening profile" />
      </main>
    );
  }

  const act = async (task: () => Promise<unknown>, msg?: string) => {
    setBusy(true);
    try {
      await task();
      if (msg) toast(msg);
      refreshInbox();
      await load();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  };

  const visibleEntries =
    selectedAlbumId === null ? profile.entries : profile.entries.filter((e) => e.album_ids.includes(selectedAlbumId));

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <Link to="/friends" className="btn small quiet">
            <IconArrowLeft /> Friends
          </Link>
        </div>
      </div>

      <section className="panel profile-header">
        <div className="profile-avatar-lg">
          <Avatar name={profile.display_name} src={profile.avatar_url} />
        </div>
        <div className="profile-meta">
          <div className="row" style={{ gap: 10 }}>
            <h1>{profile.display_name}</h1>
            {profile.relation === "friend" && <span className="status-pill ok"><span className="dot" /> FRIEND</span>}
            {profile.is_you && profile.profile_visibility && (
              <span className="status-pill">{profile.profile_visibility.toUpperCase()} PROFILE</span>
            )}
          </div>
          <span className="bloom-id">{profile.bloom_id}</span>
          {profile.can_view_profile && profile.bio && <p className="lede" style={{ marginTop: 6 }}>{profile.bio}</p>}
          {profile.can_view_profile && profile.friend_count !== null && (
            <p className="muted small">
              {profile.friend_count} {profile.friend_count === 1 ? "friend" : "friends"} · joined {formatDate(profile.created_at)}
            </p>
          )}
        </div>

        <div className="btn-row">
          {profile.is_you ? (
            <Link to="/account" className="btn">
              <IconEdit /> Edit profile &amp; privacy
            </Link>
          ) : (
            <>
              {profile.relation === "none" && profile.allow_friend_requests && (
                <button
                  type="button"
                  className="btn primary"
                  disabled={busy}
                  onClick={() => void act(() => api("/api/friends/requests", { body: { bloom_id: profile.bloom_id } }), "Friend request sent.")}
                >
                  Add friend
                </button>
              )}
              {profile.relation === "none" && !profile.allow_friend_requests && (
                <span className="muted small">Not accepting friend requests</span>
              )}
              {profile.relation === "request-sent" && profile.request_id && (
                <button
                  type="button"
                  className="btn quiet"
                  disabled={busy}
                  onClick={() => void act(() => api(`/api/friends/requests/${profile.request_id}`, { method: "DELETE" }), "Request cancelled.")}
                >
                  Cancel request
                </button>
              )}
              {profile.relation === "request-received" && profile.request_id && (
                <>
                  <button
                    type="button"
                    className="btn primary"
                    disabled={busy}
                    onClick={() => void act(() => api(`/api/friends/requests/${profile.request_id}/accept`, { method: "POST" }), `You and ${profile.display_name} are friends now.`)}
                  >
                    Accept request
                  </button>
                  <button
                    type="button"
                    className="btn quiet"
                    disabled={busy}
                    onClick={() => void act(() => api(`/api/friends/requests/${profile.request_id}/decline`, { method: "POST" }), "Request declined.")}
                  >
                    Decline
                  </button>
                </>
              )}
              {profile.relation === "friend" && (
                <>
                  <button type="button" className="btn" onClick={() => navigate(`/together?with=${encodeURIComponent(profile.bloom_id)}`)}>
                    <IconTogether /> Together
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={busy}
                    onClick={() =>
                      void act(async () => {
                        const room = await api<{ id: string }>("/api/live/rooms", { body: { friend_bloom_id: profile.bloom_id } });
                        navigate(`/live/${room.id}`);
                      })
                    }
                  >
                    <IconLive /> Live room
                  </button>
                  <button
                    type="button"
                    className="btn quiet danger"
                    disabled={busy}
                    onClick={() => {
                      if (window.confirm(`Remove ${profile.display_name} from your friends?`)) {
                        void act(() => api(`/api/friends/${encodeURIComponent(profile.bloom_id)}`, { method: "DELETE" }), "Removed.");
                      }
                    }}
                  >
                    Remove friend
                  </button>
                </>
              )}
            </>
          )}
        </div>
      </section>

      {!profile.can_view_profile ? (
        <div style={{ marginTop: 28 }}>
          <Empty title="This profile is private">
            {profile.relation === "friend"
              ? `${profile.display_name} keeps their profile details private.`
              : `Only ${profile.display_name}'s friends can view their bio, flowers, and shared journal pages.`}
          </Empty>
        </div>
      ) : (
        <div className="stack" style={{ marginTop: 32, gap: 36 }}>
          <section className="stack">
            <div className="row between">
              <h2>Flower creations</h2>
              {profile.is_you && (
                <Link to="/studio" className="btn small">
                  <IconFlower /> Open Studio
                </Link>
              )}
            </div>
            {profile.flowers.length === 0 ? (
              <p className="muted">No shared flower creations yet.</p>
            ) : (
              <div className="profile-grid">
                {profile.flowers.map((f) => {
                  const rec: FlowerRecipe = normalizeRecipe(f.recipe);
                  return (
                    <div key={f.id} className="plate stack tight">
                      <FlowerPreview recipe={rec} label={f.title} />
                      <div className="row between">
                        <strong>{f.title || rec.word}</strong>
                        <span className="eyebrow">{f.visibility}</span>
                      </div>
                      <button
                        type="button"
                        className="btn small"
                        onClick={() => {
                          growFlower(rec);
                          navigate("/studio");
                        }}
                      >
                        <IconFlower /> Open in Studio
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section className="stack">
            <div className="row between">
              <h2>Shared journal &amp; collections</h2>
              {profile.albums.length > 0 && (
                <div className="chips">
                  <button type="button" className="chip" aria-pressed={selectedAlbumId === null} onClick={() => setSelectedAlbumId(null)}>
                    All shared ({profile.entries.length})
                  </button>
                  {profile.albums.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      className="chip"
                      aria-pressed={selectedAlbumId === a.id}
                      onClick={() => setSelectedAlbumId(a.id)}
                    >
                      {a.name} ({a.entry_count})
                    </button>
                  ))}
                </div>
              )}
            </div>
            {visibleEntries.length === 0 ? (
              <p className="muted">No shared journal entries in this view.</p>
            ) : (
              <div className="entries">
                {visibleEntries.map((entry) => {
                  const rec = entry.recipe ? normalizeRecipe(entry.recipe) : null;
                  return (
                    <button key={entry.id} type="button" className="entry-card" onClick={() => setOpenEntry(entry)}>
                      <div className="print">
                        {entry.photo_url ? (
                          <img src={mediaUrl(entry.photo_url)!} alt={entry.title || "Shared entry"} loading="lazy" />
                        ) : rec ? (
                          <FlowerPreview recipe={rec} />
                        ) : null}
                      </div>
                      <div className="meta">
                        <span className="title">{entry.title || rec?.word || "Untitled"}</span>
                        <span className="date">{formatDate(entry.taken_at)}</span>
                      </div>
                      <span className="kind-tag">{entry.visibility} · {entry.entry_type}</span>
                      {entry.caption && <p className="caption">{entry.caption}</p>}
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      )}

      {openEntry && (
        <Modal title={openEntry.title || "Journal entry"} onClose={() => setOpenEntry(null)} wide>
          <div className="entry-view">
            <div className="plate">
              {openEntry.photo_url ? (
                <img src={mediaUrl(openEntry.photo_url)!} alt={openEntry.title || "Shared photo"} style={{ width: "100%", height: "auto", display: "block" }} />
              ) : openEntry.recipe ? (
                <FlowerPreview recipe={normalizeRecipe(openEntry.recipe)} />
              ) : null}
            </div>
            <div className="stack">
              <p className="eyebrow">
                {formatDate(openEntry.taken_at)} · {openEntry.visibility}
              </p>
              {openEntry.caption && <p><strong>{openEntry.caption}</strong></p>}
              {openEntry.notes && <p className="muted" style={{ whiteSpace: "pre-wrap" }}>{openEntry.notes}</p>}
              {Boolean(openEntry.recipe) && (
                <button
                  type="button"
                  className="btn small"
                  style={{ justifySelf: "start" }}
                  onClick={() => {
                    growFlower(normalizeRecipe(openEntry.recipe));
                    setOpenEntry(null);
                    navigate("/studio");
                  }}
                >
                  <IconFlower /> Open flower in Studio
                </button>
              )}
            </div>
          </div>
        </Modal>
      )}
    </main>
  );
}
