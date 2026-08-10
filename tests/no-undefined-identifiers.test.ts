import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * No shipped code may reference an identifier that does not exist.
 *
 * `npm run build` uses esbuild, which strips types without checking them, so a
 * plain typo compiles and deploys happily and then throws a ReferenceError in
 * the browser the moment that component renders. Three of these reached
 * production at once: `importedDialpadCalls` on the printable EOD sheet (which
 * renders on every submitted report — it took the whole page down),
 * `callbacksAndDeferrals` in the EOD history row, and `isAdminOrManager` on the
 * State Lookup page.
 *
 * The repo does not typecheck cleanly overall, so this deliberately checks ONE
 * error code rather than demanding a clean tsc. TS2304 is "Cannot find name",
 * which is exactly the class that becomes a runtime crash.
 */
test("no file references an identifier that is never defined", () => {
  let output = "";
  try {
    output = execFileSync("npx", ["tsc", "--noEmit", "-p", "tsconfig.json"], {
      cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], shell: true,
    });
  } catch (e: any) {
    // tsc exits non-zero while other pre-existing errors remain; the output is
    // what matters, not the exit code.
    output = `${e?.stdout ?? ""}${e?.stderr ?? ""}`;
  }

  const undefinedNames = output
    .split(/\r?\n/)
    .filter((l) => l.includes("error TS2304"))
    .map((l) => l.trim());

  assert.deepEqual(
    undefinedNames, [],
    `Undefined identifiers would throw a ReferenceError at runtime:\n${undefinedNames.join("\n")}`,
  );
});
