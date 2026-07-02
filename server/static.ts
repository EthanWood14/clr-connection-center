import express, { type Express } from "express";
import fs from "fs";
import path from "path";

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  // Serve manifest.json with the correct MIME type Chrome requires for PWA install
  app.get("/manifest.json", (_req, res) => {
    res.setHeader("Content-Type", "application/manifest+json");
    res.sendFile(path.resolve(distPath, "manifest.json"));
  });

  app.use(express.static(distPath, {
    setHeaders: (res, filePath) => {
      // index.html must NEVER be cached — it points at the current hashed
      // bundle, and a stale copy references a deleted asset → blank app after a
      // deploy. Hashed build assets are content-addressed, so cache them forever.
      if (/\.html$/i.test(filePath)) {
        res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      } else if (/[\\/]assets[\\/]/.test(filePath)) {
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      }
    },
  }));

  // SPA fallback — always serve a fresh index.html (never cached).
  app.use("/{*path}", (_req, res) => {
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
