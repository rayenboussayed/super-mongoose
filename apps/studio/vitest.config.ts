import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["test/unit/**/*.spec.ts"],
          environment: "jsdom",
          setupFiles: ["test/setup.ts"],
        },
      },
      {
        test: {
          name: "integration",
          include: ["test/integration/**/*.spec.ts"],
          environment: "node",
          testTimeout: 60_000,
          hookTimeout: 120_000,
        },
      },
    ],
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 30_000,
    coverage: {
      provider: "v8",
      all: true,
      include: ["src/lib/**", "src/server/**"],
      exclude: ["**/node_modules/**", "dist/**", "coverage/**", "src/server/functions.ts"],
      reporter: ["text", "lcov", "json-summary"],
      reportsDirectory: "coverage",
      thresholds: {
        statements: 75,
        branches: 60,
        functions: 85,
        lines: 75,
      },
    },
  },
  resolve: {
    conditions: ["development"],
  },
});
