/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@workspace/ui"],
  experimental: {
    nodeMiddleware: true,
    // serverActions: true,
  }
}

export default nextConfig
