import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  root: path.resolve(import.meta.dirname, "client"),
  base: "./",
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    // The app shipped as ONE 2.59 MB chunk: every page and every vendor, so a
    // logged-out visitor downloaded the whole admin app before seeing a login
    // form, and each deploy re-downloaded all of it. Pages are lazy now (see
    // App.tsx); these are the vendor splits worth naming.
    rollupOptions: {
      output: {
        manualChunks: {
          // React itself changes rarely — keep it cacheable across deploys.
          "vendor-react": ["react", "react-dom", "react/jsx-runtime"],
          // 433 kB of charting used by 9 reporting pages and nobody else.
          "vendor-charts": ["recharts"],
          "vendor-query": ["@tanstack/react-query"],
        },
      },
    },
    // The single chunk was 5x the default warning, which made the warning
    // meaningless. Lower it so a regression is visible again.
    chunkSizeWarningLimit: 700,
  },
  server: {
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});
