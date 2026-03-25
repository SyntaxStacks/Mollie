/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: process.env.NEXT_DIST_DIR || ".next",
  typescript: {
    tsconfigPath: process.env.NEXT_DIST_DIR === ".next-ui-e2e" ? "./tsconfig.ui-e2e.json" : "./tsconfig.json"
  },
  transpilePackages: ["@reselleros/types", "@reselleros/ui"]
};

export default nextConfig;
