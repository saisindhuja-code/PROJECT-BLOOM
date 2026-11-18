/** The Bloom Journal: entries, scrapbook pages, albums, page reordering & trash/restore. */
import { useCallback, useEffect, useState } from "react";
import { FlowerPreview } from "../components/FlowerPreview";
import { IconEdit, IconPlus, IconReset, IconTrash } from "../components/Icons";
import { Empty, Loading, formatDate } from "../components/ui";
import { errorMessage } from "../lib/api";
import { Link, useRouter } from "../lib/router";
import { useSession } from "../lib/session";
import type { Album, EntryType, JournalEntry, Visibility } from "../lib/store";
import { useTheme } from "../theme/ThemeProvider";

const TYPES: Array<{ id: EntryType | ""; label: string }> = [
  { id: "", label: "Everything" },
  { id: "scrapbook", label: "Scrapbooks" },
  { id: "flower", label: "Flowers" },
  { id: "photo", label: "Photographs" },
  { id: "composition", label: "Together" },
];

export function EntryCard({ entry, index }: { entry: JournalEntry; index?: number }) {
  const { navigate } = useRouter();
  return (
    <button type="button" className="entry-card" onClick={() => navigate(`/journal/${entry.id}`)}>
      <div className="print">
        {entry.photoUrl ? (
          <img src={entry.photoUrl} alt={entry.title || "Journal photo"} loading="lazy" />
        ) : entry.recipe ? (
          <FlowerPreview recipe={entry.recipe} />
        ) : null}
      </div>
      {index !== undefined && (
        <>
          <span className="entry-no" aria-hidden="true">No. {String(index + 1).padStart(3, "0")}</span>
          <span className="entry-file" aria-hidden="true">DSC_{String(index + 1).padStart(4, "0")}.JPG</span>
        </>
      )}
      <div className="meta">
        <span className="title">{entry.title || entry.recipe?.word || "Untitled"}</span>
        <span className="date">{formatDate(entry.taken_at)}</span>
      </div>
      <span className="kind-tag">
        {entry.entry_type === "composition"
          ? `with ${entry.participants.filter((p) => p.display_name).map((p) => p.display_name).join(" & ")}`
          : entry.entry_type}
      </span>
      {entry.caption && <p className="caption">{entry.caption}</p>}
    </button>
  );
}

export function JournalPage() {
  const { store, toast, user, deviceMode, serverOnline } = useSession();
  const { theme: siteTheme } = useTheme();
  const [entries, setEntries] = useState<JournalEntry[] | null>(null);
  const [albums, setAlbums] = useState<Album[]>([]);
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [type, setType] = useState<EntryType | "">("");
  const [albumId, setAlbumId] = useState("");
  const [trashed, setTrashed] = useState(false);
  const [reordering, setReordering] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(q), 250);
    return () => window.clearTimeout(timer);
  }, [q]);

  const loadAlbums = useCallback(() => store.listAlbums().then(setAlbums).catch(() => setAlbums([])), [store]);

  const loadEntries = useCallback(() => {
    setError("");
    return store
      .listEntries({ q: query, type, albumId, trashed })
      .then((list) => setEntries(list))
      .catch((e) => {
        setError(errorMessage(e));
        setEntries([]);
      });
  }, [store, query, type, albumId, trashed]);

  useEffect(() => {
    void loadAlbums();
  }, [loadAlbums]);

  useEffect(() => {
    void loadEntries();
  }, [loadEntries]);

  const newAlbum = async () => {
    const name = window.prompt("Name the new album");
    if (!name?.trim()) return;
    try {
      const album = await store.createAlbum(name.trim());
      await loadAlbums();
      setAlbumId(album.id);
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  const renameAlbum = async (album: Album) => {
    const name = window.prompt("Rename album", album.name);
    if (!name?.trim() || name.trim() === album.name) return;
    try {
      await store.renameAlbum(album.id, name.trim());
      await loadAlbums();
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  const deleteAlbum = async (album: Album) => {
    if (!window.confirm(`Delete the album “${album.name}”? The entries in it stay in your journal.`)) return;
    try {
      await store.deleteAlbum(album.id);
      setAlbumId("");
      await loadAlbums();
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  const movePage = async (index: number, delta: -1 | 1) => {
    if (!entries) return;
    const target = index + delta;
    if (target < 0 || target >= entries.length) return;
    const next = [...entries];
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item);
    setEntries(next);
    try {
      await store.reorderEntries(next.map((e) => e.id));
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  const restoreOne = async (id: string) => {
    try {
      await store.restoreEntry(id);
      toast("Restored to your journal.");
      await loadEntries();
      await loadAlbums();
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  const deleteForever = async (id: string) => {
    if (!window.confirm("Delete forever? This cannot be undone.")) return;
    try {
      await store.deleteEntry(id);
      toast("Permanently deleted.");
      await loadEntries();
      await loadAlbums();
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  const currentAlbum = albums.find((a) => a.id === albumId);
  const filtered = Boolean(query || type || albumId);

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">03 · Journal {user ? `· ${user.display_name}` : "· this device"}</p>
          <h1>
            {trashed ? "Trash" : currentAlbum ? currentAlbum.name : <>Pressed <span className="flourish">between pages</span></>}
          </h1>
          <p className="journal-kind">{siteTheme.journalName}</p>
        </div>
        <div className="btn-row">
          {!trashed && (
            <>
              <Link to="/scrapbook" className="btn small primary">
                <IconPlus /> New scrapbook page
              </Link>
              <button
                type="button"
                className="btn small"
                aria-pressed={reordering}
                onClick={() => setReordering((r) => !r)}
              >
                {reordering ? "Done organizing" : "Organize pages"}
              </button>
            </>
          )}
          <button
            type="button"
            className="btn small quiet"
            aria-pressed={trashed}
            onClick={() => {
              setTrashed((t) => !t);
              setReordering(false);
            }}
          >
            <IconTrash /> {trashed ? "Back to journal" : "Trash"}
          </button>
        </div>
      </div>

      {currentAlbum && !trashed && (
        <div className="btn-row" style={{ marginBottom: 18 }}>
          {store.kind === "server" && (
            <select
              aria-label="Collection visibility"
              value={currentAlbum.visibility}
              style={{ width: "auto", minHeight: 34, padding: "4px 32px 4px 12px", fontSize: 13 }}
              onChange={async (e) => {
                try {
                  await store.updateAlbum(currentAlbum.id, { visibility: e.target.value as Visibility });
                  await loadAlbums();
                  toast("Collection visibility updated.");
                } catch (err) {
                  toast(errorMessage(err), "error");
                }
              }}
            >
              <option value="private">Private</option>
              <option value="friends">Friends</option>
              <option value="public">Public</option>
            </select>
          )}
          <button type="button" className="btn small quiet" onClick={() => void renameAlbum(currentAlbum)}>
            <IconEdit /> Rename
          </button>
          <button type="button" className="btn small quiet danger" onClick={() => void deleteAlbum(currentAlbum)}>
            <IconTrash /> Delete album
          </button>
        </div>
      )}

      {!user && (deviceMode || !serverOnline) && (
        <div className="banner">
          <span>
            <strong>Saved on this device.</strong> Your journal lives in this browser.{" "}
            {serverOnline ? "Sign in to keep it in your account and share with friends." : "The Bloom server is offline right now."}
          </span>
          <span className="spacer" />
          {serverOnline && (
            <Link to="/signin" className="btn small">
              Sign in
            </Link>
          )}
        </div>
      )}

      <div className="journal">
        <nav className="album-list" aria-label="Albums">
          <button type="button" aria-pressed={!albumId && !trashed} onClick={() => { setTrashed(false); setAlbumId(""); }}>
            All entries
          </button>
          {albums.map((album) => (
            <button key={album.id} type="button" aria-pressed={albumId === album.id && !trashed} onClick={() => { setTrashed(false); setAlbumId(album.id); }}>
              <span>{album.name}</span>
              <span className="count">{album.entry_count}</span>
            </button>
          ))}
          <button type="button" onClick={() => void newAlbum()}>
            <span className="muted">
              <IconPlus width={14} height={14} style={{ verticalAlign: "-2px" }} /> New album
            </span>
          </button>
        </nav>

        <section>
          {!trashed && (
            <div className="journal-tools">
              <input type="search" placeholder="Search words, captions, notes, themes…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search the journal" />
              <div className="chips" role="group" aria-label="Show">
                {TYPES.map((t) => (
                  <button key={t.id} type="button" className="chip" aria-pressed={type === t.id} onClick={() => setType(t.id)}>
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          {error && <p className="notice error">{error}</p>}
          {entries === null ? (
            <Loading label="Opening your journal" />
          ) : entries.length === 0 ? (
            trashed ? (
              <Empty title="Trash is empty">Deleted pages stay here until you restore or permanently remove them.</Empty>
            ) : filtered ? (
              <Empty title="Nothing matches">Try another word, or clear the filters.</Empty>
            ) : (
              <Empty
                title="Your journal is waiting"
                action={
                  <div className="btn-row">
                    <Link to="/scrapbook" className="btn primary">
                      New scrapbook page
                    </Link>
                    <Link to="/studio" className="btn">
                      Grow a flower
                    </Link>
                    <Link to="/cam" className="btn">
                      Take a photo
                    </Link>
                  </div>
                }
              >
                Scrapbook pages, flowers, and photos from Bloom Cam are kept here.
              </Empty>
            )
          ) : trashed ? (
            <div className="stack tight">
              {entries.map((entry) => (
                <div key={entry.id} className="person">
                  <div className="who">
                    <strong>{entry.title || "Untitled"}</strong>
                    <span className="muted small">{entry.entry_type} · {formatDate(entry.taken_at)}</span>
                  </div>
                  <button type="button" className="btn small" onClick={() => void restoreOne(entry.id)}>
                    <IconReset /> Restore
                  </button>
                  <button type="button" className="btn small quiet danger" onClick={() => void deleteForever(entry.id)}>
                    <IconTrash /> Delete forever
                  </button>
                </div>
              ))}
            </div>
          ) : reordering ? (
            <div className="stack tight">
              {entries.map((entry, idx) => (
                <div key={entry.id} className="person">
                  <div className="who">
                    <strong>{idx + 1}. {entry.title || entry.recipe?.word || "Untitled"}</strong>
                    <span className="muted small">{entry.entry_type} · {formatDate(entry.taken_at)}</span>
                  </div>
                  <button type="button" className="btn small quiet" disabled={idx === 0} onClick={() => void movePage(idx, -1)}>
                    Move up
                  </button>
                  <button type="button" className="btn small quiet" disabled={idx === entries.length - 1} onClick={() => void movePage(idx, 1)}>
                    Move down
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="entries">
              {entries.map((entry, i) => (
                <EntryCard key={entry.id} entry={entry} index={entries.length - 1 - i} />
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
