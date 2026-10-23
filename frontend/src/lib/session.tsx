/**
 * App-wide session: who is signed in, whether the server is reachable, which
 * store (account or this device) the journal uses, the inbox, and toasts.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { defaultRecipe, normalizeRecipe, type FlowerRecipe } from "../flower/recipe";
import { ApiError, api, type User } from "./api";
import { localStore, serverStore, type BloomStore } from "./store";

export interface Inbox {
  friend_requests: Array<{ request_id: number; bloom_id: string; display_name: string }>;
  project_invites: Array<{ id: number; title: string; mode: string; owner: string }>;
  live_invites: Array<{ id: string; friend: { bloom_id: string; display_name: string } }>;
  count: number;
}

interface Toast {
  id: number;
  text: string;
  tone: "info" | "error";
}

interface SessionValue {
  ready: boolean;
  user: User | null;
  serverOnline: boolean;
  deviceMode: boolean;
  store: BloomStore;
  inbox: Inbox | null;
  refreshInbox: () => void;
  signIn: (username: string, password: string) => Promise<void>;
  signUp: (username: string, displayName: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  useThisDevice: () => void;
  setUser: (user: User) => void;
  recipe: FlowerRecipe;
  setRecipe: (recipe: FlowerRecipe) => void;
  /** True once you've grown a flower (nothing is made automatically). */
  hasFlower: boolean;
  /** Grows a flower on purpose: sets the recipe and marks it as made. */
  growFlower: (recipe: FlowerRecipe) => void;
  /** Bumps each time a flower is grown, so previews can play the growing animation. */
  growCount: number;
  toast: (text: string, tone?: "info" | "error") => void;
  toasts: Toast[];
  dismissToast: (id: number) => void;
}

const SessionContext = createContext<SessionValue | null>(null);

const RECIPE_KEY = "bloom.currentRecipe";
const DEVICE_KEY = "bloom.deviceMode";
const GROWN_KEY = "bloom.hasFlower";

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* storage can be unavailable (private mode); the app still works */
  }
}

function loadRecipe(): FlowerRecipe {
  const saved = readStorage(RECIPE_KEY);
  if (!saved) return defaultRecipe();
  try {
    return normalizeRecipe(JSON.parse(saved));
  } catch {
    return defaultRecipe();
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [user, setUserState] = useState<User | null>(null);
  const [serverOnline, setServerOnline] = useState(true);
  const [deviceChoice, setDeviceChoice] = useState(() => readStorage(DEVICE_KEY) === "1");
  const [inbox, setInbox] = useState<Inbox | null>(null);
  const [recipe, setRecipeState] = useState<FlowerRecipe>(loadRecipe);
  const [hasFlower, setHasFlower] = useState(() => readStorage(GROWN_KEY) === "1");
  const [growCount, setGrowCount] = useState(0);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);

  const toast = useCallback((text: string, tone: "info" | "error" = "info") => {
    const id = ++toastId.current;
    setToasts((list) => [...list.slice(-2), { id, text, tone }]);
    window.setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), tone === "error" ? 6000 : 3500);
  }, []);

  const dismissToast = useCallback((id: number) => setToasts((list) => list.filter((t) => t.id !== id)), []);

  useEffect(() => {
    let cancelled = false;
    api<{ user: User | null }>("/api/auth/session")
      .then(({ user: me }) => {
        if (!cancelled) {
          setUserState(me);
          setServerOnline(true);
        }
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setServerOnline(!(error instanceof ApiError && error.isOffline));
      })
      .finally(() => !cancelled && setReady(true));
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshInbox = useCallback(() => {
    if (!user) return;
    api<Inbox>("/api/inbox")
      .then((data) => {
        setInbox(data);
        setServerOnline(true);
      })
      .catch((error: unknown) => {
        if (error instanceof ApiError && error.isOffline) setServerOnline(false);
        if (error instanceof ApiError && error.status === 401) setUserState(null);
      });
  }, [user]);

  useEffect(() => {
    if (!user) {
      setInbox(null);
      return;
    }
    refreshInbox();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") refreshInbox();
    }, 15000);
    return () => window.clearInterval(timer);
  }, [user, refreshInbox]);

  const signIn = useCallback(async (username: string, password: string) => {
    const me = await api<User>("/api/auth/login", { body: { username, password } });
    setUserState(me);
    setServerOnline(true);
    setDeviceChoice(false);
    writeStorage(DEVICE_KEY, null);
  }, []);

  const signUp = useCallback(async (username: string, displayName: string, password: string) => {
    const me = await api<User>("/api/auth/register", { body: { username, display_name: displayName, password } });
    setUserState(me);
    setServerOnline(true);
    setDeviceChoice(false);
    writeStorage(DEVICE_KEY, null);
  }, []);

  const signOut = useCallback(async () => {
    try {
      await api("/api/auth/logout", { method: "POST" });
    } finally {
      setUserState(null);
    }
  }, []);

  const useThisDevice = useCallback(() => {
    setDeviceChoice(true);
    writeStorage(DEVICE_KEY, "1");
  }, []);

  const setRecipe = useCallback((next: FlowerRecipe) => {
    setRecipeState(next);
    writeStorage(RECIPE_KEY, JSON.stringify(next));
  }, []);

  const growFlower = useCallback((next: FlowerRecipe) => {
    setRecipeState(next);
    writeStorage(RECIPE_KEY, JSON.stringify(next));
    setHasFlower(true);
    writeStorage(GROWN_KEY, "1");
    setGrowCount((n) => n + 1);
  }, []);

  const deviceMode = !user && (deviceChoice || !serverOnline);
  const store: BloomStore = user ? serverStore : localStore;

  const value = useMemo<SessionValue>(
    () => ({
      ready,
      user,
      serverOnline,
      deviceMode,
      store,
      inbox,
      refreshInbox,
      signIn,
      signUp,
      signOut,
      useThisDevice,
      setUser: setUserState,
      recipe,
      setRecipe,
      hasFlower,
      growFlower,
      growCount,
      toast,
      toasts,
      dismissToast,
    }),
    [ready, user, serverOnline, deviceMode, store, inbox, refreshInbox, signIn, signUp, signOut, useThisDevice, recipe, setRecipe, hasFlower, growFlower, growCount, toast, toasts, dismissToast],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession must be used inside SessionProvider");
  return value;
}
