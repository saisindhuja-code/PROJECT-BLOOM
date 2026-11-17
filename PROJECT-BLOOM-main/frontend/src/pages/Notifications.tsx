/** Persistent notification center + notification preferences. */
import { useEffect, useState } from "react";
import { IconCheck, IconTrash } from "../components/Icons";
import { Avatar, Empty, Loading, SignInNeeded, Toggle, formatDate } from "../components/ui";
import { api, errorMessage, type AppNotification, type NotificationPreferences } from "../lib/api";
import { useRouter } from "../lib/router";
import { useSession } from "../lib/session";

export function NotificationsPage() {
  const { user, notifications, unreadNotifications, refreshNotifications, setNotificationsState, toast } = useSession();
  const { navigate } = useRouter();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [prefs, setPrefs] = useState<NotificationPreferences | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) return;
    refreshNotifications();
    api<NotificationPreferences>("/api/notifications/preferences")
      .then(setPrefs)
      .catch(() => undefined);
  }, [user, refreshNotifications]);

  if (!user) {
    return (
      <main className="page">
        <SignInNeeded what="Notifications" />
      </main>
    );
  }

  const shown = unreadOnly ? notifications.filter((n) => !n.is_read) : notifications;

  const openNotification = async (n: AppNotification) => {
    if (!n.is_read) {
      try {
        await api(`/api/notifications/${n.id}/read`, { method: "POST" });
        setNotificationsState(
          (list) => list.map((item) => (item.id === n.id ? { ...item, is_read: true } : item)),
          -1,
        );
      } catch {
        /* still navigate */
      }
    }
    if (n.link) navigate(n.link);
  };

  const markAllRead = async () => {
    setBusy(true);
    try {
      await api("/api/notifications/read-all", { method: "POST" });
      setNotificationsState((list) => list.map((item) => ({ ...item, is_read: true })), 0, true);
      toast("All caught up.");
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  };

  const removeOne = async (n: AppNotification) => {
    try {
      await api(`/api/notifications/${n.id}`, { method: "DELETE" });
      setNotificationsState(
        (list) => list.filter((item) => item.id !== n.id),
        n.is_read ? 0 : -1,
      );
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  const updatePref = async (patch: Partial<NotificationPreferences>) => {
    if (!prefs) return;
    const next = { ...prefs, ...patch };
    setPrefs(next);
    try {
      setPrefs(await api<NotificationPreferences>("/api/notifications/preferences", { method: "PATCH", body: next }));
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Notifications</p>
          <h1>
            Recent <span className="flourish">activity</span>
          </h1>
        </div>
        <div className="btn-row">
          <div className="segmented" role="group" aria-label="Filter notifications">
            <button type="button" aria-pressed={!unreadOnly} onClick={() => setUnreadOnly(false)}>
              All ({notifications.length})
            </button>
            <button type="button" aria-pressed={unreadOnly} onClick={() => setUnreadOnly(true)}>
              Unread ({unreadNotifications})
            </button>
          </div>
          <button type="button" className="btn small" disabled={busy || unreadNotifications === 0} onClick={() => void markAllRead()}>
            <IconCheck /> Mark all read
          </button>
        </div>
      </div>

      <div className="columns">
        <section className="panel stack">
          {shown.length === 0 ? (
            <Empty title={unreadOnly ? "No unread notifications" : "Nothing here yet"}>
              Real activity from your friends, shared projects, and messages appears here.
            </Empty>
          ) : (
            <div className="stack tight">
              {shown.map((n) => (
                <div key={n.id} className={`notif-row${n.is_read ? "" : " unread"}`}>
                  {n.actor ? <Avatar name={n.actor.display_name} /> : <span className="notif-dot" />}
                  <button type="button" className="notif-main" onClick={() => void openNotification(n)}>
                    <strong>{n.title}</strong>
                    {n.body && <span className="muted small">{n.body}</span>}
                    <span className="eyebrow">{formatDate(n.created_at)}</span>
                  </button>
                  <button type="button" className="btn icon small quiet" aria-label="Delete notification" onClick={() => void removeOne(n)}>
                    <IconTrash />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        <aside className="panel stack">
          <h3>Notification preferences</h3>
          {!prefs ? (
            <Loading label="Loading preferences" />
          ) : (
            <div className="stack">
              <Toggle label="Friend requests & acceptances" checked={prefs.friend_requests} onChange={(friend_requests) => void updatePref({ friend_requests })} />
              <Toggle label="New followers" checked={prefs.follows} onChange={(follows) => void updatePref({ follows })} />
              <Toggle label="Reactions on your creations" checked={prefs.reactions} onChange={(reactions) => void updatePref({ reactions })} />
              <Toggle label="Direct & group messages" checked={prefs.messages} onChange={(messages) => void updatePref({ messages })} />
              <Toggle label="Bloom Together invites & updates" checked={prefs.projects} onChange={(projects) => void updatePref({ projects })} />
              <Toggle label="Live Bloom room invites" checked={prefs.live} onChange={(live) => void updatePref({ live })} />
            </div>
          )}
        </aside>
      </div>
    </main>
  );
}
