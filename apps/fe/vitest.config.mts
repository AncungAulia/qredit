import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: { tsconfigPaths: true },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    // Vitest does not read .env.local; tests mock the api layer, so any valid URL works.
    env: { NEXT_PUBLIC_API_URL: "http://localhost:4010" },
  },
});
