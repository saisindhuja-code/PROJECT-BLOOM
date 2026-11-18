/** The Bloom Journal: everything you've made, with search, filters, albums, Scrapbook launcher, and Trash/Restore. */
import { useTheme } from "../theme/ThemeProvider";
import { useCallback, useEffect, useState } from "react";
import { FlowerPreview } from "../components/FlowerPreview";
import { IconEdit, IconLayers, IconPlus, IconRestore, IconTrash } from "../components/Icons";
import { Empty, Loading, formatDate } from "../components/ui";
import { errorMessage } from "../lib/api";
import { Link, useRouter } from "../lib/router";
import { useSession } from "../lib/session";
import type { Album, EntryType, JournalEntry } from "../lib/store";

const TYPES: Array<{ id: EntryType | ""; label: string }> = [
  { id: "", label: "Everything" },
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
        {entry.edit_state?.scrapbook
          ? "scrapbook"
          : entry.entry_type === "composition"
            ? `with ${entry.participants.filter((p) => p.display_name).map((p) => p.display_name).join(" & ")}`
            : entry.entry_type}
      </span>
      {entry.caption && <p className="caption">{entry.caption}</p>}
    </button>
  );
}

export function JournalPage() {
  const { store, toast, user, deviceMode, serverOnline } = useSession();
  const { navigate } = useRouter();
  const { theme: siteTheme } = useTheme();
  const [entries, setEntries] = useState<JournalEntry[] | null>(null);
  const [albums, setAlbums] = useState<Album[]>([]);
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [type, setType] = useState<EntryType | "">("");
  const [albumId, setAlbumId] = useState("");
  const [showTrash, setShowTrash] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(q), 250);
    return () => window.clearTimeout(timer);
  }, [q]);

  const loadAlbums = useCallback(() => store.listAlbums().then(setAlbums).catch(() => setAlbums([])), [store]);

  const loadEntries = useCallback(() => {
    setError("");
    return store
      .listEntries({ q: query, type, albumId: showTrash ? "" : albumId, trash: showTrash })
      .then((list) => setEntries(list))
      .catch((e) => {
        setError(errorMessage(e));
        setEntries([]);
      });
  }, [store, query, type, albumId, showTrash]);

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
      setShowTrash(false);
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

  const restore = async (id: string) => {
    setBusy(true);
    try {
      await store.restoreEntry(id);
      toast("Restored to your journal.");
      await Promise.all([loadEntries(), loadAlbums()]);
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  };

  const purgeOne = async (id: string) => {
    if (!window.confirm("Delete permanently? This cannot be undone.")) return;
    setBusy(true);
    try {
      await store.permanentDeleteEntry(id);
      toast("Deleted forever.");
      await loadEntries();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  };

  const emptyAllTrash = async () => {
    if (!window.confirm("Empty Trash permanently? All trashed entries will be erased.")) return;
    setBusy(true);
    try {
      await store.emptyTrash();
      toast("Trash emptied.");
      await loadEntries();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
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
            {showTrash ? (
              <>Recently <span className="flourish">deleted</span></>
            ) : currentAlbum ? (
              currentAlbum.name
            ) : (
              <>Pressed <span className="flourish">between pages</span></>
            )}
          </h1>
          <p className="journal-kind">{siteTheme.journalName}</p>
        </div>
        <div className="btn-row">
          {!showTrash && (
            <button type="button" className="btn primary" onClick={() => navigate("/scrapbook")}>
              <IconLayers /> New scrapbook page
            </button>
          )}
          {showTrash && entries && entries.length > 0 && (
            <button type="button" className="btn small quiet danger" disabled={busy} onClick={() => void emptyAllTrash()}>
              <IconTrash /> Empty Trash
            </button>
          )}
          {!showTrash && currentAlbum && (
            <>
              <button type="button" className="btn small quiet" onClick={() => void renameAlbum(currentAlbum)}>
                <IconEdit /> Rename
              </button>
              <button type="button" className="btn small quiet danger" onClick={() => void deleteAlbum(currentAlbum)}>
                <IconTrash /> Delete album
              </button>
            </>
          )}
        </div>
      </div>

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
          <button
            type="button"
            aria-pressed={!showTrash && !albumId}
            onClick={() => {
              setShowTrash(false);
              setAlbumId("");
            }}
          >
            All entries
          </button>
          {albums.map((album) => (
            <button
              key={album.id}
              type="button"
              aria-pressed={!showTrash && albumId === album.id}
              onClick={() => {
                setShowTrash(false);
                setAlbumId(album.id);
              }}
            >
              <span>{album.name}</span>
              <span className="count">{album.entry_count}</span>
            </button>
          ))}
          <button type="button" onClick={() => void newAlbum()}>
            <span className="muted">
              <IconPlus width={14} height={14} style={{ verticalAlign: "-2px" }} /> New album
            </span>
          </button>
          <button
            type="button"
            aria-pressed={showTrash}
            onClick={() => {
              setShowTrash(true);
              setAlbumId("");
            }}
          >
            <span>
              <IconTrash width={14} height={14} style={{ verticalAlign: "-2px", marginRight: 6 }} />
              Trash
            </span>
          </button>
        </nav>

        <section>
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
          {error && <p className="notice error">{error}</p>}
          {entries === null ? (
            <Loading label="Opening your journal" />
          ) : entries.length === 0 ? (
            showTrash ? (
              <Empty title="Trash is empty">Deleted journal entries appear here first so you can restore them if you change your mind.</Empty>
            ) : filtered ? (
              <Empty title="Nothing matches">Try another word, or clear the filters.</Empty>
            ) : (
              <Empty
                title="Your journal is waiting"
                action={
                  <div className="btn-row">
                    <Link to="/studio" className="btn primary">
                      Grow a flower
                    </Link>
                    <Link to="/cam" className="btn">
                      Take a photo
                    </Link>
                    <Link to="/scrapbook" className="btn">
                      Scrapbook page
                    </Link>
                  </div>
                }
              >
                Flowers you save and photos you take with Bloom Cam are kept here.
              </Empty>
            )
          ) : showTrash ? (
            <div className="entries">
              {entries.map((entry) => (
                <div key={entry.id} className="entry-card">
                  <div className="print">
                    {entry.photoUrl ? (
                      <img src={entry.photoUrl} alt={entry.title || "Trashed entry"} loading="lazy" />
                    ) : entry.recipe ? (
                      <FlowerPreview recipe={entry.recipe} />
                    ) : null}
                  </div>
                  <div className="meta">
                    <span className="title">{entry.title || entry.recipe?.word || "Untitled"}</span>
                    <span className="date">{formatDate(entry.deleted_at ?? entry.taken_at)}</span>
                  </div>
                  <div className="btn-row" style={{ marginTop: 10 }}>
                    <button type="button" className="btn small primary" disabled={busy} onClick={() => void restore(entry.id)}>
                      <IconRestore /> Restore
                    </button>
                    <button type="button" className="btn small quiet danger" disabled={busy} onClick={() => void purgeOne(entry.id)}>
                      <IconTrash /> Delete
                    </button>
                  </div>
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
