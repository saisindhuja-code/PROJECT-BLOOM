/** Top-bar theme switcher: the four themes, Auto, and a link to the gallery. */
import { useEffect, useRef, useState } from "react";
import { Link } from "../lib/router";
import { useTheme } from "./ThemeProvider";
import { SITE_THEMES, type ThemeChoice } from "./themes";

function IconPalette() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" aria-hidden="true">
      <path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.2 0 1.8-.9 1.4-1.9-.5-1.2.3-2.3 1.6-2.3h2a3.5 3.5 0 0 0 3.5-3.5C20.5 7.3 16.7 3.5 12 3.5Z" />
      <circle cx="7.8" cy="11" r="1.1" fill="currentColor" />
      <circle cx="10.5" cy="7.4" r="1.1" fill="currentColor" />
      <circle cx="15" cy="7.6" r="1.1" fill="currentColor" />
    </svg>
  );
}

export function ThemeDots({ colors }: { colors: string[] }) {
  return (
    <span className="dots" aria-hidden="true">
      {colors.map((c) => (
        <i key={c} style={{ background: c }} />
      ))}
    </span>
  );
}

export function ThemeMenu() {
  const { choice, setChoice } = useTheme();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  const pick = (c: ThemeChoice) => setChoice(c);

  return (
    <div className="appearance" ref={box}>
      <button type="button" className="btn icon quiet" aria-label="Theme" aria-expanded={open} title="Theme" onClick={() => setOpen((o) => !o)}>
        <IconPalette />
      </button>
      {open && (
        <div className="appearance-menu" role="dialog" aria-label="Website theme">
          <span className="label">Website theme</span>
          <div className="theme-quick" role="radiogroup" aria-label="Website theme">
            {SITE_THEMES.map((t) => (
              <button key={t.id} type="button" role="radio" aria-checked={choice === t.id} onClick={() => pick(t.id)}>
                <ThemeDots colors={t.palette.slice(0, 3).map((p) => p.color)} />
                {t.name}
              </button>
            ))}
            <button type="button" role="radio" aria-checked={choice === "auto"} onClick={() => pick("auto")}>
              <ThemeDots colors={["#140b19", "#f3ebe0"]} />
              Auto · match my device
            </button>
          </div>
          <Link to="/themes" className="btn small" onClick={() => setOpen(false)}>
            Open the theme gallery
          </Link>
        </div>
      )}
    </div>
  );
}
