import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist/client",
    manifest: true,
    rollupOptions: {
      input: "/src/client.tsx",
    },
  },
  ssr: {
    noExternal: ["vite-ssr-components"],
  },
});
