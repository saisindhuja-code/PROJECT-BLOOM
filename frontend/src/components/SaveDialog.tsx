/** "Save to journal": final preview + title, caption, notes, date, albums. */
import { useEffect, useState, type ReactNode } from "react";
import { errorMessage } from "../lib/api";
import { useSession } from "../lib/session";
import { AlbumPicker } from "./AlbumPicker";
import { Modal, Toggle } from "./ui";

export interface SaveDetails {
  title: string;
  caption: string;
  notes: string;
  takenAt: string;
  albumIds: string[];
  keepOriginal: boolean;
}

function localInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function SaveDialog({
  heading = "Save to your journal",
  preview,
  defaultTitle,
  date,
  allowKeepOriginal,
  confirmLabel = "Save to journal",
  onClose,
  onSave,
  extra,
  initial,
}: {
  heading?: string;
  preview: Blob | null;
  defaultTitle: string;
  date: Date;
  allowKeepOriginal: boolean;
  confirmLabel?: string;
  onClose: () => void;
  onSave: (details: SaveDetails) => Promise<void>;
  extra?: ReactNode;
  initial?: Partial<SaveDetails>;
}) {
  const { store, user } = useSession();
  const [details, setDetails] = useState<SaveDetails>({
    title: defaultTitle,
    caption: "",
    notes: "",
    takenAt: localInputValue(date),
    albumIds: [],
    keepOriginal: true,
    ...initial,
  });
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!preview) return;
    const u = URL.createObjectURL(preview);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [preview]);

  const save = async () => {
    setBusy(true);
    setError("");
    try {
      await onSave(details);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <Modal title={heading} onClose={busy ? () => undefined : onClose} wide>
      <div className="entry-view" style={{ gap: 28 }}>
        <div className="plate">
          {url ? <img src={url} alt="The finished picture" style={{ display: "block", width: "100%", height: "auto" }} /> : <span className="spinner" />}
          <div className="plate-caption">
            <span>Final preview</span>
            <span className="lcd">{store.kind === "server" ? `${user?.display_name ?? ""}'s journal` : "This device"}</span>
          </div>
        </div>
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          {extra}
          <label className="field">
            <span>Title</span>
            <input type="text" value={details.title} maxLength={120} onChange={(e) => setDetails({ ...details, title: e.target.value })} />
          </label>
          <label className="field">
            <span>Caption</span>
            <input type="text" value={details.caption} maxLength={500} onChange={(e) => setDetails({ ...details, caption: e.target.value })} />
          </label>
          <label className="field">
            <span>Notes</span>
            <textarea value={details.notes} maxLength={10000} onChange={(e) => setDetails({ ...details, notes: e.target.value })} />
          </label>
          <label className="field">
            <span>Date</span>
            <input type="datetime-local" value={details.takenAt} onChange={(e) => setDetails({ ...details, takenAt: e.target.value })} />
          </label>
          <AlbumPicker value={details.albumIds} onChange={(albumIds) => setDetails({ ...details, albumIds })} />
          {allowKeepOriginal && (
            <Toggle
              label="Keep the original photo too (lets you re-edit later)"
              checked={details.keepOriginal}
              onChange={(keepOriginal) => setDetails({ ...details, keepOriginal })}
            />
          )}
          {store.kind === "local" && <p className="notice">You're not signed in, so this is saved on this device only.</p>}
          <p className="form-error" role="alert">
            {error}
          </p>
          <div className="btn-row">
            <button type="submit" className="btn primary" disabled={busy}>
              {busy ? <span className="spinner" /> : null} {confirmLabel}
            </button>
            <button type="button" className="btn quiet" onClick={onClose} disabled={busy}>
              Not yet
            </button>
          </div>
        </form>
      </div>
    </Modal>
  );
}

export function isoFromLocalInput(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}
