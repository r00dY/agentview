import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["agentview"],
  webpack: (config) => {
    // The agentview package uses .js extensions in TS imports (ESM convention).
    // Tell webpack to try .ts before .js so it finds the source files.
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
};

export default nextConfig;
