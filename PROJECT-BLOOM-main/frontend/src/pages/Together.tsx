/** Bloom Together: shared projects list, invitations, and starting a new one. */
import { useEffect, useState } from "react";
import { RecipePicker } from "../components/RecipePicker";
import { Avatar, Empty, Loading, SignInNeeded, formatDate } from "../components/ui";
import type { FlowerRecipe } from "../flower/recipe";
import { api, errorMessage } from "../lib/api";
import { MODES, type Project, type ProjectMode } from "../lib/projects";
import { Link, useRouter } from "../lib/router";
import { useSession } from "../lib/session";
import { useFriends } from "./Friends";

export function ModeDiagram({ mode }: { mode: ProjectMode }) {
  const rose = "var(--rose)";
  const sage = "var(--sage)";
  return (
    <svg viewBox="0 0 52 34" aria-hidden="true">
      <rect x="1" y="3" width="22" height="28" rx="2" fill="none" stroke="currentColor" opacity=".6" />
      <rect x="29" y="3" width="22" height="28" rx="2" fill="none" stroke="currentColor" opacity=".6" />
      <circle cx="12" cy="13" r="4" fill={rose} />
      <circle cx="40" cy="13" r="4" fill={mode === "two" ? sage : rose} />
      {mode === "moment" && (
        <>
          <rect x="6" y="20" width="12" height="7" rx="1" fill={sage} opacity=".7" />
          <rect x="34" y="20" width="12" height="7" rx="1" fill={rose} opacity=".7" />
        </>
      )}
    </svg>
  );
}

export function TogetherPage() {
  const { user, toast, recipe, refreshInbox, hasFlower } = useSession();
  const { navigate, query } = useRouter();
  const { data: friends } = useFriends();
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(Boolean(query.get("with")));
  const [mode, setMode] = useState<ProjectMode>("twin");
  const [title, setTitle] = useState("");
  const [friend, setFriend] = useState(query.get("with") ?? "");
  const [shared, setShared] = useState<FlowerRecipe | null>(hasFlower ? recipe : null);
  const [busy, setBusy] = useState(false);

  const load = () =>
    api<Project[]>("/api/projects")
      .then((list) => {
        setProjects(list);
        setError("");
      })
      .catch((e) => setError(errorMessage(e)));

  useEffect(() => {
    if (user) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  if (!user) {
    return (
      <main className="page">
        <SignInNeeded what="Bloom Together" />
      </main>
    );
  }

  const create = async () => {
    setBusy(true);
    try {
      const project = await api<Project>("/api/projects", {
        body: {
          title: title.trim() || MODES.find((m) => m.id === mode)!.name,
          mode,
          invite_bloom_id: friend || null,
          shared_recipe: mode === "twin" ? shared : null,
        },
      });
      navigate(`/together/${project.id}`);
    } catch (e) {
      toast(errorMessage(e), "error");
      setBusy(false);
    }
  };

  const respond = async (project: Project, accept: boolean) => {
    try {
      await api(`/api/projects/${project.id}/${accept ? "accept" : "decline"}`, { method: "POST" });
      refreshInbox();
      if (accept) navigate(`/together/${project.id}`);
      else void load();
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  const invitations = projects?.filter((p) => p.my_status === "invited") ?? [];
  const active = projects?.filter((p) => p.my_status === "active") ?? [];

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">04 · Bloom Together</p>
          <h1>
            One picture, <span className="flourish">two places</span>
          </h1>
          <p className="lede" style={{ marginTop: 10 }}>
            Make something with a friend at your own pace. Add your part whenever you're ready; it waits for theirs.
          </p>
        </div>
        {!creating && (
          <button type="button" className="btn primary" onClick={() => setCreating(true)}>
            Start a project
          </button>
        )}
      </div>

      {error && <p className="notice error">{error}</p>}

      {creating && (
        <section className="panel stack" style={{ marginBottom: 32 }}>
          <h2>New project</h2>
          <div className="mode-cards" role="radiogroup" aria-label="Kind of project">
            {MODES.map((m) => (
              <button key={m.id} type="button" className="mode-card" role="radio" aria-checked={mode === m.id} aria-pressed={mode === m.id} onClick={() => setMode(m.id)}>
                <ModeDiagram mode={m.id} />
                <h3>{m.name}</h3>
                <span>{m.text}</span>
              </button>
            ))}
          </div>
          <div className="columns">
            <div className="stack">
              <label className="field">
                <span>Title</span>
                <input type="text" value={title} maxLength={80} placeholder={MODES.find((m) => m.id === mode)!.name} onChange={(e) => setTitle(e.target.value)} />
              </label>
              <label className="field">
                <span>Invite a friend</span>
                <select value={friend} onChange={(e) => setFriend(e.target.value)}>
                  <option value="">Choose later</option>
                  {friends?.friends.map((f) => (
                    <option key={f.bloom_id} value={f.bloom_id}>
                      {f.display_name} · {f.bloom_id}
                    </option>
                  ))}
                </select>
              </label>
              {friends && friends.friends.length === 0 && (
                <p className="muted small">
                  You haven't added friends yet. <Link to="/friends">Add one by Bloom ID</Link>.
                </p>
              )}
            </div>
            {mode === "twin" && (
              <div className="stack tight">
                <span className="label">The flower you'll both hold</span>
                <RecipePicker value={shared} onChange={setShared} />
              </div>
            )}
          </div>
          <div className="btn-row">
            <button type="button" className="btn primary" disabled={busy || (mode === "twin" && !shared)} onClick={() => void create()}>
              Create project
            </button>
            <button type="button" className="btn quiet" onClick={() => setCreating(false)}>
              Cancel
            </button>
          </div>
        </section>
      )}

      {projects === null ? (
        <Loading />
      ) : (
        <div className="stack">
          {invitations.length > 0 && (
            <section className="panel">
              <h3>Invitations</h3>
              {invitations.map((p) => (
                <div key={p.id} className="person">
                  <Avatar name={p.owner.display_name} />
                  <div className="who">
                    <strong>{p.title}</strong>
                    <span className="muted small">
                      {p.owner.display_name} invited you · {MODES.find((m) => m.id === p.mode)?.name}
                    </span>
                  </div>
                  <button type="button" className="btn small primary" onClick={() => void respond(p, true)}>
                    Join
                  </button>
                  <button type="button" className="btn small quiet" onClick={() => void respond(p, false)}>
                    Decline
                  </button>
                </div>
              ))}
            </section>
          )}
          {active.length === 0 && invitations.length === 0 && !creating ? (
            <Empty title="Nothing shared yet" action={<button type="button" className="btn primary" onClick={() => setCreating(true)}>Start a project</button>}>
              Start a Twin Bloom, Two Blooms or Our Moment project with a friend.
            </Empty>
          ) : (
            <section>
              {active.map((p) => (
                <Link key={p.id} to={`/together/${p.id}`} className="project-row">
                  <span style={{ color: "var(--ink-soft)" }}>
                    <ModeDiagram mode={p.mode} />
                  </span>
                  <span className="grow">
                    <h3>{p.title}</h3>
                    <span className="muted small">
                      {MODES.find((m) => m.id === p.mode)?.name} · with{" "}
                      {(p.members ?? []).filter((m) => !m.is_you).map((m) => `${m.display_name}${m.status === "invited" ? " (invited)" : ""}`).join(", ") || "nobody yet"}
                    </span>
                  </span>
                  <span className="date muted small">{formatDate(p.updated_at)}</span>
                </Link>
              ))}
            </section>
          )}
        </div>
      )}
    </main>
  );
}
