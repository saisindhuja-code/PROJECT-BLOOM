/**
 * Turns MediaPipe hand landmarks into a flower placement, so the flower looks
 * held: the stem's end sits between thumb and index finger and the flower
 * leans the way the hand points.
 *
 * Pure maths (no browser APIs) so it can be tested on its own.
 */

import type { FlowerPlacement } from "../imaging/compose";

export interface Landmark {
  x: number; // 0..1 across the video frame
  y: number; // 0..1 down the video frame
  z?: number;
}

// MediaPipe hand landmark indices
const WRIST = 0;
const THUMB_TIP = 4;
const INDEX_MCP = 5;
const INDEX_PIP = 6;
const MIDDLE_MCP = 9;
const PINKY_MCP = 17;

export interface HandGeometry {
  /** Where the stem should be held, in pixels. */
  grip: { x: number; y: number };
  /** Direction the hand points (wrist -> knuckles), unit vector in pixels. */
  up: { x: number; y: number };
  /** Rough hand length in pixels (wrist -> middle knuckle). */
  length: number;
}

export function handGeometry(landmarks: Landmark[], width: number, height: number, mirrored: boolean): HandGeometry | null {
  if (landmarks.length < 21) return null;
  const p = (i: number) => ({ x: (mirrored ? 1 - landmarks[i].x : landmarks[i].x) * width, y: landmarks[i].y * height });
  const thumb = p(THUMB_TIP);
  const indexPip = p(INDEX_PIP);
  const indexMcp = p(INDEX_MCP);
  const wrist = p(WRIST);
  const middle = p(MIDDLE_MCP);
  const pinky = p(PINKY_MCP);
  // Grip: between the thumb tip and the index finger, nudged toward the palm.
  const grip = {
    x: (thumb.x + indexPip.x) / 2 * 0.75 + indexMcp.x * 0.25,
    y: (thumb.y + indexPip.y) / 2 * 0.75 + indexMcp.y * 0.25,
  };
  const knuckles = { x: (middle.x + indexMcp.x + pinky.x) / 3, y: (middle.y + indexMcp.y + pinky.y) / 3 };
  const dx = knuckles.x - wrist.x;
  const dy = knuckles.y - wrist.y;
  const length = Math.hypot(dx, dy);
  if (length < 4) return null;
  return { grip, up: { x: dx / length, y: dy / length }, length };
}

/**
 * Places the flower so its stem end is at the grip and the flower head lies
 * in the direction the hand points.
 *
 * stemEnd: stem end relative to the flower centre (turtle units, y down).
 * stickerHeight: flower height in turtle units (from flowerSticker()).
 */
export function placementFromHand(
  hand: HandGeometry,
  stemEnd: { x: number; y: number },
  stickerHeight: number,
  frame: { width: number; height: number },
  previous: FlowerPlacement,
): FlowerPlacement {
  // Size the flower relative to the hand (about 2.6 hand lengths tall).
  const size = Math.min(1.6, Math.max(0.25, (hand.length * 2.6) / frame.height));
  const k = (size * frame.height) / stickerHeight; // pixels per turtle unit

  // Angle of (centre - stemEnd) in the unrotated flower, and the angle we want.
  const natural = Math.atan2(-stemEnd.y, -stemEnd.x);
  const wanted = Math.atan2(hand.up.y, hand.up.x);
  const rotation = wanted - natural;

  // centre = grip + R(rotation) * (-stemEnd) * k
  const vx = -stemEnd.x * k;
  const vy = -stemEnd.y * k;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const cx = hand.grip.x + vx * cos - vy * sin;
  const cy = hand.grip.y + vx * sin + vy * cos;

  let degrees = (rotation * 180) / Math.PI;
  while (degrees > 180) degrees -= 360;
  while (degrees < -180) degrees += 360;

  return {
    ...previous,
    x: cx / frame.width,
    y: cy / frame.height,
    size,
    rotation: degrees,
    flip: false,
    visible: true,
  };
}

/** Exponential smoothing so the flower does not jitter with the hand. */
export function smoothPlacement(previous: FlowerPlacement, next: FlowerPlacement, amount = 0.35): FlowerPlacement {
  const mix = (a: number, b: number) => a + (b - a) * amount;
  let dr = next.rotation - previous.rotation;
  while (dr > 180) dr -= 360;
  while (dr < -180) dr += 360;
  return {
    ...next,
    x: mix(previous.x, next.x),
    y: mix(previous.y, next.y),
    size: mix(previous.size, next.size),
    rotation: previous.rotation + dr * amount,
  };
}
