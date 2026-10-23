// Types for Vite's import.meta.env (kept local so the project does not need vite/client types to type-check).
interface ImportMetaEnv {
  readonly VITE_API_BASE?: string;
  readonly VITE_MEDIAPIPE_WASM?: string;
  readonly VITE_HAND_MODEL_URL?: string;
  readonly DEV?: boolean;
  readonly PROD?: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module "*.css";
