/**
 * The editing stage: the photo with its theme, and the flower you can move,
 * resize, rotate and crop. While you drag, the flower is drawn on top for
 * speed; a moment later the whole picture (flower included) is re-rendered
 * through the theme so the preview matches the saved photo.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { FlowerRecipe } from "../flower/recipe";
import { drawFlowerOn, placementCorners, renderPhotoWithFlower, type FlowerPlacement } from "../imaging/compose";
import { context2d, renderThemed, toCanvas } from "../imaging/process";
import type { ThemeSettings } from "../imaging/themes";
import { handlePosition, useOverlayGestures } from "../hooks/useOverlayGestures";

const PREVIEW_SIZE = 1100;

export function EditorStage({
  photo,
  recipe,
  overlay,
  theme,
  date,
  onOverlay,
  label = "Photo editor",
}: {
  photo: HTMLCanvasElement;
  recipe: FlowerRecipe | null;
  overlay: FlowerPlacement;
  theme: ThemeSettings;
  date: Date;
  onOverlay: (next: FlowerPlacement, commit: boolean) => void;
  label?: string;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [active, setActive] = useState(false);
  const [size, setSize] = useState({ w: 0, h: 0 });

  const base = useMemo(() => toCanvas(photo, PREVIEW_SIZE), [photo]);
  const editTheme = useMemo(() => ({ ...theme, frame: false }), [theme]);

  // Themed photo without the flower: redrawn only when the theme changes.
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
    if (recipe) drawFlowerOn(ctx, recipe, overlay, { x: 0, y: 0, w: canvas.width, h: canvas.height });
  }, [base, themedPhoto, recipe, overlay]);

  // Accurate draw (theme applied to the flower too) when things settle.
  useEffect(() => {
    if (active) return;
    const timer = window.setTimeout(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const full = renderThemed(renderPhotoWithFlower(base, recipe, overlay, PREVIEW_SIZE), editTheme, { maxSize: PREVIEW_SIZE, date });
      context2d(canvas).drawImage(full, 0, 0, canvas.width, canvas.height);
    }, 220);
    return () => window.clearTimeout(timer);
  }, [active, base, recipe, overlay, editTheme, date]);

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
      style={{ aspectRatio: `${photo.width} / ${photo.height}` }}
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
