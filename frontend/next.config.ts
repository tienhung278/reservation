import type { NextConfig } from "next";

// Backend defaults to port 3000; frontend scripts run on 3001 to avoid self-proxying.
const apiOrigin = process.env.RESERVATION_API_ORIGIN ?? "http://localhost:3000";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${apiOrigin}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
