import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Runs cleanly under root server.ts middleware mode on port 3000 (or standalone Vite on 3000).
export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 3000,
    allowedHosts: true,
    hmr: false,
  },
  build: {
    target: "es2021",
    chunkSizeWarningLimit: 900,
  },
});
