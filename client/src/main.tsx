import { createRoot } from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components/error-boundary";
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

createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);
