import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["test/unit/**/*.spec.ts"],
          environment: "node",
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
      {
        test: {
          name: "e2e",
          include: ["test/e2e/**/*.spec.ts"],
          environment: "node",
          testTimeout: 120_000,
          hookTimeout: 180_000,
        },
      },
    ],
    fileParallelism: false,
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    isolate: true,
    sequence: { concurrent: false },
    testTimeout: 30_000,
    hookTimeout: 60_000,
    teardownTimeout: 60_000,
    coverage: {
      provider: "v8",
      all: true,
      include: ["src/**/*.ts"],
      exclude: ["**/node_modules/**", "dist/**", "coverage/**"],
      reporter: ["text", "lcov", "json-summary"],
      reportsDirectory: "coverage",
      thresholds: {
        statements: 95,
        branches: 95,
        functions: 95,
        lines: 95,
      },
    },
  },
});
