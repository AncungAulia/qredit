import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: { tsconfigPaths: true },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    // Vitest does not read .env.local; these public URLs match .env.example so tests never depend on it.
    env: {
      NEXT_PUBLIC_API_URL: "https://api.qredit.fun",
      NEXT_PUBLIC_QORE_EVM_URL: "https://evm-testnet.qore.host",
      NEXT_PUBLIC_QORE_CHAIN_ID: "qorechain-diana",
      NEXT_PUBLIC_EXPLORER_URL: "",
    },
  },
});
