/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  transpilePackages: ["@reselleros/types", "@reselleros/ui"]
};

export default nextConfig;
