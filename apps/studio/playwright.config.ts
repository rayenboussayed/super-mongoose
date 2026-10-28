import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "test/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  globalSetup: "./test/e2e/global-setup.ts",
  globalTeardown: "./test/e2e/global-teardown.ts",
  use: {
    baseURL: "http://127.0.0.1:3010",
    trace: "on-first-retry",
    launchOptions: { executablePath: "/home/malek/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome" },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run start",
    url: "http://127.0.0.1:3010",
    reuseExistingServer: true,
    timeout: 180_000,
    env: {
      MONGO_URL: "mongodb://127.0.0.1:27018",
      MONGO_DB: "super_mongoose_studio_e2e",
      SUPER_MONGOOSE_CONTRACTS: "/tmp/opencode/super-mongoose-build/apps/studio/contracts/demo.mjs",
    },
  },
});
