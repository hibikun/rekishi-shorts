/** @type {import('next').NextConfig} */
const nextConfig = {
  // monorepo: 親ディレクトリのファイルを画像として参照する
  outputFileTracingRoot: new URL("../../", import.meta.url).pathname,
  // workspace package を Next.js に トランスパイルさせる（pipeline は ESM .js 拡張子付き import を使うため）
  transpilePackages: ["@rekishi/pipeline", "@rekishi/shared"],
  // Remotion 関連（@remotion/bundler / @remotion/renderer / @rekishi/renderer 等）は
  // webpack で bundle せず Node 標準解決に任せる。
  // bundle すると Remotion 内部の binary asset (esbuild バイナリ等) で
  // "Module parse failed: Unexpected character" が発生する。
  serverExternalPackages: [
    "@rekishi/renderer",
    "@remotion/bundler",
    "@remotion/renderer",
    "@remotion/cli",
    "remotion",
    "esbuild",
    "@swc/core",
  ],
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
