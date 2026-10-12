import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // libSQL ships native bindings; keep it out of the bundle.
  serverExternalPackages: ["@libsql/client"],
};

export default nextConfig;
