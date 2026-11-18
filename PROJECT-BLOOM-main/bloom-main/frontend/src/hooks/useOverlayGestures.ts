/**
 * Move, resize and rotate a flower on a photo with mouse, touch or keyboard.
 *  - drag the flower to move it
 *  - drag the round handle to resize and rotate
 *  - two fingers: pinch to resize, twist to rotate
 *  - mouse wheel: resize
 *  - keyboard (stage focused): arrows move, + / - resize, [ / ] rotate
 */
import { useEffect, useRef, type RefObject } from "react";
import type { FlowerRecipe } from "../flower/recipe";
import { placementCorners, type FlowerPlacement } from "../imaging/compose";

function inside(point: [number, number], polygon: Array<[number, number]>): boolean {
  let hit = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    if (yi > point[1] !== yj > point[1] && point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

export function handlePosition(corners: Array<[number, number]>): [number, number] {
  return corners[2];
}

interface Options {
  container: RefObject<HTMLElement | null>;
  recipe: FlowerRecipe | null;
  placement: FlowerPlacement;
  enabled: boolean;
  onChange: (next: FlowerPlacement, commit: boolean) => void;
  onActive?: (active: boolean) => void;
}

export function useOverlayGestures({ container, recipe, placement, enabled, onChange, onActive }: Options): void {
  const latest = useRef({ recipe, placement, onChange, onActive, enabled });
  latest.current = { recipe, placement, onChange, onActive, enabled };

  useEffect(() => {
    const el = container.current;
    if (!el) return;
    const pointers = new Map<number, { x: number; y: number }>();
    let mode: "none" | "move" | "handle" | "pinch" = "none";
    let start = { placement: latest.current.placement, x: 0, y: 0, angle: 0, dist: 1 };

    const local = (event: PointerEvent | WheelEvent) => {
      const rect = el.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top, w: rect.width, h: rect.height };
    };

    const centre = (w: number, h: number) => ({ x: latest.current.placement.x * w, y: latest.current.placement.y * h });

    const down = (event: PointerEvent) => {
      const { recipe: r, placement: p, enabled: on } = latest.current;
      if (!on || !r || !p.visible) return;
      const pos = local(event);
      pointers.set(event.pointerId, { x: pos.x, y: pos.y });
      const corners = placementCorners(r, p, { w: pos.w, h: pos.h });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        mode = "pinch";
        start = { placement: p, x: 0, y: 0, angle: Math.atan2(b.y - a.y, b.x - a.x), dist: Math.hypot(b.x - a.x, b.y - a.y) || 1 };
      } else {
        const [hx, hy] = handlePosition(corners);
        if (Math.hypot(pos.x - hx, pos.y - hy) < 22) {
          mode = "handle";
          const c = centre(pos.w, pos.h);
          start = { placement: p, x: pos.x, y: pos.y, angle: Math.atan2(pos.y - c.y, pos.x - c.x), dist: Math.hypot(pos.x - c.x, pos.y - c.y) || 1 };
        } else if (inside([pos.x, pos.y], corners)) {
          mode = "move";
          start = { placement: p, x: pos.x, y: pos.y, angle: 0, dist: 1 };
        } else {
          pointers.delete(event.pointerId);
          return;
        }
      }
      el.setPointerCapture(event.pointerId);
      latest.current.onActive?.(true);
      event.preventDefault();
    };

    const move = (event: PointerEvent) => {
      if (!pointers.has(event.pointerId) || mode === "none") return;
      const pos = local(event);
      pointers.set(event.pointerId, { x: pos.x, y: pos.y });
      const p0 = start.placement;
      if (mode === "move") {
        latest.current.onChange({ ...p0, x: p0.x + (pos.x - start.x) / pos.w, y: p0.y + (pos.y - start.y) / pos.h }, false);
      } else if (mode === "handle") {
        const c = { x: p0.x * pos.w, y: p0.y * pos.h };
        const angle = Math.atan2(pos.y - c.y, pos.x - c.x);
        const dist = Math.hypot(pos.x - c.x, pos.y - c.y);
        latest.current.onChange(
          {
            ...p0,
            size: Math.min(2.5, Math.max(0.05, p0.size * (dist / start.dist))),
            rotation: normalizeAngle(p0.rotation + ((angle - start.angle) * 180) / Math.PI),
          },
          false,
        );
      } else if (mode === "pinch" && pointers.size >= 2) {
        const [a, b] = [...pointers.values()];
        const angle = Math.atan2(b.y - a.y, b.x - a.x);
        const dist = Math.hypot(b.x - a.x, b.y - a.y);
        latest.current.onChange(
          {
            ...p0,
            size: Math.min(2.5, Math.max(0.05, p0.size * (dist / start.dist))),
            rotation: normalizeAngle(p0.rotation + ((angle - start.angle) * 180) / Math.PI),
          },
          false,
        );
      }
    };

    const up = (event: PointerEvent) => {
      if (!pointers.has(event.pointerId)) return;
      pointers.delete(event.pointerId);
      if (pointers.size === 0 && mode !== "none") {
        mode = "none";
        latest.current.onChange(latest.current.placement, true);
        latest.current.onActive?.(false);
      } else if (pointers.size === 1 && mode === "pinch") {
        mode = "none";
        latest.current.onChange(latest.current.placement, true);
      }
    };

    let wheelTimer = 0;
    const wheel = (event: WheelEvent) => {
      const { recipe: r, placement: p, enabled: on } = latest.current;
      if (!on || !r || !p.visible) return;
      const pos = local(event);
      if (!inside([pos.x, pos.y], placementCorners(r, p, { w: pos.w, h: pos.h }))) return;
      event.preventDefault();
      const factor = Math.exp(-event.deltaY * 0.0015);
      latest.current.onChange({ ...p, size: Math.min(2.5, Math.max(0.05, p.size * factor)) }, false);
      window.clearTimeout(wheelTimer);
      wheelTimer = window.setTimeout(() => latest.current.onChange(latest.current.placement, true), 300);
    };

    const key = (event: KeyboardEvent) => {
      const { placement: p, enabled: on } = latest.current;
      if (!on || event.target !== el) return;
      const step = event.shiftKey ? 0.05 : 0.01;
      const changes: Record<string, Partial<FlowerPlacement>> = {
        ArrowLeft: { x: p.x - step },
        ArrowRight: { x: p.x + step },
        ArrowUp: { y: p.y - step },
        ArrowDown: { y: p.y + step },
        "+": { size: Math.min(2.5, p.size * 1.05) },
        "=": { size: Math.min(2.5, p.size * 1.05) },
        "-": { size: Math.max(0.05, p.size / 1.05) },
        "[": { rotation: normalizeAngle(p.rotation - 3) },
        "]": { rotation: normalizeAngle(p.rotation + 3) },
      };
      const change = changes[event.key];
      if (!change) return;
      event.preventDefault();
      latest.current.onChange({ ...p, ...change }, true);
    };

    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener("wheel", wheel, { passive: false });
    el.addEventListener("keydown", key);
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      el.removeEventListener("wheel", wheel);
      el.removeEventListener("keydown", key);
      window.clearTimeout(wheelTimer);
    };
  }, [container]);
}

export function normalizeAngle(deg: number): number {
  let d = deg;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return d;
}
