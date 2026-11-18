/**
 * Non-destructive Cam 2.0 editing stage:
 * - Applies PhotoCrop cleanly on a preview copy of the original photo
 * - Draws multiple flower layers, highlights the active layer, and lets you
 *   click/tap any visible flower layer to select & move/resize/rotate it.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  cropPhotoCanvas,
  drawFlowerOn,
  placementCorners,
  renderPhotoWithLayers,
  type FlowerLayer,
  type FlowerPlacement,
  type PhotoCrop,
} from "../imaging/compose";
import { context2d, renderThemed } from "../imaging/process";
import type { ThemeSettings } from "../imaging/themes";
import { handlePosition, useOverlayGestures } from "../hooks/useOverlayGestures";

const PREVIEW_SIZE = 1100;

function pointInPoly(point: [number, number], polygon: Array<[number, number]>): boolean {
  let hit = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    if (yi > point[1] !== yj > point[1] && point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

export function EditorStage({
  photo,
  crop,
  layers,
  activeLayerId,
  theme,
  date,
  onSelectLayer,
  onOverlay,
  label = "Photo editor",
}: {
  photo: HTMLCanvasElement;
  crop: PhotoCrop;
  layers: FlowerLayer[];
  activeLayerId: string | null;
  theme: ThemeSettings;
  date: Date;
  onSelectLayer: (id: string) => void;
  onOverlay: (next: FlowerPlacement, commit: boolean) => void;
  label?: string;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [active, setActive] = useState(false);
  const [size, setSize] = useState({ w: 0, h: 0 });

  const base = useMemo(() => cropPhotoCanvas(photo, crop, PREVIEW_SIZE), [photo, crop]);
  const editTheme = useMemo(() => ({ ...theme, frame: false }), [theme]);

  const activeLayer = useMemo(
    () => layers.find((l) => l.id === activeLayerId) ?? layers[0] ?? null,
    [layers, activeLayerId],
  );

  const [themedPhoto, setThemedPhoto] = useState<HTMLCanvasElement>(base);
  useEffect(() => {
    const timer = window.setTimeout(() => setThemedPhoto(renderThemed(base, editTheme, { maxSize: PREVIEW_SIZE, date })), 40);
    return () => window.clearTimeout(timer);
  }, [base, editTheme, date]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = base.width;
    canvas.height = base.height;
    const ctx = context2d(canvas);
    ctx.drawImage(themedPhoto, 0, 0, canvas.width, canvas.height);
    for (const l of layers) {
      drawFlowerOn(ctx, l.recipe, l.placement, { x: 0, y: 0, w: canvas.width, h: canvas.height });
    }
  }, [base, themedPhoto, layers]);

  useEffect(() => {
    if (active) return;
    const timer = window.setTimeout(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const full = renderThemed(renderPhotoWithLayers(base, layers, PREVIEW_SIZE), editTheme, { maxSize: PREVIEW_SIZE, date });
      context2d(canvas).drawImage(full, 0, 0, canvas.width, canvas.height);
    }, 220);
    return () => window.clearTimeout(timer);
  }, [active, base, layers, editTheme, date]);

  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Switch active layer if user taps directly on another visible flower
  useEffect(() => {
    const el = stage.current;
    if (!el || layers.length < 2) return;
    const onCaptureDown = (event: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      if (activeLayer && activeLayer.placement.visible) {
        const activeCorners = placementCorners(activeLayer.recipe, activeLayer.placement, { w: rect.width, h: rect.height });
        const [hx, hy] = handlePosition(activeCorners);
        if (Math.hypot(x - hx, y - hy) < 22 || pointInPoly([x, y], activeCorners)) {
          return;
        }
      }
      for (let i = layers.length - 1; i >= 0; i--) {
        const l = layers[i];
        if (!l.placement.visible || l.id === activeLayer?.id) continue;
        const corners = placementCorners(l.recipe, l.placement, { w: rect.width, h: rect.height });
        if (pointInPoly([x, y], corners)) {
          onSelectLayer(l.id);
          break;
        }
      }
    };
    el.addEventListener("pointerdown", onCaptureDown, { capture: true });
    return () => el.removeEventListener("pointerdown", onCaptureDown, { capture: true });
  }, [layers, activeLayer, onSelectLayer]);

  useOverlayGestures({
    container: stage,
    recipe: activeLayer?.recipe ?? null,
    placement: activeLayer?.placement ?? { x: 0.5, y: 0.5, size: 0.7, rotation: 0, crop: { top: 0, right: 0, bottom: 0, left: 0 }, flip: false, visible: false },
    enabled: Boolean(activeLayer),
    onChange: onOverlay,
    onActive: setActive,
  });

  const corners =
    activeLayer && activeLayer.placement.visible && size.w
      ? placementCorners(activeLayer.recipe, activeLayer.placement, size)
      : null;
  const handle = corners ? handlePosition(corners) : null;

  return (
    <div
      ref={stage}
      className="viewfinder"
      style={{ aspectRatio: `${base.width} / ${base.height}` }}
      tabIndex={0}
      role="application"
      aria-label={`${label}. Drag a flower to move it, drag the round handle to resize and rotate.`}
    >
      <canvas ref={canvasRef} className="stage" />
      {corners && (
        <svg className="overlay-svg" width={size.w} height={size.h} style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
          <polygon
            points={corners.map((c) => c.join(",")).join(" ")}
            fill="none"
            stroke="rgba(244,234,217,0.75)"
            strokeDasharray="5 5"
            strokeWidth={1}
          />
          {handle && (
            <g>
              <circle cx={handle[0]} cy={handle[1]} r={11} fill="var(--cream)" stroke="var(--night)" strokeWidth={2} />
              <path
                d={`M${handle[0] - 4} ${handle[1] + 1} a4.5 4.5 0 1 1 4 3.5`}
                fill="none"
                stroke="var(--night)"
                strokeWidth={1.6}
                strokeLinecap="round"
              />
            </g>
          )}
        </svg>
      )}
    </div>
  );
}
