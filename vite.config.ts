import { defineConfig } from "vitest/config"

export default defineConfig({
  base: process.env.PAGES_BASE ?? "/",
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
})
