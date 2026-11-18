/**
 * Phase 6: Bloom Cam 2.0
 * - Multi-flower layering (add/switch/remove/reorder multiple flowers on a photo)
 * - Non-destructive Photo Crop (Free, 1:1, 4:5, 3:4, 16:9 + interactive sliders)
 * - Photo Strip (up to 4 frames) & Film Contact Sheet (up to 6 frames) capture modes
 * - Full non-destructive editing & Journal saving
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CameraView } from "../components/CameraView";
import { EditorStage } from "../components/EditorStage";
import {
  IconArrowLeft,
  IconCrop,
  IconDownload,
  IconFlower,
  IconJournal,
  IconPlus,
  IconRedo,
  IconReset,
  IconTrash,
  IconUndo,
} from "../components/Icons";
import { OverlayControls } from "../components/OverlayControls";
import { RecipePicker } from "../components/RecipePicker";
import { SaveDialog, isoFromLocalInput, type SaveDetails } from "../components/SaveDialog";
import { ThemeGallery } from "../components/ThemeGallery";
import { Loading, Slider } from "../components/ui";
import { defaultRecipe, type FlowerRecipe, normalizeRecipe } from "../flower/recipe";
import { canvasToBlob, downloadBlob, safeFileName } from "../flower/render";
import { useHistory } from "../hooks/useHistory";
import {
  cropAspectRatio,
  cropPhotoCanvas,
  defaultPhotoCrop,
  defaultPlacement,
  normalizePhotoCrop,
  normalizePlacement,
  renderPhotoSequence,
  renderPhotoWithFlower,
  renderPhotoWithFlowers,
  type CropAspect,
  type FlowerLayerItem,
  type FlowerPlacement,
  type PhotoCrop,
} from "../imaging/compose";
import { context2d, renderThemed, toCanvas } from "../imaging/process";
import { defaultSettings, normalizeSettings, themeById, type ThemeSettings } from "../imaging/themes";
import { errorMessage, fetchImage } from "../lib/api";
import { localUid } from "../lib/ids";
import { useNavigationGuard, useRouter } from "../lib/router";
import { useSession } from "../lib/session";
import { storeFor, type JournalEntry } from "../lib/store";
import { useTheme } from "../theme/ThemeProvider";

interface CamEdit {
  layers: FlowerLayerItem[];
  activeLayerId: string;
  crop: PhotoCrop;
  theme: ThemeSettings;
}

export function renderFinal(photo: HTMLCanvasElement, edit: CamEdit, date: Date, maxSize = 2400): HTMLCanvasElement {
  const composed = renderPhotoWithFlowers(photo, edit.layers, edit.crop, maxSize);
  const firstWord = edit.layers[0]?.recipe.word ?? "";
  return renderThemed(composed, edit.theme, {
    maxSize,
    date,
    caption: firstWord,
    seed: Math.round(date.getTime() / 1000),
  });
}

const CROP_ASPECTS: Array<{ id: CropAspect; label: string }> = [
  { id: "free", label: "Free" },
  { id: "1:1", label: "1:1" },
  { id: "4:5", label: "4:5" },
  { id: "3:4", label: "3:4" },
  { id: "16:9", label: "16:9" },
];

export function CamPage() {
  const { recipe: studioRecipe, store, toast, hasFlower } = useSession();
  const { navigate, query } = useRouter();
  const entryId = query.get("entry");
  const { theme: siteTheme } = useTheme();

  const [camMode, setCamMode] = useState<"single" | "strip" | "contact-sheet">("single");
  const [stripFrames, setStripFrames] = useState<HTMLCanvasElement[]>([]);
  const stripPreviewRef = useRef<HTMLCanvasElement>(null);

  const [livePlacement, setLivePlacement] = useState<FlowerPlacement>(defaultPlacement);
  const [liveTheme, setLiveTheme] = useState<ThemeSettings>(() => defaultSettings(siteTheme.cameraFilter));
  const [cameraRecipe, setCameraRecipe] = useState<FlowerRecipe | null>(hasFlower ? studioRecipe : null);

  const [photo, setPhoto] = useState<HTMLCanvasElement | null>(null);
  const [date, setDate] = useState(() => new Date());
  const [initial, setInitial] = useState<CamEdit | null>(null);
  const [editing, setEditing] = useState<JournalEntry | null>(null);
  const [loadingEntry, setLoadingEntry] = useState(Boolean(entryId));
  const [preview, setPreview] = useState<Blob | null>(null);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<"flower" | "crop" | "look">("flower");

  const initialLayerId = useMemo(() => localUid(), []);
  const history = useHistory<CamEdit>({
    layers: hasFlower ? [{ id: initialLayerId, recipe: studioRecipe, placement: defaultPlacement() }] : [],
    activeLayerId: initialLayerId,
    crop: defaultPhotoCrop(),
    theme: defaultSettings(),
  });
  const edit = history.value;
  const activeLayer = edit.layers.find((l) => l.id === edit.activeLayerId) ?? edit.layers[0] ?? null;

  useNavigationGuard(Boolean(photo || stripFrames.length) && history.canUndo && !saving, "Leave without saving?");

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
        const state = (entry.edit_state ?? {}) as Record<string, unknown>;

        let restoredLayers: FlowerLayerItem[] = [];
        if (hasOriginal && Array.isArray(state.flowers)) {
          restoredLayers = state.flowers
            .map((raw) => {
              const obj = raw as Record<string, unknown>;
              if (!obj || !obj.recipe) return null;
              return {
                id: typeof obj.id === "string" ? obj.id : localUid(),
                recipe: normalizeRecipe(obj.recipe),
                placement: normalizePlacement(obj.placement),
              };
            })
            .filter((x): x is FlowerLayerItem => Boolean(x));
        } else if (hasOriginal && entry.recipe) {
          restoredLayers = [
            {
              id: localUid(),
              recipe: entry.recipe,
              placement: normalizePlacement(state.overlay),
            },
          ];
        }

        const restored: CamEdit = {
          layers: restoredLayers,
          activeLayerId: restoredLayers[0]?.id ?? "",
          crop: hasOriginal ? normalizePhotoCrop(state.crop) : defaultPhotoCrop(),
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

  const maxFrames = camMode === "strip" ? 4 : camMode === "contact-sheet" ? 6 : 1;

  const onCapture = useCallback(
    (shot: HTMLCanvasElement, placement: FlowerPlacement, _source: "camera" | "upload", theme: ThemeSettings) => {
      if (camMode !== "single") {
        const rendered = renderPhotoWithFlower(shot, cameraRecipe, placement, 1400);
        const themedFrame = renderThemed(rendered, { ...theme, frame: false }, { maxSize: 1400, date: new Date() });
        setStripFrames((prev) => {
          const next = [...prev, themedFrame].slice(0, camMode === "strip" ? 4 : 6);
          if (next.length === (camMode === "strip" ? 4 : 6)) {
            toast(`Captured ${next.length} frames! Review your ${camMode === "strip" ? "photo strip" : "contact sheet"} below.`);
          } else {
            toast(`Frame ${next.length} added.`);
          }
          return next;
        });
        setLiveTheme(theme);
        return;
      }

      const id = localUid();
      const start: CamEdit = {
        layers: cameraRecipe ? [{ id, recipe: cameraRecipe, placement }] : [],
        activeLayerId: cameraRecipe ? id : "",
        crop: defaultPhotoCrop(),
        theme,
      };
      setPhoto(shot);
      setDate(new Date());
      setInitial(start);
      history.reset(start);
      setEditing(null);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cameraRecipe, camMode, toast],
  );

  const onLivePlacement = useCallback((next: FlowerPlacement) => setLivePlacement(next), []);

  // Render live Strip / Contact Sheet canvas when frames update
  const sequenceCanvas = useMemo(() => {
    if (camMode === "single" || stripFrames.length === 0) return null;
    const seq = renderPhotoSequence(camMode, stripFrames, cameraRecipe?.word || "Bloom Cam");
    return renderThemed(seq, { ...liveTheme, frame: false }, { maxSize: 1800, date });
  }, [camMode, stripFrames, liveTheme, cameraRecipe?.word, date]);

  useEffect(() => {
    const c = stripPreviewRef.current;
    if (!c || !sequenceCanvas) return;
    c.width = sequenceCanvas.width;
    c.height = sequenceCanvas.height;
    context2d(c).drawImage(sequenceCanvas, 0, 0);
  }, [sequenceCanvas]);

  const retake = () => {
    if (history.canUndo && !window.confirm("Retake? This photo and its edits will be discarded.")) return;
    setPhoto(null);
    setEditing(null);
    if (entryId) navigate("/cam", { replace: true });
  };

  const openSave = async () => {
    if (camMode !== "single" && sequenceCanvas) {
      setPreview(await canvasToBlob(sequenceCanvas, "image/jpeg", 0.9));
      return;
    }
    if (!photo) return;
    setPreview(await canvasToBlob(renderFinal(photo, edit, date, 1400), "image/jpeg", 0.9));
  };

  const save = async (details: SaveDetails) => {
    setSaving(true);
    try {
      if (camMode !== "single" && sequenceCanvas) {
        const final = await canvasToBlob(sequenceCanvas, "image/jpeg", 0.92);
        const entry = await store.createEntry({
          entry_type: "photo",
          title: details.title,
          caption: details.caption,
          notes: details.notes,
          taken_at: isoFromLocalInput(details.takenAt),
          recipe: cameraRecipe,
          photo: final,
          edit_state: {
            version: 2,
            mode: camMode,
            theme: { ...liveTheme, name: themeById(liveTheme.preset).name },
          },
          album_ids: details.albumIds,
        });
        toast("Saved to your journal.");
        setStripFrames([]);
        navigate(`/journal/${entry.id}`);
        return;
      }

      if (!photo) return;
      const final = await canvasToBlob(renderFinal(photo, edit, date), "image/jpeg", 0.92);
      const editState = {
        version: 2,
        theme: { ...edit.theme, name: themeById(edit.theme.preset).name },
        overlay: activeLayer?.placement ?? defaultPlacement(),
        flowers: edit.layers,
        crop: edit.crop,
        photo: { width: photo.width, height: photo.height },
      };

      if (editing) {
        const keepOriginal = details.keepOriginal && Boolean(editing.originalUrl);
        const entry = await storeFor(editing.id, store).updateEntry(editing.id, {
          title: details.title,
          caption: details.caption,
          notes: details.notes,
          taken_at: isoFromLocalInput(details.takenAt),
          recipe: edit.layers[0]?.recipe ?? undefined,
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
          recipe: edit.layers[0]?.recipe ?? null,
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
    if (camMode !== "single" && sequenceCanvas) {
      downloadBlob(await canvasToBlob(sequenceCanvas, "image/jpeg", 0.94), `bloom-${camMode}.jpg`);
      return;
    }
    if (!photo) return;
    downloadBlob(
      await canvasToBlob(renderFinal(photo, edit, date), "image/jpeg", 0.94),
      `bloom-${safeFileName(edit.layers[0]?.recipe.word ?? "photo")}.jpg`,
    );
  };

  const themeSource = useMemo(() => {
    if (!photo) return null;
    return cropPhotoCanvas(photo, edit.crop, 400);
  }, [photo, edit.crop]);

  const updateActivePlacement = (placement: FlowerPlacement, commit: boolean) => {
    if (!activeLayer) return;
    history.set(
      (e) => ({
        ...e,
        layers: e.layers.map((l) => (l.id === activeLayer.id ? { ...l, placement } : l)),
      }),
      commit,
    );
  };

  const addFlowerLayer = () => {
    const id = localUid();
    const baseRecipe = hasFlower ? studioRecipe : defaultRecipe("bloom");
    const count = edit.layers.length;
    const offsetPlacement: FlowerPlacement = {
      ...defaultPlacement(),
      x: Math.max(0.2, Math.min(0.8, 0.35 + count * 0.16)),
      y: Math.max(0.2, Math.min(0.8, 0.38 + count * 0.08)),
      size: 0.56,
    };
    history.set(
      (e) => ({
        ...e,
        layers: [...e.layers, { id, recipe: baseRecipe, placement: offsetPlacement }],
        activeLayerId: id,
      }),
      true,
    );
  };

  const removeLayer = (id: string) => {
    history.set((e) => {
      const next = e.layers.filter((l) => l.id !== id);
      return {
        ...e,
        layers: next,
        activeLayerId: e.activeLayerId === id ? next[0]?.id ?? "" : e.activeLayerId,
      };
    }, true);
  };

  const applyAspectCrop = (aspect: CropAspect) => {
    if (!photo) return;
    if (aspect === "free") {
      history.set((e) => ({ ...e, crop: { ...e.crop, aspect } }), true);
      return;
    }
    const target = cropAspectRatio(aspect, photo.width, photo.height)!;
    const srcRatio = photo.width / photo.height;
    let w = 1;
    let h = 1;
    if (srcRatio > target) {
      w = target / srcRatio;
    } else {
      h = srcRatio / target;
    }
    const x = (1 - w) / 2;
    const y = (1 - h) / 2;
    history.set((e) => ({ ...e, crop: { x, y, w, h, aspect } }), true);
  };

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
          <h1>
            {photo ? (
              <>
                Make it <span className="flourish">yours</span>
              </>
            ) : (
              <>
                Hold your flower up to the <span className="flourish">light</span>
              </>
            )}
          </h1>
        </div>
        {!photo ? (
          <div className="segmented" role="group" aria-label="Capture mode">
            <button
              type="button"
              aria-pressed={camMode === "single"}
              onClick={() => {
                setCamMode("single");
                setStripFrames([]);
              }}
            >
              Single
            </button>
            <button
              type="button"
              aria-pressed={camMode === "strip"}
              onClick={() => {
                setCamMode("strip");
                setStripFrames([]);
              }}
            >
              Photo strip (4)
            </button>
            <button
              type="button"
              aria-pressed={camMode === "contact-sheet"}
              onClick={() => {
                setCamMode("contact-sheet");
                setStripFrames([]);
              }}
            >
              Contact sheet (6)
            </button>
          </div>
        ) : (
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
          <div className="stack">
            <CameraView
              recipe={cameraRecipe}
              placement={livePlacement}
              onPlacement={onLivePlacement}
              onCapture={onCapture}
              theme={liveTheme}
              onTheme={setLiveTheme}
            />
            {camMode !== "single" && (
              <div className="panel stack tight">
                <div className="row between" style={{ alignItems: "center" }}>
                  <div>
                    <strong>
                      {camMode === "strip" ? "Photo Booth Strip" : "Darkroom Contact Sheet"} · {stripFrames.length}/{maxFrames} frames
                    </strong>
                    <p className="muted small">Press the shutter or upload photos repeatedly to fill your frames.</p>
                  </div>
                  <div className="btn-row">
                    {stripFrames.length > 0 && (
                      <>
                        <button type="button" className="btn small quiet" onClick={() => setStripFrames([])}>
                          Clear
                        </button>
                        <button type="button" className="btn small" onClick={() => void download()}>
                          <IconDownload /> Download
                        </button>
                        <button type="button" className="btn small primary" onClick={() => void openSave()}>
                          <IconJournal /> Save to journal
                        </button>
                      </>
                    )}
                  </div>
                </div>
                {stripFrames.length > 0 && (
                  <div className="plate" style={{ maxWidth: 420, margin: "0 auto" }}>
                    <canvas ref={stripPreviewRef} style={{ width: "100%", height: "auto", display: "block" }} />
                  </div>
                )}
              </div>
            )}
          </div>
          <aside className="sheet">
            <div className="sheet-section">
              <header>
                <h3>Flower</h3>
                <span className="eyebrow">drag it on the picture</span>
              </header>
              <RecipePicker value={cameraRecipe} onChange={setCameraRecipe} />
              <button
                type="button"
                className="btn small quiet"
                style={{ justifySelf: "start" }}
                onClick={() => setCameraRecipe(null)}
                disabled={!cameraRecipe}
              >
                No flower, just the photo
              </button>
            </div>
            <div className="sheet-section">
              <p className="muted small">
                Tip: press <strong>Hold with hand</strong> and hold your hand up as if holding a stem. The flower follows
                your fingers; press the shutter when it looks right. You can layer more flowers and crop afterwards.
              </p>
            </div>
          </aside>
        </div>
      ) : (
        <div className="cam">
          <div className="stack">
            <EditorStage
              photo={photo}
              recipe={activeLayer?.recipe ?? null}
              overlay={activeLayer?.placement ?? defaultPlacement()}
              activeLayerId={activeLayer?.id}
              layers={edit.layers}
              crop={edit.crop}
              theme={edit.theme}
              date={date}
              onOverlay={updateActivePlacement}
            />
            {editing && !editing.originalUrl && (
              <p className="notice">
                The original of this photo wasn't kept, so edits build on the finished picture. You can still layer more flowers or crop it.
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
                  <IconFlower width={15} height={15} /> Flowers ({edit.layers.length})
                </button>
                <button type="button" aria-pressed={tab === "crop"} onClick={() => setTab("crop")}>
                  <IconCrop width={15} height={15} /> Crop
                </button>
                <button type="button" aria-pressed={tab === "look"} onClick={() => setTab("look")}>
                  Look
                </button>
              </div>
            </div>

            {tab === "flower" && (
              <>
                <div className="sheet-section">
                  <header>
                    <h3>Flower layers</h3>
                    <button type="button" className="btn small" onClick={addFlowerLayer} disabled={edit.layers.length >= 6}>
                      <IconPlus /> Add flower
                    </button>
                  </header>
                  {edit.layers.length === 0 ? (
                    <p className="muted small">No flowers on this photo yet. Click “Add flower” to layer one.</p>
                  ) : (
                    <div className="stack tight">
                      {edit.layers.map((layer, idx) => (
                        <div
                          key={layer.id}
                          className={`layer-row${layer.id === activeLayer?.id ? " active" : ""}`}
                          onClick={() => history.set((e) => ({ ...e, activeLayerId: layer.id }), false)}
                        >
                          <span className="lcd" style={{ fontSize: 11 }}>0{idx + 1}</span>
                          <strong style={{ flex: 1 }}>“{layer.recipe.word}”</strong>
                          <span className="muted small">{layer.recipe.shape}</span>
                          <button
                            type="button"
                            className="btn icon small quiet danger"
                            aria-label="Remove flower layer"
                            onClick={(ev) => {
                              ev.stopPropagation();
                              removeLayer(layer.id);
                            }}
                          >
                            <IconTrash />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {activeLayer && (
                  <>
                    <div className="sheet-section">
                      <OverlayControls value={activeLayer.placement} onChange={updateActivePlacement} />
                    </div>
                    <div className="sheet-section">
                      <header>
                        <h3>Which flower</h3>
                      </header>
                      <RecipePicker
                        value={activeLayer.recipe}
                        onChange={(recipe) =>
                          history.set(
                            (e) => ({
                              ...e,
                              layers: e.layers.map((l) =>
                                l.id === activeLayer.id
                                  ? { ...l, recipe, placement: { ...l.placement, visible: true } }
                                  : l,
                              ),
                            }),
                            true,
                          )
                        }
                      />
                    </div>
                  </>
                )}
              </>
            )}

            {tab === "crop" && (
              <div className="sheet-section stack">
                <header>
                  <h3>Non-destructive crop</h3>
                  <button
                    type="button"
                    className="btn small quiet"
                    onClick={() => history.set((e) => ({ ...e, crop: defaultPhotoCrop() }), true)}
                  >
                    <IconReset /> Full frame
                  </button>
                </header>
                <div className="chips" role="group" aria-label="Aspect ratio">
                  {CROP_ASPECTS.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      className="chip"
                      aria-pressed={edit.crop.aspect === a.id}
                      onClick={() => applyAspectCrop(a.id)}
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
                <Slider
                  label="Width"
                  value={edit.crop.w}
                  min={0.25}
                  max={1}
                  step={0.01}
                  format={(v) => `${Math.round(v * 100)}%`}
                  onChange={(w) => {
                    const maxW = Math.min(1, w);
                    const x = Math.min(edit.crop.x, 1 - maxW);
                    history.set((e) => ({ ...e, crop: { ...e.crop, w: maxW, x } }), true);
                  }}
                />
                <Slider
                  label="Height"
                  value={edit.crop.h}
                  min={0.25}
                  max={1}
                  step={0.01}
                  format={(v) => `${Math.round(v * 100)}%`}
                  onChange={(h) => {
                    const maxH = Math.min(1, h);
                    const y = Math.min(edit.crop.y, 1 - maxH);
                    history.set((e) => ({ ...e, crop: { ...e.crop, h: maxH, y } }), true);
                  }}
                />
                <Slider
                  label="Horizontal offset"
                  value={edit.crop.x}
                  min={0}
                  max={Math.max(0.01, 1 - edit.crop.w)}
                  step={0.01}
                  format={(v) => `${Math.round(v * 100)}%`}
                  onChange={(x) => history.set((e) => ({ ...e, crop: { ...e.crop, x: Math.min(x, 1 - e.crop.w) } }), true)}
                />
                <Slider
                  label="Vertical offset"
                  value={edit.crop.y}
                  min={0}
                  max={Math.max(0.01, 1 - edit.crop.h)}
                  step={0.01}
                  format={(v) => `${Math.round(v * 100)}%`}
                  onChange={(y) => history.set((e) => ({ ...e, crop: { ...e.crop, y: Math.min(y, 1 - e.crop.h) } }), true)}
                />
              </div>
            )}

            {tab === "look" && (
              <div className="sheet-section">
                <ThemeGallery
                  source={themeSource}
                  value={edit.theme}
                  caption={activeLayer?.recipe.word}
                  onChange={(theme, commit) => history.set((e) => ({ ...e, theme }), commit)}
                />
              </div>
            )}
          </aside>
        </div>
      )}

      {preview && (photo || sequenceCanvas) && (
        <SaveDialog
          heading={editing ? "Save your changes" : "Save to your journal"}
          preview={preview}
          defaultTitle={
            editing?.title ??
            (camMode === "strip"
              ? "Photo strip"
              : camMode === "contact-sheet"
                ? "Contact sheet"
                : activeLayer?.recipe.word ?? "A photograph")
          }
          date={date}
          allowKeepOriginal={camMode === "single" ? (editing ? Boolean(editing.originalUrl) : true) : false}
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
