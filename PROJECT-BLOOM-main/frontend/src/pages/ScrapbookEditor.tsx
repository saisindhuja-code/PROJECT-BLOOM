/**
 * Bloom 2.0 Digital Scrapbook Editor:
 * - 4 visual page styles (Pressed Herbarium, Kraft & Letters, Midnight Folio, Pastel Keepsake)
 * - Elements: multi-photos (with Polaroid/torn/taped frames), pressed flowers,
 *   built-in & user-uploaded reusable stickers, washi tape, stamps, labels
 *   (handwritten/serif/display/mono fonts), doodles, paper scraps
 * - Freehand pen drawing tool
 * - Drag & drop, resize, rotate, layer reorder, undo/redo & automatic saving
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlbumPicker } from "../components/AlbumPicker";
import {
  IconArrowLeft,
  IconDownload,
  IconEdit,
  IconFlower,
  IconImage,
  IconRedo,
  IconTrash,
  IconUndo,
  IconUpload,
} from "../components/Icons";
import { Loading, Slider } from "../components/ui";
import { canvasToBlob, downloadBlob, safeFileName } from "../flower/render";
import { useHistory } from "../hooks/useHistory";
import { errorMessage, fetchImage, mediaUrl, uploadImage } from "../lib/api";
import { localUid } from "../lib/ids";
import * as local from "../lib/localdb";
import { Link, useRouter } from "../lib/router";
import {
  BUILTIN_STICKERS,
  SCRAPBOOK_STYLES,
  WASHI_COLORS,
  defaultScrapbookDoc,
  normalizeScrapbookDoc,
  renderScrapbookToCanvas,
  scrapbookStyleById,
  type DoodleId,
  type PhotoFrameStyle,
  type ScrapbookDoc,
  type ScrapbookElement,
  type ScrapbookFont,
  type ScrapbookStroke,
  type ScrapbookStyleId,
} from "../lib/scrapbook";
import { useSession } from "../lib/session";
import { localBlobUrl, storeFor, type SavedDesign, type UserSticker, type Visibility } from "../lib/store";

const DOODLES: Array<{ id: DoodleId; label: string }> = [
  { id: "heart", label: "Heart" },
  { id: "sparkle", label: "Sparkle" },
  { id: "leaf", label: "Leaf" },
  { id: "swirl", label: "Swirl" },
  { id: "moon", label: "Moon" },
  { id: "star", label: "Star" },
];

const FONTS: Array<{ id: ScrapbookFont; label: string }> = [
  { id: "hand", label: "Handwritten" },
  { id: "serif", label: "Editorial" },
  { id: "display", label: "Romantic" },
  { id: "mono", label: "Typewriter" },
];

const FRAMES: Array<{ id: PhotoFrameStyle; label: string }> = [
  { id: "polaroid", label: "Polaroid" },
  { id: "torn", label: "Torn edge" },
  { id: "taped", label: "Washi taped" },
  { id: "none", label: "Plain" },
];

export function ScrapbookEditorPage({ id }: { id?: string }) {
  const { store: sessionStore, recipe: studioRecipe, toast } = useSession();
  const store = id ? storeFor(id, sessionStore) : sessionStore;
  const { navigate } = useRouter();

  const [entryId, setEntryId] = useState<string | undefined>(id);
  const [loading, setLoading] = useState(Boolean(id));
  const [title, setTitle] = useState("Untitled page");
  const [caption, setCaption] = useState("");
  const [notes, setNotes] = useState("");
  const [albumIds, setAlbumIds] = useState<string[]>([]);
  const [visibility, setVisibility] = useState<Visibility>("private");

  const history = useHistory<ScrapbookDoc>(defaultScrapbookDoc());
  const doc = history.value;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tool, setTool] = useState<"select" | "draw">("select");
  const [penColor, setPenColor] = useState("#4a2a22");
  const [penWidth, setPenWidth] = useState(4);
  const [activeTab, setActiveTab] = useState<"add" | "edit" | "page">("add");

  const [designs, setDesigns] = useState<SavedDesign[]>([]);
  const [userStickers, setUserStickers] = useState<UserSticker[]>([]);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "unsaved">("saved");
  const [hydrated, setHydrated] = useState(!id);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const stickerInput = useRef<HTMLInputElement>(null);
  const imageCache = useRef<Map<string, HTMLImageElement>>(new Map());
  const activeStrokeRef = useRef<ScrapbookStroke | null>(null);
  const dragRef = useRef<{
    id: string;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  } | null>(null);

  useEffect(() => {
    store.listDesigns().then(setDesigns).catch(() => undefined);
    store.listStickers().then(setUserStickers).catch(() => undefined);
  }, [store]);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    store
      .getEntry(id)
      .then((entry) => {
        if (cancelled) return;
        setEntryId(entry.id);
        setTitle(entry.title || "Untitled page");
        setCaption(entry.caption);
        setNotes(entry.notes);
        setAlbumIds(entry.album_ids);
        setVisibility(entry.visibility);
        const restored = entry.scrapbook_doc ? normalizeScrapbookDoc(entry.scrapbook_doc) : defaultScrapbookDoc();
        history.reset(restored);
        setPenColor(scrapbookStyleById(restored.style).ink);
        setHydrated(true);
      })
      .catch((e) => {
        toast(errorMessage(e), "error");
        navigate("/journal");
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, store]);

  const loadImage = useCallback(async (el: ScrapbookElement): Promise<HTMLImageElement | null> => {
    const key = el.mediaId ? `m:${el.mediaId}` : el.localBlobId ? `b:${el.localBlobId}` : el.url ?? "";
    if (!key) return null;
    const cached = imageCache.current.get(key);
    if (cached) return cached;

    let srcUrl = el.url ?? null;
    if (el.mediaId && !srcUrl) srcUrl = mediaUrl(`/api/media/${el.mediaId}`);
    if (el.localBlobId && !srcUrl) srcUrl = await localBlobUrl(el.localBlobId);
    if (!srcUrl) return null;

    try {
      const img = srcUrl.startsWith("blob:")
        ? await new Promise<HTMLImageElement>((resolve, reject) => {
            const i = new Image();
            i.onload = () => resolve(i);
            i.onerror = () => reject(new Error("Image load failed"));
            i.src = srcUrl!;
          })
        : await fetchImage(srcUrl);
      imageCache.current.set(key, img);
      return img;
    } catch {
      return null;
    }
  }, []);

  // Render live scrapbook preview + selection box
  useEffect(() => {
    let cancelled = false;
    const draw = async () => {
      const rendered = await renderScrapbookToCanvas(doc, loadImage, 900, 1200);
      if (cancelled) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = rendered.width;
      canvas.height = rendered.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(rendered, 0, 0);

      if (selectedId && tool === "select") {
        const el = doc.elements.find((item) => item.id === selectedId);
        if (el) {
          const px = el.x * canvas.width;
          const py = el.y * canvas.height;
          const ew = el.w * canvas.width;
          const eh = ew * 0.75;
          ctx.save();
          ctx.translate(px, py);
          ctx.rotate((el.rotation * Math.PI) / 180);
          ctx.strokeStyle = "#ff3ea5";
          ctx.lineWidth = 2;
          ctx.setLineDash([6, 4]);
          ctx.strokeRect(-ew / 2 - 6, -eh / 2 - 6, ew + 12, eh + 12);
          ctx.restore();
        }
      }
    };
    const timer = window.setTimeout(() => void draw(), 30);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [doc, selectedId, tool, loadImage]);

  const persistPage = useCallback(
    async (silent = false) => {
      setSaveState("saving");
      try {
        const rendered = await renderScrapbookToCanvas(doc, loadImage, 1200, 1600);
        const snapBlob = await canvasToBlob(rendered, "image/jpeg", 0.9);
        const cleanDoc: ScrapbookDoc = {
          ...doc,
          elements: doc.elements.map(({ url: _u, ...rest }) => rest),
        };
        if (entryId) {
          await store.updateEntry(entryId, {
            title: title.trim() || "Scrapbook page",
            caption,
            notes,
            photo: snapBlob,
            scrapbook_doc: cleanDoc,
            album_ids: albumIds,
            visibility,
          });
        } else {
          const created = await store.createEntry({
            entry_type: "scrapbook",
            title: title.trim() || "Scrapbook page",
            caption,
            notes,
            photo: snapBlob,
            scrapbook_doc: cleanDoc,
            album_ids: albumIds,
            visibility,
          });
          setEntryId(created.id);
          navigate(`/scrapbook/${created.id}`, { replace: true });
        }
        setSaveState("saved");
        if (!silent) toast("Scrapbook page saved.");
      } catch (e) {
        setSaveState("unsaved");
        if (!silent) toast(errorMessage(e), "error");
      }
    },
    [doc, loadImage, entryId, store, title, caption, notes, albumIds, visibility, navigate, toast],
  );

  // Automatic layout save after edits when already created (or after first element added)
  useEffect(() => {
    if (!hydrated) return;
    if (!entryId && doc.elements.length === 0 && doc.strokes.length === 0) return;
    setSaveState("unsaved");
    const timer = window.setTimeout(() => {
      void persistPage(true);
    }, 1800);
    return () => window.clearTimeout(timer);
  }, [doc, title, caption, notes, albumIds, visibility, hydrated, entryId, persistPage]);

  const addElement = (el: Omit<ScrapbookElement, "id" | "x" | "y" | "rotation"> & { x?: number; y?: number; rotation?: number }) => {
    const newId = localUid();
    const offset = (doc.elements.length % 5) * 0.04;
    const item: ScrapbookElement = {
      id: newId,
      x: el.x ?? 0.44 + offset,
      y: el.y ?? 0.42 + offset,
      rotation: el.rotation ?? ((doc.elements.length % 3) - 1) * 4,
      ...el,
    };
    history.set((d) => ({ ...d, elements: [...d.elements, item] }), true);
    setSelectedId(newId);
    setTool("select");
    setActiveTab("edit");
  };

  const selectedElement = useMemo(
    () => doc.elements.find((e) => e.id === selectedId) ?? null,
    [doc.elements, selectedId],
  );

  const updateSelected = (patch: Partial<ScrapbookElement>, commit = false) => {
    if (!selectedId) return;
    history.set(
      (d) => ({
        ...d,
        elements: d.elements.map((e) => (e.id === selectedId ? { ...e, ...patch } : e)),
      }),
      commit,
    );
  };

  const moveSelectedLayer = (delta: -1 | 1) => {
    if (!selectedId) return;
    const idx = doc.elements.findIndex((e) => e.id === selectedId);
    const target = idx + delta;
    if (idx < 0 || target < 0 || target >= doc.elements.length) return;
    history.set((d) => {
      const next = [...d.elements];
      const [item] = next.splice(idx, 1);
      next.splice(target, 0, item);
      return { ...d, elements: next };
    }, true);
  };

  const removeSelected = () => {
    if (!selectedId) return;
    history.set((d) => ({ ...d, elements: d.elements.filter((e) => e.id !== selectedId) }), true);
    setSelectedId(null);
  };

  const uploadPhotoElement = async (file: File | undefined) => {
    if (!file) return;
    try {
      if (store.kind === "server") {
        const media = await uploadImage(file, "photo", file.name);
        addElement({ kind: "photo", w: 0.42, mediaId: media.id, url: mediaUrl(media.url)!, frame: "polaroid", caption: "" });
      } else {
        const blobId = await local.putBlob(file);
        const url = await localBlobUrl(blobId);
        addElement({ kind: "photo", w: 0.42, localBlobId: blobId, url: url ?? undefined, frame: "polaroid", caption: "" });
      }
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  const uploadUserSticker = async (file: File | undefined) => {
    if (!file) return;
    try {
      const created = await store.createSticker(file, file.name.replace(/\.[^.]+$/, ""));
      setUserStickers((list) => [created, ...list]);
      addElement({ kind: "user-sticker", w: 0.22, mediaId: created.media_id, url: created.url });
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  const deleteUserSticker = async (stk: UserSticker) => {
    try {
      await store.deleteSticker(stk.id);
      setUserStickers((list) => list.filter((s) => s.id !== stk.id));
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  const canvasCoords = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      nx: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
      ny: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
    };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const { nx, ny } = canvasCoords(e);
    e.currentTarget.setPointerCapture(e.pointerId);

    if (tool === "draw") {
      const stroke: ScrapbookStroke = { id: localUid(), color: penColor, width: penWidth, points: [[nx, ny]] };
      activeStrokeRef.current = stroke;
      history.set((d) => ({ ...d, strokes: [...d.strokes, stroke] }), false);
      return;
    }

    // Hit-test topmost element near click point
    for (let i = doc.elements.length - 1; i >= 0; i--) {
      const el = doc.elements[i];
      const halfW = el.w / 2;
      const halfH = (el.w * 0.75) / 2;
      if (Math.abs(nx - el.x) <= halfW && Math.abs(ny - el.y) <= halfH) {
        setSelectedId(el.id);
        setActiveTab("edit");
        dragRef.current = { id: el.id, startX: nx, startY: ny, origX: el.x, origY: el.y };
        return;
      }
    }
    setSelectedId(null);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const { nx, ny } = canvasCoords(e);
    if (tool === "draw" && activeStrokeRef.current) {
      const targetId = activeStrokeRef.current.id;
      activeStrokeRef.current.points.push([nx, ny]);
      history.set(
        (d) => ({
          ...d,
          strokes: d.strokes.map((s) => (s.id === targetId ? { ...s, points: [...s.points, [nx, ny]] } : s)),
        }),
        false,
      );
      return;
    }
    if (dragRef.current) {
      const { id: dragId, startX, startY, origX, origY } = dragRef.current;
      const dx = nx - startX;
      const dy = ny - startY;
      history.set(
        (d) => ({
          ...d,
          elements: d.elements.map((el) =>
            el.id === dragId ? { ...el, x: Math.min(0.98, Math.max(0.02, origX + dx)), y: Math.min(0.98, Math.max(0.02, origY + dy)) } : el,
          ),
        }),
        false,
      );
    }
  };

  const onPointerUp = () => {
    if (activeStrokeRef.current) {
      activeStrokeRef.current = null;
      history.commit();
    }
    if (dragRef.current) {
      dragRef.current = null;
      history.commit();
    }
  };

  const exportPng = async () => {
    const rendered = await renderScrapbookToCanvas(doc, loadImage, 1500, 2000);
    downloadBlob(await canvasToBlob(rendered, "image/png"), `scrapbook-${safeFileName(title)}.png`);
  };

  if (loading) {
    return (
      <main className="page">
        <Loading label="Opening scrapbook page" />
      </main>
    );
  }

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <Link to="/journal" className="btn small quiet">
            <IconArrowLeft /> Journal
          </Link>
          <h1 style={{ marginTop: 8 }}>
            Scrapbook <span className="flourish">editor</span>
          </h1>
        </div>
        <div className="btn-row">
          <span className={`status-pill ${saveState === "saved" ? "ok" : "warn"}`}>
            <span className="dot" /> {saveState === "saved" ? "SAVED" : saveState === "saving" ? "SAVING…" : "UNSAVED"}
          </span>
          <button type="button" className="btn icon quiet" onClick={history.undo} disabled={!history.canUndo} title="Undo">
            <IconUndo />
          </button>
          <button type="button" className="btn icon quiet" onClick={history.redo} disabled={!history.canRedo} title="Redo">
            <IconRedo />
          </button>
          <button type="button" className="btn small" onClick={() => void exportPng()}>
            <IconDownload /> PNG
          </button>
          <button type="button" className="btn small primary" onClick={() => void persistPage(false)}>
            Save page
          </button>
        </div>
      </div>

      <div className="scrapbook-workspace">
        <div className="stack">
          <div className="scrapbook-toolbar">
            <div className="segmented" role="group" aria-label="Tool">
              <button type="button" aria-pressed={tool === "select"} onClick={() => setTool("select")}>
                Arrange elements
              </button>
              <button type="button" aria-pressed={tool === "draw"} onClick={() => setTool("draw")}>
                <IconEdit width={14} height={14} /> Freehand draw
              </button>
            </div>
            {tool === "draw" && (
              <div className="row" style={{ gap: 10 }}>
                <input type="color" value={penColor} onChange={(e) => setPenColor(e.target.value)} aria-label="Pen color" />
                <div style={{ width: 120 }}>
                  <Slider label="Pen" value={penWidth} min={1} max={12} step={1} onChange={setPenWidth} />
                </div>
                {doc.strokes.length > 0 && (
                  <button
                    type="button"
                    className="btn small quiet danger"
                    onClick={() => history.set((d) => ({ ...d, strokes: d.strokes.slice(0, -1) }), true)}
                  >
                    Undo stroke
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="scrapbook-canvas-wrap">
            <canvas
              ref={canvasRef}
              className="scrapbook-canvas"
              style={{ cursor: tool === "draw" ? "crosshair" : "grab" }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            />
          </div>
        </div>

        <aside className="sheet">
          <div className="sheet-section">
            <div className="segmented" role="group" aria-label="Scrapbook inspector">
              <button type="button" aria-pressed={activeTab === "add"} onClick={() => setActiveTab("add")}>
                Add items
              </button>
              <button type="button" aria-pressed={activeTab === "edit"} onClick={() => setActiveTab("edit")}>
                Selected
              </button>
              <button type="button" aria-pressed={activeTab === "page"} onClick={() => setActiveTab("page")}>
                Page &amp; style
              </button>
            </div>
          </div>

          {activeTab === "add" && (
            <>
              <div className="sheet-section">
                <header>
                  <h3>Photos &amp; flowers</h3>
                </header>
                <div className="btn-row">
                  <button type="button" className="btn small primary" onClick={() => photoInput.current?.click()}>
                    <IconImage /> Add photo
                  </button>
                  <button
                    type="button"
                    className="btn small"
                    onClick={() => addElement({ kind: "flower", w: 0.3, recipe: studioRecipe })}
                  >
                    <IconFlower /> Studio flower
                  </button>
                </div>
                <input
                  ref={photoInput}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  hidden
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    void uploadPhotoElement(file);
                  }}
                />
                {designs.length > 0 && (
                  <div className="chips" style={{ marginTop: 8 }}>
                    {designs.slice(0, 6).map((d) => (
                      <button
                        key={d.id}
                        type="button"
                        className="chip"
                        onClick={() => addElement({ kind: "flower", w: 0.28, recipe: d.recipe })}
                      >
                        + {d.title}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="sheet-section">
                <header>
                  <h3>Washi tape, labels &amp; scraps</h3>
                </header>
                <div className="btn-row">
                  <button
                    type="button"
                    className="btn small"
                    onClick={() => addElement({ kind: "washi", w: 0.28, color: WASHI_COLORS[0].color, pattern: "stripe" })}
                  >
                    + Washi tape
                  </button>
                  <button
                    type="button"
                    className="btn small"
                    onClick={() => addElement({ kind: "label", w: 0.34, text: "A little memory", font: "hand" })}
                  >
                    + Label
                  </button>
                  <button
                    type="button"
                    className="btn small"
                    onClick={() => addElement({ kind: "stamp", w: 0.22, text: "BLOOM 2026" })}
                  >
                    + Stamp
                  </button>
                  <button
                    type="button"
                    className="btn small"
                    onClick={() => addElement({ kind: "scrap", w: 0.38, bgColor: "#efe4d4" })}
                  >
                    + Paper scrap
                  </button>
                </div>
              </div>

              <div className="sheet-section">
                <header>
                  <h3>Doodles</h3>
                </header>
                <div className="chips">
                  {DOODLES.map((d) => (
                    <button
                      key={d.id}
                      type="button"
                      className="chip"
                      onClick={() => addElement({ kind: "doodle", w: 0.14, doodleId: d.id, color: scrapbookStyleById(doc.style).accent })}
                    >
                      + {d.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="sheet-section">
                <header>
                  <h3>Stickers</h3>
                  <button type="button" className="btn small quiet" onClick={() => stickerInput.current?.click()}>
                    <IconUpload /> Upload own
                  </button>
                </header>
                <input
                  ref={stickerInput}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  hidden
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    void uploadUserSticker(file);
                  }}
                />
                <div className="chips">
                  {BUILTIN_STICKERS.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      className="chip"
                      onClick={() => addElement({ kind: "sticker", w: 0.2, stickerId: s.id })}
                    >
                      + {s.label}
                    </button>
                  ))}
                </div>
                {userStickers.length > 0 && (
                  <div className="sticker-grid" style={{ marginTop: 10 }}>
                    {userStickers.map((stk) => (
                      <div key={stk.id} className="sticker-btn">
                        <button
                          type="button"
                          style={{ background: "none", border: "none", padding: 0, cursor: "pointer" }}
                          onClick={() => addElement({ kind: "user-sticker", w: 0.22, mediaId: stk.media_id, url: stk.url })}
                        >
                          <img src={stk.url} alt={stk.name} style={{ width: 52, height: 52, objectFit: "contain" }} />
                        </button>
                        <button
                          type="button"
                          className="btn icon small quiet danger"
                          aria-label={`Delete ${stk.name}`}
                          onClick={() => void deleteUserSticker(stk)}
                        >
                          <IconTrash width={12} height={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}

          {activeTab === "edit" && (
            <div className="sheet-section">
              {!selectedElement ? (
                <p className="muted small">Tap any element on the page to move, resize, rotate, or customize it.</p>
              ) : (
                <div className="stack">
                  <header className="row between">
                    <h3>{selectedElement.kind}</h3>
                    <div className="btn-row">
                      <button type="button" className="btn small quiet" onClick={() => moveSelectedLayer(-1)}>Back</button>
                      <button type="button" className="btn small quiet" onClick={() => moveSelectedLayer(1)}>Front</button>
                      <button type="button" className="btn small quiet danger" onClick={removeSelected}>
                        <IconTrash />
                      </button>
                    </div>
                  </header>

                  <Slider
                    label="Size"
                    value={selectedElement.w}
                    min={0.08}
                    max={0.9}
                    step={0.01}
                    format={(v) => `${Math.round(v * 100)}%`}
                    onChange={(w) => updateSelected({ w })}
                    onCommit={history.commit}
                  />
                  <Slider
                    label="Rotation"
                    value={selectedElement.rotation}
                    min={-180}
                    max={180}
                    step={1}
                    format={(v) => `${Math.round(v)}°`}
                    onChange={(rotation) => updateSelected({ rotation })}
                    onCommit={history.commit}
                  />

                  {selectedElement.kind === "photo" && (
                    <>
                      <div className="stack tight">
                        <span className="label">Photo frame</span>
                        <div className="chips">
                          {FRAMES.map((f) => (
                            <button
                              key={f.id}
                              type="button"
                              className="chip"
                              aria-pressed={(selectedElement.frame ?? "polaroid") === f.id}
                              onClick={() => updateSelected({ frame: f.id }, true)}
                            >
                              {f.label}
                            </button>
                          ))}
                        </div>
                      </div>
                      {(selectedElement.frame ?? "polaroid") === "polaroid" && (
                        <label className="field">
                          <span>Polaroid caption</span>
                          <input
                            type="text"
                            value={selectedElement.caption ?? ""}
                            maxLength={60}
                            onChange={(e) => updateSelected({ caption: e.target.value }, false)}
                            onBlur={history.commit}
                          />
                        </label>
                      )}
                    </>
                  )}

                  {(selectedElement.kind === "label" || selectedElement.kind === "stamp") && (
                    <>
                      <label className="field">
                        <span>Text</span>
                        <input
                          type="text"
                          value={selectedElement.text ?? ""}
                          maxLength={80}
                          onChange={(e) => updateSelected({ text: e.target.value }, false)}
                          onBlur={history.commit}
                        />
                      </label>
                      {selectedElement.kind === "label" && (
                        <div className="chips">
                          {FONTS.map((f) => (
                            <button
                              key={f.id}
                              type="button"
                              className="chip"
                              aria-pressed={(selectedElement.font ?? "hand") === f.id}
                              onClick={() => updateSelected({ font: f.id }, true)}
                            >
                              {f.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </>
                  )}

                  {selectedElement.kind === "washi" && (
                    <>
                      <div className="chips">
                        {WASHI_COLORS.map((wc) => (
                          <button
                            key={wc.label}
                            type="button"
                            className="chip"
                            aria-pressed={selectedElement.color === wc.color}
                            onClick={() => updateSelected({ color: wc.color }, true)}
                          >
                            {wc.label}
                          </button>
                        ))}
                      </div>
                      <div className="chips">
                        {(["solid", "stripe", "dots"] as const).map((pat) => (
                          <button
                            key={pat}
                            type="button"
                            className="chip"
                            aria-pressed={(selectedElement.pattern ?? "stripe") === pat}
                            onClick={() => updateSelected({ pattern: pat }, true)}
                          >
                            {pat}
                          </button>
                        ))}
                      </div>
                    </>
                  )}

                  {(selectedElement.kind === "doodle" || selectedElement.kind === "stamp" || selectedElement.kind === "label") && (
                    <label className="field">
                      <span>Ink color</span>
                      <input
                        type="color"
                        value={selectedElement.color ?? scrapbookStyleById(doc.style).ink}
                        onChange={(e) => updateSelected({ color: e.target.value }, true)}
                      />
                    </label>
                  )}

                  {(selectedElement.kind === "label" || selectedElement.kind === "scrap") && (
                    <label className="field">
                      <span>Paper color</span>
                      <input
                        type="color"
                        value={selectedElement.bgColor ?? "#efe4d4"}
                        onChange={(e) => updateSelected({ bgColor: e.target.value }, true)}
                      />
                    </label>
                  )}
                </div>
              )}
            </div>
          )}

          {activeTab === "page" && (
            <>
              <div className="sheet-section">
                <header>
                  <h3>Scrapbook visual style</h3>
                </header>
                <div className="stack tight">
                  {SCRAPBOOK_STYLES.map((st) => (
                    <button
                      key={st.id}
                      type="button"
                      className={`cam-layer-row${doc.style === st.id ? " active" : ""}`}
                      onClick={() => {
                        history.set((d) => ({ ...d, style: st.id as ScrapbookStyleId }), true);
                        setPenColor(st.ink);
                      }}
                    >
                      <span style={{ width: 22, height: 22, borderRadius: "50%", background: st.paper, border: `2px solid ${st.accent}` }} />
                      <div style={{ textAlign: "left", flex: 1 }}>
                        <strong style={{ display: "block", fontSize: 13.5 }}>{st.name}</strong>
                        <span className="muted small">{st.tagline}</span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
              <div className="sheet-section">
                <label className="field">
                  <span>Page title</span>
                  <input type="text" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
                </label>
                <label className="field">
                  <span>Caption</span>
                  <input type="text" value={caption} maxLength={500} onChange={(e) => setCaption(e.target.value)} />
                </label>
                <label className="field">
                  <span>Notes</span>
                  <textarea value={notes} maxLength={10000} rows={3} onChange={(e) => setNotes(e.target.value)} />
                </label>
                <AlbumPicker value={albumIds} onChange={setAlbumIds} />
                {store.kind === "server" && (
                  <label className="field">
                    <span>Who can see this page</span>
                    <select value={visibility} onChange={(e) => setVisibility(e.target.value as Visibility)}>
                      <option value="private">Private (only me)</option>
                      <option value="friends">Friends</option>
                      <option value="public">Public profile</option>
                    </select>
                  </label>
                )}
              </div>
            </>
          )}
        </aside>
      </div>
    </main>
  );
}
