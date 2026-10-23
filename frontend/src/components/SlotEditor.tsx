/**
 * Edit one of your pictures inside its layout slot: drag the photo to
 * reframe it, drag the flower to place it, plus precise sliders.
 */
import { useEffect, useRef } from "react";
import type { FlowerRecipe } from "../flower/recipe";
import { drawFlowerOn, drawPhotoInRect, type FlowerPlacement, type PhotoTransform } from "../imaging/compose";
import { context2d } from "../imaging/process";
import { useOverlayGestures } from "../hooks/useOverlayGestures";
import { Slider } from "./ui";

export function SlotEditor({
  image,
  recipe,
  photo,
  flower,
  aspect,
  onPhoto,
  onFlower,
}: {
  image: CanvasImageSource | null;
  recipe: FlowerRecipe | null;
  photo: PhotoTransform;
  flower: FlowerPlacement;
  aspect: number;
  onPhoto: (next: PhotoTransform) => void;
  onFlower: (next: FlowerPlacement, commit: boolean) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const photoRef = useRef(photo);
  photoRef.current = photo;

  useEffect(() => {
    const c = canvas.current;
    const el = box.current;
    if (!c || !el) return;
    const w = Math.max(1, Math.round(el.clientWidth * Math.min(2, window.devicePixelRatio || 1)));
    const h = Math.round(w / aspect);
    c.width = w;
    c.height = h;
    const ctx = context2d(c);
    ctx.fillStyle = "#2a1934";
    ctx.fillRect(0, 0, w, h);
    const rect = { x: 0, y: 0, w, h };
    if (image) drawPhotoInRect(ctx, image as HTMLCanvasElement, photo, rect);
    if (recipe) drawFlowerOn(ctx, recipe, flower, rect);
  }, [image, recipe, photo, flower, aspect]);

  useOverlayGestures({ container: box, recipe, placement: flower, enabled: true, onChange: onFlower });

  // Dragging outside the flower moves the photo inside the frame.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    let start: { x: number; y: number; panX: number; panY: number; id: number } | null = null;
    const down = (e: PointerEvent) => {
      if (e.defaultPrevented || !image) return;
      start = { x: e.clientX, y: e.clientY, panX: photoRef.current.panX, panY: photoRef.current.panY, id: e.pointerId };
      el.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (!start || e.pointerId !== start.id) return;
      const scale = 2 / Math.max(1, el.clientWidth * 0.5 * photoRef.current.zoom);
      onPhoto({
        ...photoRef.current,
        panX: Math.max(-1, Math.min(1, start.panX - (e.clientX - start.x) * scale)),
        panY: Math.max(-1, Math.min(1, start.panY - (e.clientY - start.y) * scale)),
      });
    };
    const up = () => {
      start = null;
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
    };
  }, [image, onPhoto]);

  return (
    <div className="stack">
      <div ref={box} className="slot-thumb" style={{ aspectRatio: String(aspect) }} tabIndex={0} aria-label="Your picture in its frame. Drag the photo to reframe it; drag the flower to move it.">
        <canvas ref={canvas} />
      </div>
      {image && (
        <>
          <Slider label="Photo zoom" value={photo.zoom} min={1} max={4} step={0.01} format={(v) => `${v.toFixed(2)}×`} onChange={(zoom) => onPhoto({ ...photo, zoom })} />
          <Slider
            label="Photo rotation"
            value={photo.rotation}
            min={-45}
            max={45}
            step={0.5}
            format={(v) => `${v.toFixed(1)}°`}
            onChange={(rotation) => onPhoto({ ...photo, rotation })}
          />
        </>
      )}
    </div>
  );
}
