import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    // mobile/src: the app's pure modules (no React Native imports) are tested here too.
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts", "mobile/src/**/*.test.ts"],
    // Integration tests share one database and truncate it, so run files one at a time.
    fileParallelism: !process.env.TEST_DATABASE_URL,
    coverage: {
      provider: "v8",
      include: ["src/lib/**/*.ts"],
      // Thin I/O wrappers are exercised against real services, not unit tests.
      exclude: ["src/lib/**/*.test.ts", "src/lib/db/**", "src/lib/auth*.ts"],
    },
  },
});
