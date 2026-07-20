// Single source of truth for the app version (semver, "X.Y.Z").
//
// Bump this on every deploy. The client bakes this value into its bundle at
// build time, and the server serves it from GET /api/version. When a new build
// is deployed, already-open clients still hold the OLD baked value, so they see
// the server report a newer version and show an "update available" prompt.
//
// Convention: patch (3.11.x) for fixes/small features, minor (3.x.0) for larger
// features, major (x.0.0) for big releases.
export const APP_VERSION = "3.27.0";
