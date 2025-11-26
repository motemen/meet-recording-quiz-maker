import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import ssrPlugin from "vite-ssr-components/plugin";

export default defineConfig({
  plugins: [react(), ssrPlugin()],
  build: {
    outDir: "dist/client",
    emptyOutDir: true,
    manifest: true,
    rollupOptions: {
      input: "/src/client/main.tsx",
    },
  },
  server: {
    port: 5173,
  },
  resolve: {
    alias: {
      "@": "/src/client",
    },
  },
});
