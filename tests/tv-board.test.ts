import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  classifyOutcome, detectMilestones, flattenTips, pickTip, whenLabel, type OutcomeRow,
} from "../server/tv-board";
import { TRAINING_DAYS } from "../shared/clr-training";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const routes = readFileSync(join(root, "server/routes.ts"), "utf8");
const page = readFileSync(join(root, "client/src/pages/tv.tsx"), "utf8");
const app = readFileSync(join(root, "client/src/App.tsx"), "utf8");
const storage = readFileSync(join(root, "server/storage.ts"), "utf8");

const row = (over: Partial<OutcomeRow> = {}): OutcomeRow => ({
  id: 7, outcome_type: "transfer", borrower_name: "Maria Alvarez", assistant_name: "Elleine Asuncion",
  lo_name: "Christopher Redoble", created_at: "2026-09-01T20:00:00.000Z", updated_at: null, ...over,
});

test("a transfer is a transfer, and says who it went to", () => {
  const e = classifyOutcome(row())!;
  assert.equal(e.kind, "transfer");
  assert.equal(e.id, "7:transfer");
  assert.equal(e.borrower, "Maria Alvarez");
  assert.equal(e.who, "Elleine Asuncion");
  assert.equal(e.detail, "to Christopher Redoble");
});

test("an appointment is a meeting set; a rescheduled one is a meeting moved", () => {
  const set = classifyOutcome(row({ outcome_type: "appointment", appointment_datetime: "2026-09-03T14:30" }))!;
  assert.equal(set.kind, "appointment");
  assert.match(String(set.detail), /Thu/);
  const moved = classifyOutcome(row({ outcome_type: "appointment", rescheduled: 1, reschedule_datetime: "2026-09-04T09:00" }))!;
  assert.equal(moved.kind, "rescheduled");
  assert.match(String(moved.detail), /^Moved to Fri/);
  // Different ids, so the same row can play twice as two different things.
  assert.notEqual(set.id, moved.id);
});

test("a fell-through WITH a reason is a missed appointment; without one it is just a fall-through", () => {
  const missed = classifyOutcome(row({ outcome_type: "fell_through", missed_reason: "No-show, phone off" }))!;
  assert.equal(missed.kind, "missed_appointment");
  assert.equal(missed.detail, "No-show, phone off");
  const plain = classifyOutcome(row({ outcome_type: "fell_through", missed_reason: "" }))!;
  assert.equal(plain.kind, "fell_through");
  assert.equal(plain.detail, "with Christopher Redoble");
});

test("the wall only shouts about the moments worth looking up for", () => {
  for (const t of ["no_answer", "wrong_number", "deferral", "not_interested", "other", "future_contact"]) {
    assert.equal(classifyOutcome(row({ outcome_type: t })), null, `${t} must be silent`);
  }
});

test("the event time is the UPDATE time when there is one", () => {
  // An appointment marked missed is an edit; created_at would put it hours or
  // days in the past and the TV would think it had already played.
  const e = classifyOutcome(row({ outcome_type: "fell_through", missed_reason: "late", updated_at: "2026-09-02T01:00:00.000Z" }))!;
  assert.equal(e.at, "2026-09-02T01:00:00.000Z");
});

test("a blank borrower or CLR still reads as a sentence", () => {
  const e = classifyOutcome(row({ borrower_name: "  ", assistant_name: null, lo_name: null }))!;
  assert.equal(e.borrower, "A borrower");
  assert.equal(e.who, "A CLR");
  assert.equal(e.detail, null);
});

test("whenLabel reads a wall-clock stamp in the office's own time", () => {
  // "2026-09-03T14:30" carries no zone, so it is 2:30 PM as typed.
  assert.match(String(whenLabel("2026-09-03T14:30")), /2:30\s?PM/);
  assert.equal(whenLabel(null), null);
  assert.equal(whenLabel("garbage"), "garbage", "unparseable text is shown rather than dropped");
});

// ── milestones ──────────────────────────────────────────────────────────────
const person = (over: Partial<Parameters<typeof detectMilestones>[0]["people"][number]> = {}) => ({
  id: 1, name: "Tommy Le", transfersToday: 0, transfersWeek: 0, appointmentsToday: 0, appointmentsWeek: 0,
  goalTransfersWeekly: 0, goalAppointmentsWeekly: 0, bestDayBefore: 0, ...over,
});
const input = (people: ReturnType<typeof person>[]) => ({ today: "2026-09-01", weekStart: "2026-08-31", people });

test("milestone ids are stable across polls, so each plays exactly once", () => {
  const a = detectMilestones(input([person({ transfersToday: 26 }), person({ id: 2, name: "Linda", transfersToday: 25 })]));
  const b = detectMilestones(input([person({ transfersToday: 27 }), person({ id: 2, name: "Linda", transfersToday: 25 })]));
  const ida = a.find((m) => m.kind === "team_day")!.id;
  const idb = b.find((m) => m.kind === "team_day")!.id;
  assert.equal(ida, "team-day-50-2026-09-01");
  assert.equal(idb, ida, "51 and 52 both sit on the 50 step; same id, no re-celebration");
});

test("a bigger number crosses to a bigger step and a bigger celebration", () => {
  const m = detectMilestones(input([person({ transfersToday: 100 })]));
  const day = m.find((x) => x.kind === "team_day")!;
  assert.equal(day.headline, "100 transfers today");
  assert.equal(day.weight, 3);
  const small = detectMilestones(input([person({ transfersToday: 10 })])).find((x) => x.kind === "team_day")!;
  assert.equal(small.weight, 2);
  assert.equal(detectMilestones(input([person({ transfersToday: 9 })])).some((x) => x.kind === "team_day"), false);
});

test("a personal best needs a real record to beat", () => {
  // Beating a two-transfer record by one is not a moment.
  assert.equal(detectMilestones(input([person({ transfersToday: 3, bestDayBefore: 2 })])).some((m) => m.kind === "personal_best"), false);
  assert.equal(detectMilestones(input([person({ transfersToday: 5, bestDayBefore: 5 })])).some((m) => m.kind === "personal_best"), false, "equal is not a best");
  const pb = detectMilestones(input([person({ transfersToday: 6, bestDayBefore: 5 })])).find((m) => m.kind === "personal_best")!;
  assert.ok(pb);
  assert.match(pb.detail, /Old record was 5/);
  assert.equal(pb.weight, 3);
});

test("hitting a weekly goal is named, and only when there is a goal", () => {
  const hit = detectMilestones(input([person({ transfersWeek: 12, goalTransfersWeekly: 12 })]));
  assert.ok(hit.some((m) => m.kind === "goal_transfers" && m.id === "goal-transfers-1-2026-08-31"));
  const noGoal = detectMilestones(input([person({ transfersWeek: 40, goalTransfersWeekly: 0 })]));
  assert.equal(noGoal.some((m) => m.kind === "goal_transfers"), false);
});

test("heaviest milestone first, so a short queue plays the right one", () => {
  const m = detectMilestones(input([person({ transfersToday: 10, transfersWeek: 12, goalTransfersWeekly: 12, bestDayBefore: 4 })]));
  assert.ok(m.length >= 3);
  for (let i = 1; i < m.length; i += 1) assert.ok(m[i - 1].weight >= m[i].weight);
});

// ── tips ────────────────────────────────────────────────────────────────────
test("every step of the plan is a tip, and the walk visits all of them", () => {
  const tips = flattenTips(TRAINING_DAYS);
  const expected = TRAINING_DAYS.reduce((n, d) => n + d.morning.length + d.afternoon.length + (d.eod ? 1 : 0), 0);
  assert.equal(tips.length, expected);
  const seen = new Set<number>();
  for (let s = 0; s < tips.length; s += 1) seen.add(tips.indexOf(pickTip(s, tips)!));
  assert.equal(seen.size, tips.length, "consecutive seeds must reach every tip before repeating");
  // Deterministic: two TVs with the same seed show the same tip.
  assert.equal(pickTip(41, tips), pickTip(41, tips));
  assert.equal(pickTip(3, []), null);
});

test("consecutive seeds do not linger in day one", () => {
  const tips = flattenTips(TRAINING_DAYS);
  const days = [0, 1, 2, 3].map((s) => pickTip(s, tips)!.day);
  assert.ok(new Set(days).size >= 3, `four seeds should span days, got ${days.join(",")}`);
});

// ── wiring ──────────────────────────────────────────────────────────────────
test("the TV has no session and can only read", () => {
  assert.match(routes, /if \(req\.path\.startsWith\("\/tv\/"\)\) return next\(\);/);
  const feed = routes.slice(routes.indexOf('app.get("/api/tv/:token/feed"'), routes.indexOf("// ── LO priority share link"));
  assert.match(feed, /tvLink\(req\.params\.token\)/);
  // The revocation check is in the helper every TV route resolves through.
  const helper = routes.slice(routes.indexOf("function tvLink("), routes.indexOf('app.get("/api/tv-links"'));
  assert.match(helper, /revoked_at IS NULL/);
  assert.match(helper, /^\s*if \(!\/\^\[A-Za-z0-9_-\]\{16,64\}\$\/\.test/m, "the token shape is checked before any lookup");
  // Read-only: the only write is bookkeeping on the link itself.
  const writes = feed.match(/\b(INSERT|UPDATE|DELETE)\b/g) ?? [];
  assert.deepEqual(writes, ["UPDATE"], "the feed must not write to anything but its own use counter");
  assert.match(feed, /UPDATE tv_display_links SET use_count/);
  assert.match(feed, /org_id/, "org-scoped");
});

test("events come from an updated_at cursor, so a miss can animate", () => {
  const feed = routes.slice(routes.indexOf('app.get("/api/tv/:token/feed"'), routes.indexOf("// ── LO priority share link"));
  assert.match(feed, /COALESCE\(o\.updated_at, o\.created_at\) > \?/);
  // First poll: no replaying history at the TV on boot.
  assert.match(feed, /First poll: no replaying history/);
});

test("links are manager-made, revocable, and audited; the page mounts outside the login shell", () => {
  assert.match(storage, /CREATE TABLE IF NOT EXISTS tv_display_links/);
  for (const r of ['app.get("/api/tv-links"', 'app.post("/api/tv-links"', 'app.delete("/api/tv-links/:id"']) {
    const i = routes.indexOf(r);
    assert.ok(i > 0, `missing ${r}`);
    assert.match(routes.slice(i, i + 300), /requireManagerOrAdmin\(req, res\)/);
  }
  assert.match(routes, /entityType: "tv_display_link"/);
  assert.match(app, /<Route path="\/tv\/:token" component=\{TvBoard\} \/>/);
});

test("the screen queues moments, plays a milestone once, and reloads on deploy", () => {
  assert.match(page, /const \[queue, setQueue\] = useState<Moment\[\]>/);
  assert.match(page, /if \(current \|\| !queue\.length\) return;/, "one moment at a time");
  assert.match(page, /played\.current\.has\(m\.id\)/);
  assert.match(page, /localStorage\.setItem\(PLAYED_KEY/);
  assert.match(page, /data\.version === APP_VERSION/);
  assert.match(page, /window\.location\.reload\(\)/);
  // Nothing on a wall the whole floor faces may flash fast.
  assert.doesNotMatch(page, /animate-ping|setInterval\([^)]*, ?[0-9]{1,2}\)/);
  assert.match(page, /useReducedMotion/);
});

test("the moment queue cannot deadlock, and cannot lose moments on reload", () => {
  // Seen live, twice. (1) One effect that both dequeued and owned the hold
  // timer cancelled that timer in its own cleanup, so the first moment sat on
  // screen forever. (2) Remembering a moment as played on ENQUEUE meant a
  // reload mid-queue silently lost everything behind the one on screen.
  const dequeue = page.slice(page.indexOf("if (current || !queue.length) return;"), page.indexOf("}, [current, queue, remember]);"));
  assert.doesNotMatch(dequeue, /setTimeout/, "the dequeue effect must not own the hold timer");
  assert.match(dequeue, /remember\(head\.key\)/, "a moment is remembered when it STARTS");
  assert.match(page, /if \(!current\) return;\s*\r?\n\s*const hold = /, "the hold timer lives in its own effect keyed on current");
  const enqueue = page.slice(page.indexOf("cursorRef.current = data.cursor;"), page.indexOf("}, [data]);"));
  assert.doesNotMatch(enqueue, /remember\(/, "enqueueing must not mark anything as played");
  assert.match(enqueue, /!have\.has\(x\.key\)/, "a re-poll cannot double-queue the same moment");
});

test("pages rotate like signage, and pause under a moment", () => {
  assert.match(page, /const DECK: Array<\{ id: PageId; dwellMs: number \}> = \[/);
  for (const id of ["scorecard", "team", "latest", "tip"]) assert.match(page, new RegExp(`data-testid="tv-page-${id}"`));
  // The scorecard is what people look up for: it comes round most often.
  assert.equal((page.match(/\{ id: "scorecard"/g) ?? []).length, 2);
  // A repeated page must re-enter fresh, so bars grow and numbers count again.
  assert.match(page, /key=\{`\$\{page\}-\$\{dealt\}`\}/);
  // And the deck does not turn under a moment.
  const deck = page.slice(page.indexOf("const [slot, setSlot]"), page.indexOf("const page = DECK[slot].id;"));
  assert.match(deck, /if \(current\) return;/);
  assert.match(page, /AnimatePresence mode="wait"/, "one page leaves before the next arrives");
});
const hype = readFileSync(join(root, "client/src/components/tv/hype.tsx"), "utf8");

test("every moment is a hype screen, and every kind has its own bit", () => {
  // Ethan: not a lane -- "unhinged animated stuff", the energy of a strike
  // screen. Each kind must choreograph differently, with its own word and
  // its own impact time for the sound to land on.
  assert.match(page, /<HypeScene kind=\{kind\}/);
  for (const k of ["transfer", "appointment", "rescheduled", "fell_through", "missed_appointment", "milestone"]) {
    assert.match(hype, new RegExp(`case "${k}":`), `${k} needs its own bit`);
    assert.match(hype, new RegExp(`\\b${k}: "[A-Z !\\-]+"`), `${k} needs its own word`);
    assert.match(hype, new RegExp(`\\b${k}: \\d+`), `${k} needs an impact time`);
  }
  assert.match(hype, /TRANSFER!/); assert.match(hype, /BOOKED!/); assert.match(hype, /MOVED!/);
  assert.match(hype, /FELL THROUGH/); assert.match(hype, /NO-SHOW/); assert.match(hype, /MILESTONE!/);
});

test("the hype screen cannot wedge the overlay open", () => {
  // Seen live. The first cut mounted motion elements on timers. One mounted
  // while the overlay was already exiting, registered with presence after
  // the exit had been dispatched, never reported done -- and the overlay
  // sat in the DOM at opacity 0 with the pages rotating underneath it. So:
  // one mount, delays and keyframes only, no exit props below the wrapper,
  // and no infinite framer loops.
  assert.doesNotMatch(hype, /useEffect|useState|setTimeout|setInterval|requestAnimationFrame/);
  assert.doesNotMatch(hype, /exit=/);
  assert.doesNotMatch(hype, /repeat: Infinity/);
});

test("the hype screen is safe for a wall the whole floor faces", () => {
  // No flashing above two per second: the only loop is a slow CSS ray spin,
  // the no-show shudder is position on the word only, and reduced motion
  // drops every bit to its final frame.
  const spin = hype.match(/hype-spin (\d+)s linear infinite/);
  assert.ok(spin && Number(spin[1]) >= 10, "the ray spin must be slow");
  assert.match(hype, /useReducedMotion/);
  assert.match(hype, /const STILL: Transition = \{ duration: 0\.3 \}/);
  assert.match(hype, /reduced \? STILL/);
  // Nothing is downloaded: it is all inline SVG and text.
  assert.doesNotMatch(hype, /<img|src=|fetch\(/);
});

test("the holds fit the choreography, and the crash lands with the word", () => {
  assert.match(page, /transfer: 9500, appointment: 8000, rescheduled: 8000, fell_through: 8500, missed_appointment: 7500, milestone: 10500/);
  for (const k of ["transfer", "appointment", "rescheduled", "fell_through", "missed_appointment", "milestone"]) {
    assert.match(page, new RegExp(`${k}:\\s+\\(\\) => \\{ crash\\(\\{ delayMs: HYPE_IMPACT_MS\\.${k}`), `${k} sound must key off the impact time`);
  }
});

test("a moment holds and then hard-cuts, with no exit animation anywhere", () => {
  // Two different wedges, both seen live. Under AnimatePresence the overlay
  // stayed in the DOM at opacity 0 after its exit, because some descendant
  // never reported its exit done. Replacing that with a hand-run fade — a
  // `leaving` flag driving opacity, unmounting 300ms later — moved the bug:
  // a moment could mount while the flag was still set and play its whole
  // scene invisibly with the deck paused behind it. A hard cut cannot do
  // either, so there is exactly one timer and no leaving state.
  assert.doesNotMatch(page, /<AnimatePresence>\{current/);
  assert.doesNotMatch(page, /setLeaving|leaving=\{/, "no fade-out state may come back");
  assert.doesNotMatch(page, /FADE_MS/);
  assert.match(page, /\{current && <MomentOverlay moment=\{current\} reduced=\{reduced\} \/>\}/);
  assert.match(page, /const done = setTimeout\(\(\) => setCurrent\(null\), hold\);/);
  const overlay = page.slice(page.indexOf("function MomentOverlay"), page.indexOf("// ── the page"));
  assert.doesNotMatch(overlay, /exit=/, "nothing in the overlay may depend on presence");
  assert.match(overlay, /animate=\{\{ opacity: 1 \}\}/);
});

test("?demo=1 plays one of every moment, and ?demo=<kind> loops just that one", () => {
  // So a screen can be checked from Settings without waiting for the floor,
  // and so a single animation can be built without sitting through the reel.
  const from = page.indexOf('get("demo")');
  assert.ok(from >= 0, "the demo switch must read the kind from the query");
  const demo = page.slice(from, page.indexOf("}, []);", from));
  assert.match(demo, /const one = reel\.filter/);
  assert.match(demo, /setQueue\(loop\)/);
  for (const k of ["transfer", "appointment", "rescheduled", "fell_through", "missed_appointment"]) {
    assert.match(demo, new RegExp(`ev\\("${k}", `), `${k} must be in the demo reel`);
  }
  assert.match(demo, /type: "milestone", key: `demo-\$\{stamp\}-milestone`/);
  assert.doesNotMatch(demo, /cursorRef|remember\(/);
});

// ── the wall quotes ─────────────────────────────────────────────────────────
test("the tip page shows standalone quotes, not raw manual lines", async () => {
  // A manual line like "run the four steps from this morning" means nothing on
  // a wall with no morning session in sight, so the board quotes a set written
  // to stand alone.
  const { TV_QUOTES, pickQuote } = await import("../shared/tv-quotes");
  assert.equal(TV_QUOTES.length, 50);
  for (const q of TV_QUOTES) {
    assert.ok(q.text.length > 20 && q.text.length < 160, `awkward length: ${q.text}`);
    assert.ok(!/^\s|\s$/.test(q.text), `padded: ${q.text}`);
    // Nothing may lean on the manual being open beside it.
    assert.doesNotMatch(q.text, /\b(this morning|yesterday|last week|as we (covered|said)|see day \d|step \d)\b/i, q.text);
    // No motivational-poster voice.
    assert.doesNotMatch(q.text, /!|\b(crush|grind it|hustle|beast|warrior|no excuses)\b/i, q.text);
  }
  assert.equal(new Set(TV_QUOTES.map((q) => q.text)).size, 50, "no duplicates");
  // Deterministic, and it walks the whole list rather than clustering.
  assert.equal(pickQuote(7)?.text, pickQuote(7)?.text);
  const walked = new Set(Array.from({ length: 50 }, (_, i) => pickQuote(i)?.text));
  assert.equal(walked.size, 50, "every quote must be reachable");
  // And the route serves them.
  assert.match(routes, /const quote = pickQuote\(Number\(req\.query\.tip\) \|\| 0\)/);
});

// ── one CLR passing another ─────────────────────────────────────────────────
test("an overtake is worked out between polls and plays its own race scene", () => {
  // The feed is stateless, so a CHANGE between two polls cannot come from the
  // server — the board holds the previous standings and compares.
  assert.match(page, /const prevStandings = useRef<RankRow\[\] \| null>\(null\);/);
  assert.match(page, /detectOvertakes\(prevStandings\.current, standings, data\.today\)/);
  assert.match(page, /prevStandings\.current = standings;/);
  // It goes through the same played-set as every other moment, so a pass that
  // is still true on the next poll cannot play twice.
  const enqueue = page.slice(page.indexOf("cursorRef.current = data.cursor;"), page.indexOf("}, [data]);"));
  assert.match(enqueue, /!played\.current\.has\(o\.key\)/);
  // Its own scene, its own hold, its own sound.
  assert.match(page, /<RaceScene passerName=\{o\.passerName\} passedName=\{o\.passedName\} count=\{o\.count\} reduced=\{reduced\} \/>/);
  assert.match(page, /overtake: 8500,/);
  assert.match(page, /overtake:\s+\(\) => \{ crash\(/);
  // The union stays exhaustive: nothing may assume a moment is an event.
  assert.doesNotMatch(page, /m\.type === "milestone" \? "milestone" : m\.event\.kind/);
});

test("the race scene never mocks the person who got passed", () => {
  const race = readFileSync(join(root, "client/src/components/tv/race.tsx"), "utf8");
  // Both drivers are colleagues watching this on the wall. Comments are
  // stripped first: the file explains IN a comment why neither car reads as a
  // loser, and that sentence should not trip its own guard.
  const code = race.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  assert.doesNotMatch(code, /\b(crash|explode|blow up|loser|beaten|wreck|spin out)\b/i);
  // Same house rules as the hype screens: CSS keyframes, nothing downloaded,
  // and a still frame under reduced motion.
  assert.match(race, /@keyframes race-/);
  assert.match(race, /useReducedMotion/);
  assert.doesNotMatch(race, /<img|src=|fetch\(/);
  assert.doesNotMatch(race, /repeat: Infinity/);
});
