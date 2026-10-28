import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  server: {
    host: "127.0.0.1",
    port: 3010,
  },
  preview: {
    host: "127.0.0.1",
    port: 3010,
  },
  resolve: {
    tsconfigPaths: true,
    alias: {
      "super-mongoose": fileURLToPath(new URL("../../packages/super-mongoose/src/index.ts", import.meta.url)),
    },
  },
  plugins: [tanstackStart(), viteReact()],
});
