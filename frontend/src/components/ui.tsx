/** Small shared UI pieces: modal, slider, toggle, toasts, empty states. */
import { useEffect, useId, useRef, type ReactNode } from "react";
import { useSession } from "../lib/session";
import { IconSprig, IconX } from "./Icons";

export function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>("input, textarea, select, button")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal${wide ? " wide" : ""}`} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div className="row between">
          <h2>{title}</h2>
          <button type="button" className="btn icon quiet" onClick={onClose} aria-label="Close">
            <IconX />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format = (v) => String(v),
  onCommit,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  format?: (value: number) => string;
  /** Called when the user lets go (good moment to record an undo step). */
  onCommit?: () => void;
}) {
  const id = useId();
  return (
    <div className="slider">
      <label className="label" htmlFor={id}>
        {label}
      </label>
      <output htmlFor={id}>{format(value)}</output>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={onCommit}
        onKeyUp={onCommit}
      />
    </div>
  );
}

export function Toggle({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="toggle" style={disabled ? { opacity: 0.45 } : undefined}>
      <span>{label}</span>
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

export function Toasts() {
  const { toasts, dismissToast } = useSession();
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.tone === "error" ? "error" : ""}`} role={t.tone === "error" ? "alert" : "status"}>
          <span>{t.text}</span>
          <button type="button" onClick={() => dismissToast(t.id)} aria-label="Dismiss">
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <IconSprig />
      <h3>{title}</h3>
      {children && <p className="muted">{children}</p>}
      {action}
    </div>
  );
}

export function Loading({ label = "Loading" }: { label?: string }) {
  return (
    <div className="empty" role="status">
      <span className="spinner" />
      <p className="muted small">{label}…</p>
    </div>
  );
}

export function initials(name: string): string {
  return name.trim().slice(0, 1).toUpperCase() || "·";
}

export function Avatar({ name }: { name: string }) {
  const hue = Array.from(name).reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 360, 7);
  const palette = ["#e7a3b5", "#9db39a", "#d9b26f", "#b9a2e8", "#f6d3dc"];
  return (
    <span className="avatar" style={{ background: palette[hue % palette.length] }} aria-hidden="true">
      {initials(name)}
    </span>
  );
}

export function formatDate(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function SignInNeeded({ what }: { what: string }) {
  const { serverOnline } = useSession();
  return (
    <div className="panel stack" style={{ maxWidth: 560 }}>
      <h2>{serverOnline ? "Sign in to use " + what : what + " needs the Bloom server"}</h2>
      <p className="muted">
        {serverOnline
          ? `${what} connects you with friends, so it needs a Bloom account. Your studio, camera and journal still work on this device without one.`
          : "The Bloom server can't be reached right now. Start the backend (see the README), then reload this page. Your studio, camera and journal keep working on this device meanwhile."}
      </p>
      {serverOnline && (
        <div className="btn-row">
          <a className="btn primary" href="/signin">
            Sign in
          </a>
          <a className="btn" href="/signup">
            Create an account
          </a>
        </div>
      )}
    </div>
  );
}
