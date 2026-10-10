/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  agentRules: false, // don't auto-generate AGENTS.md
  experimental: { serverActions: { bodySizeLimit: '1mb' } },
};
export default nextConfig;
