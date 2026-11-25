import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@qredit/qore"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
