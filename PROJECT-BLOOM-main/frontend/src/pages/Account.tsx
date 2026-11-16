import { useEffect, useState } from "react";
import { IconCopy } from "../components/Icons";
import { api, errorMessage, type User } from "../lib/api";
import { Link, useRouter } from "../lib/router";
import { useSession } from "../lib/session";
import { localStore, serverStore } from "../lib/store";
import { useTheme } from "../theme/ThemeProvider";

export function AccountPage() {
  const { theme, choice } = useTheme();
  const { user, signOut, setUser, toast, ready } = useSession();
  const { navigate } = useRouter();
  const [name, setName] = useState(user?.display_name ?? "");
  const [counts, setCounts] = useState({ entries: 0, designs: 0, albums: 0 });
  const [moving, setMoving] = useState<string | null>(null);

  useEffect(() => {
    localStore.counts().then(setCounts).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (ready && !user) navigate("/signin?next=/account", { replace: true });
  }, [ready, user, navigate]);

  if (!user) return null;

  const saveName = async () => {
    try {
      setUser(await api<User>("/api/auth/me", { method: "PATCH", body: { display_name: name } }));
      toast("Name updated.");
    } catch (error) {
      toast(errorMessage(error), "error");
    }
  };

  const moveLocal = async () => {
    setMoving("Starting…");
    try {
      const moved = await localStore.moveTo(serverStore, (done, total) => setMoving(`Moved ${done} of ${total}…`));
      setCounts(await localStore.counts());
      toast(`Moved ${moved} journal entries into your account.`);
    } catch (error) {
      toast(`${errorMessage(error)} Anything not moved is still on this device.`, "error");
    } finally {
      setMoving(null);
    }
  };

  const localTotal = counts.entries + counts.designs;

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Your account</p>
          <h1>{user.display_name}</h1>
        </div>
        <button
          type="button"
          className="btn"
          onClick={async () => {
            await signOut();
            navigate("/");
          }}
        >
          Sign out
        </button>
      </div>
      <div className="columns">
        <div className="id-card">
          <span className="eyebrow">Your Bloom ID</span>
          <span className="bloom-id">{user.bloom_id}</span>
          <p className="muted small">Share this with friends so they can find you. It doesn't reveal your username or anything private.</p>
          <div className="btn-row">
            <button
              type="button"
              className="btn small"
              onClick={() => {
                void navigator.clipboard?.writeText(user.bloom_id).then(
                  () => toast("Bloom ID copied."),
                  () => toast("Couldn't copy. Select the ID and copy it instead.", "error"),
                );
              }}
            >
              <IconCopy /> Copy
            </button>
            <Link to="/friends" className="btn small quiet">
              Friends
            </Link>
          </div>
        </div>
        <form
          className="panel stack"
          onSubmit={(e) => {
            e.preventDefault();
            void saveName();
          }}
        >
          <label className="field">
            <span>Name shown to friends</span>
            <input type="text" value={name} maxLength={48} onChange={(e) => setName(e.target.value)} />
          </label>
          <p className="muted small">Username: {user.username}</p>
          <button type="submit" className="btn small" style={{ justifySelf: "start" }} disabled={!name.trim() || name === user.display_name}>
            Save name
          </button>
        </form>
        {localTotal > 0 && (
          <div className="panel stack">
            <h3>Saved on this device</h3>
            <p className="muted">
              {counts.entries} journal entries and {counts.designs} designs were made here before you signed in. Move them
              into your account so they're kept with everything else.
            </p>
            <button type="button" className="btn primary" style={{ justifySelf: "start" }} disabled={Boolean(moving)} onClick={() => void moveLocal()}>
              {moving ?? "Move them to my account"}
            </button>
          </div>
        )}
        <div className="panel stack">
          <h3>Appearance</h3>
          <p className="muted">Website theme: {theme.name}{choice === "auto" ? " (auto, follows your device)" : ""}. Saved on this device.</p>
          <Link to="/themes" className="btn small" style={{ justifySelf: "start" }}>
            Open the theme gallery
          </Link>
        </div>
      </div>
    </main>
  );
}
