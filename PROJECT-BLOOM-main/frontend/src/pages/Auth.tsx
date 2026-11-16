import { useState } from "react";
import { FlowerPreview } from "../components/FlowerPreview";
import { errorMessage } from "../lib/api";
import { Link, useRouter } from "../lib/router";
import { useSession } from "../lib/session";
import { localStore } from "../lib/store";

export function AuthPage({ mode }: { mode: "signin" | "signup" }) {
  const { signIn, signUp, recipe, serverOnline, useThisDevice } = useSession();
  const { navigate, query } = useRouter();
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError("");
    if (mode === "signup" && password !== confirm) {
      setError("The two passwords don't match.");
      return;
    }
    setBusy(true);
    try {
      if (mode === "signin") await signIn(username, password);
      else await signUp(username, displayName || username, password);
      const counts = await localStore.counts().catch(() => ({ entries: 0, designs: 0, albums: 0 }));
      const next = query.get("next");
      navigate(counts.entries + counts.designs > 0 ? "/account?move=1" : next && next.startsWith("/") ? next : "/journal", { replace: true });
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <main className="page">
      <div className="auth stack">
        <div style={{ width: 180 }}>
          <FlowerPreview recipe={{ ...recipe, showHearts: false }} framing="tight" background={false} />
        </div>
        <div>
          <p className="eyebrow">{mode === "signin" ? "Welcome back" : "Start your journal"}</p>
          <h1>{mode === "signin" ? "Sign in" : "Create an account"}</h1>
        </div>
        {!serverOnline && (
          <p className="notice error">
            The Bloom server can't be reached, so accounts are unavailable right now. You can keep using Bloom on this
            device and move everything into an account later.
          </p>
        )}
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <label className="field">
            <span>Username</span>
            <input type="text" autoComplete="username" required minLength={3} maxLength={32} value={username} onChange={(e) => setUsername(e.target.value)} />
          </label>
          {mode === "signup" && (
            <label className="field">
              <span>Your name (shown to friends)</span>
              <input type="text" autoComplete="nickname" maxLength={48} value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            </label>
          )}
          <label className="field">
            <span>Password {mode === "signup" && "(8+ characters)"}</span>
            <input
              type="password"
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              required
              minLength={mode === "signup" ? 8 : 1}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {mode === "signup" && (
            <label className="field">
              <span>Password, once more</span>
              <input type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </label>
          )}
          <p className="form-error" role="alert">
            {error}
          </p>
          <button type="submit" className="btn primary" disabled={busy || !serverOnline}>
            {busy && <span className="spinner" />} {mode === "signin" ? "Sign in" : "Create my account"}
          </button>
        </form>
        <p className="muted small">
          {mode === "signin" ? (
            <>
              New here? <Link to="/signup">Create an account</Link>
            </>
          ) : (
            <>
              Already have one? <Link to="/signin">Sign in</Link>
            </>
          )}{" "}
          ·{" "}
          <a
            href="/journal"
            onClick={(e) => {
              e.preventDefault();
              useThisDevice();
              navigate("/studio");
            }}
          >
            Use this device without an account
          </a>
        </p>
        {mode === "signup" && (
          <p className="muted small">
            You'll get a Bloom ID (like BLM-7Q4K-2XRD) that friends use to find you. Your photos and journal stay private
            unless you add them to a shared project.
          </p>
        )}
      </div>
    </main>
  );
}
