/**
 * Phase 2: Account, Profile customization (Bio, Favorite word, Flower Avatar),
 * Privacy settings, Password change, and Local-to-Account migration.
 */
import { useEffect, useState } from "react";
import { FlowerPreview } from "../components/FlowerPreview";
import { IconCopy, IconFlower } from "../components/Icons";
import { Toggle } from "../components/ui";
import { STUDIO_PALETTES, defaultRecipe, normalizeRecipe } from "../flower/recipe";
import { api, errorMessage, type DmPolicy, type ProfileVisibility, type User } from "../lib/api";
import { Link, useRouter } from "../lib/router";
import { useSession } from "../lib/session";
import { localStore, serverStore } from "../lib/store";
import { useTheme } from "../theme/ThemeProvider";

export function AccountPage() {
  const { theme, choice } = useTheme();
  const { user, signOut, setUser, toast, ready, recipe: studioRecipe, hasFlower } = useSession();
  const { navigate } = useRouter();
  const [name, setName] = useState(user?.display_name ?? "");
  const [bio, setBio] = useState(user?.bio ?? "");
  const [favoriteWord, setFavoriteWord] = useState(user?.favorite_word ?? "");
  const [avatarRecipe, setAvatarRecipe] = useState(user?.avatar_recipe ? normalizeRecipe(user.avatar_recipe) : null);
  const [visibility, setVisibility] = useState<ProfileVisibility>(user?.privacy?.profile_visibility ?? "everyone");
  const [dmPolicy, setDmPolicy] = useState<DmPolicy>(user?.privacy?.allow_dm_from ?? "everyone");
  const [discoverable, setDiscoverable] = useState(user?.privacy?.discoverable ?? true);
  const [showOnline, setShowOnline] = useState(user?.privacy?.show_online ?? true);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const [counts, setCounts] = useState({ entries: 0, designs: 0, albums: 0 });
  const [moving, setMoving] = useState<string | null>(null);

  useEffect(() => {
    localStore.counts().then(setCounts).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (ready && !user) navigate("/signin?next=/account", { replace: true });
  }, [ready, user, navigate]);

  useEffect(() => {
    if (!user) return;
    setName(user.display_name);
    setBio(user.bio ?? "");
    setFavoriteWord(user.favorite_word ?? "");
    setAvatarRecipe(user.avatar_recipe ? normalizeRecipe(user.avatar_recipe) : null);
    setVisibility(user.privacy?.profile_visibility ?? "everyone");
    setDmPolicy(user.privacy?.allow_dm_from ?? "everyone");
    setDiscoverable(user.privacy?.discoverable ?? true);
    setShowOnline(user.privacy?.show_online ?? true);
  }, [user]);

  if (!user) return null;

  const saveProfile = async () => {
    setBusy(true);
    try {
      const updated = await api<User>("/api/auth/me", {
        method: "PATCH",
        body: {
          display_name: name,
          bio,
          favorite_word: favoriteWord,
          avatar_recipe: avatarRecipe,
        },
      });
      setUser(updated);
      toast("Profile saved.");
    } catch (error) {
      toast(errorMessage(error), "error");
    } finally {
      setBusy(false);
    }
  };

  const savePrivacy = async (patch: Partial<User["privacy"]>) => {
    try {
      const updated = await api<User>("/api/auth/me", {
        method: "PATCH",
        body: { privacy: patch },
      });
      setUser(updated);
      toast("Privacy settings updated.");
    } catch (error) {
      toast(errorMessage(error), "error");
    }
  };

  const changePassword = async () => {
    setBusy(true);
    try {
      await api("/api/auth/password", {
        body: { current_password: currentPassword, new_password: newPassword },
      });
      setCurrentPassword("");
      setNewPassword("");
      toast("Password changed.");
    } catch (error) {
      toast(errorMessage(error), "error");
    } finally {
      setBusy(false);
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
          <p className="eyebrow">Your account · @{user.username}</p>
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
        <div className="stack">
          <div className="id-card">
            <span className="eyebrow">Your Bloom ID</span>
            <span className="bloom-id">{user.bloom_id}</span>
            <p className="muted small">Share this with friends so they can find you, follow your blooms, or start a chat.</p>
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
                Friends & Discovery
              </Link>
            </div>
          </div>

          <form
            className="panel stack"
            onSubmit={(e) => {
              e.preventDefault();
              void saveProfile();
            }}
          >
            <h3>Profile</h3>
            <label className="field">
              <span>Name shown to friends</span>
              <input type="text" value={name} maxLength={48} onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="field">
              <span>Bio</span>
              <textarea
                rows={3}
                value={bio}
                maxLength={240}
                placeholder="A little note about what you're growing…"
                onChange={(e) => setBio(e.target.value)}
              />
            </label>
            <label className="field">
              <span>Signature word</span>
              <input
                type="text"
                value={favoriteWord}
                maxLength={24}
                placeholder="solstice, bloom, stardust…"
                onChange={(e) => setFavoriteWord(e.target.value)}
              />
            </label>

            <div className="stack tight">
              <span className="label">Mini-flower emblem</span>
              <div className="row" style={{ alignItems: "center", gap: 14 }}>
                <div className="avatar-flower-preview">
                  {avatarRecipe ? (
                    <FlowerPreview recipe={{ ...avatarRecipe, showHearts: false, showStem: false }} framing="tight" />
                  ) : (
                    <IconFlower />
                  )}
                </div>
                <div className="btn-row">
                  {hasFlower && (
                    <button
                      type="button"
                      className="btn small"
                      onClick={() => setAvatarRecipe(studioRecipe)}
                    >
                      Use current Studio flower
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn small quiet"
                    onClick={() => {
                      const pick = STUDIO_PALETTES[Math.floor(Math.random() * STUDIO_PALETTES.length)];
                      setAvatarRecipe({
                        ...defaultRecipe(favoriteWord || name.split(" ")[0] || "bloom"),
                        colors: { ...pick.colors },
                      });
                    }}
                  >
                    Quick blossom
                  </button>
                  {avatarRecipe && (
                    <button type="button" className="btn small quiet" onClick={() => setAvatarRecipe(null)}>
                      Clear
                    </button>
                  )}
                </div>
              </div>
            </div>

            <button type="submit" className="btn primary" style={{ justifySelf: "start" }} disabled={busy || !name.trim()}>
              Save profile
            </button>
          </form>
        </div>

        <div className="stack">
          <section className="panel stack">
            <h3>Privacy & Discovery</h3>
            <label className="field">
              <span>Who can see your profile details</span>
              <select
                value={visibility}
                onChange={(e) => {
                  const v = e.target.value as ProfileVisibility;
                  setVisibility(v);
                  void savePrivacy({ profile_visibility: v });
                }}
              >
                <option value="everyone">Everyone on Bloom</option>
                <option value="friends">Friends only</option>
                <option value="private">Private (name & Bloom ID only)</option>
              </select>
            </label>
            <label className="field">
              <span>Who can send you direct messages</span>
              <select
                value={dmPolicy}
                onChange={(e) => {
                  const v = e.target.value as DmPolicy;
                  setDmPolicy(v);
                  void savePrivacy({ allow_dm_from: v });
                }}
              >
                <option value="everyone">Anyone with my Bloom ID</option>
                <option value="friends">Friends only</option>
              </select>
            </label>
            <Toggle
              label="Appear in Bloom discovery search"
              checked={discoverable}
              onChange={(v) => {
                setDiscoverable(v);
                void savePrivacy({ discoverable: v });
              }}
            />
            <Toggle
              label="Show when you're online"
              checked={showOnline}
              onChange={(v) => {
                setShowOnline(v);
                void savePrivacy({ show_online: v });
              }}
            />
          </section>

          <form
            className="panel stack"
            onSubmit={(e) => {
              e.preventDefault();
              void changePassword();
            }}
          >
            <h3>Security</h3>
            <label className="field">
              <span>Current password</span>
              <input
                type="password"
                value={currentPassword}
                autoComplete="current-password"
                onChange={(e) => setCurrentPassword(e.target.value)}
              />
            </label>
            <label className="field">
              <span>New password (min 8 characters)</span>
              <input
                type="password"
                value={newPassword}
                minLength={8}
                autoComplete="new-password"
                onChange={(e) => setNewPassword(e.target.value)}
              />
            </label>
            <button
              type="submit"
              className="btn small"
              style={{ justifySelf: "start" }}
              disabled={busy || !currentPassword || newPassword.length < 8}
            >
              Update password
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
      </div>
    </main>
  );
}
