// The app's own Vite config plus one plugin: every page (index.html, settings.html) gets the mock backend as its first
// script, so the real entry files load unchanged. Port 1430, next to Tauri's 1420.
import { defineConfig, mergeConfig, type ConfigEnv, type UserConfig } from "vite";
import base from "../vite.config.ts";

const root = new URL("..", import.meta.url).pathname;

export default defineConfig((env: ConfigEnv) =>
  mergeConfig((typeof base === "function" ? base(env) : base) as UserConfig, {
    root,
    plugins: [
      {
        name: "relay-harness-mock-backend",
        transformIndexHtml: {
          order: "pre",
          handler: (html: string) => ({
            html,
            tags: [{ tag: "script", attrs: { type: "module", src: "/harness/mock-backend.ts" }, injectTo: "head-prepend" }],
          }),
        },
      },
    ],
    server: { port: 1430, strictPort: true, host: "127.0.0.1", hmr: false },
  } satisfies UserConfig),
);
