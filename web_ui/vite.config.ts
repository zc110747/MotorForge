import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Frontend build config. The dev server proxies nothing; it connects
// directly to the simulation WebSocket server (default 127.0.0.1:18098).
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
  },
  build: {
    outDir: "dist",
    sourcemap: false,
  },
});
