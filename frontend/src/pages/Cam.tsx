/**
 * Bloom Cam: take (or upload) a photo with your flower, adjust it, pick a
 * camera look, and save it to your journal.
 *
 * Non-destructive: the original photo is kept in memory untouched; every
 * preview and the final image are rendered from it plus the edit settings.
 */
import { useTheme } from "../theme/ThemeProvider";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CameraView } from "../components/CameraView";
import { EditorStage } from "../components/EditorStage";
import { IconArrowLeft, IconDownload, IconJournal, IconRedo, IconReset, IconUndo } from "../components/Icons";
import { OverlayControls } from "../components/OverlayControls";
import { RecipePicker } from "../components/RecipePicker";
import { SaveDialog, isoFromLocalInput, type SaveDetails } from "../components/SaveDialog";
import { ThemeGallery } from "../components/ThemeGallery";
import { Loading } from "../components/ui";
import type { FlowerRecipe } from "../flower/recipe";
import { canvasToBlob, downloadBlob, safeFileName } from "../flower/render";
import { useHistory } from "../hooks/useHistory";
import { defaultPlacement, normalizePlacement, renderPhotoWithFlower, type FlowerPlacement } from "../imaging/compose";
import { renderThemed, toCanvas } from "../imaging/process";
import { defaultSettings, normalizeSettings, themeById, type ThemeSettings } from "../imaging/themes";
import { errorMessage, fetchImage } from "../lib/api";
import { useNavigationGuard, useRouter } from "../lib/router";
import { useSession } from "../lib/session";
import { storeFor, type JournalEntry } from "../lib/store";

interface CamEdit {
  recipe: FlowerRecipe | null;
  overlay: FlowerPlacement;
  theme: ThemeSettings;
}

export function renderFinal(photo: HTMLCanvasElement, edit: CamEdit, date: Date, maxSize = 2400): HTMLCanvasElement {
  const composed = renderPhotoWithFlower(photo, edit.recipe, edit.overlay, maxSize);
  return renderThemed(composed, edit.theme, { maxSize, date, caption: edit.recipe?.word ?? "", seed: Math.round(date.getTime() / 1000) });
}

export function CamPage() {
  const { recipe: studioRecipe, store, toast, hasFlower } = useSession();
  const { navigate, query } = useRouter();
  const entryId = query.get("entry");
  const [livePlacement, setLivePlacement] = useState<FlowerPlacement>(defaultPlacement);
  // The website theme only SUGGESTS a starting filter; you can change or remove it freely.
  const { theme: siteTheme } = useTheme();
  const [liveTheme, setLiveTheme] = useState<ThemeSettings>(() => defaultSettings(siteTheme.cameraFilter));
  const [cameraRecipe, setCameraRecipe] = useState<FlowerRecipe | null>(hasFlower ? studioRecipe : null);
  const [photo, setPhoto] = useState<HTMLCanvasElement | null>(null);
  const [date, setDate] = useState(() => new Date());
  const [initial, setInitial] = useState<CamEdit | null>(null);
  const [editing, setEditing] = useState<JournalEntry | null>(null);
  const [loadingEntry, setLoadingEntry] = useState(Boolean(entryId));
  const [preview, setPreview] = useState<Blob | null>(null);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<"flower" | "look">("flower");
  const history = useHistory<CamEdit>({ recipe: hasFlower ? studioRecipe : null, overlay: defaultPlacement(), theme: defaultSettings() });
  const edit = history.value;

  useNavigationGuard(Boolean(photo) && history.canUndo && !saving, "Leave without saving this photo?");

  // Re-edit an existing journal entry: /cam?entry=s:12
  useEffect(() => {
    if (!entryId) return;
    let cancelled = false;
    (async () => {
      try {
        const entry = await storeFor(entryId, store).getEntry(entryId);
        const url = entry.originalUrl ?? entry.photoUrl;
        if (!url) throw new Error("This entry has no photo to edit.");
        const image = entry.source === "server" ? await fetchImage(url) : await loadLocal(url);
        if (cancelled) return;
        const hasOriginal = Boolean(entry.originalUrl);
        const state = entry.edit_state ?? {};
        const restored: CamEdit = {
          recipe: entry.recipe,
          // Without the original, the flower is already part of the photo.
          overlay: hasOriginal ? normalizePlacement(state.overlay) : { ...normalizePlacement(state.overlay), visible: false },
          theme: hasOriginal ? normalizeSettings(state.theme) : defaultSettings(),
        };
        setPhoto(toCanvas(image, 4096));
        setDate(new Date(entry.taken_at));
        setInitial(restored);
        history.reset(restored);
        setEditing(entry);
      } catch (error) {
        toast(errorMessage(error), "error");
      } finally {
        if (!cancelled) setLoadingEntry(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryId, store]);

  const onCapture = useCallback(
    (shot: HTMLCanvasElement, placement: FlowerPlacement, _source: "camera" | "upload", theme: ThemeSettings) => {
      // The photo is kept untouched; the live filter just becomes the starting theme.
      const start: CamEdit = { recipe: cameraRecipe, overlay: placement, theme };
      setPhoto(shot);
      setDate(new Date());
      setInitial(start);
      history.reset(start);
      setEditing(null);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cameraRecipe],
  );

  const onLivePlacement = useCallback((next: FlowerPlacement) => setLivePlacement(next), []);

  const retake = () => {
    if (history.canUndo && !window.confirm("Retake? This photo and its edits will be discarded.")) return;
    setPhoto(null);
    setEditing(null);
    if (entryId) navigate("/cam", { replace: true });
  };

  const openSave = async () => {
    if (!photo) return;
    setPreview(await canvasToBlob(renderFinal(photo, edit, date, 1400), "image/jpeg", 0.9));
  };

  const save = async (details: SaveDetails) => {
    if (!photo) return;
    setSaving(true);
    const final = await canvasToBlob(renderFinal(photo, edit, date), "image/jpeg", 0.92);
    const editState = {
      version: 1,
      theme: { ...edit.theme, name: themeById(edit.theme.preset).name },
      overlay: edit.overlay,
      photo: { width: photo.width, height: photo.height },
    };
    try {
      if (editing) {
        const keepOriginal = details.keepOriginal && Boolean(editing.originalUrl);
        const entry = await storeFor(editing.id, store).updateEntry(editing.id, {
          title: details.title,
          caption: details.caption,
          notes: details.notes,
          taken_at: isoFromLocalInput(details.takenAt),
          recipe: edit.recipe ?? undefined,
          photo: final,
          edit_state: editState,
          album_ids: details.albumIds,
          keep_original: keepOriginal ? undefined : false,
        });
        toast("Journal entry updated.");
        setPhoto(null);
        navigate(`/journal/${entry.id}`);
      } else {
        const original = details.keepOriginal ? await canvasToBlob(toCanvas(photo, 4096), "image/jpeg", 0.95) : null;
        const entry = await store.createEntry({
          entry_type: "photo",
          title: details.title,
          caption: details.caption,
          notes: details.notes,
          taken_at: isoFromLocalInput(details.takenAt),
          recipe: edit.recipe,
          photo: final,
          original,
          edit_state: editState,
          album_ids: details.albumIds,
        });
        toast("Saved to your journal.");
        setPhoto(null);
        navigate(`/journal/${entry.id}`);
      }
    } finally {
      setSaving(false);
      setPreview(null);
    }
  };

  const download = async () => {
    if (!photo) return;
    downloadBlob(await canvasToBlob(renderFinal(photo, edit, date), "image/jpeg", 0.94), `bloom-${safeFileName(edit.recipe?.word ?? "photo")}.jpg`);
  };

  const themeSource = useMemo(() => (photo ? toCanvas(photo, 400) : null), [photo]);

  if (loadingEntry) {
    return (
      <main className="page">
        <Loading label="Opening your photo" />
      </main>
    );
  }

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">02 · Bloom Cam {editing ? "· editing a journal photo" : ""}</p>
          <h1>{photo ? <>Make it <span className="flourish">yours</span></> : <>Hold your flower up to the <span className="flourish">light</span></>}</h1>
        </div>
        {photo && (
          <div className="btn-row">
            <button type="button" className="btn icon quiet" onClick={history.undo} disabled={!history.canUndo} aria-label="Undo" title="Undo">
              <IconUndo />
            </button>
            <button type="button" className="btn icon quiet" onClick={history.redo} disabled={!history.canRedo} aria-label="Redo" title="Redo">
              <IconRedo />
            </button>
            <button
              type="button"
              className="btn small quiet"
              onClick={() => initial && history.set(initial, true)}
              disabled={!history.canUndo}
              title="Back to how the photo was captured"
            >
              <IconReset /> Reset
            </button>
          </div>
        )}
      </div>

      {!photo ? (
        <div className="cam">
          <CameraView
            recipe={cameraRecipe}
            placement={livePlacement}
            onPlacement={onLivePlacement}
            onCapture={onCapture}
            theme={liveTheme}
            onTheme={setLiveTheme}
          />
          <aside className="sheet">
            <div className="sheet-section">
              <header>
                <h3>Flower</h3>
                <span className="eyebrow">drag it on the picture</span>
              </header>
              <RecipePicker value={cameraRecipe} onChange={setCameraRecipe} />
              <button type="button" className="btn small quiet" style={{ justifySelf: "start" }} onClick={() => setCameraRecipe(null)} disabled={!cameraRecipe}>
                No flower, just the photo
              </button>
            </div>
            <div className="sheet-section">
              <p className="muted small">
                Tip: press <strong>Hold with hand</strong> and hold your hand up as if holding a stem. The flower follows
                your fingers; press the shutter when it looks right. You can still move it afterwards.
              </p>
            </div>
          </aside>
        </div>
      ) : (
        <div className="cam">
          <div className="stack">
            <EditorStage
              photo={photo}
              recipe={edit.recipe}
              overlay={edit.overlay}
              theme={edit.theme}
              date={date}
              onOverlay={(overlay, commit) => history.set((e) => ({ ...e, overlay }), commit)}
            />
            {editing && !editing.originalUrl && (
              <p className="notice">
                The original of this photo wasn't kept, so edits build on the finished picture. Its flower is already part of
                the photo; you can add another one.
              </p>
            )}
            <div className="btn-row" style={{ justifyContent: "space-between" }}>
              <button type="button" className="btn quiet" onClick={retake}>
                <IconArrowLeft /> {editing ? "Cancel" : "Retake"}
              </button>
              <div className="btn-row">
                <button type="button" className="btn" onClick={() => void download()}>
                  <IconDownload /> Download
                </button>
                <button type="button" className="btn primary" onClick={() => void openSave()}>
                  <IconJournal /> {editing ? "Save changes" : "Save to journal"}
                </button>
              </div>
            </div>
          </div>
          <aside className="sheet">
            <div className="sheet-section">
              <div className="segmented" role="group" aria-label="Edit">
                <button type="button" aria-pressed={tab === "flower"} onClick={() => setTab("flower")}>
                  Flower
                </button>
                <button type="button" aria-pressed={tab === "look"} onClick={() => setTab("look")}>
                  Filters & frames
                </button>
              </div>
            </div>
            {tab === "flower" ? (
              <>
                <div className="sheet-section">
                  <OverlayControls value={edit.overlay} onChange={(overlay, commit) => history.set((e) => ({ ...e, overlay }), commit)} />
                </div>
                <div className="sheet-section">
                  <header>
                    <h3>Which flower</h3>
                  </header>
                  <RecipePicker value={edit.recipe} onChange={(recipe) => history.set((e) => ({ ...e, recipe, overlay: { ...e.overlay, visible: true } }), true)} />
                </div>
              </>
            ) : (
              <div className="sheet-section">
                <ThemeGallery
                  source={themeSource}
                  value={edit.theme}
                  caption={edit.recipe?.word}
                  onChange={(theme, commit) => history.set((e) => ({ ...e, theme }), commit)}
                />
              </div>
            )}
          </aside>
        </div>
      )}

      {preview && photo && (
        <SaveDialog
          heading={editing ? "Save your changes" : "Save to your journal"}
          preview={preview}
          defaultTitle={editing?.title ?? edit.recipe?.word ?? "A photograph"}
          date={date}
          allowKeepOriginal={editing ? Boolean(editing.originalUrl) : true}
          confirmLabel={editing ? "Save changes" : "Save to journal"}
          initial={editing ? { caption: editing.caption, notes: editing.notes, albumIds: editing.album_ids } : undefined}
          onClose={() => setPreview(null)}
          onSave={save}
        />
      )}
    </main>
  );
}

function loadLocal(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not open the photo."));
    image.src = url;
  });
}
