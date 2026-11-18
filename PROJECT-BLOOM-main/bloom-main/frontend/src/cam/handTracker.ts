/**
 * Optional hand tracking with MediaPipe Tasks (runs in the browser; video
 * never leaves the device).
 *
 * Loads lazily the first time it is switched on. The WebAssembly files come
 * from /mediapipe/wasm (copied there by `npm install`), the model from
 * /mediapipe/hand_landmarker.task or, failing that, Google's model server.
 */

import type { Landmark } from "./handPose";

export interface HandTracker {
  detect(video: HTMLVideoElement, timestampMs: number): Landmark[] | null;
  close(): void;
}

const WASM_PATH = import.meta.env.VITE_MEDIAPIPE_WASM || "/mediapipe/wasm";
const MODEL_URLS = [
  import.meta.env.VITE_HAND_MODEL_URL,
  "/mediapipe/hand_landmarker.task",
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
].filter((url): url is string => Boolean(url));

async function firstReachable(urls: string[]): Promise<string> {
  for (const url of urls) {
    try {
      const response = await fetch(url, { method: "HEAD" });
      const type = response.headers.get("content-type") ?? "";
      if (response.ok && !type.includes("text/html")) return url;
    } catch {
      /* try the next one */
    }
  }
  throw new Error("The hand-tracking model could not be downloaded. Check your internet connection.");
}

export async function createHandTracker(): Promise<HandTracker> {
  let vision: typeof import("@mediapipe/tasks-vision");
  try {
    vision = await import("@mediapipe/tasks-vision");
  } catch {
    throw new Error("Hand tracking is not installed. Run npm install in the frontend folder.");
  }
  const modelAssetPath = await firstReachable(MODEL_URLS);
  const fileset = await vision.FilesetResolver.forVisionTasks(WASM_PATH);
  const create = (delegate: "GPU" | "CPU") =>
    vision.HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath, delegate },
      runningMode: "VIDEO",
      numHands: 1,
      minHandDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
  let landmarker: Awaited<ReturnType<typeof create>>;
  try {
    landmarker = await create("GPU");
  } catch {
    landmarker = await create("CPU");
  }
  let lastTimestamp = -1;
  return {
    detect(video, timestampMs) {
      if (video.readyState < 2 || video.videoWidth === 0) return null;
      const ts = Math.max(timestampMs, lastTimestamp + 1);
      lastTimestamp = ts;
      const result = landmarker.detectForVideo(video, ts);
      const hand = result.landmarks?.[0];
      return hand && hand.length >= 21 ? hand : null;
    },
    close() {
      landmarker.close();
    },
  };
}
