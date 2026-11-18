import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  BloomMark,
  IconBell,
  IconCamera,
  IconChat,
  IconFlower,
  IconInbox,
  IconJournal,
  IconLive,
  IconMenu,
  IconTogether,
  IconUsers,
} from "./components/Icons";
import { Avatar, Loading, Modal, Toasts } from "./components/ui";
import { api, errorMessage } from "./lib/api";
import { Link, RouterProvider, matchPath, useRouter } from "./lib/router";
import { SessionProvider, useSession } from "./lib/session";
import { AccountPage } from "./pages/Account";
import { ActivityPage } from "./pages/Activity";
import { AuthPage } from "./pages/Auth";
import { CamPage } from "./pages/Cam";
import { ChatPage } from "./pages/Chat";
import { EntryPage } from "./pages/Entry";
import { FriendsPage } from "./pages/Friends";
import { HomePage } from "./pages/Home";
import { JournalPage } from "./pages/Journal";
import { LivePage } from "./pages/Live";
import { LiveRoomPage } from "./pages/LiveRoom";
import { NotificationsPage } from "./pages/Notifications";
import { ProfilePage } from "./pages/Profile";
import { ProjectPage } from "./pages/Project";
import { ScrapbookEditorPage } from "./pages/ScrapbookEditor";
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
  { to: "/friends", label: "Friends", num: "07", icon: IconUsers },
];

const TABBAR_NAV = [
  { to: "/studio", label: "Studio", icon: IconFlower },
  { to: "/cam", label: "Cam", icon: IconCamera },
  { to: "/journal", label: "Journal", icon: IconJournal },
  { to: "/together", label: "Together", icon: IconTogether },
  { to: "/chat", label: "Chat", icon: IconChat },
];

const ROUTES: Array<{ path: string; render: (params: Record<string, string>) => ReactNode }> = [
  { path: "/", render: () => <HomePage /> },
  { path: "/studio", render: () => <StudioPage /> },
  { path: "/cam", render: () => <CamPage /> },
  { path: "/journal", render: () => <JournalPage /> },
  { path: "/journal/:id", render: (p) => <EntryPage id={p.id} /> },
  { path: "/scrapbook", render: () => <ScrapbookEditorPage /> },
  { path: "/scrapbook/:id", render: (p) => <ScrapbookEditorPage id={p.id} /> },
  { path: "/friends", render: () => <FriendsPage /> },
  { path: "/activity", render: () => <ActivityPage /> },
  { path: "/notifications", render: () => <NotificationsPage /> },
  { path: "/chat", render: () => <ChatPage /> },
  { path: "/chat/:id", render: (p) => <ChatPage conversationId={p.id} /> },
  { path: "/together", render: () => <TogetherPage /> },
  { path: "/together/:id", render: (p) => <ProjectPage id={Number(p.id)} /> },
  { path: "/live", render: () => <LivePage /> },
  { path: "/live/:id", render: (p) => <LiveRoomPage id={p.id} /> },
  { path: "/signin", render: () => <AuthPage mode="signin" /> },
  { path: "/signup", render: () => <AuthPage mode="signup" /> },
  { path: "/account", render: () => <AccountPage /> },
  { path: "/profile", render: () => <ProfilePage /> },
  { path: "/profile/:bloomId", render: (p) => <ProfilePage bloomId={p.bloomId} /> },
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
  const { inbox, refreshInbox, toast } = useSession();
  const { navigate } = useRouter();
  const act = async (action: () => Promise<unknown>, message: string) => {
    try {
      await action();
      toast(message);
      refreshInbox();
    } catch (error) {
      toast(errorMessage(error), "error");
    }
  };
  const empty = !inbox || inbox.count === 0;
  return (
    <Modal title="Inbox" onClose={onClose}>
      {empty && <p className="muted">Nothing waiting for you. Friend requests and invitations appear here.</p>}
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
    </Modal>
  );
}

function Shell() {
  const { path, navigate } = useRouter();
  const { user, inbox, unreadNotifications, unreadChat, serverOnline, deviceMode, ready, signOut } = useSession();
  const [inboxOpen, setInboxOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  const isActive = (to: string) => path === to || path.startsWith(`${to}/`);

  useEffect(() => {
    setUserMenuOpen(false);
    setMobileMenuOpen(false);
  }, [path]);

  useEffect(() => {
    if (!userMenuOpen) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !userMenuRef.current?.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [userMenuOpen]);

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
              {item.to === "/chat" && unreadChat > 0 && <span className="nav-dot-badge">{unreadChat}</span>}
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
            <>
              <Link to="/notifications" className="btn icon quiet inbox-button" aria-label={`Notifications, ${unreadNotifications} unread`}>
                <IconBell />
                {unreadNotifications > 0 && <span className="badge">{unreadNotifications}</span>}
              </Link>
              <button type="button" className="btn icon quiet inbox-button optional-desktop" onClick={() => setInboxOpen(true)} aria-label={`Inbox, ${inbox?.count ?? 0} waiting`}>
                <IconInbox />
                {inbox && inbox.count > 0 && <span className="badge">{inbox.count}</span>}
              </button>
              <div className="appearance" ref={userMenuRef}>
                <button
                  type="button"
                  className="btn small quiet user-menu-trigger"
                  aria-expanded={userMenuOpen}
                  onClick={() => setUserMenuOpen((o) => !o)}
                >
                  <Avatar name={user.display_name} src={user.avatar_url} />
                  <span className="optional-text">{user.display_name}</span>
                </button>
                {userMenuOpen && (
                  <div className="appearance-menu user-dropdown" role="menu">
                    <Link to={`/profile/${user.bloom_id}`} className="menu-item-link">My Profile</Link>
                    <Link to="/account" className="menu-item-link">Account &amp; Settings</Link>
                    <Link to="/scrapbook" className="menu-item-link">New Scrapbook Page</Link>
                    <Link to="/activity" className="menu-item-link">Shared Feed</Link>
                    <Link to="/chat?tab=studio" className="menu-item-link">Studio Chat</Link>
                    <Link to="/themes" className="menu-item-link">Website Themes</Link>
                    <div className="divider" />
                    <button
                      type="button"
                      className="menu-item-link danger"
                      onClick={async () => {
                        setUserMenuOpen(false);
                        await signOut();
                        navigate("/");
                      }}
                    >
                      Sign out
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
          {!user && ready && serverOnline && (
            <Link to="/signin" className="btn small">
              Sign in
            </Link>
          )}
          <button
            type="button"
            className="btn icon quiet mobile-menu-btn"
            aria-label="Open navigation menu"
            onClick={() => setMobileMenuOpen(true)}
          >
            <IconMenu />
          </button>
        </div>
      </header>
      <Routes />
      <nav className="tabbar" aria-label="Main">
        {TABBAR_NAV.map((item) => (
          <Link key={item.to} to={item.to} className={isActive(item.to) ? "active" : ""}>
            <span style={{ position: "relative", display: "inline-flex" }}>
              <item.icon />
              {item.to === "/chat" && unreadChat > 0 && <span className="tabbar-badge">{unreadChat}</span>}
            </span>
            {item.label}
          </Link>
        ))}
      </nav>
      {inboxOpen && <InboxDialog onClose={() => setInboxOpen(false)} />}
      {mobileMenuOpen && (
        <Modal title="Bloom Navigation" onClose={() => setMobileMenuOpen(false)}>
          <div className="mobile-nav-grid">
            <Link to="/" className="menu-item-link">Home</Link>
            <Link to="/studio" className="menu-item-link">Flower Studio</Link>
            <Link to="/cam" className="menu-item-link">Bloom Cam</Link>
            <Link to="/journal" className="menu-item-link">Journal</Link>
            <Link to="/scrapbook" className="menu-item-link">Scrapbook Editor</Link>
            <Link to="/together" className="menu-item-link">Bloom Together</Link>
            <Link to="/live" className="menu-item-link">Live Bloom</Link>
            <Link to="/chat?tab=dm" className="menu-item-link">Messages (Personal &amp; Groups)</Link>
            <Link to="/chat?tab=studio" className="menu-item-link">Studio Chat</Link>
            <Link to="/friends" className="menu-item-link">Friends</Link>
            <Link to="/activity" className="menu-item-link">Shared Feed</Link>
            <Link to="/notifications" className="menu-item-link">Notifications ({unreadNotifications})</Link>
            {user && (
              <>
                <Link to={`/profile/${user.bloom_id}`} className="menu-item-link">My Profile</Link>
                <Link to="/account" className="menu-item-link">Settings &amp; Privacy</Link>
              </>
            )}
            <Link to="/themes" className="menu-item-link">Website Themes</Link>
          </div>
        </Modal>
      )}
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
