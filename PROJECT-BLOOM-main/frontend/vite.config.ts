import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In development the React app runs here (http://localhost:5173) and sends
// /api requests (including the Live Bloom WebSocket) to the FastAPI backend.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8000",
        ws: true,
      },
    },
  },
  build: {
    target: "es2021",
    chunkSizeWarningLimit: 900,
  },
});
