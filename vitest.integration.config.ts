import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Integration suite against a REAL local Supabase stack (see scripts/integration.mjs).
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    include: ["tests/integration/**/*.test.ts"],
    environment: "node",
    testTimeout: 60_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
