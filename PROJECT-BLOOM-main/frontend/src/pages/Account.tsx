import { useEffect, useRef, useState } from "react";
import { IconCopy, IconTrash, IconUpload, IconUser } from "../components/Icons";
import { Avatar, Toggle } from "../components/ui";
import { api, errorMessage, uploadImage, type PrivacySettings, type User, type Visibility } from "../lib/api";
import { Link, useRouter } from "../lib/router";
import { useSession } from "../lib/session";
import { localStore, serverStore } from "../lib/store";
import { useTheme } from "../theme/ThemeProvider";

export function AccountPage() {
  const { theme, choice } = useTheme();
  const { user, signOut, setUser, toast, ready } = useSession();
  const { navigate } = useRouter();
  const [name, setName] = useState(user?.display_name ?? "");
  const [bio, setBio] = useState(user?.bio ?? "");
  const [privacy, setPrivacy] = useState<PrivacySettings>(
    user?.privacy_settings ?? {
      profile_visibility: "friends",
      searchable: true,
      show_online_status: true,
      allow_friend_requests: true,
    },
  );
  const [counts, setCounts] = useState({ entries: 0, designs: 0, albums: 0 });
  const [moving, setMoving] = useState<string | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changingPw, setChangingPw] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleting, setDeleting] = useState(false);
  const avatarInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    localStore.counts().then(setCounts).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (user) {
      setName(user.display_name);
      setBio(user.bio ?? "");
      setPrivacy(user.privacy_settings);
    }
  }, [user]);

  useEffect(() => {
    if (ready && !user) navigate("/signin?next=/account", { replace: true });
  }, [ready, user, navigate]);

  if (!user) return null;

  const saveProfile = async () => {
    setSavingProfile(true);
    try {
      const updated = await api<User>("/api/auth/me", {
        method: "PATCH",
        body: { display_name: name, bio, privacy_settings: privacy },
      });
      setUser(updated);
      toast("Profile & privacy settings saved.");
    } catch (error) {
      toast(errorMessage(error), "error");
    } finally {
      setSavingProfile(false);
    }
  };

  const uploadAvatar = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast("Please choose a JPEG, PNG or WebP image.", "error");
      return;
    }
    setUploadingAvatar(true);
    try {
      const uploaded = await uploadImage(file, "avatar", file.name);
      const updated = await api<User>("/api/auth/me", {
        method: "PATCH",
        body: { avatar_media_id: uploaded.id },
      });
      setUser(updated);
      toast("Profile picture updated.");
    } catch (error) {
      toast(errorMessage(error), "error");
    } finally {
      setUploadingAvatar(false);
    }
  };

  const removeAvatar = async () => {
    setUploadingAvatar(true);
    try {
      const updated = await api<User>("/api/auth/me", {
        method: "PATCH",
        body: { remove_avatar: true },
      });
      setUser(updated);
      toast("Profile picture removed.");
    } catch (error) {
      toast(errorMessage(error), "error");
    } finally {
      setUploadingAvatar(false);
    }
  };

  const changePassword = async () => {
    if (newPassword !== confirmPassword) {
      toast("The two new passwords don't match.", "error");
      return;
    }
    setChangingPw(true);
    try {
      await api("/api/auth/change-password", {
        body: { current_password: currentPassword, new_password: newPassword },
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      toast("Password updated.");
    } catch (error) {
      toast(errorMessage(error), "error");
    } finally {
      setChangingPw(false);
    }
  };

  const deleteAccount = async () => {
    if (!window.confirm("Permanently delete your Bloom account and all uploaded media? This cannot be undone.")) return;
    setDeleting(true);
    try {
      await api("/api/auth/delete-account", { body: { password: deletePassword } });
      await signOut().catch(() => undefined);
      toast("Account deleted.");
      navigate("/", { replace: true });
    } catch (error) {
      toast(errorMessage(error), "error");
      setDeleting(false);
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
          <p className="eyebrow">Your account &amp; privacy</p>
          <h1>{user.display_name}</h1>
        </div>
        <div className="btn-row">
          <Link to={`/profile/${user.bloom_id}`} className="btn">
            <IconUser /> View my profile
          </Link>
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
      </div>

      <div className="columns">
        <div className="stack">
          <div className="id-card">
            <span className="eyebrow">Your Bloom ID</span>
            <span className="bloom-id">{user.bloom_id}</span>
            <p className="muted small">Share this with friends so they can find you. It doesn't reveal your username or private journal.</p>
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

          <div className="panel stack">
            <h3>Profile picture</h3>
            <div className="row">
              <div className="profile-avatar-lg">
                <Avatar name={user.display_name} src={user.avatar_url} />
              </div>
              <div className="stack tight">
                <div className="btn-row">
                  <button
                    type="button"
                    className="btn small"
                    disabled={uploadingAvatar}
                    onClick={() => avatarInput.current?.click()}
                  >
                    <IconUpload /> {user.avatar_url ? "Change picture" : "Upload picture"}
                  </button>
                  {user.avatar_url && (
                    <button type="button" className="btn small quiet danger" disabled={uploadingAvatar} onClick={() => void removeAvatar()}>
                      <IconTrash /> Remove
                    </button>
                  )}
                </div>
                <span className="muted small">JPEG, PNG or WebP. Visible only to people allowed to see your profile.</span>
              </div>
            </div>
            <input
              ref={avatarInput}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                void uploadAvatar(file);
              }}
            />
          </div>

          <form
            className="panel stack"
            onSubmit={(e) => {
              e.preventDefault();
              void saveProfile();
            }}
          >
            <h3>Profile &amp; privacy</h3>
            <label className="field">
              <span>Name shown to friends</span>
              <input type="text" value={name} maxLength={48} onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="field">
              <span>Bio</span>
              <textarea
                value={bio}
                maxLength={500}
                rows={3}
                placeholder="A little note about what you're growing…"
                onChange={(e) => setBio(e.target.value)}
              />
            </label>
            <label className="field">
              <span>Who can see your profile</span>
              <select
                value={privacy.profile_visibility}
                onChange={(e) => setPrivacy({ ...privacy, profile_visibility: e.target.value as Visibility })}
              >
                <option value="public">Public (anyone signed in to Bloom)</option>
                <option value="friends">Friends only</option>
                <option value="private">Private (only you)</option>
              </select>
            </label>
            <Toggle
              label="Allow people to find me by display name search"
              checked={privacy.searchable}
              onChange={(searchable) => setPrivacy({ ...privacy, searchable })}
            />
            <Toggle
              label="Allow incoming friend requests"
              checked={privacy.allow_friend_requests}
              onChange={(allow_friend_requests) => setPrivacy({ ...privacy, allow_friend_requests })}
            />
            <Toggle
              label="Show when I'm online"
              checked={privacy.show_online_status}
              onChange={(show_online_status) => setPrivacy({ ...privacy, show_online_status })}
            />
            <p className="muted small">Username: {user.username}</p>
            <button type="submit" className="btn primary small" style={{ justifySelf: "start" }} disabled={!name.trim() || savingProfile}>
              {savingProfile ? "Saving…" : "Save profile & privacy"}
            </button>
          </form>
        </div>

        <div className="stack">
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

          <form
            className="panel stack"
            onSubmit={(e) => {
              e.preventDefault();
              void changePassword();
            }}
          >
            <h3>Change password</h3>
            <label className="field">
              <span>Current password</span>
              <input type="password" autoComplete="current-password" required value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
            </label>
            <label className="field">
              <span>New password (8+ characters)</span>
              <input type="password" autoComplete="new-password" required minLength={8} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
            </label>
            <label className="field">
              <span>New password, once more</span>
              <input type="password" autoComplete="new-password" required minLength={8} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
            </label>
            <button type="submit" className="btn small" style={{ justifySelf: "start" }} disabled={changingPw || !currentPassword || newPassword.length < 8}>
              Update password
            </button>
          </form>

          <form
            className="panel stack"
            onSubmit={(e) => {
              e.preventDefault();
              void deleteAccount();
            }}
          >
            <h3>Delete account</h3>
            <p className="muted small">Permanently removes your account, journal entries, designs, and uploaded photos.</p>
            <label className="field">
              <span>Confirm with your password</span>
              <input type="password" autoComplete="current-password" required value={deletePassword} onChange={(e) => setDeletePassword(e.target.value)} />
            </label>
            <button type="submit" className="btn small danger" style={{ justifySelf: "start" }} disabled={deleting || !deletePassword}>
              <IconTrash /> Delete my account
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
