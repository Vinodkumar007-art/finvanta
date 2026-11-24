import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: { include: ["tests/**/*.test.ts"], environment: "node", env: { DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db" } },
});
