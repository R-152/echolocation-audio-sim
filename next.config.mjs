/** @type {import("next").NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "standalone",
  poweredByHeader: false,
  compress: true,
  allowedDevOrigins: ["192.168.1.138"]
};

export default nextConfig;
