/**
 * Bloom Cam 2.0:
 * - Multi-flower overlays (add, select, reorder, hide, delete, hand-hold)
 * - Default & manual photo crop modes (Original, 1:1, 4:5, 3:4, 9:16, Manual)
 * - Cam styles: Vintage digicam, Disposable camera, Polaroid, Photo strip,
 *   Contact sheet, and Botanical portrait
 * - Non-destructive: original photo stays untouched; re-editable from Journal
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CameraView } from "../components/CameraView";
import { EditorStage } from "../components/EditorStage";
import {
  IconArrowLeft,
  IconDownload,
  IconJournal,
  IconPlus,
  IconRedo,
  IconReset,
  IconTrash,
  IconUndo,
  IconUpload,
} from "../components/Icons";
import { OverlayControls } from "../components/OverlayControls";
import { RecipePicker } from "../components/RecipePicker";
import { SaveDialog, isoFromLocalInput, type SaveDetails } from "../components/SaveDialog";
import { ThemeGallery } from "../components/ThemeGallery";
import { Loading, Slider } from "../components/ui";
import { normalizeRecipe, type FlowerRecipe } from "../flower/recipe";
import { canvasToBlob, downloadBlob, safeFileName } from "../flower/render";
import { useHistory } from "../hooks/useHistory";
import {
  CAM_STYLES,
  cropPhotoCanvas,
  defaultPhotoCrop,
  defaultPlacement,
  normalizePhotoCrop,
  normalizePlacement,
  renderMultiFrameCam,
  renderPhotoWithLayers,
  type CamStyleId,
  type CropAspect,
  type FlowerLayer,
  type FlowerPlacement,
  type PhotoCrop,
} from "../imaging/compose";
import { context2d, renderThemed, toCanvas } from "../imaging/process";
import { defaultSettings, normalizeSettings, themeById, type ThemeSettings } from "../imaging/themes";
import { blobToImage, errorMessage, fetchImage } from "../lib/api";
import { localUid } from "../lib/ids";
import { useNavigationGuard, useRouter } from "../lib/router";
import { useSession } from "../lib/session";
import { storeFor, type JournalEntry } from "../lib/store";
import { useTheme } from "../theme/ThemeProvider";

interface CamEdit {
  camStyle: CamStyleId;
  crop: PhotoCrop;
  layers: FlowerLayer[];
  theme: ThemeSettings;
}

const CROP_ASPECTS: Array<{ id: CropAspect; label: string }> = [
  { id: "original", label: "Default (original)" },
  { id: "1:1", label: "1:1 Square" },
  { id: "4:5", label: "4:5 Portrait" },
  { id: "3:4", label: "3:4 Classic" },
  { id: "9:16", label: "9:16 Story" },
  { id: "manual", label: "Manual crop" },
];

export function renderFinal(frames: HTMLCanvasElement[], edit: CamEdit, date: Date, maxSize = 2400): HTMLCanvasElement {
  const seed = Math.round(date.getTime() / 1000);
  const caption = edit.layers[0]?.recipe.word ?? "";

  if (edit.camStyle === "photo-strip" || edit.camStyle === "contact-sheet") {
    const processedFrames = frames.map((f) => {
      const cropped = cropPhotoCanvas(f, edit.crop, Math.min(maxSize, 1200));
      return renderPhotoWithLayers(cropped, edit.layers, Math.min(maxSize, 1200));
    });
    const sheet = renderMultiFrameCam(processedFrames, edit.camStyle, { caption, date, maxSize });
    return renderThemed(sheet, { ...edit.theme, frame: false }, { maxSize, date, caption, seed });
  }

  const base = frames[0];
  const cropped = cropPhotoCanvas(base, edit.crop, maxSize);
  const composed = renderPhotoWithLayers(cropped, edit.layers, maxSize);
  return renderThemed(composed, edit.theme, { maxSize, date, caption, seed });
}

export function CamPage() {
  const { recipe: studioRecipe, store, toast, hasFlower } = useSession();
  const { navigate, query } = useRouter();
  const entryId = query.get("entry");
  const { theme: siteTheme } = useTheme();

  const [camStyle, setCamStyle] = useState<CamStyleId>("single");
  const [livePlacement, setLivePlacement] = useState<FlowerPlacement>(defaultPlacement);
  const [liveTheme, setLiveTheme] = useState<ThemeSettings>(() => defaultSettings(siteTheme.cameraFilter));
  const [cameraRecipe, setCameraRecipe] = useState<FlowerRecipe | null>(hasFlower ? studioRecipe : null);

  const [frames, setFrames] = useState<HTMLCanvasElement[]>([]);
  const [date, setDate] = useState(() => new Date());
  const [initial, setInitial] = useState<CamEdit | null>(null);
  const [editing, setEditing] = useState<JournalEntry | null>(null);
  const [loadingEntry, setLoadingEntry] = useState(Boolean(entryId));
  const [preview, setPreview] = useState<Blob | null>(null);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<"flower" | "crop" | "look">("flower");
  const [activeLayerId, setActiveLayerId] = useState<string | null>(null);
  const addFrameInput = useRef<HTMLInputElement>(null);
  const stripPreviewCanvas = useRef<HTMLCanvasElement>(null);

  const history = useHistory<CamEdit>({
    camStyle: "single",
    crop: defaultPhotoCrop(),
    layers: hasFlower ? [{ id: "l1", recipe: studioRecipe, placement: defaultPlacement() }] : [],
    theme: defaultSettings(),
  });
  const edit = history.value;
  const photo = frames[0] ?? null;
  const isMultiFrame = edit.camStyle === "photo-strip" || edit.camStyle === "contact-sheet";

  useNavigationGuard(Boolean(photo) && (!editing || history.canUndo) && !saving, "Leave without saving this photo?");

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
        const styleId = CAM_STYLES.some((s) => s.id === state.camStyle) ? (state.camStyle as CamStyleId) : "single";

        let restoredLayers: FlowerLayer[] = [];
        if (Array.isArray(state.layers) && state.layers.length > 0) {
          restoredLayers = state.layers
            .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
            .map((item, idx) => ({
              id: typeof item.id === "string" ? item.id : `l${idx + 1}`,
              recipe: normalizeRecipe(item.recipe),
              placement: hasOriginal
                ? normalizePlacement(item.placement)
                : { ...normalizePlacement(item.placement), visible: false },
            }));
        } else if (entry.recipe) {
          restoredLayers = [
            {
              id: "l1",
              recipe: entry.recipe,
              placement: hasOriginal ? normalizePlacement(state.overlay) : { ...normalizePlacement(state.overlay), visible: false },
            },
          ];
        }

        const restored: CamEdit = {
          camStyle: styleId,
          crop: hasOriginal ? normalizePhotoCrop(state.crop) : defaultPhotoCrop(),
          layers: restoredLayers,
          theme: hasOriginal ? normalizeSettings(state.theme) : defaultSettings(),
        };
        setFrames([toCanvas(image, 4096)]);
        setDate(new Date(entry.taken_at));
        setInitial(restored);
        history.reset(restored);
        setActiveLayerId(restoredLayers[0]?.id ?? null);
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

  const chooseLiveCamStyle = (id: CamStyleId) => {
    const spec = CAM_STYLES.find((s) => s.id === id) ?? CAM_STYLES[0];
    setCamStyle(id);
    setLiveTheme({ ...defaultSettings(spec.preset), frame: spec.frame, dateStamp: spec.dateStamp });
  };

  const onCapture = useCallback(
    (shot: HTMLCanvasElement, placement: FlowerPlacement, _source: "camera" | "upload", theme: ThemeSettings) => {
      const spec = CAM_STYLES.find((s) => s.id === camStyle) ?? CAM_STYLES[0];
      const firstLayer: FlowerLayer[] = cameraRecipe ? [{ id: localUid(), recipe: cameraRecipe, placement }] : [];
      const start: CamEdit = {
        camStyle,
        crop: defaultPhotoCrop(spec.aspect ?? "original"),
        layers: firstLayer,
        theme,
      };
      setFrames([shot]);
      setDate(new Date());
      setInitial(start);
      history.reset(start);
      setActiveLayerId(firstLayer[0]?.id ?? null);
      setEditing(null);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cameraRecipe, camStyle],
  );

  const onMultiCapture = useCallback(
    (shots: HTMLCanvasElement[], placement: FlowerPlacement, theme: ThemeSettings) => {
      const spec = CAM_STYLES.find((s) => s.id === camStyle) ?? CAM_STYLES[0];
      const firstLayer: FlowerLayer[] = cameraRecipe ? [{ id: localUid(), recipe: cameraRecipe, placement }] : [];
      const start: CamEdit = {
        camStyle,
        crop: defaultPhotoCrop(spec.aspect ?? "original"),
        layers: firstLayer,
        theme,
      };
      setFrames(shots);
      setDate(new Date());
      setInitial(start);
      history.reset(start);
      setActiveLayerId(firstLayer[0]?.id ?? null);
      setEditing(null);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cameraRecipe, camStyle],
  );

  const onLivePlacement = useCallback((next: FlowerPlacement) => setLivePlacement(next), []);

  // Live preview for multi-frame Photo Strip / Contact Sheet
  useEffect(() => {
    if (!photo || !isMultiFrame) return;
    const timer = window.setTimeout(() => {
      const canvas = stripPreviewCanvas.current;
      if (!canvas) return;
      const rendered = renderFinal(frames, edit, date, 1000);
      canvas.width = rendered.width;
      canvas.height = rendered.height;
      context2d(canvas).drawImage(rendered, 0, 0);
    }, 90);
    return () => window.clearTimeout(timer);
  }, [photo, isMultiFrame, frames, edit, date]);

  const activeLayer = useMemo(
    () => edit.layers.find((l) => l.id === activeLayerId) ?? edit.layers[0] ?? null,
    [edit.layers, activeLayerId],
  );

  const updateActiveOverlay = useCallback(
    (placement: FlowerPlacement, commit: boolean) => {
      if (!activeLayer) return;
      history.set(
        (e) => ({
          ...e,
          layers: e.layers.map((l) => (l.id === activeLayer.id ? { ...l, placement } : l)),
        }),
        commit,
      );
    },
    [activeLayer, history],
  );

  const addFlowerLayer = () => {
    const id = localUid();
    const offset = (edit.layers.length % 4) * 0.08;
    const placement: FlowerPlacement = {
      ...defaultPlacement(),
      x: Math.min(0.85, 0.42 + offset),
      y: Math.min(0.85, 0.45 + offset),
      size: 0.56,
    };
    const newLayer: FlowerLayer = { id, recipe: studioRecipe, placement };
    history.set((e) => ({ ...e, layers: [...e.layers, newLayer] }), true);
    setActiveLayerId(id);
  };

  const removeLayer = (id: string) => {
    history.set((e) => {
      const next = e.layers.filter((l) => l.id !== id);
      if (activeLayerId === id) setActiveLayerId(next[0]?.id ?? null);
      return { ...e, layers: next };
    }, true);
  };

  const moveLayer = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= edit.layers.length) return;
    history.set((e) => {
      const next = [...e.layers];
      const [item] = next.splice(index, 1);
      next.splice(target, 0, item);
      return { ...e, layers: next };
    }, true);
  };

  const addExtraFrame = async (file: File | undefined) => {
    if (!file) return;
    try {
      const img = await blobToImage(file);
      setFrames((list) => [...list.slice(0, 5), toCanvas(img, 3000)]);
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  const retake = () => {
    if (history.canUndo && !window.confirm("Retake? This photo and its edits will be discarded.")) return;
    setFrames([]);
    setEditing(null);
    if (entryId) navigate("/cam", { replace: true });
  };

  const openSave = async () => {
    if (!photo) return;
    setPreview(await canvasToBlob(renderFinal(frames, edit, date, 1400), "image/jpeg", 0.9));
  };

  const save = async (details: SaveDetails) => {
    if (!photo) return;
    setSaving(true);
    try {
      const final = await canvasToBlob(renderFinal(frames, edit, date), "image/jpeg", 0.92);
      const primaryLayer = edit.layers[0] ?? null;
      const editState = {
        version: 2,
        camStyle: edit.camStyle,
        crop: edit.crop,
        theme: { ...edit.theme, name: themeById(edit.theme.preset).name },
        layers: edit.layers,
        overlay: primaryLayer?.placement ?? defaultPlacement(),
        photo: { width: photo.width, height: photo.height },
      };
      if (editing) {
        const keepOriginal = details.keepOriginal && Boolean(editing.originalUrl);
        const entry = await storeFor(editing.id, store).updateEntry(editing.id, {
          title: details.title,
          caption: details.caption,
          notes: details.notes,
          taken_at: isoFromLocalInput(details.takenAt),
          recipe: primaryLayer?.recipe ?? undefined,
          photo: final,
          edit_state: editState,
          album_ids: details.albumIds,
          keep_original: keepOriginal ? undefined : false,
        });
        toast("Journal entry updated.");
        setPreview(null);
        setFrames([]);
        navigate(`/journal/${entry.id}`);
      } else {
        const original = details.keepOriginal ? await canvasToBlob(toCanvas(photo, 4096), "image/jpeg", 0.95) : null;
        const entry = await store.createEntry({
          entry_type: "photo",
          title: details.title,
          caption: details.caption,
          notes: details.notes,
          taken_at: isoFromLocalInput(details.takenAt),
          recipe: primaryLayer?.recipe ?? null,
          photo: final,
          original,
          edit_state: editState,
          album_ids: details.albumIds,
        });
        toast("Saved to your journal.");
        setPreview(null);
        setFrames([]);
        navigate(`/journal/${entry.id}`);
      }
    } finally {
      setSaving(false);
    }
  };

  const download = async () => {
    if (!photo) return;
    const word = edit.layers[0]?.recipe.word ?? "photo";
    downloadBlob(await canvasToBlob(renderFinal(frames, edit, date), "image/jpeg", 0.94), `bloom-${safeFileName(word)}.jpg`);
  };

  const themeSource = useMemo(() => (photo ? cropPhotoCanvas(photo, edit.crop, 400) : null), [photo, edit.crop]);
  const activeCamSpec = CAM_STYLES.find((s) => s.id === camStyle) ?? CAM_STYLES[0];

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
          <p className="eyebrow">02 · Bloom Cam 2.0 {editing ? "· editing a journal photo" : ""}</p>
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
          <div className="stack">
            <div className="chips" role="radiogroup" aria-label="Camera style">
              {CAM_STYLES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className="chip"
                  role="radio"
                  aria-checked={camStyle === s.id}
                  aria-pressed={camStyle === s.id}
                  title={s.hint}
                  onClick={() => chooseLiveCamStyle(s.id)}
                >
                  {s.name}
                </button>
              ))}
            </div>
            <CameraView
              recipe={cameraRecipe}
              placement={livePlacement}
              onPlacement={onLivePlacement}
              onCapture={onCapture}
              shotCount={activeCamSpec.multiShots ?? 1}
              onMultiCapture={onMultiCapture}
              theme={liveTheme}
              onTheme={setLiveTheme}
            />
          </div>
          <aside className="sheet">
            <div className="sheet-section">
              <header>
                <h3>Camera style</h3>
                <span className="eyebrow">{activeCamSpec.name}</span>
              </header>
              <p className="muted small">{activeCamSpec.hint}</p>
            </div>
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
                your fingers; you can add more flowers and crop after shooting.
              </p>
            </div>
          </aside>
        </div>
      ) : (
        <div className="cam">
          <div className="stack">
            {isMultiFrame ? (
              <div className="plate composition-preview">
                <canvas ref={stripPreviewCanvas} aria-label="Multi-frame composition preview" />
                <div className="plate-caption">
                  <span>{CAM_STYLES.find((s) => s.id === edit.camStyle)?.name}</span>
                  <span className="lcd">{frames.length} frames</span>
                </div>
              </div>
            ) : (
              <EditorStage
                photo={photo}
                crop={edit.crop}
                layers={edit.layers}
                activeLayerId={activeLayer?.id ?? null}
                theme={edit.theme}
                date={date}
                onSelectLayer={setActiveLayerId}
                onOverlay={updateActiveOverlay}
              />
            )}

            {editing && !editing.originalUrl && (
              <p className="notice">
                The original of this photo wasn't kept, so edits build on the finished picture.
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
                  Flowers ({edit.layers.length})
                </button>
                <button type="button" aria-pressed={tab === "crop"} onClick={() => setTab("crop")}>
                  Crop
                </button>
                <button type="button" aria-pressed={tab === "look"} onClick={() => setTab("look")}>
                  Style &amp; filter
                </button>
              </div>
            </div>

            {tab === "flower" && (
              <>
                <div className="sheet-section">
                  <header>
                    <h3>Flower layers</h3>
                    <button type="button" className="btn small" onClick={addFlowerLayer}>
                      <IconPlus /> Add flower
                    </button>
                  </header>
                  {edit.layers.length === 0 ? (
                    <p className="muted small">No flowers on this photo yet. Click Add flower to place one.</p>
                  ) : (
                    <div className="stack tight">
                      {edit.layers.map((l, idx) => (
                        <div
                          key={l.id}
                          className={`cam-layer-row${activeLayer?.id === l.id ? " active" : ""}`}
                          onClick={() => setActiveLayerId(l.id)}
                        >
                          <strong style={{ flex: 1, fontSize: 14 }}>
                            {idx + 1}. “{l.recipe.word}”
                          </strong>
                          <button
                            type="button"
                            className="btn small quiet"
                            disabled={idx === 0}
                            onClick={(e) => {
                              e.stopPropagation();
                              moveLayer(idx, -1);
                            }}
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            className="btn small quiet"
                            disabled={idx === edit.layers.length - 1}
                            onClick={(e) => {
                              e.stopPropagation();
                              moveLayer(idx, 1);
                            }}
                          >
                            ↓
                          </button>
                          <button
                            type="button"
                            className="btn icon small quiet danger"
                            aria-label="Remove flower layer"
                            onClick={(e) => {
                              e.stopPropagation();
                              removeLayer(l.id);
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
                      <OverlayControls value={activeLayer.placement} onChange={updateActiveOverlay} />
                    </div>
                    <div className="sheet-section">
                      <header>
                        <h3>Flower for selected layer</h3>
                      </header>
                      <RecipePicker
                        value={activeLayer.recipe}
                        onChange={(recipe) =>
                          history.set(
                            (e) => ({
                              ...e,
                              layers: e.layers.map((l) =>
                                l.id === activeLayer.id ? { ...l, recipe, placement: { ...l.placement, visible: true } } : l,
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
              <div className="sheet-section">
                <header>
                  <h3>Photo crop</h3>
                  <button
                    type="button"
                    className="btn small quiet"
                    onClick={() => history.set((e) => ({ ...e, crop: defaultPhotoCrop() }), true)}
                  >
                    <IconReset /> Default
                  </button>
                </header>
                <div className="chips" role="radiogroup" aria-label="Crop aspect">
                  {CROP_ASPECTS.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      className="chip"
                      role="radio"
                      aria-checked={edit.crop.aspect === a.id}
                      aria-pressed={edit.crop.aspect === a.id}
                      onClick={() => history.set((e) => ({ ...e, crop: { ...e.crop, aspect: a.id } }), true)}
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
                <div className="stack" style={{ marginTop: 8 }}>
                  <Slider
                    label="Top trim"
                    value={edit.crop.top}
                    min={0}
                    max={0.4}
                    step={0.01}
                    format={(v) => `${Math.round(v * 100)}%`}
                    onChange={(top) => history.set((e) => ({ ...e, crop: { ...e.crop, top } }))}
                    onCommit={history.commit}
                  />
                  <Slider
                    label="Bottom trim"
                    value={edit.crop.bottom}
                    min={0}
                    max={0.4}
                    step={0.01}
                    format={(v) => `${Math.round(v * 100)}%`}
                    onChange={(bottom) => history.set((e) => ({ ...e, crop: { ...e.crop, bottom } }))}
                    onCommit={history.commit}
                  />
                  <Slider
                    label="Left trim"
                    value={edit.crop.left}
                    min={0}
                    max={0.4}
                    step={0.01}
                    format={(v) => `${Math.round(v * 100)}%`}
                    onChange={(left) => history.set((e) => ({ ...e, crop: { ...e.crop, left } }))}
                    onCommit={history.commit}
                  />
                  <Slider
                    label="Right trim"
                    value={edit.crop.right}
                    min={0}
                    max={0.4}
                    step={0.01}
                    format={(v) => `${Math.round(v * 100)}%`}
                    onChange={(right) => history.set((e) => ({ ...e, crop: { ...e.crop, right } }))}
                    onCommit={history.commit}
                  />
                </div>
              </div>
            )}

            {tab === "look" && (
              <>
                <div className="sheet-section">
                  <header>
                    <h3>Cam composition style</h3>
                  </header>
                  <div className="chips">
                    {CAM_STYLES.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        className="chip"
                        aria-pressed={edit.camStyle === s.id}
                        onClick={() => {
                          history.set(
                            (e) => ({
                              ...e,
                              camStyle: s.id,
                              crop: s.aspect ? { ...e.crop, aspect: s.aspect } : e.crop,
                              theme: { ...defaultSettings(s.preset), frame: s.frame, dateStamp: s.dateStamp },
                            }),
                            true,
                          );
                        }}
                      >
                        {s.name}
                      </button>
                    ))}
                  </div>
                  {isMultiFrame && (
                    <div className="stack tight" style={{ marginTop: 10 }}>
                      <span className="label">Frames ({frames.length}/6)</span>
                      <div className="btn-row">
                        <button
                          type="button"
                          className="btn small"
                          disabled={frames.length >= 6}
                          onClick={() => addFrameInput.current?.click()}
                        >
                          <IconUpload /> Add photo frame
                        </button>
                        <button
                          type="button"
                          className="btn small quiet"
                          disabled={frames.length >= 6}
                          onClick={() => setFrames((list) => [...list, list[list.length - 1]])}
                        >
                          <IconPlus /> Duplicate frame
                        </button>
                        {frames.length > 1 && (
                          <button
                            type="button"
                            className="btn small quiet danger"
                            onClick={() => setFrames((list) => list.slice(0, -1))}
                          >
                            Remove last
                          </button>
                        )}
                      </div>
                      <input
                        ref={addFrameInput}
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        hidden
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          e.target.value = "";
                          void addExtraFrame(file);
                        }}
                      />
                    </div>
                  )}
                </div>

                <div className="sheet-section">
                  <ThemeGallery
                    source={themeSource}
                    value={edit.theme}
                    caption={edit.layers[0]?.recipe.word}
                    onChange={(theme, commit) => history.set((e) => ({ ...e, theme }), commit)}
                  />
                </div>
              </>
            )}
          </aside>
        </div>
      )}

      {preview && photo && (
        <SaveDialog
          heading={editing ? "Save your changes" : "Save to your journal"}
          preview={preview}
          defaultTitle={editing?.title ?? edit.layers[0]?.recipe.word ?? "A photograph"}
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
