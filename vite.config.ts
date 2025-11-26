import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { ssrComponents } from "vite-ssr-components";

export default defineConfig({
  plugins: [ssrComponents(), react()],
  build: {
    manifest: true,
    outDir: "dist/client",
  },
});
