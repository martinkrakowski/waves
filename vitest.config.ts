import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const contractSource = fileURLToPath(
  new URL("./packages/contract/src/index.ts", import.meta.url),
);

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "contract",
          include: ["packages/contract/__tests__/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        resolve: {
          alias: {
            "@hexagen-monaco/waves-contract": contractSource,
          },
        },
        test: {
          name: "server",
          include: ["packages/server/__tests__/**/*.test.ts"],
          exclude: ["packages/server/__tests__/ui/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        resolve: {
          alias: {
            "@hexagen-monaco/waves-contract": contractSource,
          },
        },
        test: {
          name: "ui",
          include: ["packages/server/__tests__/ui/**/*.test.ts"],
          environment: "happy-dom",
        },
      },
      {
        test: {
          name: "client",
          include: ["packages/client/__tests__/**/*.test.ts"],
          setupFiles: ["packages/client/__tests__/support/leak-guard.ts"],
          environment: "node",
        },
      },
    ],
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**/*.ts", "packages/server/public/**/*.js"],
      exclude: ["packages/*/src/main.ts", "packages/server/public/**/*.d.ts"],
      reporter: ["text", "json-summary"],
      thresholds: {
        lines: 100,
        branches: 100,
        functions: 100,
        statements: 100,
      },
    },
  },
});
