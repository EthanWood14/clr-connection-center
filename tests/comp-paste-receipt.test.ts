import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const page = readFileSync(join(root, "client/src/pages/comp-requests.tsx"), "utf8");
const routes = readFileSync(join(root, "server/routes.ts"), "utf8");

test("a screenshot can be pasted anywhere on the comp page", () => {
  // A document-level listener is what makes Ctrl+V work without first clicking
  // into a particular field — which is how people actually paste a screenshot.
  assert.match(page, /document\.addEventListener\("paste", onDocPaste\)/);
  assert.match(page, /document\.removeEventListener\("paste", onDocPaste\)/, "the listener must be cleaned up");
  assert.match(page, /function imagesFromClipboard/);
});

test("a text paste is never intercepted", () => {
  const helper = page.slice(page.indexOf("function imagesFromClipboard"), page.indexOf("function Attachments("));
  // Only file items of an image type are taken; everything else falls through
  // to the field being typed in.
  assert.match(helper, /item\.kind !== "file" \|\| !item\.type\.startsWith\("image\/"\)/);
  const handler = page.slice(page.indexOf("function onDocPaste"), page.indexOf("document.addEventListener"));
  assert.match(handler, /if \(!images\.length\) return;/, "a non-image paste must return before preventDefault");
  assert.ok(handler.indexOf("if (!images.length) return;") < handler.indexOf("event.preventDefault()"),
    "preventDefault must come only after an image is confirmed");
});

test("a pasted screenshot gets a filename a person can recognise", () => {
  // Clipboard blobs arrive unnamed or as a generic image.png, and the API
  // stores whatever filename it is handed.
  const namer = page.slice(page.indexOf("function nameClipboardImage"), page.indexOf("function imagesFromClipboard"));
  assert.match(namer, /blob\.name\.toLowerCase\(\) !== "image\.png"/, "a real filename is kept as-is");
  assert.match(namer, /`screenshot \$\{stamp\}\.\$\{ext\}`/);
  assert.match(namer, /new File\(\[blob\]/);
});

test("oversized files are refused with a real number, before upload", () => {
  // The server's nominal 8 MB is unreachable: base64 inflates ~4/3 inside a
  // JSON body that body-parser caps at 10 MB, so a big file 413s with an
  // unparseable HTML error. The client stops it first.
  assert.match(page, /const COMP_ATTACH_MAX_BYTES = 7 \* 1024 \* 1024/);
  assert.match(page, /the limit is 7 MB/);
  assert.match(page, /up to 7 MB each/, "the helper copy must match the real limit");
  assert.match(routes, /const COMP_ATTACH_MAX_BYTES = 8 \* 1024 \* 1024/, "server cap unchanged; the client is deliberately stricter");
});

test("the success toast never claims a receipt that failed to upload", () => {
  const mut = page.slice(page.indexOf("const createMutation"), page.indexOf("const decideMutation"));
  // Failures are collected rather than swallowed...
  assert.match(mut, /failed\.push\(f\.name\)/);
  assert.ok(!/catch \{\}/.test(mut), "the silent catch must be gone");
  assert.match(mut, /attachedCount: pendingFiles\.length - failed\.length/);
  // ...and the count in the toast is what actually landed.
  assert.match(mut, /const attached = Number\(d\?\.attachedCount \?\? 0\)/);
  assert.match(mut, /receipt\(s\) did not upload/);
  assert.match(mut, /variant: "destructive"/);
});

test("pasted images preview as thumbnails and the object URLs are revoked", () => {
  assert.match(page, /URL\.createObjectURL\(f\)/);
  assert.match(page, /pendingPreviews\.forEach\(url => url && URL\.revokeObjectURL\(url\)\)/);
  assert.match(page, /data-testid="chip-pending-file"/);
});
