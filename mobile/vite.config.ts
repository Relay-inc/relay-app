// The phone's webview: mobile.html (src/mobile) from the same src/ as the desktop, built into mobile/dist for
// mobile/src-tauri. `pnpm exec vite build --config mobile/vite.config.ts` from the repo root.
import { defineConfig } from "vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

export default defineConfig({
  root,
  plugins: [react(), babel({ presets: [reactCompilerPreset()] }), tailwindcss()],
  build: { outDir: "mobile/dist", emptyOutDir: true, rollupOptions: { input: { mobile: "mobile.html" } } },
  clearScreen: false,
  server: { port: 1440, strictPort: true, host: true },
});
