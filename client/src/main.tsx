import { createRoot } from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components/error-boundary";
import { APP_VERSION } from "@shared/version";
import { applyProductMetadata, detectProductPortal } from "./lib/product-metadata";
import "./index.css";

// Normalize query strings inside the hash (e.g. "#/reset-password?token=abc")
// into the URL search, so wouter's hash location can match routes cleanly.
(() => {
  const hash = window.location.hash || "";
  const qIdx = hash.indexOf("?");
  if (qIdx !== -1) {
    const hashPath = hash.slice(0, qIdx);
    const hashSearch = hash.slice(qIdx); // includes leading "?"
    const newUrl = window.location.pathname + hashSearch + hashPath;
    window.history.replaceState(null, "", newUrl);
  }
})();

if (!window.location.hash) {
  window.location.hash = "#/";
}

applyProductMetadata(detectProductPortal(), { updateTitle: true });
const syncProductMetadata = () => {
  applyProductMetadata(detectProductPortal(), { updateTitle: true });
};
window.addEventListener("hashchange", syncProductMetadata);
window.addEventListener("popstate", syncProductMetadata);

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    const release = encodeURIComponent(APP_VERSION);
    navigator.serviceWorker.register(`/sw.js?v=${release}`, {
      scope: "/",
      updateViaCache: "none",
    }).then((registration) => {
      window.dispatchEvent(new Event("wcl:service-worker-ready"));
      void registration.update().catch(() => {});
    }).catch(() => {});
  });
}

createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);
