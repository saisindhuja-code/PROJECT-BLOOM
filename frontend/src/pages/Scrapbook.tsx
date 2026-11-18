/**
 * Phase 7: Bloom Journal Scrapbook Studio & Editor (`/scrapbook` and `/scrapbook/:id`)
 * Interactive multi-layer canvas supporting:
 *   - Background paper styles (cream, kraft, midnight, dot-grid, lined)
 *   - Photo layers (from device or existing journal entries)
 *   - Bloom Flower layers (using flowerSticker)
 *   - Botanical & Washi stickers
 *   - Handwritten/Editorial text notes
 *   - Freehand brush drawing with undo/redo & pressure-smooth paths
 *   - Layer list (reorder up/down, visibility, lock, opacity, remove)
 * Saves full editable scrapbook JSON into `edit_state.scrapbook` so entries reopen cleanly!
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  IconArrowLeft,
  IconDownload,
  IconFlower,
  IconJournal,
  IconLayers,
  IconPlus,
  IconRedo,
  IconTrash,
  IconUndo,
  IconUpload,
} from "../components/Icons";
import { Loading } from "../components/ui";
import { defaultRecipe, normalizeRecipe, type FlowerRecipe } from "../flower/recipe";
import { canvasToBlob, downloadBlob, flowerSticker } from "../flower/render";
import { blobToImage } from "../lib/api";
import { localUid } from "../lib/ids";
import { Link, useRouter } from "../lib/router";
import { useSession } from "../lib/session";
import { storeFor, type JournalEntry } from "../lib/store";

type PaperId = "cream" | "kraft" | "midnight" | "grid" | "lined";

interface PaperSpec {
  id: PaperId;
  name: string;
  bg: string;
  ink: string;
  accent: string;
}

const PAPERS: PaperSpec[] = [
  { id: "cream", name: "Warm Cream", bg: "#f6efe2", ink: "#2a1b24", accent: "#c96f8b" },
  { id: "kraft", name: "Botanical Kraft", bg: "#d9c2a3", ink: "#2b1d14", accent: "#527853" },
  { id: "midnight", name: "Midnight Velvet", bg: "#180f20", ink: "#f6ece1", accent: "#e7a3b5" },
  { id: "grid", name: "Studio Grid", bg: "#f4efe8", ink: "#26202b", accent: "#7b8fa3" },
  { id: "lined", name: "Letter Page", bg: "#fbf7ef", ink: "#2c2228", accent: "#b88491" },
];

const STICKERS = [
  { id: "washi-rose", label: "Washi Rose", glyph: "▬", color: "#e7a3b5" },
  { id: "washi-sage", label: "Washi Sage", glyph: "▬", color: "#9db39a" },
  { id: "wax-seal", label: "Wax Seal", glyph: "❦", color: "#a4384c" },
  { id: "pressed-leaf", label: "Pressed Leaf", glyph: "🌿", color: "#4e704c" },
  { id: "sparkle", label: "Sparkle", glyph: "✦", color: "#e6b85c" },
  { id: "blossom", label: "Blossom", glyph: "✿", color: "#d96b8f" },
  { id: "heart", label: "Heart Stamp", glyph: "♡", color: "#d96b8f" },
  { id: "moon", label: "Crescent", glyph: "☾", color: "#8e7ab5" },
];

interface BaseLayer {
  id: string;
  name: string;
  x: number; // 0..1 of canvas width
  y: number; // 0..1 of canvas height
  scale: number;
  rotation: number; // degrees
  opacity: number;
  visible: boolean;
  locked: boolean;
}

type ScrapLayer =
  | (BaseLayer & { kind: "flower"; recipe: FlowerRecipe })
  | (BaseLayer & { kind: "photo"; src: string })
  | (BaseLayer & { kind: "sticker"; stickerId: string; glyph: string; color: string })
  | (BaseLayer & { kind: "text"; text: string; color: string; font: "serif" | "hand" | "mono" });

interface InkStroke {
  id: string;
  color: string;
  width: number;
  points: Array<[number, number]>;
}

interface ScrapbookDoc {
  paper: PaperId;
  title: string;
  layers: ScrapLayer[];
  strokes: InkStroke[];
}

const CANVAS_W = 1200;
const CANVAS_H = 1500;

export function ScrapbookPage({ id }: { id?: string }) {
  const { store, toast, recipe: studioRecipe, hasFlower } = useSession();
  const { navigate, query } = useRouter();
  const entryId = id || undefined;
  const fromId = query.get("from");

  const [loading, setLoading] = useState(Boolean(entryId || fromId));
  const [editingEntry, setEditingEntry] = useState<JournalEntry | null>(null);
  const [doc, setDoc] = useState<ScrapbookDoc>(() => ({
    paper: "cream",
    title: hasFlower ? `${studioRecipe.word} notes` : "My Bloom Scrapbook",
    layers: hasFlower
      ? [
          {
            id: localUid(),
            name: `Flower · ${studioRecipe.word}`,
            kind: "flower",
            recipe: studioRecipe,
            x: 0.5,
            y: 0.44,
            scale: 1,
            rotation: -4,
            opacity: 1,
            visible: true,
            locked: false,
          },
          {
            id: localUid(),
            name: "Note",
            kind: "text",
            text: `grown from “${studioRecipe.word}”`,
            color: "#3d2733",
            font: "serif",
            x: 0.5,
            y: 0.84,
            scale: 1,
            rotation: 0,
            opacity: 1,
            visible: true,
            locked: false,
          },
        ]
      : [],
    strokes: [],
  }));
  const [undoStack, setUndoStack] = useState<ScrapbookDoc[]>([]);
  const [redoStack, setRedoStack] = useState<ScrapbookDoc[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(doc.layers[0]?.id ?? null);
  const [tool, setTool] = useState<"move" | "draw">("move");
  const [brushColor, setBrushColor] = useState("#c96f8b");
  const [brushWidth, setBrushWidth] = useState(6);
  const [saving, setSaving] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const loadedImages = useRef<Map<string, HTMLImageElement>>(new Map());
  const dragRef = useRef<
    | { mode: "layer"; id: string; startX: number; startY: number; origX: number; origY: number }
    | { mode: "draw"; strokeId: string }
    | null
  >(null);

  const commitDoc = (updater: (prev: ScrapbookDoc) => ScrapbookDoc) => {
    setDoc((prev) => {
      setUndoStack((u) => [...u.slice(-24), prev]);
      setRedoStack([]);
      return updater(prev);
    });
  };

  const undo = () => {
    if (undoStack.length === 0) return;
    const previous = undoStack[undoStack.length - 1];
    setRedoStack((r) => [...r, doc]);
    setUndoStack((u) => u.slice(0, -1));
    setDoc(previous);
  };

  const redo = () => {
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    setUndoStack((u) => [...u, doc]);
    setRedoStack((r) => r.slice(0, -1));
    setDoc(next);
  };

  // Load existing scrapbook entry or seed from another entry (?from=...)
  useEffect(() => {
    const targetId = entryId || fromId;
    if (!targetId) return;
    let cancelled = false;
    storeFor(targetId, store)
      .getEntry(targetId)
      .then(async (entry) => {
        if (cancelled) return;
        const state = entry.edit_state?.scrapbook as Partial<ScrapbookDoc> | undefined;
        if (entryId && state && Array.isArray(state.layers)) {
          setEditingEntry(entry);
          setDoc({
            paper: state.paper ?? "cream",
            title: state.title || entry.title || "Scrapbook page",
            layers: state.layers.map((l) =>
              l.kind === "flower" ? { ...l, recipe: normalizeRecipe(l.recipe) } : l,
            ),
            strokes: Array.isArray(state.strokes) ? state.strokes : [],
          });
          setSelectedId(state.layers[0]?.id ?? null);
        } else {
          // Seed new scrapbook page from ?from=entry
          const seedLayers: ScrapLayer[] = [];
          if (entry.photoUrl) {
            seedLayers.push({
              id: localUid(),
              name: entry.title || "Photo",
              kind: "photo",
              src: entry.photoUrl,
              x: 0.5,
              y: 0.44,
              scale: 0.9,
              rotation: -2,
              opacity: 1,
              visible: true,
              locked: false,
            });
          }
          if (entry.recipe) {
            seedLayers.push({
              id: localUid(),
              name: `Flower · ${entry.recipe.word}`,
              kind: "flower",
              recipe: entry.recipe,
              x: 0.68,
              y: 0.58,
              scale: 0.72,
              rotation: 6,
              opacity: 1,
              visible: true,
              locked: false,
            });
          }
          setDoc({
            paper: "cream",
            title: entry.title ? `${entry.title} scrapbook` : "Scrapbook page",
            layers: seedLayers,
            strokes: [],
          });
          setSelectedId(seedLayers[0]?.id ?? null);
        }
      })
      .catch((e) => toast(e instanceof Error ? e.message : "Could not open entry.", "error"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [entryId, fromId, store, toast]);

  // Preload photo sources
  useEffect(() => {
    doc.layers.forEach((l) => {
      if (l.kind === "photo" && !loadedImages.current.has(l.src)) {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
          loadedImages.current.set(l.src, img);
          drawScene();
        };
        img.src = l.src;
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.layers]);

  const drawScene = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = CANVAS_W;
    canvas.height = CANVAS_H;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const paper = PAPERS.find((p) => p.id === doc.paper) ?? PAPERS[0];
    ctx.fillStyle = paper.bg;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // Subtle paper textures / rulings
    if (doc.paper === "grid") {
      ctx.fillStyle = "rgba(90, 90, 120, 0.16)";
      for (let x = 40; x < CANVAS_W; x += 40) {
        for (let y = 40; y < CANVAS_H; y += 40) {
          ctx.fillRect(x, y, 2, 2);
        }
      }
    } else if (doc.paper === "lined") {
      ctx.strokeStyle = "rgba(184, 132, 145, 0.24)";
      ctx.lineWidth = 1.5;
      for (let y = 140; y < CANVAS_H - 80; y += 54) {
        ctx.beginPath();
        ctx.moveTo(72, y);
        ctx.lineTo(CANVAS_W - 72, y);
        ctx.stroke();
      }
    }

    // Margin border
    ctx.strokeStyle = doc.paper === "midnight" ? "rgba(255,255,255,0.12)" : "rgba(60,30,40,0.1)";
    ctx.lineWidth = 2;
    ctx.strokeRect(28, 28, CANVAS_W - 56, CANVAS_H - 56);

    // Render ordered layers
    for (const layer of doc.layers) {
      if (!layer.visible) continue;
      ctx.save();
      ctx.globalAlpha = layer.opacity;
      ctx.translate(layer.x * CANVAS_W, layer.y * CANVAS_H);
      ctx.rotate((layer.rotation * Math.PI) / 180);
      ctx.scale(layer.scale, layer.scale);

      if (layer.kind === "photo") {
        const img = loadedImages.current.get(layer.src);
        const maxSide = 520;
        if (img && img.width > 0) {
          const k = maxSide / Math.max(img.width, img.height);
          const w = img.width * k;
          const h = img.height * k;
          ctx.shadowColor = "rgba(0,0,0,0.22)";
          ctx.shadowBlur = 24;
          ctx.shadowOffsetY = 8;
          ctx.fillStyle = "#fbf8f1";
          ctx.fillRect(-w / 2 - 18, -h / 2 - 18, w + 36, h + 56);
          ctx.shadowColor = "transparent";
          ctx.drawImage(img, -w / 2, -h / 2, w, h);
        }
      } else if (layer.kind === "flower") {
        const sticker = flowerSticker(layer.recipe, 3);
        const targetH = 440;
        const k = targetH / sticker.height;
        const w = sticker.width * k;
        const h = sticker.height * k;
        ctx.drawImage(sticker.canvas, -w / 2, -h / 2, w, h);
      } else if (layer.kind === "sticker") {
        if (layer.stickerId.startsWith("washi-")) {
          ctx.fillStyle = layer.color;
          ctx.globalAlpha = layer.opacity * 0.78;
          ctx.fillRect(-110, -24, 220, 48);
        } else {
          ctx.fillStyle = layer.color;
          ctx.font = "96px serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(layer.glyph, 0, 0);
        }
      } else if (layer.kind === "text") {
        ctx.fillStyle = layer.color;
        ctx.font =
          layer.font === "hand"
            ? "56px Caveat, cursive"
            : layer.font === "mono"
              ? "32px 'DM Mono', monospace"
              : "italic 44px Fraunces, Georgia, serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const lines = layer.text.split("\n");
        lines.forEach((line, idx) => {
          ctx.fillText(line, 0, (idx - (lines.length - 1) / 2) * 52, CANVAS_W * 0.75);
        });
      }

      if (layer.id === selectedId && tool === "move") {
        ctx.strokeStyle = paper.accent;
        ctx.lineWidth = 2 / Math.max(0.2, layer.scale);
        ctx.setLineDash([8, 6]);
        ctx.strokeRect(-140, -140, 280, 280);
      }
      ctx.restore();
    }

    // Freehand ink strokes
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const s of doc.strokes) {
      if (s.points.length < 2) continue;
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.width;
      ctx.beginPath();
      s.points.forEach(([px, py], i) => {
        const cx = px * CANVAS_W;
        const cy = py * CANVAS_H;
        if (i === 0) ctx.moveTo(cx, cy);
        else ctx.lineTo(cx, cy);
      });
      ctx.stroke();
    }
    ctx.restore();
  };

  useEffect(() => {
    drawScene();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, selectedId, tool]);

  const pointFromEvent = (e: React.PointerEvent<HTMLCanvasElement>): [number, number] => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return [
      Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
      Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)),
    ];
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const [nx, ny] = pointFromEvent(e);
    if (tool === "draw") {
      const strokeId = localUid();
      const newStroke: InkStroke = { id: strokeId, color: brushColor, width: brushWidth, points: [[nx, ny]] };
      setUndoStack((u) => [...u.slice(-24), doc]);
      setRedoStack([]);
      setDoc((d) => ({ ...d, strokes: [...d.strokes, newStroke] }));
      dragRef.current = { mode: "draw", strokeId };
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }

    // Hit test top-most visible unlocked layer near pointer
    const hit = [...doc.layers]
      .reverse()
      .find((l) => l.visible && !l.locked && Math.hypot(l.x - nx, l.y - ny) < 0.22 * l.scale);
    if (hit) {
      setSelectedId(hit.id);
      setUndoStack((u) => [...u.slice(-24), doc]);
      setRedoStack([]);
      dragRef.current = { mode: "layer", id: hit.id, startX: nx, startY: ny, origX: hit.x, origY: hit.y };
      e.currentTarget.setPointerCapture(e.pointerId);
    } else {
      setSelectedId(null);
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const [nx, ny] = pointFromEvent(e);
    if (drag.mode === "draw") {
      setDoc((d) => ({
        ...d,
        strokes: d.strokes.map((s) => (s.id === drag.strokeId ? { ...s, points: [...s.points, [nx, ny]] } : s)),
      }));
    } else {
      const dx = nx - drag.startX;
      const dy = ny - drag.startY;
      setDoc((d) => ({
        ...d,
        layers: d.layers.map((l) => (l.id === drag.id ? { ...l, x: drag.origX + dx, y: drag.origY + dy } : l)),
      }));
    }
  };

  const onPointerUp = () => {
    dragRef.current = null;
  };

  const selectedLayer = useMemo(() => doc.layers.find((l) => l.id === selectedId) ?? null, [doc.layers, selectedId]);

  const updateSelected = (patch: Partial<ScrapLayer>) => {
    if (!selectedLayer) return;
    setDoc((d) => ({
      ...d,
      layers: d.layers.map((l) => (l.id === selectedLayer.id ? ({ ...l, ...patch } as ScrapLayer) : l)),
    }));
  };

  const addFlower = () => {
    const rec = hasFlower ? studioRecipe : defaultRecipe("bloom");
    const id = localUid();
    commitDoc((d) => ({
      ...d,
      layers: [
        ...d.layers,
        {
          id,
          name: `Flower · ${rec.word}`,
          kind: "flower",
          recipe: rec,
          x: 0.5,
          y: 0.5,
          scale: 0.85,
          rotation: 0,
          opacity: 1,
          visible: true,
          locked: false,
        },
      ],
    }));
    setSelectedId(id);
    setTool("move");
  };

  const addNote = () => {
    const id = localUid();
    commitDoc((d) => ({
      ...d,
      layers: [
        ...d.layers,
        {
          id,
          name: "Note",
          kind: "text",
          text: "pressed today",
          color: PAPERS.find((p) => p.id === d.paper)?.ink ?? "#2a1b24",
          font: "hand",
          x: 0.5,
          y: 0.72,
          scale: 1,
          rotation: 0,
          opacity: 1,
          visible: true,
          locked: false,
        },
      ],
    }));
    setSelectedId(id);
    setTool("move");
  };

  const addSticker = (s: (typeof STICKERS)[number]) => {
    const id = localUid();
    commitDoc((d) => ({
      ...d,
      layers: [
        ...d.layers,
        {
          id,
          name: s.label,
          kind: "sticker",
          stickerId: s.id,
          glyph: s.glyph,
          color: s.color,
          x: 0.5,
          y: 0.3,
          scale: 1,
          rotation: -6,
          opacity: 1,
          visible: true,
          locked: false,
        },
      ],
    }));
    setSelectedId(id);
    setTool("move");
  };

  const addPhoto = async (file: File | undefined) => {
    if (!file) return;
    try {
      const reader = new FileReader();
      reader.onload = async () => {
        const dataUrl = String(reader.result);
        const img = await blobToImage(file);
        loadedImages.current.set(dataUrl, img);
        const id = localUid();
        commitDoc((d) => ({
          ...d,
          layers: [
            ...d.layers,
            {
              id,
              name: file.name.slice(0, 24) || "Photo",
              kind: "photo",
              src: dataUrl,
              x: 0.5,
              y: 0.45,
              scale: 0.9,
              rotation: -2,
              opacity: 1,
              visible: true,
              locked: false,
            },
          ],
        }));
        setSelectedId(id);
        setTool("move");
      };
      reader.readAsDataURL(file);
    } catch {
      toast("Could not add that photo.", "error");
    }
  };

  const moveLayerOrder = (index: number, delta: -1 | 1) => {
    const nextIdx = index + delta;
    if (nextIdx < 0 || nextIdx >= doc.layers.length) return;
    commitDoc((d) => {
      const copy = [...d.layers];
      const [item] = copy.splice(index, 1);
      copy.splice(nextIdx, 0, item);
      return { ...d, layers: copy };
    });
  };

  const saveToJournal = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setSaving(true);
    try {
      // Clear selection box before exporting cleanly
      const prevSel = selectedId;
      setSelectedId(null);
      await new Promise((r) => setTimeout(r, 20));
      const blob = await canvasToBlob(canvas, "image/jpeg", 0.92);
      setSelectedId(prevSel);

      const firstFlower = doc.layers.find((l): l is Extract<ScrapLayer, { kind: "flower" }> => l.kind === "flower")?.recipe ?? null;
      const editState = { version: 2, scrapbook: doc };

      if (editingEntry) {
        const updated = await storeFor(editingEntry.id, store).updateEntry(editingEntry.id, {
          title: doc.title,
          photo: blob,
          recipe: firstFlower ?? undefined,
          edit_state: editState,
        });
        toast("Scrapbook page updated.");
        navigate(`/journal/${updated.id}`);
      } else {
        const created = await store.createEntry({
          entry_type: "photo",
          title: doc.title || "Scrapbook page",
          recipe: firstFlower,
          photo: blob,
          edit_state: editState,
        });
        toast("Saved scrapbook page to your journal.");
        navigate(`/journal/${created.id}`);
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not save scrapbook.", "error");
    } finally {
      setSaving(false);
    }
  };

  const downloadImage = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    downloadBlob(await canvasToBlob(canvas, "image/png"), `bloom-scrapbook.png`);
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
          <h1 style={{ marginTop: 10 }}>
            Scrapbook <span className="flourish">Studio</span>
          </h1>
        </div>
        <div className="btn-row">
          <button type="button" className="btn icon quiet" onClick={undo} disabled={undoStack.length === 0} title="Undo">
            <IconUndo />
          </button>
          <button type="button" className="btn icon quiet" onClick={redo} disabled={redoStack.length === 0} title="Redo">
            <IconRedo />
          </button>
          <button type="button" className="btn" onClick={() => void downloadImage()}>
            <IconDownload /> Export PNG
          </button>
          <button type="button" className="btn primary" disabled={saving} onClick={() => void saveToJournal()}>
            <IconJournal /> {editingEntry ? "Update entry" : "Save to journal"}
          </button>
        </div>
      </div>

      <div className="scrapbook-layout">
        <section className="scrapbook-stage-wrap">
          <canvas
            ref={canvasRef}
            className="scrapbook-canvas"
            style={{ cursor: tool === "draw" ? "crosshair" : "grab" }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
          />
        </section>

        <aside className="sheet">
          <div className="sheet-section stack tight">
            <label className="field">
              <span>Page title</span>
              <input type="text" value={doc.title} maxLength={80} onChange={(e) => setDoc({ ...doc, title: e.target.value })} />
            </label>
            <div className="segmented" role="group" aria-label="Tool">
              <button type="button" aria-pressed={tool === "move"} onClick={() => setTool("move")}>
                Move & arrange
              </button>
              <button type="button" aria-pressed={tool === "draw"} onClick={() => setTool("draw")}>
                Freehand ink
              </button>
            </div>
            {tool === "draw" && (
              <div className="stack tight" style={{ marginTop: 6 }}>
                <div className="row" style={{ gap: 10, alignItems: "center" }}>
                  <input type="color" value={brushColor} onChange={(e) => setBrushColor(e.target.value)} aria-label="Ink color" />
                  <input type="range" min={2} max={24} value={brushWidth} onChange={(e) => setBrushWidth(Number(e.target.value))} style={{ flex: 1 }} />
                  <span className="lcd" style={{ fontSize: 12 }}>{brushWidth}px</span>
                </div>
                {doc.strokes.length > 0 && (
                  <button
                    type="button"
                    className="btn small quiet"
                    onClick={() => commitDoc((d) => ({ ...d, strokes: d.strokes.slice(0, -1) }))}
                  >
                    Remove last stroke
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="sheet-section">
            <header>
              <h3>Add elements</h3>
            </header>
            <div className="btn-row">
              <button type="button" className="btn small" onClick={addFlower}>
                <IconFlower /> Flower
              </button>
              <button type="button" className="btn small" onClick={() => fileInput.current?.click()}>
                <IconUpload /> Photo
              </button>
              <button type="button" className="btn small" onClick={addNote}>
                <IconPlus /> Note
              </button>
              <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => void addPhoto(e.target.files?.[0])} />
            </div>
            <div className="chips" style={{ marginTop: 10 }}>
              {STICKERS.map((s) => (
                <button key={s.id} type="button" className="chip" onClick={() => addSticker(s)} title={s.label}>
                  {s.glyph} {s.label}
                </button>
              ))}
            </div>
          </div>

          <div className="sheet-section">
            <header>
              <h3>Paper background</h3>
            </header>
            <div className="chips">
              {PAPERS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="chip"
                  aria-pressed={doc.paper === p.id}
                  onClick={() => commitDoc((d) => ({ ...d, paper: p.id }))}
                >
                  {p.name}
                </button>
              ))}
            </div>
          </div>

          {selectedLayer && (
            <div className="sheet-section stack tight">
              <header>
                <h3>Selected · {selectedLayer.name}</h3>
                <button
                  type="button"
                  className="btn small quiet danger"
                  onClick={() => {
                    commitDoc((d) => ({ ...d, layers: d.layers.filter((l) => l.id !== selectedLayer.id) }));
                    setSelectedId(null);
                  }}
                >
                  <IconTrash />
                </button>
              </header>
              {selectedLayer.kind === "text" && (
                <>
                  <textarea
                    rows={2}
                    value={selectedLayer.text}
                    maxLength={140}
                    onChange={(e) => updateSelected({ text: e.target.value })}
                  />
                  <div className="row" style={{ gap: 8, alignItems: "center" }}>
                    <input type="color" value={selectedLayer.color} onChange={(e) => updateSelected({ color: e.target.value })} />
                    {(["serif", "hand", "mono"] as const).map((f) => (
                      <button
                        key={f}
                        type="button"
                        className="chip"
                        aria-pressed={selectedLayer.font === f}
                        onClick={() => updateSelected({ font: f })}
                      >
                        {f}
                      </button>
                    ))}
                  </div>
                </>
              )}
              <label className="field">
                <span>Scale ({Math.round(selectedLayer.scale * 100)}%)</span>
                <input
                  type="range"
                  min={0.25}
                  max={2.4}
                  step={0.05}
                  value={selectedLayer.scale}
                  onChange={(e) => updateSelected({ scale: Number(e.target.value) })}
                />
              </label>
              <label className="field">
                <span>Rotation ({selectedLayer.rotation}°)</span>
                <input
                  type="range"
                  min={-180}
                  max={180}
                  step={1}
                  value={selectedLayer.rotation}
                  onChange={(e) => updateSelected({ rotation: Number(e.target.value) })}
                />
              </label>
              <label className="field">
                <span>Opacity ({Math.round(selectedLayer.opacity * 100)}%)</span>
                <input
                  type="range"
                  min={0.15}
                  max={1}
                  step={0.05}
                  value={selectedLayer.opacity}
                  onChange={(e) => updateSelected({ opacity: Number(e.target.value) })}
                />
              </label>
            </div>
          )}

          <div className="sheet-section">
            <header>
              <h3>
                <IconLayers width={16} height={16} /> Layers ({doc.layers.length})
              </h3>
            </header>
            {doc.layers.length === 0 ? (
              <p className="muted small">Add a flower, photo, note, or sticker to get started.</p>
            ) : (
              <div className="stack tight">
                {[...doc.layers].reverse().map((l, revIdx) => {
                  const idx = doc.layers.length - 1 - revIdx;
                  return (
                    <div
                      key={l.id}
                      className={`layer-row${l.id === selectedId ? " active" : ""}`}
                      onClick={() => setSelectedId(l.id)}
                    >
                      <span style={{ flex: 1, opacity: l.visible ? 1 : 0.45 }}>{l.name}</span>
                      <button
                        type="button"
                        className="btn small quiet"
                        title="Move forward"
                        onClick={(ev) => {
                          ev.stopPropagation();
                          moveLayerOrder(idx, 1);
                        }}
                        disabled={idx === doc.layers.length - 1}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="btn small quiet"
                        title="Move back"
                        onClick={(ev) => {
                          ev.stopPropagation();
                          moveLayerOrder(idx, -1);
                        }}
                        disabled={idx === 0}
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        className="btn small quiet"
                        onClick={(ev) => {
                          ev.stopPropagation();
                          commitDoc((d) => ({
                            ...d,
                            layers: d.layers.map((item) => (item.id === l.id ? { ...item, visible: !item.visible } : item)),
                          }));
                        }}
                      >
                        {l.visible ? "Hide" : "Show"}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </aside>
      </div>
    </main>
  );
}
