/** @type {import('next').NextConfig} */
const nextConfig = {
  // monorepo: 親ディレクトリのファイルを画像として参照する
  outputFileTracingRoot: new URL("../../", import.meta.url).pathname,
  // workspace package を Next.js に トランスパイルさせる（pipeline は ESM .js 拡張子付き import を使うため）
  transpilePackages: ["@rekishi/pipeline", "@rekishi/shared"],
  // pipeline / shared の ts ソースで import "./xxx.js" と書かれているのを .ts に解決する
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
      ".mjs": [".mts", ".mjs"],
    };
    return config;
  },
};

export default nextConfig;
