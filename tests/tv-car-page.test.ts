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

test("the page and navigation share the narrow CLR-or-owner race participant policy", () => {
  for (const source of [page, sidebar]) {
    assert.match(source, /import \{ isTvCarParticipant \} from "@shared\/tv-race-participation"/);
    assert.match(source, /isTvCarParticipant\(user\)/);
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
  assert.match(page, /useEffect\(\(\) => \(\) => \{ pictureRequest\.current \+= 1; \}, \[\]\)/,
    "the image cleanup effect only cancels late decoding, never reseeds paint");
  assert.doesNotMatch(page, /useEffect\([\s\S]*?setDraft\([\s\S]*?\}, \[car\.data/);
});

test("saving sends only cosmetic fields and protects drafts during a pending save", () => {
  assert.match(page, /apiRequest\("PATCH", "\/api\/me\/tv-car", \{\s*bodyColor: next\.bodyColor, accentColor: next\.accentColor, livery: next\.livery,\s*\}\)/);
  assert.match(page, /queryClient\.cancelQueries\(\{ queryKey, exact: true \}\)/);
  assert.match(page, /const busy = save\.isPending \|\| wrap\.isPending \|\| preparingWrap/);
  assert.match(page, /<fieldset disabled=\{busy\}/);
  assert.match(page, /disabled=\{!dirty \|\| !valid \|\| busy \|\| !!preparedWrap\}/);
  assert.match(page, /Your draft is still here; try saving again/);
});

test("defaults stay a draft, all paint styles are supported, and the preview is local", () => {
  assert.match(page, /onClick=\{\(\) => update\(defaultTvCarAppearance\(user\.id\)\)\}/);
  for (const value of ["stripe", "double-stripe", "solid"]) assert.ok(page.includes(`value: "${value}"`));
  assert.match(page, /<svg viewBox="0 0 560 300" role="img"/);
  assert.match(page, /type="color"/);
  assert.match(page, /validateTvCarAppearance\(\{ bodyColor: appearance\.bodyColor, accentColor: appearance\.accentColor, livery: appearance\.livery \}\)/);
  assert.match(page, /cosmetic change only/);
  assert.doesNotMatch(page, /https?:\/\/|mountRaceScene/);
});

test("pictures preview on the body before an explicit upload and can be replaced or removed", () => {
  assert.match(page, /type="file" accept="image\/png,image\/jpeg,image\/webp"/);
  assert.match(page, /prepareTvCarWrap\(file\)/);
  assert.match(page, /picturePreview=\{preparedWrap\?\.previewUrl\}/);
  const body = page.slice(page.indexOf('<g clipPath='), page.indexOf('function ColorPicker'));
  assert.match(body, /<image href=\{wrapUrl\}/);
  assert.ok(body.indexOf('<image') < body.indexOf('livery === "stripe"'), "stripes remain above the picture");
  assert.match(page, /isSafeTvCarWrapUrl\(appearance\.wrapUrl\)/);
  assert.match(page, /data-testid="upload-tv-car-wrap"/);
  assert.match(page, /data-testid="remove-tv-car-wrap"/);
  assert.match(page, /Replace your picture/);
  assert.match(page, /role="alert"/);
  assert.match(page, /aria-live="polite"/);
  assert.match(page, /up to 8 MB/);
  assert.doesNotMatch(page, /dangerouslySetInnerHTML/);
});

test("picture operations are self-scoped, upload decoded PNG bytes and retain unsaved paint", () => {
  assert.match(page, /fetch\("\/api\/me\/tv-car\/wrap", \{\s*method: "POST", credentials: "include", headers: \{ "Content-Type": "image\/png" \}, body: change\.picture\.blob/);
  assert.match(page, /apiRequest\("DELETE", "\/api\/me\/tv-car\/wrap"\)/);
  assert.match(page, /setDraft\(current => current \? \{ \.\.\.current, wrapUrl: data\.appearance\.wrapUrl \} : null\)/);
  assert.match(page, /request === pictureRequest\.current/);
  assert.match(page, /Upload or discard your picture before saving paint/);
  assert.doesNotMatch(page, /\/api\/users\/|assistantId:|userId:/);
});

test("pixel workshop is the default, preserves separate drafts and shares the real 3D model", () => {
  assert.match(page, /useState<"skin" \| "paint">\("skin"\)/);
  assert.match(page, /const CarSkinPreview = lazy/);
  assert.match(page, /<CarSkinEditor[\s\S]*onBusyChange=\{setPreparingSkin\}/);
  assert.match(page, /const editingSkin = skinDraft \?\? saved\.skin \?\? blankSkin/);
  assert.match(page, /<CarSkinPreview appearance=\{\{ \.\.\.saved, skin: editingSkin \}\}/);
  assert.match(page, /apiRequest\("PUT", "\/api\/me\/tv-car\/skin", \{ skin: next \}\)/);
  assert.match(page, /apiRequest\("DELETE", "\/api\/me\/tv-car\/skin"\)/);
  assert.match(page, /disabled=\{!skinDirty \|\| busy\}/);
  assert.match(page, /skinSave\.isPending \|\| preparingSkin/);
  assert.match(page, /<AlertDialogTitle>Return to paint and pictures/);
  assert.match(page, /setDraft\(current => current \? \{ \.\.\.current, skin: data\.appearance\.skin \} : null\)/);
  assert.match(page, /window\.addEventListener\("beforeunload", warn\)/);
});
