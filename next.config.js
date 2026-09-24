/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    return [
      {
        // The SPA shell (prerendered "/") must always revalidate — it
        // references content-hashed chunks, and caching the shell itself
        // means a broken/half-deployed build keeps rendering (plain HTML,
        // 404 chunks) from browser cache even after the server is fixed.
        // Chunk files under /_next/static keep their immutable cache.
        source: "/",
        headers: [{ key: "Cache-Control", value: "no-cache, must-revalidate" }],
      },
    ];
  },
};

module.exports = nextConfig;