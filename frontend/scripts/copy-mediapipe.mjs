// Runs after `npm install`.
// 1. Copies MediaPipe's WebAssembly files into public/mediapipe/wasm so hand
//    tracking loads from your own server (same version as the npm package).
// 2. Tries to download the hand landmark model into public/mediapipe/.
//    If you are offline, the app downloads the model from Google at runtime.
import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const wasmSource = join(root, "node_modules", "@mediapipe", "tasks-vision", "wasm");
const target = join(root, "public", "mediapipe");
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

mkdirSync(target, { recursive: true });

if (existsSync(wasmSource)) {
  cpSync(wasmSource, join(target, "wasm"), { recursive: true });
  console.log("[bloom] Copied MediaPipe wasm files to public/mediapipe/wasm");
} else {
  console.warn("[bloom] @mediapipe/tasks-vision is not installed; hand tracking will be unavailable.");
}

const modelPath = join(target, "hand_landmarker.task");
if (!existsSync(modelPath)) {
  try {
    const response = await fetch(MODEL_URL);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    writeFileSync(modelPath, Buffer.from(await response.arrayBuffer()));
    console.log("[bloom] Downloaded the hand landmark model to public/mediapipe/hand_landmarker.task");
  } catch (error) {
    console.warn(`[bloom] Could not download the hand model (${error.message}). It will load from Google at runtime.`);
  }
}
