import { resolve } from "node:path";
import { defineConfig } from "vite";

// `npm run dev`: the pages with hot reload; /api goes to the dev server (python -m giuthanh --dev --port 8777).
// Never 8767: that is the installed app, which may be running (a dev page there would play with its real session).
// `npm run build`: dist/, served by the app.
export default defineConfig({
  base: "/",
  server: { port: 5179, proxy: { "/api": "http://127.0.0.1:8777" } },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    chunkSizeWarningLimit: 1500,
    rollupOptions: { input: { main: resolve(import.meta.dirname, "index.html"), control: resolve(import.meta.dirname, "control.html") } },
  },
});
