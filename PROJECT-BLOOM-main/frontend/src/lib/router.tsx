/**
 * A very small history-based router (no extra dependency).
 * Routes are matched in order; ":name" segments become params.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type AnchorHTMLAttributes,
  type ReactNode,
} from "react";

interface RouterValue {
  path: string;
  query: URLSearchParams;
  navigate: (to: string, options?: { replace?: boolean }) => void;
}

const RouterContext = createContext<RouterValue | null>(null);

type Guard = (to: string) => boolean;
const guards = new Set<Guard>();

/** Lets a page ask before the user navigates away (e.g. unsaved photo). */
export function useNavigationGuard(shouldBlock: boolean, message: string): void {
  useEffect(() => {
    if (!shouldBlock) return;
    const guard: Guard = () => window.confirm(message);
    guards.add(guard);
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = message;
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      guards.delete(guard);
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, [shouldBlock, message]);
}

export function RouterProvider({ children }: { children: ReactNode }) {
  const [location, setLocation] = useState(() => ({ path: window.location.pathname, search: window.location.search }));

  useEffect(() => {
    const onPop = () => setLocation({ path: window.location.pathname, search: window.location.search });
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const navigate = useCallback((to: string, options: { replace?: boolean } = {}) => {
    for (const guard of guards) if (!guard(to)) return;
    if (options.replace) window.history.replaceState(null, "", to);
    else window.history.pushState(null, "", to);
    const url = new URL(to, window.location.origin);
    setLocation({ path: url.pathname, search: url.search });
    window.scrollTo({ top: 0 });
  }, []);

  const value = useMemo(
    () => ({ path: location.path, query: new URLSearchParams(location.search), navigate }),
    [location, navigate],
  );
  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

export function useRouter(): RouterValue {
  const value = useContext(RouterContext);
  if (!value) throw new Error("useRouter must be used inside RouterProvider");
  return value;
}

export function matchPath(pattern: string, path: string): Record<string, string> | null {
  const patternParts = pattern.split("/").filter(Boolean);
  const pathParts = path.split("/").filter(Boolean);
  if (patternParts.length !== pathParts.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < patternParts.length; i++) {
    const part = patternParts[i];
    if (part.startsWith(":")) params[part.slice(1)] = decodeURIComponent(pathParts[i]);
    else if (part !== pathParts[i]) return null;
  }
  return params;
}

export function Link({
  to,
  className,
  children,
  onClick,
  ...rest
}: { to: string; className?: string; children: ReactNode; onClick?: () => void } & Omit<
  AnchorHTMLAttributes<HTMLAnchorElement>,
  "href" | "onClick"
>) {
  const { navigate } = useRouter();
  return (
    <a
      {...rest}
      href={to}
      className={className}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
        event.preventDefault();
        onClick?.();
        navigate(to);
      }}
    >
      {children}
    </a>
  );
}
