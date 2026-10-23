/**
 * Word shapes beyond the original flower. Each shape is drawn the Bloom way:
 * the word is stamped along five nested outlines (centre ring first, outer
 * ring last), each outline in its own ring colour, just like the flower's
 * five petal rings.
 *
 * Every shape is a closed curve given as points in turtle units (y up).
 * Words are placed at equal distances along the curve, so the spacing looks
 * even whatever the shape.
 */

export type ShapeId = "flower" | "heart" | "heartburst" | "star" | "butterfly" | "infinity" | "moon";

export const SHAPES: Array<{ id: ShapeId; name: string; hint: string }> = [
  { id: "flower", name: "Flower", hint: "The original Bloom flower" },
  { id: "heart", name: "Heart", hint: "x = 16 sin³t, y = 13 cos t − 5 cos 2t − 2 cos 3t − cos 4t" },
  { id: "heartburst", name: "Heart burst", hint: "120 rays out to the heart curve, a sparkle at each tip" },
  { id: "star", name: "Star", hint: "A five-pointed star" },
  { id: "butterfly", name: "Butterfly", hint: "Fay's butterfly curve" },
  { id: "infinity", name: "Infinity", hint: "The lemniscate: forever" },
  { id: "moon", name: "Moon", hint: "A crescent moon" },
];

type Point = [number, number];

const TAU = Math.PI * 2;

/** The outer outline of each shape, about 300 units across, centred on (0, 0). */
export type RingShape = Exclude<ShapeId, "flower" | "heartburst">;

function outline(shape: RingShape): Point[] {
  const pts: Point[] = [];
  const N = 480;
  switch (shape) {
    case "heart": {
      // The same heart as Bloom's floating ♡, scaled up.
      for (let i = 0; i < N; i++) {
        const t = (i / N) * TAU;
        const x = 16 * Math.sin(t) ** 3;
        const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
        pts.push([x * 9.5, (y + 2.5) * 9.5]);
      }
      break;
    }
    case "star": {
      const outer = 165;
      const inner = 72;
      // Straight edges between 10 corners, top point first.
      const corners: Point[] = [];
      for (let k = 0; k < 10; k++) {
        const r = k % 2 === 0 ? outer : inner;
        const a = Math.PI / 2 + (k * Math.PI) / 5;
        corners.push([r * Math.cos(a), r * Math.sin(a) - 12]);
      }
      const perSide = N / 10;
      for (let k = 0; k < 10; k++) {
        const [x1, y1] = corners[k];
        const [x2, y2] = corners[(k + 1) % 10];
        for (let j = 0; j < perSide; j++) {
          const f = j / perSide;
          pts.push([x1 + (x2 - x1) * f, y1 + (y2 - y1) * f]);
        }
      }
      break;
    }
    case "butterfly": {
      // Polar butterfly: r = e^{sin θ} − 2 cos 4θ + sin⁵((2θ − π) / 24)
      for (let i = 0; i < N * 2; i++) {
        const t = (i / (N * 2)) * TAU;
        const r = Math.exp(Math.sin(t)) - 2 * Math.cos(4 * t) + Math.sin((2 * t - Math.PI) / 24) ** 5;
        pts.push([r * Math.cos(t) * 46, r * Math.sin(t) * 46 - 40]);
      }
      break;
    }
    case "infinity": {
      // Lemniscate of Bernoulli
      const a = 200;
      for (let i = 0; i < N; i++) {
        const t = (i / N) * TAU;
        const d = 1 + Math.sin(t) ** 2;
        pts.push([(a * Math.cos(t)) / d, (a * 1.25 * Math.sin(t) * Math.cos(t)) / d]);
      }
      break;
    }
    case "moon": {
      // Outer circle minus a shifted circle = crescent.
      const R = 160;
      const cx = 70;
      const cy = 40;
      const r = 140;
      const outside = (x: number, y: number) => Math.hypot(x - cx, y - cy) > r;
      const insideBig = (x: number, y: number) => Math.hypot(x, y) < R;
      // Outer arc: the part of the big circle outside the cut circle (walk counter-clockwise).
      const outer: Point[] = [];
      for (let i = 0; i < N; i++) {
        const a = (i / N) * TAU;
        const p: Point = [R * Math.cos(a), R * Math.sin(a)];
        if (outside(p[0], p[1])) outer.push(p);
      }
      // Rotate the list so the arc is continuous (start just after a gap).
      const gapAt = outer.findIndex((p, i) => i > 0 && Math.hypot(p[0] - outer[i - 1][0], p[1] - outer[i - 1][1]) > 10);
      const outerArc = gapAt > 0 ? [...outer.slice(gapAt), ...outer.slice(0, gapAt)] : outer;
      // Inner arc: the part of the cut circle inside the big circle, walked back the other way.
      const innerArc: Point[] = [];
      for (let i = 0; i < N; i++) {
        const a = (i / N) * TAU;
        const p: Point = [cx + r * Math.cos(a), cy + r * Math.sin(a)];
        if (insideBig(p[0], p[1])) innerArc.push(p);
      }
      const gapIn = innerArc.findIndex((p, i) => i > 0 && Math.hypot(p[0] - innerArc[i - 1][0], p[1] - innerArc[i - 1][1]) > 10);
      const innerOrdered = gapIn > 0 ? [...innerArc.slice(gapIn), ...innerArc.slice(0, gapIn)] : innerArc;
      pts.push(...outerArc, ...innerOrdered.reverse());
      // centre the crescent's visible body
      for (const p of pts) {
        p[0] += 35;
        p[1] -= 8;
      }
      break;
    }
  }
  return pts;
}

/** Points spaced `step` apart along a closed polyline. */
export function evenlySpaced(points: Point[], step: number): Point[] {
  if (points.length < 2) return points;
  const closed = [...points, points[0]];
  const out: Point[] = [];
  let carry = 0;
  for (let i = 0; i < closed.length - 1; i++) {
    const [x1, y1] = closed[i];
    const [x2, y2] = closed[i + 1];
    const len = Math.hypot(x2 - x1, y2 - y1);
    let d = carry;
    while (d < len) {
      const f = d / len;
      out.push([x1 + (x2 - x1) * f, y1 + (y2 - y1) * f]);
      d += step;
    }
    carry = d - len;
  }
  return out;
}

const RING_SCALES = [0.22, 0.42, 0.61, 0.8, 1];

/**
 * Where to stamp the word for each ring of a shape.
 * size: 1 = normal; density: 1 = normal spacing (higher = more words).
 */
export function shapeRings(shape: RingShape, size: number, density: number): Point[][] {
  const base = outline(shape);
  const step = Math.max(6, 14 / density);
  return RING_SCALES.map((scale) =>
    evenlySpaced(
      base.map(([x, y]) => [x * scale * size, y * scale * size] as Point),
      step,
    ),
  );
}
