import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as {
  version: string;
};

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Injected as a string literal at build time so the boot screen's version
  // line can't drift from package.json the way a hand-typed copy would.
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  server: {
    port: 5173,
    // Dev-only: proxies /api to the local node so nothing needs hardcoding
    // here. A production build talking to a remote node instead uses
    // VITE_API_BASE (see src/lib/api.ts and .env.example) — this proxy
    // block has no effect once the dashboard is actually built/deployed.
    proxy: {
      "/api": {
        target: "http://localhost:8080",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
});
