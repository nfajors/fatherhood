import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/lib/**/*.ts"],
      // Thin I/O wrappers are exercised against real services, not unit tests.
      exclude: ["src/lib/**/*.test.ts", "src/lib/db/**", "src/lib/auth*.ts"],
    },
  },
});
