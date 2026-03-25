/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: process.env.NEXT_DIST_DIR || ".next",
  transpilePackages: ["@reselleros/types", "@reselleros/ui"]
};

export default nextConfig;
