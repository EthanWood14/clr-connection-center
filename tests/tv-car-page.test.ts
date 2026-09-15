import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");
const page = read("client/src/pages/tv-car.tsx");
const app = read("client/src/App.tsx");
const sidebar = read("client/src/components/app-sidebar.tsx");

test("My TV Car has a lazy hash route and an Advanced Settings personal link", () => {
  assert.match(app, /const TvCar = lazy\(\(\) => import\("@\/pages\/tv-car"\)\)/);
  assert.match(app, /"\/tv-car":\s*"My TV Car"/);
  assert.match(app, /<Route path="\/tv-car" component=\{TvCar\}/);
  const from = sidebar.indexOf("const advancedPersonalItems:");
  const to = sidebar.indexOf("const teamItems:", from);
  assert.ok(from >= 0 && to > from, "personal navigation anchors exist");
  assert.match(sidebar.slice(from, to), /title: "My TV Car",\s*url: "\/tv-car"/);
  assert.match(sidebar, /advancedPersonalItems\.filter\(item => item.url !== "\/tv-car" \|\| canCustomizeTvCar\)/);
});

test("the page and navigation admit C3 CLRs, not LAP, LOP or manager-only accounts", () => {
  for (const source of [page, sidebar]) {
    assert.match(source, /user\.portal == null \|\| user\.portal === "c3"/);
    assert.match(source, /user\.role === "assistant" \|\| \(user\.role === "admin" && user\.isClr\)/);
  }
  const entry = page.slice(page.indexOf("export default function TvCar"));
  assert.ok(entry.indexOf("if (!canCustomize || !user)") < entry.indexOf("return <Garage"));
  assert.doesNotMatch(entry, /useQuery|useMutation/);
});

test("unsaved paint edits are separate from refetched data and scoped to the signed-in person", () => {
  assert.match(page, /const \[draft, setDraft\] = useState<TvCarAppearance \| null>\(null\)/);
  assert.match(page, /const appearance = draft \?\? saved/);
  assert.match(page, /const queryKey = \["\/api\/me\/tv-car", user\.orgId, user\.id\]/);
  assert.match(page, /<Garage key=\{`\$\{user\.orgId\}:\$\{user\.id\}`\}/);
  assert.doesNotMatch(page, /useEffect/, "a query-data effect must not overwrite the current draft");
});

test("saving sends only cosmetic fields and protects drafts during a pending save", () => {
  assert.match(page, /apiRequest\("PATCH", "\/api\/me\/tv-car", \{\s*bodyColor: next\.bodyColor, accentColor: next\.accentColor, livery: next\.livery,\s*\}\)/);
  assert.match(page, /queryClient\.cancelQueries\(\{ queryKey, exact: true \}\)/);
  assert.match(page, /<fieldset disabled=\{save\.isPending\}/);
  assert.match(page, /disabled=\{!dirty \|\| !valid \|\| save\.isPending\}/);
  assert.match(page, /Your draft is still here; try saving again/);
});

test("defaults stay a draft, all paint styles are supported, and the preview is local", () => {
  assert.match(page, /onClick=\{\(\) => update\(defaultTvCarAppearance\(user\.id\)\)\}/);
  for (const value of ["stripe", "double-stripe", "solid"]) assert.ok(page.includes(`value: "${value}"`));
  assert.match(page, /<svg viewBox="0 0 560 300" role="img"/);
  assert.match(page, /type="color"/);
  assert.match(page, /validateTvCarAppearance\(appearance\)/);
  assert.match(page, /cosmetic change only/);
  assert.doesNotMatch(page, /https?:\/\/|mountRaceScene/);
});
