/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["@sparticuz/chromium", "playwright-core"],
  outputFileTracingIncludes: {
    "/api/run-batch": ["./node_modules/@sparticuz/chromium/bin/**"],
  },
};
export default nextConfig;
