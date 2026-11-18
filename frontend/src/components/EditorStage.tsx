/**
 * The editing stage: displays cropped + themed photo with one or more flower layers.
 * Interactive drag/resize/rotate gestures manipulate the currently active layer,
 * while background flower layers render seamlessly underneath/above.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { FlowerRecipe } from "../flower/recipe";
import {
  cropPhotoCanvas,
  defaultPhotoCrop,
  drawFlowerOn,
  placementCorners,
  renderPhotoWithFlowers,
  type FlowerLayerItem,
  type FlowerPlacement,
  type PhotoCrop,
} from "../imaging/compose";
import { context2d, renderThemed } from "../imaging/process";
import type { ThemeSettings } from "../imaging/themes";
import { handlePosition, useOverlayGestures } from "../hooks/useOverlayGestures";

const PREVIEW_SIZE = 1100;

export function EditorStage({
  photo,
  recipe,
  overlay,
  activeLayerId,
  layers,
  crop,
  theme,
  date,
  onOverlay,
  label = "Photo editor",
}: {
  photo: HTMLCanvasElement;
  recipe: FlowerRecipe | null;
  overlay: FlowerPlacement;
  activeLayerId?: string;
  layers?: FlowerLayerItem[];
  crop?: PhotoCrop;
  theme: ThemeSettings;
  date: Date;
  onOverlay: (next: FlowerPlacement, commit: boolean) => void;
  label?: string;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [active, setActive] = useState(false);
  const [size, setSize] = useState({ w: 0, h: 0 });

  const appliedCrop = crop ?? defaultPhotoCrop();
  const base = useMemo(() => cropPhotoCanvas(photo, appliedCrop, PREVIEW_SIZE), [photo, appliedCrop]);
  const editTheme = useMemo(() => ({ ...theme, frame: false }), [theme]);

  const effectiveLayers = useMemo<FlowerLayerItem[]>(() => {
    if (layers && layers.length > 0) return layers;
    if (recipe) return [{ id: activeLayerId ?? "primary", recipe, placement: overlay }];
    return [];
  }, [layers, recipe, activeLayerId, overlay]);

  // Themed photo without the flower: redrawn only when crop or theme changes.
  const [themedPhoto, setThemedPhoto] = useState<HTMLCanvasElement>(base);
  useEffect(() => {
    const timer = window.setTimeout(() => setThemedPhoto(renderThemed(base, editTheme, { maxSize: PREVIEW_SIZE, date })), 40);
    return () => window.clearTimeout(timer);
  }, [base, editTheme, date]);

  // Fast draw on every change.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = base.width;
    canvas.height = base.height;
    const ctx = context2d(canvas);
    ctx.drawImage(themedPhoto, 0, 0, canvas.width, canvas.height);
    for (const layer of effectiveLayers) {
      drawFlowerOn(ctx, layer.recipe, layer.placement, { x: 0, y: 0, w: canvas.width, h: canvas.height });
    }
  }, [base, themedPhoto, effectiveLayers]);

  // Accurate draw (theme applied to flowers too) when dragging settles.
  useEffect(() => {
    if (active) return;
    const timer = window.setTimeout(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const composed = renderPhotoWithFlowers(base, effectiveLayers, defaultPhotoCrop(), PREVIEW_SIZE);
      const full = renderThemed(composed, editTheme, { maxSize: PREVIEW_SIZE, date });
      context2d(canvas).drawImage(full, 0, 0, canvas.width, canvas.height);
    }, 220);
    return () => window.clearTimeout(timer);
  }, [active, base, effectiveLayers, editTheme, date]);

  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useOverlayGestures({ container: stage, recipe, placement: overlay, enabled: true, onChange: onOverlay, onActive: setActive });

  const corners = recipe && overlay.visible && size.w ? placementCorners(recipe, overlay, size) : null;
  const handle = corners ? handlePosition(corners) : null;

  return (
    <div
      ref={stage}
      className="viewfinder"
      style={{ aspectRatio: `${base.width} / ${base.height}` }}
      tabIndex={0}
      role="application"
      aria-label={`${label}. Drag the flower to move it, drag the round handle to resize and rotate. Arrow keys move, plus and minus resize, brackets rotate.`}
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
