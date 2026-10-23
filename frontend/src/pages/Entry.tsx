/** One journal entry: view, edit details, re-edit, duplicate, download, delete. */
import { useEffect, useState } from "react";
import { AlbumPicker } from "../components/AlbumPicker";
import { FlowerPreview } from "../components/FlowerPreview";
import { IconArrowLeft, IconCamera, IconCopy, IconDownload, IconEdit, IconFlower, IconTrash } from "../components/Icons";
import { Loading, formatDate } from "../components/ui";
import { buildFlower } from "../flower/engine";
import { canvasToBlob, downloadBlob, drawingToCanvas, safeFileName } from "../flower/render";
import { errorMessage } from "../lib/api";
import { Link, useRouter } from "../lib/router";
import { useSession } from "../lib/session";
import { storeFor, type JournalEntry } from "../lib/store";

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function EntryPage({ id }: { id: string }) {
  const { store: sessionStore, toast, growFlower } = useSession();
  const store = storeFor(id, sessionStore);
  const { navigate } = useRouter();
  const [entry, setEntry] = useState<JournalEntry | null>(null);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ title: "", caption: "", notes: "", takenAt: "", albumIds: [] as string[] });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    store
      .getEntry(id)
      .then((e) => {
        if (cancelled) return;
        setEntry(e);
        setForm({ title: e.title, caption: e.caption, notes: e.notes, takenAt: toLocalInput(e.taken_at), albumIds: e.album_ids });
      })
      .catch((e) => !cancelled && setError(errorMessage(e)));
    return () => {
      cancelled = true;
    };
  }, [id, store]);

  if (error) {
    return (
      <main className="page">
        <p className="notice error">{error}</p>
        <p style={{ marginTop: 16 }}>
          <Link to="/journal">Back to the journal</Link>
        </p>
      </main>
    );
  }
  if (!entry) {
    return (
      <main className="page">
        <Loading label="Opening the page" />
      </main>
    );
  }

  const dirty =
    form.title !== entry.title ||
    form.caption !== entry.caption ||
    form.notes !== entry.notes ||
    form.takenAt !== toLocalInput(entry.taken_at) ||
    JSON.stringify([...form.albumIds].sort()) !== JSON.stringify([...entry.album_ids].sort());

  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    try {
      await task();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  };

  const saveDetails = () =>
    run(async () => {
      const updated = await store.updateEntry(entry.id, {
        title: form.title,
        caption: form.caption,
        notes: form.notes,
        taken_at: new Date(form.takenAt).toISOString(),
        album_ids: form.albumIds,
      });
      setEntry(updated);
      toast("Saved.");
    });

  const duplicate = () =>
    run(async () => {
      const copy = await store.duplicateEntry(entry.id);
      toast("Duplicated.");
      navigate(`/journal/${copy.id}`);
    });

  const remove = () => {
    if (!window.confirm("Delete this entry? This can't be undone.")) return;
    void run(async () => {
      await store.deleteEntry(entry.id);
      toast("Deleted.");
      navigate("/journal", { replace: true });
    });
  };

  const download = (which: "photo" | "original") =>
    run(async () => {
      const name = safeFileName(entry.title || entry.recipe?.word || "bloom");
      if (entry.entry_type === "flower" && entry.recipe) {
        const canvas = drawingToCanvas(buildFlower(entry.recipe), { framing: "window", background: true, scale: 3 });
        downloadBlob(await canvasToBlob(canvas), `bloom-${name}.png`);
        return;
      }
      const url = which === "original" ? entry.originalUrl : entry.photoUrl;
      if (!url) return;
      const response = await fetch(url, { credentials: "include" });
      if (!response.ok) throw new Error("Could not download the image.");
      const blob = await response.blob();
      downloadBlob(blob, `bloom-${name}${which === "original" ? "-original" : ""}.${blob.type === "image/png" ? "png" : "jpg"}`);
    });

  const dropOriginal = () => {
    if (!window.confirm("Remove the kept original photo? You won't be able to re-edit from it.")) return;
    void run(async () => {
      setEntry(await store.updateEntry(entry.id, { keep_original: false }));
      toast("Original removed.");
    });
  };

  const theme = entry.edit_state?.theme;

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <Link to="/journal" className="btn small quiet" aria-label="Back to the journal">
            <IconArrowLeft /> Journal
          </Link>
          <h1 style={{ marginTop: 12 }}>{entry.title || entry.recipe?.word || "Untitled"}</h1>
          <p className="muted" style={{ marginTop: 6 }}>
            {formatDate(entry.taken_at)}
            {theme?.name ? ` · ${String(theme.name)}` : ""}
            {entry.recipe ? ` · grown from “${entry.recipe.word}”` : ""}
          </p>
        </div>
        <div className="btn-row">
          {entry.entry_type === "photo" && (
            <button type="button" className="btn" onClick={() => navigate(`/cam?entry=${encodeURIComponent(entry.id)}`)}>
              <IconCamera /> Edit photo
            </button>
          )}
          {entry.recipe && (
            <button
              type="button"
              className="btn"
              onClick={() => {
                growFlower(entry.recipe!);
                navigate("/studio");
              }}
            >
              <IconFlower /> Open flower in studio
            </button>
          )}
          {entry.entry_type === "composition" && entry.project_id && (
            <Link to={`/together/${entry.project_id}`} className="btn">
              Open project
            </Link>
          )}
        </div>
      </div>

      <div className="entry-view">
        <div className="stack">
          <div className="plate print">
            {entry.photoUrl ? <img src={entry.photoUrl} alt={entry.title || "Journal photo"} /> : entry.recipe ? <FlowerPreview recipe={entry.recipe} /> : null}
            <div className="plate-caption">
              <span>{entry.entry_type}</span>
              <span className="lcd">{entry.originalUrl ? "original kept" : entry.entry_type === "flower" ? "recipe kept" : "final only"}</span>
            </div>
          </div>
          {entry.participants.length > 0 && (
            <p className="muted">Made together with {entry.participants.map((p) => p.display_name).join(" & ")}.</p>
          )}
          <div className="btn-row">
            <button type="button" className="btn small" disabled={busy} onClick={() => void download("photo")}>
              <IconDownload /> Download
            </button>
            {entry.originalUrl && (
              <button type="button" className="btn small quiet" disabled={busy} onClick={() => void download("original")}>
                <IconDownload /> Original
              </button>
            )}
            <button type="button" className="btn small quiet" disabled={busy} onClick={() => void duplicate()}>
              <IconCopy /> Duplicate
            </button>
            {entry.originalUrl && (
              <button type="button" className="btn small quiet" disabled={busy} onClick={dropOriginal}>
                Remove original
              </button>
            )}
            <button type="button" className="btn small quiet danger" disabled={busy} onClick={remove}>
              <IconTrash /> Delete
            </button>
          </div>
        </div>

        <form
          className="sheet"
          onSubmit={(e) => {
            e.preventDefault();
            void saveDetails();
          }}
        >
          <div className="sheet-section">
            <header>
              <h3>
                <IconEdit width={16} height={16} /> Details
              </h3>
            </header>
            <label className="field">
              <span>Title</span>
              <input type="text" value={form.title} maxLength={120} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </label>
            <label className="field">
              <span>Caption</span>
              <input type="text" value={form.caption} maxLength={500} onChange={(e) => setForm({ ...form, caption: e.target.value })} />
            </label>
            <label className="field">
              <span>Notes</span>
              <textarea value={form.notes} maxLength={10000} rows={6} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </label>
            <label className="field">
              <span>Date</span>
              <input type="datetime-local" value={form.takenAt} onChange={(e) => setForm({ ...form, takenAt: e.target.value })} />
            </label>
          </div>
          <div className="sheet-section">
            <AlbumPicker value={form.albumIds} onChange={(albumIds) => setForm({ ...form, albumIds })} />
          </div>
          <div className="sheet-section">
            <button type="submit" className="btn primary" disabled={!dirty || busy} style={{ justifySelf: "start" }}>
              Save details
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}
