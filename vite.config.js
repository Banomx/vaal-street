import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// /ninja/* is proxied to https://poe.ninja/* by the dev server,
// so the browser only ever talks to localhost -> no CORS issues.
export default defineConfig({
  base: "./", // relative asset paths -> works on GitHub Pages project sites
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/ninja": {
        target: "https://poe.ninja",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/ninja/, ""),
        headers: { "User-Agent": "scarab-ledger/0.1 (local dev)" },
      },
    },
  },
  preview: {
    port: 5173,
    proxy: {
      "/ninja": {
        target: "https://poe.ninja",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/ninja/, ""),
        headers: { "User-Agent": "scarab-ledger/0.1 (local preview)" },
      },
    },
  },
});
