// Lead capture — the qualification checklist, info-gathering fields, and lead
// source asked on every logged call.
//
// One definition shared by the Input Results wizard (outcomes.tsx), the
// live-call Script page, and — since 14 Sep 2026 — the Chrome extension's
// "Log result in C3" panel, whose write-up the SERVER composes. So the
// definitions now live in shared/lead-capture.ts; this module re-exports them
// so every client import keeps working unchanged.
export * from "@shared/lead-capture";
