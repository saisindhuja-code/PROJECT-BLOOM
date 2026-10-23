/**
 * Central theme state. Applies the theme to <html data-theme="…"> (the CSS
 * variables in styles/themes.css do the rest), remembers the choice on this
 * device, and follows the device's light/dark setting in "auto".
 *
 * Persistence goes through `themeStorage`, so the choice can later be synced
 * to a Bloom account by swapping in a storage that also calls the API.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { DEFAULT_THEME, isThemeChoice, resolveChoice, siteTheme, type SiteTheme, type ThemeChoice } from "./themes";

const KEY = "bloom.theme";

export interface ThemeStorage {
  load(): ThemeChoice | null;
  save(choice: ThemeChoice): void;
}

export const themeStorage: ThemeStorage = {
  load() {
    try {
      const value = localStorage.getItem(KEY);
      return isThemeChoice(value) ? value : null;
    } catch {
      return null;
    }
  },
  save(choice) {
    try {
      localStorage.setItem(KEY, choice);
    } catch {
      /* private mode etc.: the theme still applies for this visit */
    }
  },
};

const darkQuery = () => (typeof window !== "undefined" ? window.matchMedia?.("(prefers-color-scheme: dark)") : undefined);

export function applyTheme(theme: SiteTheme): void {
  const root = document.documentElement;
  root.dataset.theme = theme.id;
  root.dataset.tone = theme.tone;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme.metaColor);
}

interface ThemeValue {
  /** What the person picked (may be "auto"). */
  choice: ThemeChoice;
  /** The theme actually showing. */
  theme: SiteTheme;
  setChoice: (choice: ThemeChoice) => void;
  resetTheme: () => void;
}

const ThemeContext = createContext<ThemeValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [choice, setChoiceState] = useState<ThemeChoice>(() => themeStorage.load() ?? DEFAULT_THEME);
  const [deviceDark, setDeviceDark] = useState(() => darkQuery()?.matches ?? true);

  useEffect(() => {
    const query = darkQuery();
    if (!query) return;
    const onChange = () => setDeviceDark(query.matches);
    query.addEventListener?.("change", onChange);
    return () => query.removeEventListener?.("change", onChange);
  }, []);

  const theme = siteTheme(resolveChoice(choice, deviceDark));

  useEffect(() => applyTheme(theme), [theme]);

  const setChoice = useCallback((next: ThemeChoice) => {
    setChoiceState(next);
    themeStorage.save(next);
  }, []);

  const resetTheme = useCallback(() => setChoice(DEFAULT_THEME), [setChoice]);

  const value = useMemo(() => ({ choice, theme, setChoice, resetTheme }), [choice, theme, setChoice, resetTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useTheme must be used inside ThemeProvider");
  return value;
}
