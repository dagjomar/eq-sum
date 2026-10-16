import { resolve } from "node:path"
import { defineConfig } from "vitest/config"

export default defineConfig({
  base: process.env.PAGES_BASE ?? "/",
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        app: resolve(__dirname, "app/index.html"),
        // Unlinked and noindex. Present so /trace/ works as a direct URL.
        trace: resolve(__dirname, "trace/index.html"),
      },
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
})
