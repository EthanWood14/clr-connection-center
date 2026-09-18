import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { dialpadCallUrl, reserveDialpadLaunch } from "../client/src/lib/dialpad-launch";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
type Popup = NonNullable<ReturnType<NonNullable<Parameters<typeof reserveDialpadLaunch>[1]>>>;

function popupFixture(options: { navigationThrows?: boolean; focusThrows?: boolean; closeThrows?: boolean } = {}) {
  const events: string[] = [], navigations: string[] = [];
  const popup = {
    closed: false, opener: { existing: true } as unknown,
    document: { title: "", body: { textContent: "" } },
    location: { replace(url: string) {
      events.push("navigate");
      if (options.navigationThrows) throw new Error("navigation denied");
      navigations.push(url);
    } },
    close() { events.push("close"); if (options.closeThrows) throw new Error("close denied"); popup.closed = true; },
    focus() { events.push("focus"); if (options.focusThrows) throw new Error("focus denied"); },
  };
  return { popup, events, navigations, open: () => { events.push("reserve"); return popup as unknown as Popup; } };
}

test("Dialpad URLs normalize domestic and explicit international numbers without changing the destination", () => {
  for (const [input, normalized] of [
    ["9495550100", "+19495550100"], [" (949) 555-0100 ", "+19495550100"],
    ["19495550100", "+19495550100"], ["1 (949) 555.0100", "+19495550100"],
    ["+1 949 555 0100", "+19495550100"], ["+44 20 7946 0958", "+442079460958"],
    ["+61 (2) 5550-1234", "+61255501234"], ["+123456789012345", "+123456789012345"],
  ]) {
    const result = dialpadCallUrl(input), url = new URL(result);
    assert.equal(result, `https://dialpad.com/launch?phone=${encodeURIComponent(normalized)}`);
    assert.equal(url.origin, "https://dialpad.com"); assert.equal(url.pathname, "/launch");
    assert.deepEqual([...url.searchParams.entries()], [["phone", normalized]]);
    assert.equal(url.hash, ""); assert.equal(url.username, "");
  }
});

test("bad numbers and URL/script injection are rejected before any popup is reserved", () => {
  for (const phone of ["", "   ", "55512", "+1234567", "+0123456789", "123456789012", "+1234567890123456",
    "++19495550100", "+1+9495550100", "9495550100 ext 4", "tel:+19495550100", "javascript:alert(1)",
    "https://evil.example/", "+19495550100&url=https://evil.example", "+19495550100?x=1", "%2B19495550100", "<img src=x>"] ) {
    let reserved = false;
    assert.throws(() => reserveDialpadLaunch(phone, () => { reserved = true; return null; }), /valid phone|full phone/);
    assert.equal(reserved, false, phone);
  }
});

test("default reservation opens only about:blank and detaches its opener before any external navigation", () => {
  const fixture = popupFixture(), calls: unknown[][] = [];
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    open: (...args: unknown[]) => { calls.push(args); return fixture.open(); },
  } });
  try {
    const launch = reserveDialpadLaunch("9495550100");
    assert.deepEqual(calls, [["about:blank", "_blank"]]);
    assert.equal(fixture.popup.opener, null);
    assert.match(fixture.popup.document.title, /Preparing Dialpad/);
    assert.match(fixture.popup.document.body.textContent, /Securing your lead/);
    assert.doesNotMatch(fixture.popup.document.body.textContent, /9495550100/);
    assert.deepEqual(fixture.navigations, []);
    assert.deepEqual(fixture.events, ["reserve"]);
    launch.cancel();
    assert.deepEqual(fixture.events, ["reserve", "close"]);
    assert.equal(launch.open(), false);
    assert.deepEqual(fixture.navigations, []);
  } finally {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("an explicitly approved launch navigates once; duplicate opens and late cancellation do nothing", () => {
  const fixture = popupFixture(), launch = reserveDialpadLaunch("9495550100", fixture.open);
  assert.deepEqual(fixture.navigations, [], "reservation itself must not reveal the number to Dialpad");
  assert.equal(launch.open(), true);
  assert.deepEqual(fixture.navigations, [dialpadCallUrl("9495550100")]);
  assert.deepEqual(fixture.events, ["reserve", "navigate", "focus"]);
  assert.equal(launch.open(), false);
  launch.cancel();
  assert.deepEqual(fixture.events, ["reserve", "navigate", "focus"]);
});

test("cancellation closes the blank reservation once and can never launch later", () => {
  const fixture = popupFixture(), launch = reserveDialpadLaunch("9495550100", fixture.open);
  launch.cancel(); launch.cancel();
  assert.equal(launch.open(), false);
  assert.deepEqual(fixture.navigations, []);
  assert.deepEqual(fixture.events, ["reserve", "close"]);
  const denied = popupFixture({ closeThrows: true }), deniedLaunch = reserveDialpadLaunch("9495550100", denied.open);
  assert.doesNotThrow(() => deniedLaunch.cancel());
  assert.equal(deniedLaunch.open(), false);
});

test("blocked, closed and throwing popup paths return false for an explicit retry link", () => {
  for (const opener of [() => null, () => { throw new Error("blocked"); }]) {
    const launch = reserveDialpadLaunch("9495550100", opener);
    assert.equal(launch.url, dialpadCallUrl("9495550100"));
    assert.equal(launch.open(), false); assert.equal(launch.open(), false);
  }
  const closed = popupFixture(), closedLaunch = reserveDialpadLaunch("9495550100", closed.open);
  closed.popup.closed = true;
  assert.equal(closedLaunch.open(), false);
  closed.popup.closed = false;
  assert.equal(closedLaunch.open(), false, "a settled failure is not silently retried");
  assert.deepEqual(closed.navigations, []);
  const throws = popupFixture({ navigationThrows: true }), throwingLaunch = reserveDialpadLaunch("9495550100", throws.open);
  assert.equal(throwingLaunch.open(), false);
  assert.deepEqual(throws.events, ["reserve", "navigate", "close"]);
  assert.deepEqual(throws.navigations, []);
});

test("popup preparation errors close the reservation without navigating", () => {
  for (const field of ["opener", "document"] as const) {
    const fixture = popupFixture();
    Object.defineProperty(fixture.popup, field, field === "opener"
      ? { set() { throw new Error("opener denied"); } }
      : { get() { throw new Error("document denied"); } });
    const launch = reserveDialpadLaunch("9495550100", fixture.open);
    assert.equal(launch.open(), false);
    assert.deepEqual(fixture.navigations, []);
    assert.deepEqual(fixture.events, ["reserve", "close"]);
  }
});

test("focus denial does not invalidate successful external navigation", () => {
  const fixture = popupFixture({ focusThrows: true }), launch = reserveDialpadLaunch("9495550100", fixture.open);
  assert.equal(launch.open(), true);
  assert.deepEqual(fixture.navigations, [launch.url]);
  assert.deepEqual(fixture.events, ["reserve", "navigate", "focus"]);
});

const components = [
  { path: "client/src/components/assigned-lo-lead-alert.tsx", handler: "callLead", mutation: "claim", argument: "lead-123" },
  { path: "client/src/components/shotgun-offer-alert.tsx", handler: "callOfferedLead", mutation: "confirm", argument: 123 },
  { path: "client/src/components/shotgun-result-card.tsx", handler: "callVerifiedLead", mutation: "openPhone", argument: undefined },
  { path: "client/src/components/shotgun-bounceback-prompt.tsx", handler: "callBouncebackLead", mutation: "accept", argument: 123 },
  { path: "client/src/components/shotgun-reclaim-prompt.tsx", handler: "callReclaimLead", mutation: "reclaim", argument: 123 },
] as const;

function extractedHandler(component: typeof components[number], dependencies: Record<string, unknown>) {
  const source = ts.createSourceFile(component.path, read(component.path), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let initializer: ts.Expression | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === component.handler) initializer = node.initializer;
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.ok(initializer, `production handler ${component.handler} exists`);
  const compiled = ts.transpileModule(`const handler = ${initializer.getText(source)};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  return new Function(...Object.keys(dependencies), `${compiled}\nreturn handler;`)(...Object.values(dependencies)) as () => void;
}

function handlerFixture(component: typeof components[number], invalidPhone = false,
  prepare?: (phone: string) => { complete(): void; cancel(): void } | null) {
  const events: string[] = [];
  let accept!: () => void, reject!: (error: Error) => void;
  const checked = new Promise<void>((resolve, fail) => { accept = resolve; reject = fail; });
  const identity = { current: "org1-user1" };
  const mutation = {
    mutateAsync: (argument?: unknown) => { assert.equal(argument, component.argument); events.push("server-check"); return checked; },
    mutate: () => { throw new Error("unmount-sensitive per-mutation callback path must not be used"); },
  };
  const launch = { complete: () => events.push("complete"), cancel: () => events.push("cancel") };
  const handler = extractedHandler(component, {
    prepareDialpadCall: (phone: string) => {
      assert.equal(phone, "+19495550100"); events.push("reserve");
      return invalidPhone ? null : prepare ? prepare(phone) : launch;
    },
    lead: { externalId: "lead-123", id: 123, phone: "+19495550100" },
    offered: { id: 123, phone: "+19495550100" },
    target: { id: 123, phone: "+19495550100" },
    [component.mutation]: mutation, identity, storageKey: "org1-user1",
    dismiss: () => events.push("dismiss"),
  });
  return { handler, events, accept, reject, identity };
}

const settle = () => new Promise<void>(resolve => setImmediate(resolve));

test("all call buttons reserve synchronously but complete only after their server check succeeds", async () => {
  for (const component of components) {
    const fixture = handlerFixture(component);
    fixture.handler();
    assert.deepEqual(fixture.events, ["reserve", "server-check"]);
    await settle();
    assert.deepEqual(fixture.events, ["reserve", "server-check"], "no external launch while ownership/compliance is unresolved");
    // No mounted mutation observer is involved: these promise continuations
    // still run if a successful refetch has removed the original card.
    fixture.accept(); await settle();
    assert.deepEqual(fixture.events, component.mutation === "claim"
      ? ["reserve", "server-check", "complete", "dismiss"] : ["reserve", "server-check", "complete"]);
  }
});

test("rejected claims, confirms and compliance checks cancel without completing", async () => {
  for (const component of components) {
    const fixture = handlerFixture(component);
    fixture.handler(); fixture.reject(new Error("lead moved or compliance failed")); await settle();
    assert.deepEqual(fixture.events, ["reserve", "server-check", "cancel"]);
  }
});

test("invalid phone preparation never claims a lead and assigned identity changes cancel late success", async () => {
  for (const component of components) {
    const fixture = handlerFixture(component, true);
    fixture.handler();
    assert.deepEqual(fixture.events, ["reserve"]);
  }
  const assigned = handlerFixture(components[0]);
  assigned.handler(); assigned.identity.current = "org2-user9";
  assigned.accept(); await settle();
  assert.deepEqual(assigned.events, ["reserve", "server-check", "cancel"]);
});

function hookFixture() {
  const path = "client/src/lib/dialpad-call.tsx";
  const source = ts.createSourceFile(path, read(path), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declaration = source.statements.find((node): node is ts.FunctionDeclaration =>
    ts.isFunctionDeclaration(node) && node.name?.text === "useDialpadCall");
  assert.ok(declaration);
  const compiled = ts.transpileModule(declaration.getText(source).replace(/^export\s+/, ""), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  const events: string[] = [];
  let cleanup = () => {}, count = 0;
  const dependencies = {
    useRef: (current: unknown) => ({ current }),
    useEffect: (effect: () => () => void) => { cleanup = effect(); },
    useCallback: (callback: unknown) => callback,
    prepareDialpadCall: () => {
      const id = ++count; events.push(`reserve:${id}`);
      return {
        complete: () => { events.push(`open:${id}`); return () => events.push(`dismiss:${id}`); },
        cancel: () => events.push(`cancel:${id}`),
      };
    },
  };
  const prepare = new Function(...Object.keys(dependencies), `${compiled}\nreturn useDialpadCall();`)(...Object.values(dependencies)) as
    (phone: string) => { complete(): void; cancel(): void } | null;
  return { prepare, events, unmount: () => cleanup() };
}

test("a late successful server response after dock unmount never opens Dialpad", async () => {
  for (const component of components) {
    const hook = hookFixture(), fixture = handlerFixture(component, false, hook.prepare);
    fixture.handler();
    assert.deepEqual(hook.events, ["reserve:1"]);
    hook.unmount();
    fixture.accept(); await settle();
    assert.deepEqual(hook.events, ["reserve:1", "cancel:1"], component.handler);
    assert.equal(hook.prepare("9495550100"), null, "stale closures cannot reserve another phone tab");
  }
});

test("mounted refetch-safe completions settle once and authorized retry feedback is removed on unmount", () => {
  const hook = hookFixture(), first = hook.prepare("9495550100")!;
  first.complete(); first.complete(); first.cancel();
  assert.deepEqual(hook.events, ["reserve:1", "open:1"]);
  const second = hook.prepare("9495550101")!;
  second.complete();
  assert.deepEqual(hook.events, ["reserve:1", "open:1", "reserve:2", "dismiss:1", "open:2"]);
  const pending = hook.prepare("9495550102")!;
  hook.unmount(); pending.complete(); pending.cancel(); hook.unmount();
  assert.deepEqual(hook.events, ["reserve:1", "open:1", "reserve:2", "dismiss:1", "open:2", "reserve:3", "cancel:3", "dismiss:2"]);
});

test("retry UI is explicit and secure; affected components never silently fall back to tel navigation", () => {
  const ui = read("client/src/lib/dialpad-call.tsx");
  assert.match(ui, /href=\{launch\.url\} target="_blank" rel="noopener noreferrer"/);
  assert.match(ui, /data-testid="dialpad-launch-retry"/);
  assert.match(ui, /browser blocked or closed/);
  assert.match(ui, /const opened = launch\.open\(\)/);
  assert.match(ui, /cancel: launch\.cancel/);
  assert.match(ui, /return \(\) => feedback\.dismiss\(\)/);
  for (const component of components) {
    const source = read(component.path);
    assert.doesNotMatch(source, /tel:|window\.location|location\.href\s*=/);
    assert.match(source, /const prepareDialpadCall = useDialpadCall\(\)/);
  }
});
