import { useState, type ReactNode } from "react";
import {
  BloomMark,
  IconCamera,
  IconChat,
  IconFlower,
  IconInbox,
  IconJournal,
  IconLive,
  IconTogether,
  IconUser,
} from "./components/Icons";
import { Loading, Modal, Toasts, formatDate } from "./components/ui";
import { api, errorMessage } from "./lib/api";
import { Link, RouterProvider, matchPath, useRouter } from "./lib/router";
import { SessionProvider, useSession } from "./lib/session";
import { AccountPage } from "./pages/Account";
import { AuthPage } from "./pages/Auth";
import { CamPage } from "./pages/Cam";
import { ChatPage } from "./pages/Chat";
import { EntryPage } from "./pages/Entry";
import { FriendsPage } from "./pages/Friends";
import { HomePage } from "./pages/Home";
import { JournalPage } from "./pages/Journal";
import { LivePage } from "./pages/Live";
import { LiveRoomPage } from "./pages/LiveRoom";
import { ProjectPage } from "./pages/Project";
import { ScrapbookPage } from "./pages/Scrapbook";
import { StudioPage } from "./pages/Studio";
import { ThemesPage } from "./pages/Themes";
import { TogetherPage } from "./pages/Together";
import { ThemeDecor } from "./theme/ThemeDecor";
import { ThemeMenu } from "./theme/ThemeMenu";
import { ThemeProvider } from "./theme/ThemeProvider";

const NAV = [
  { to: "/studio", label: "Studio", num: "01", icon: IconFlower },
  { to: "/cam", label: "Cam", num: "02", icon: IconCamera },
  { to: "/journal", label: "Journal", num: "03", icon: IconJournal },
  { to: "/together", label: "Together", num: "04", icon: IconTogether },
  { to: "/live", label: "Live", num: "05", icon: IconLive },
  { to: "/chat", label: "Chat", num: "06", icon: IconChat },
];

const ROUTES: Array<{ path: string; render: (params: Record<string, string>) => ReactNode }> = [
  { path: "/", render: () => <HomePage /> },
  { path: "/studio", render: () => <StudioPage /> },
  { path: "/cam", render: () => <CamPage /> },
  { path: "/journal", render: () => <JournalPage /> },
  { path: "/journal/:id", render: (p) => <EntryPage id={p.id} /> },
  { path: "/scrapbook", render: () => <ScrapbookPage /> },
  { path: "/scrapbook/:id", render: (p) => <ScrapbookPage id={p.id} /> },
  { path: "/friends", render: () => <FriendsPage /> },
  { path: "/together", render: () => <TogetherPage /> },
  { path: "/together/:id", render: (p) => <ProjectPage id={Number(p.id)} /> },
  { path: "/live", render: () => <LivePage /> },
  { path: "/live/:id", render: (p) => <LiveRoomPage id={p.id} /> },
  { path: "/chat", render: () => <ChatPage /> },
  { path: "/chat/:id", render: (p) => <ChatPage id={Number(p.id)} /> },
  { path: "/signin", render: () => <AuthPage mode="signin" /> },
  { path: "/signup", render: () => <AuthPage mode="signup" /> },
  { path: "/account", render: () => <AccountPage /> },
  { path: "/themes", render: () => <ThemesPage /> },
];

function Routes() {
  const { path } = useRouter();
  const { ready } = useSession();
  if (!ready) {
    return (
      <main className="page">
        <Loading label="Opening Bloom" />
      </main>
    );
  }
  for (const route of ROUTES) {
    const params = matchPath(route.path, path);
    if (params) return <>{route.render(params)}</>;
  }
  return (
    <main className="page">
      <h1>This page wandered off</h1>
      <p className="lede" style={{ marginTop: 12 }}>
        <Link to="/">Back to Bloom</Link>
      </p>
    </main>
  );
}

function InboxDialog({ onClose }: { onClose: () => void }) {
  const { inbox, notifications, refreshInbox, refreshNotifications, toast } = useSession();
  const { navigate } = useRouter();
  const act = async (action: () => Promise<unknown>, message?: string) => {
    try {
      await action();
      if (message) toast(message);
      refreshInbox();
      refreshNotifications();
    } catch (error) {
      toast(errorMessage(error), "error");
    }
  };
  const emptyInvites = !inbox || (inbox.live_invites.length + inbox.project_invites.length + inbox.friend_requests.length === 0);
  const items = notifications?.items ?? [];

  return (
    <Modal title="Inbox & Notifications" onClose={onClose}>
      <div className="stack">
        {emptyInvites && items.length === 0 && (
          <p className="muted">Nothing waiting for you. Friend requests, invitations, and notifications appear here.</p>
        )}

        {inbox?.live_invites.map((room) => (
          <div key={room.id} className="person">
            <span className="status-pill live">
              <span className="dot" /> LIVE
            </span>
            <div className="who">
              <strong>{room.friend.display_name}</strong>
              <span className="muted small">is waiting in a Live Bloom room</span>
            </div>
            <button
              type="button"
              className="btn small primary"
              onClick={() => {
                onClose();
                navigate(`/live/${room.id}`);
              }}
            >
              Join
            </button>
          </div>
        ))}

        {inbox?.project_invites.map((invite) => (
          <div key={invite.id} className="person">
            <div className="who">
              <strong>{invite.title}</strong>
              <span className="muted small">
                {invite.owner} invited you to a {invite.mode === "twin" ? "Twin Bloom" : invite.mode === "two" ? "Two Blooms" : "Our Moment"} project
              </span>
            </div>
            <button
              type="button"
              className="btn small"
              onClick={() => {
                onClose();
                navigate(`/together/${invite.id}`);
              }}
            >
              View
            </button>
          </div>
        ))}

        {inbox?.friend_requests.map((request) => (
          <div key={request.request_id} className="person">
            <div className="who">
              <strong>{request.display_name}</strong>
              <span className="bloom-id">{request.bloom_id}</span>
            </div>
            <button
              type="button"
              className="btn small primary"
              onClick={() => void act(() => api(`/api/friends/requests/${request.request_id}/accept`, { method: "POST" }), `You and ${request.display_name} are friends now.`)}
            >
              Accept
            </button>
            <button
              type="button"
              className="btn small quiet"
              onClick={() => void act(() => api(`/api/friends/requests/${request.request_id}/decline`, { method: "POST" }), "Request declined.")}
            >
              Decline
            </button>
          </div>
        ))}

        {items.length > 0 && (
          <section className="stack tight" style={{ marginTop: 8 }}>
            <div className="row between" style={{ alignItems: "center" }}>
              <span className="eyebrow">Notifications ({notifications?.unread ?? 0} unread)</span>
              {(notifications?.unread ?? 0) > 0 && (
                <button
                  type="button"
                  className="btn small quiet"
                  onClick={() => void act(() => api("/api/notifications/read-all", { method: "POST" }))}
                >
                  Mark all read
                </button>
              )}
            </div>
            <div className="notif-list">
              {items.slice(0, 15).map((n) => (
                <button
                  key={n.id}
                  type="button"
                  className={`notif-row${n.read_at ? " read" : ""}`}
                  onClick={() => {
                    if (!n.read_at) {
                      void act(() => api(`/api/notifications/${n.id}/read`, { method: "POST" }));
                    }
                    if (n.link) {
                      onClose();
                      navigate(n.link);
                    }
                  }}
                >
                  <div className="row between">
                    <strong>{n.title}</strong>
                    <span className="muted small">{formatDate(n.created_at)}</span>
                  </div>
                  <p className="muted small">{n.body}</p>
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    </Modal>
  );
}

function Shell() {
  const { path } = useRouter();
  const { user, inbox, serverOnline, deviceMode, ready } = useSession();
  const [inboxOpen, setInboxOpen] = useState(false);
  const isActive = (to: string) => path === to || path.startsWith(`${to}/`);
  const unreadMsgs = inbox?.unread_messages ?? 0;

  return (
    <>
      <ThemeDecor />
      <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
        <filter id="watercolor">
          <feTurbulence type="fractalNoise" baseFrequency="0.05" numOctaves="2" seed="4" />
          <feDisplacementMap in="SourceGraphic" scale="6" />
        </filter>
      </svg>
      <header className="app-header">
        <Link to="/" className="wordmark" aria-label="Bloom home">
          <BloomMark />
          bloom
        </Link>
        <nav className="main-nav" aria-label="Main">
          {NAV.map((item) => (
            <Link key={item.to} to={item.to} className={isActive(item.to) ? "active" : ""}>
              <span className="num">{item.num}</span>
              {item.label}
              {item.to === "/chat" && unreadMsgs > 0 && <span className="nav-badge">{unreadMsgs}</span>}
            </Link>
          ))}
        </nav>
        <div className="header-tools">
          <ThemeMenu />
          {ready && !serverOnline && (
            <span className="status-pill warn optional" title="The Bloom server can't be reached. Things are saved on this device.">
              <span className="dot" /> OFFLINE · THIS DEVICE
            </span>
          )}
          {ready && serverOnline && deviceMode && (
            <span className="status-pill optional">
              <span className="dot" /> THIS DEVICE
            </span>
          )}
          {user && (
            <button type="button" className="btn icon quiet inbox-button" onClick={() => setInboxOpen(true)} aria-label={`Inbox, ${inbox?.count ?? 0} waiting`}>
              <IconInbox />
              {inbox && inbox.count > 0 && <span className="badge">{inbox.count}</span>}
            </button>
          )}
          {user ? (
            <Link to="/account" className="btn small quiet" aria-label="Your account">
              <IconUser /> <span className="optional-text">{user.display_name}</span>
            </Link>
          ) : (
            ready &&
            serverOnline && (
              <Link to="/signin" className="btn small">
                Sign in
              </Link>
            )
          )}
        </div>
      </header>
      <Routes />
      <nav className="tabbar" aria-label="Main">
        {NAV.map((item) => (
          <Link key={item.to} to={item.to} className={isActive(item.to) ? "active" : ""}>
            <item.icon />
            {item.label}
          </Link>
        ))}
      </nav>
      {inboxOpen && <InboxDialog onClose={() => setInboxOpen(false)} />}
      <Toasts />
    </>
  );
}

export function App() {
  return (
    <ThemeProvider>
      <RouterProvider>
        <SessionProvider>
          <Shell />
        </SessionProvider>
      </RouterProvider>
    </ThemeProvider>
  );
}
