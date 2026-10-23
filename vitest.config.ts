import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const src = (path: string) => fileURLToPath(new URL(`./packages/${path}`, import.meta.url));

export default defineConfig({
  resolve: {
    // Resolve workspace packages from source so tests do not require a build.
    alias: [
      { find: /^@factory\/contracts\/testing$/, replacement: src("contracts/src/testing.ts") },
      { find: /^@factory\/([a-z-]+)$/, replacement: src("$1/src/index.ts") },
    ],
  },
  test: {
    include: ["packages/*/src/**/*.test.ts", "roles/**/*.test.ts"],
  },
});
