/**
 * Bloom flower engine — faithful port of legacy/bloom_turtle.py extended
 * for Studio 2.0 (petal styles, arrangements, center & stem text inscriptions).
 *
 * When defaults are used (petalStyle="classic", arrangement="rings"),
 * coordinates match the original Python Turtle program exactly.
 */

import type { BgStyle, FlowerRecipe, PetalStyle } from "./recipe";
import { evenlySpaced, shapeRings, type RingShape } from "./shapes";

export const ORIGINAL_WIDTH = 900;
export const ORIGINAL_HEIGHT = 600;

export const PETAL_FONT_PX = 10.7;
export const HEART_FONT_PX = 13.3;
export const CENTER_FONT_PX = 14;
export const STEM_FONT_PX = 9.5;

export const PETAL_FONT_FAMILY = "Arial, 'Helvetica Neue', Helvetica, sans-serif";
export const HEART_FONT_FAMILY = "'Courier New', Courier, monospace";

export interface LinePrimitive {
  kind: "line";
  points: Array<[number, number]>;
  color: string;
  width: number;
}

export interface TextPrimitive {
  kind: "text";
  x: number;
  y: number;
  text: string;
  color: string;
  sizePx: number;
  family: string;
  weight: "bold" | "normal";
}

export type Primitive = LinePrimitive | TextPrimitive;

export interface FlowerDrawing {
  primitives: Primitive[];
  background: string;
  bgStyle: BgStyle;
}

class RecordingTurtle {
  x = 0;
  y = 0;
  heading = 0;
  isDown = false;
  color = "black";
  width = 1;

  private stroke: LinePrimitive | null = null;

  constructor(private readonly out: Primitive[]) {}

  penup(): void {
    this.isDown = false;
    this.stroke = null;
  }

  pendown(): void {
    this.isDown = true;
  }

  setColor(color: string): void {
    if (color !== this.color) this.stroke = null;
    this.color = color;
  }

  pensize(width: number): void {
    if (width !== this.width) this.stroke = null;
    this.width = width;
  }

  setheading(degrees: number): void {
    this.heading = degrees;
  }

  goto(x: number, y: number): void {
    if (this.isDown) {
      if (!this.stroke) {
        this.stroke = {
          kind: "line",
          points: [[this.x, this.y]],
          color: this.color,
          width: this.width,
        };
        this.out.push(this.stroke);
      }
      this.stroke.points.push([x, y]);
    }
    this.x = x;
    this.y = y;
  }

  forward(distance: number): void {
    const rad = (this.heading * Math.PI) / 180;
    this.goto(this.x + distance * Math.cos(rad), this.y + distance * Math.sin(rad));
  }

  left(degrees: number): void {
    this.heading = (this.heading + degrees) % 360;
  }

  circle(radius: number, extent: number): void {
    const frac = Math.abs(extent) / 360;
    const steps = 1 + Math.floor(Math.min(11 + Math.abs(radius) / 6, 59) * frac);
    let w = extent / steps;
    let w2 = 0.5 * w;
    let l = 2 * radius * Math.sin((w2 * Math.PI) / 180);
    if (radius < 0) {
      l = -l;
      w = -w;
      w2 = -w2;
    }
    this.left(w2);
    for (let i = 0; i < steps; i++) {
      this.forward(l);
      this.left(w);
    }
    this.left(-w2);
  }

  write(text: string, sizePx: number, family: string, weight: "bold" | "normal"): void {
    this.out.push({ kind: "text", x: this.x, y: this.y, text, color: this.color, sizePx, family, weight });
  }
}

export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randint(random: () => number, low: number, high: number): number {
  return low + Math.floor(random() * (high - low + 1));
}

export const ORIGINAL_RINGS = [
  { radius: 0, count: 4, length: 40, width: 15, offset: 45 },
  { radius: 10, count: 5, length: 50, width: 25, offset: 0 },
  { radius: 20, count: 7, length: 70, width: 35, offset: 30 },
  { radius: 30, count: 9, length: 90, width: 45, offset: 15 },
  { radius: 40, count: 12, length: 110, width: 55, offset: 0 },
] as const;

export function buildFlower(recipe: FlowerRecipe): FlowerDrawing {
  const primitives: Primitive[] = [];
  const t = new RecordingTurtle(primitives);
  const word = recipe.word;
  const c = recipe.colors;
  const petalScale = recipe.petalSize;
  const style: PetalStyle = recipe.petalStyle || "classic";
  const arrangement = recipe.arrangement || "rings";

  function drawPetal(
    base: [number, number],
    baseAngle: number,
    length: number,
    width: number,
    color: string,
    points = 20,
    petalWord = word,
  ): void {
    t.setColor(color);
    const [bx, by] = base;
    const cosA = Math.cos(baseAngle);
    const sinA = Math.sin(baseAngle);

    for (let i = 0; i <= points; i++) {
      const theta = (i * Math.PI) / points;
      let out = length * Math.sin(theta);
      let side = width * Math.sin(theta) * Math.cos(theta);

      if (style === "pointed") {
        out = length * Math.sin(theta) ** 0.85;
        side = width * Math.sin(theta) * Math.cos(theta) ** 3;
      } else if (style === "wavy") {
        const ripple = 1 + 0.16 * Math.sin(theta * 6);
        out *= ripple;
        side *= ripple;
      } else if (style === "chrysanthemum") {
        out = length * 1.25 * Math.sin(theta);
        side = width * 0.42 * Math.sin(theta) * Math.cos(theta);
      } else if (style === "dahlia") {
        side = width * (Math.sin(theta) ** 1.3) * Math.sign(Math.cos(theta)) * (Math.abs(Math.cos(theta)) ** 0.6);
      }

      const rx = out * cosA - side * sinA;
      const ry = out * sinA + side * cosA;
      t.goto(bx + rx, by + ry);
      t.write(petalWord, PETAL_FONT_PX, PETAL_FONT_FAMILY, "bold");
    }
  }

  function drawLeaf(base: [number, number], angleDeg: number, length: number, width: number): void {
    drawPetal(base, (angleDeg * Math.PI) / 180, length, width, c.green, 22, word);
  }

  const isFlower = !recipe.shape || recipe.shape === "flower";

  if (recipe.shape === "heartburst") {
    const rays = Math.max(24, Math.round(120 * recipe.petalCount));
    const k = 15 * petalScale * 0.92;
    const pick = seededRandom(recipe.seed ^ 0x5bd1e995);
    const tones = [c.ring3, c.ring4, c.ring5];
    t.pensize(1);
    for (let i = 0; i < rays; i++) {
      t.penup();
      t.goto(0, 40 * petalScale - 20);
      const angle = (i * Math.PI * 2) / rays;
      const x = 16 * Math.sin(angle) ** 3 * k;
      const y = (13 * Math.cos(angle) - 5 * Math.cos(2 * angle) - 2 * Math.cos(3 * angle) - Math.cos(4 * angle)) * k - 20;
      t.setColor(tones[Math.floor(pick() * tones.length)]);
      t.pendown();
      t.goto(x, y);
      t.setheading(0);
      for (let s = 0; s < 8; s++) {
        t.forward(8);
        t.forward(-8);
        t.left(-45);
      }
    }
    t.penup();
    const small: Array<[number, number]> = [];
    for (let i = 0; i < 360; i++) {
      const a = (i / 360) * Math.PI * 2;
      small.push([16 * Math.sin(a) ** 3 * 5.6 * petalScale, (13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a)) * 5.6 * petalScale + 14]);
    }
    t.setColor(c.ring1);
    for (const [x, y] of evenlySpaced(small, Math.max(6, 14 / recipe.petalCount))) {
      t.goto(x, y);
      t.write(word, PETAL_FONT_PX, PETAL_FONT_FAMILY, "bold");
    }
  }

  if (!isFlower && recipe.shape !== "heartburst") {
    const colorsByRing = [c.ring1, c.ring2, c.ring3, c.ring4, c.ring5];
    t.penup();
    shapeRings(recipe.shape as RingShape, petalScale, recipe.petalCount).forEach((ring, index) => {
      t.setColor(colorsByRing[index]);
      for (const [x, y] of ring) {
        t.goto(x, y);
        t.write(word, PETAL_FONT_PX, PETAL_FONT_FAMILY, "bold");
      }
    });
  }

  // Stem & leaves (exact Turtle order)
  const stemPoints: Array<[number, number]> = [];
  if (isFlower && recipe.showStem) {
    t.penup();
    t.goto(0, -30);
    t.setheading(260);
    t.pendown();

    t.setColor(c.green);
    t.pensize(4);
    t.circle(250, 25);
    stemPoints.push([t.x, t.y]);

    const pos1: [number, number] = [t.x, t.y];
    const head1 = t.heading;
    t.pensize(1);
    if (recipe.showLeaves) drawLeaf(pos1, 160, 50, 25);
    t.penup();
    t.goto(pos1[0], pos1[1]);
    t.setheading(head1);
    t.pendown();

    t.setColor(c.green);
    t.pensize(4);
    t.circle(250, 30);
    stemPoints.push([t.x, t.y]);
    t.penup();
    t.pensize(1);

    const pos2: [number, number] = [t.x, t.y];
    const head2 = t.heading;
    if (recipe.showLeaves) drawLeaf(pos2, 20, 55, 28);
    t.penup();
    t.goto(pos2[0], pos2[1]);
    t.setheading(head2);
    t.pendown();

    t.setColor(c.green);
    t.pensize(4);
    t.circle(250, 30);
    stemPoints.push([t.x, t.y]);
    t.penup();
    t.pensize(1);

    // Stamped stem dedication message
    if (recipe.stemMessage && recipe.stemMessage.trim()) {
      t.setColor(c.green);
      const msg = recipe.stemMessage.trim();
      const p1 = stemPoints[0] || [0, -80];
      const p2 = stemPoints[stemPoints.length - 1] || [0, -180];
      const mx = (p1[0] + p2[0]) / 2 + 14;
      const my = (p1[1] + p2[1]) / 2;
      t.goto(mx, my);
      t.write(msg, STEM_FONT_PX, PETAL_FONT_FAMILY, "normal");
    }
  }

  // Petal generation: rings (default Turtle), spiral, or burst
  const ringColors = [c.ring1, c.ring2, c.ring3, c.ring4, c.ring5];
  if (isFlower) {
    if (arrangement === "spiral") {
      // Fibonacci phyllotaxis (Golden angle ~137.507764°)
      const totalPetals = Math.round(36 * recipe.petalCount);
      const goldenAngle = 137.507764 * (Math.PI / 180);
      for (let n = 0; n < totalPetals; n++) {
        const radius = Math.sqrt(n) * 8.5 * petalScale;
        const angle = n * goldenAngle;
        const bx = radius * Math.cos(angle);
        const by = radius * Math.sin(angle);
        const colorIdx = Math.min(4, Math.floor((n / totalPetals) * 5));
        const len = (40 + (n / totalPetals) * 70) * petalScale;
        const wid = (16 + (n / totalPetals) * 38) * petalScale;
        drawPetal([bx, by], angle, len, wid, ringColors[colorIdx]);
      }
    } else if (arrangement === "burst") {
      // Starburst outward rays
      const rays = Math.round(28 * recipe.petalCount);
      for (let i = 0; i < rays; i++) {
        const rad = ((i * 360) / rays) * (Math.PI / 180);
        const isLong = i % 2 === 0;
        const len = (isLong ? 115 : 75) * petalScale;
        const wid = (isLong ? 40 : 25) * petalScale;
        const color = isLong ? c.ring5 : c.ring3;
        drawPetal([0, 0], rad, len, wid, color);
      }
    } else {
      // Default: Original 5 concentric rings
      ORIGINAL_RINGS.forEach((ring, index) => {
        const count = Math.max(3, Math.round(ring.count * recipe.petalCount));
        for (let i = 0; i < count; i++) {
          const angle = (360 / count) * i + ring.offset;
          const rad = (angle * Math.PI) / 180;
          const baseX = ring.radius * petalScale * Math.cos(rad);
          const baseY = ring.radius * petalScale * Math.sin(rad);
          drawPetal([baseX, baseY], rad, ring.length * petalScale, ring.width * petalScale, ringColors[index]);
        }
      });
    }

    // Center custom name/inscription
    if (recipe.centerText && recipe.centerText.trim()) {
      t.penup();
      t.setColor(c.ring1);
      t.goto(0, -5);
      t.write(recipe.centerText.trim(), CENTER_FONT_PX, PETAL_FONT_FAMILY, "bold");
    }
  }

  // Floating hearts / decorations
  if (recipe.showHearts) {
    t.penup();
    t.setColor(c.hearts);
    const random = seededRandom(recipe.seed);
    const decoration = recipe.decoration || "♡";
    const tries = recipe.decorCount ?? 12;
    for (let n = 0; n < tries; n++) {
      const x = randint(random, -250, 250);
      const y = randint(random, -250, 250);
      if (Math.hypot(x, y) > 130) {
        t.goto(x, y);
        t.write(decoration, HEART_FONT_PX, HEART_FONT_FAMILY, "bold");
      }
    }
  }

  // Global rotation
  if (recipe.rotation) {
    const rad = (recipe.rotation * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const rotate = (x: number, y: number): [number, number] => [x * cos - y * sin, x * sin + y * cos];
    for (const p of primitives) {
      if (p.kind === "line") p.points = p.points.map(([x, y]) => rotate(x, y));
      else if (p.sizePx !== HEART_FONT_PX) [p.x, p.y] = rotate(p.x, p.y);
    }
  }

  return { primitives, background: c.background, bgStyle: recipe.bgStyle || "solid" };
}

export interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export type MeasureText = (text: string, sizePx: number, family: string, weight: string) => number;

export const approximateMeasure: MeasureText = (text, sizePx) => text.length * sizePx * 0.62;

export function boundingBox(primitives: Primitive[], measure: MeasureText = approximateMeasure): Box {
  const box: Box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const add = (x: number, y: number) => {
    box.minX = Math.min(box.minX, x);
    box.maxX = Math.max(box.maxX, x);
    box.minY = Math.min(box.minY, y);
    box.maxY = Math.max(box.maxY, y);
  };
  for (const p of primitives) {
    if (p.kind === "line") {
      const half = p.width / 2;
      for (const [x, y] of p.points) {
        add(x - half, y - half);
        add(x + half, y + half);
      }
    } else {
      const half = measure(p.text, p.sizePx, p.family, p.weight) / 2;
      add(p.x - half, p.y);
      add(p.x + half, p.y + p.sizePx * 1.15);
    }
  }
  if (!Number.isFinite(box.minX)) return { minX: -1, minY: -1, maxX: 1, maxY: 1 };
  return box;
}
