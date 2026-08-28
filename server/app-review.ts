// Scheduled self-review: Claude looks at how C3 is actually being used and
// proposes changes a human then approves or denies.
//
// Two deliberate boundaries:
//
// 1. SUGGESTIONS ARE DATA, NEVER INSTRUCTIONS. Nothing here — and nothing
//    downstream — executes, schedules, or acts on model output. Approving a
//    suggestion records intent for a person to act on; it changes no behaviour
//    in the app. Treat every field that comes back as untrusted text.
//
// 2. IT REVIEWS THE RUNNING APP, NOT THE SOURCE. Only dist/ ships to
//    production, so the source tree is not readable there. The digest is built
//    from the live database and the shipped release notes: what people do,
//    what is failing, what has gone stale. That is the material an operational
//    review can actually stand on.
import Anthropic from "@anthropic-ai/sdk";
// The zod helper in this SDK build requires zod >= 3.25; the app pins 3.24
// under drizzle-zod, so the JSON-schema helper is used instead — same
// structured-output guarantee, no dependency bump.
import { jsonSchemaOutputFormat } from "@anthropic-ai/sdk/helpers/json-schema";
import { APP_VERSION } from "../shared/version";
import { RELEASE_NOTES } from "../shared/release-notes";

// Routine passes run on the default model; the four-weekly deep pass uses the
// most capable one. Both are overridable by env without a deploy.
export const ROUTINE_MODEL = process.env.APP_REVIEW_MODEL || "claude-opus-5";
export const DEEP_MODEL = process.env.APP_REVIEW_DEEP_MODEL || "claude-fable-5";
export const ROUTINE_INTERVAL_DAYS = 3;
export const DEEP_INTERVAL_DAYS = 28;

export type ReviewCycle = "routine" | "deep";

export const REVIEW_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["suggestions"],
  properties: {
    suggestions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "area", "problem", "proposal", "evidence", "impact", "effort"],
        properties: {
          title: { type: "string", description: "One line, specific and concrete. Not a category." },
          area: { type: "string", description: "Which part of C3: Shotgun, EOD, Comp, Transfers, LAP portal, Email, Admin, Data quality." },
          problem: { type: "string", description: "What is actually wrong or wasteful, stated from the evidence given." },
          proposal: { type: "string", description: "The specific change to make." },
          evidence: { type: "string", description: "The numbers from the digest that support this. Quote them." },
          impact: { type: "string", enum: ["high", "medium", "low"] },
          effort: { type: "string", enum: ["high", "medium", "low"] },
        },
      },
    },
  },
} as const;

export type ReviewSuggestion = {
  title: string; area: string; problem: string; proposal: string;
  evidence: string; impact: string; effort: string;
};

export function anthropicConfigured(): boolean {
  return !!(process.env.ANTHROPIC_API_KEY || "").trim();
}

const SYSTEM = `You review an internal operations tool called C3 (the "CLR Connection Center") used by a mortgage company, West Capital Lending.

WHO USES IT: CLRs (client/loan reps) who work leads, call and text them, and transfer qualified people to loan officers. Managers watch throughput. A separate portal serves outside loan-officer assistants.

YOUR JOB: from the operational digest you are given, propose changes that would make the tool measurably better for the people using it. You are not reading the source code — reason only from the evidence in the digest.

WHAT MAKES A GOOD SUGGESTION:
- It names a specific problem visible in the numbers, and quotes those numbers.
- It proposes one concrete change, not a direction or a theme.
- It is something a small team can actually ship.
- Prefer things that remove work, prevent a silent failure, or fix data people rely on.

WHAT TO AVOID:
- Generic engineering advice ("add more tests", "improve performance", "consider caching") that any codebase would receive.
- Anything you cannot support with the digest. If the evidence is thin, return fewer suggestions. Returning three well-grounded suggestions is better than ten guesses.
- Repeating a suggestion that already appears in the "recently proposed" list.

Rank by expected value. Six to ten suggestions for a routine pass; be more thorough on a deep pass.`;

/** Cost in cents, from the published per-MTok rates for the two models used. */
export function estimateCostCents(model: string, inputTokens: number, outputTokens: number): number {
  const rates: Record<string, { in: number; out: number }> = {
    "claude-opus-5": { in: 5, out: 25 },
    "claude-fable-5": { in: 10, out: 50 },
    "claude-sonnet-5": { in: 2, out: 10 },
    "claude-haiku-4-5": { in: 1, out: 5 },
  };
  const rate = rates[model] ?? rates["claude-opus-5"];
  const dollars = (inputTokens / 1_000_000) * rate.in + (outputTokens / 1_000_000) * rate.out;
  return Math.round(dollars * 100);
}

/**
 * Ask Claude for suggestions. Returns the parsed list plus usage.
 *
 * Streaming because a deep pass can produce a long answer and a non-streaming
 * request that size risks an HTTP timeout.
 */
export async function requestSuggestions(cycle: ReviewCycle, digest: string, recentTitles: string[]): Promise<{
  suggestions: ReviewSuggestion[];
  model: string;
  inputTokens: number;
  outputTokens: number;
  refusal?: string;
}> {
  const model = cycle === "deep" ? DEEP_MODEL : ROUTINE_MODEL;
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const alreadySeen = recentTitles.length
    ? `\n\nRecently proposed (do not repeat these):\n${recentTitles.map((t) => `- ${t}`).join("\n")}`
    : "";
  const stream = client.messages.stream({
    model,
    max_tokens: 64000,
    system: SYSTEM,
    // Deep passes get the most thorough setting; routine passes stay lighter.
    output_config: {
      effort: cycle === "deep" ? "high" : "medium",
      format: jsonSchemaOutputFormat(REVIEW_SCHEMA),
    },
    messages: [{
      role: "user",
      content: `Operational digest for C3 v${APP_VERSION} — ${cycle} review.\n\n${digest}${alreadySeen}`,
    }],
  } as any);
  const message: any = await stream.finalMessage();
  // A safety refusal returns HTTP 200 with stop_reason "refusal" and no usable
  // content — check it before reading anything else.
  if (message?.stop_reason === "refusal") {
    return { suggestions: [], model, inputTokens: 0, outputTokens: 0, refusal: message?.stop_details?.explanation || "The model declined this request." };
  }
  let parsed = message?.parsed_output as { suggestions?: ReviewSuggestion[] } | null | undefined;
  if (!parsed) {
    // parsed_output is null when parsing failed; fall back to the text block
    // rather than losing a whole (billed) run.
    const text = (message?.content ?? []).filter((b: any) => b?.type === "text").map((b: any) => b.text).join("");
    try { parsed = JSON.parse(text); } catch { parsed = { suggestions: [] }; }
  }
  return {
    suggestions: Array.isArray(parsed?.suggestions) ? parsed.suggestions : [],
    model,
    inputTokens: Number(message?.usage?.input_tokens ?? 0),
    outputTokens: Number(message?.usage?.output_tokens ?? 0),
  };
}

/** The last few releases, so the review knows what just changed. */
export function recentReleaseSummary(count = 12): string {
  return RELEASE_NOTES.slice(0, count)
    .map((n) => `v${n.version} — ${n.headline}`)
    .join("\n");
}
