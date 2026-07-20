import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
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
