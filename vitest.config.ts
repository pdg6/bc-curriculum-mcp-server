import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
    setupFiles: ["src/test/setup.ts"],
    // Each test file gets its own DB via the setup helper
    pool: "forks",
    testTimeout: 15_000,
  },
});
