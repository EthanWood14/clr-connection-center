/**
 * The wall quotes.
 *
 * Fifty lines drawn from the CLR training plan, rewritten so each one stands
 * on its own. The board used to quote the manual directly, which meant lines
 * like "run through the four steps from this morning" landing on a screen with
 * no morning session in sight. These say the same things without needing the
 * manual open beside them.
 *
 * Written for someone glancing up mid-call on a day that may be going badly:
 * plain, occasionally dry, never a motivational poster and never a telling-off.
 * The two about a lost deal are deliberately gentle — the whole floor sees
 * this screen, including whoever just lost one.
 */
export interface TvQuote {
  text: string;
  /** One word, for spread when picking — never shown on screen. */
  theme: string;
}

export const TV_QUOTES: TvQuote[] = [
  { text: "You memorized your opener for days like this. Let it carry you to the first question.", theme: "opener" },
  { text: "A yes-or-no question hands them a free out. They will take it.", theme: "questions" },
  { text: "You're telling the LO you have a call for them, not asking. Walk it over and hand it off clean.", theme: "handoff" },
  { text: "A no on this call is a no on this call. The next number knows nothing about it.", theme: "reset" },
  { text: "If you don't sound happy to be talking to them, they won't want to talk to you.", theme: "tone" },
  { text: "Debrief every call, good or bad. The one you'd rather forget is usually worth the two minutes.", theme: "debrief" },
  { text: "Start with what they're trying to do. Everything else on the sheet gets easier after that.", theme: "goal" },
  { text: "Know how to pull up a lead fast. Fumbling for the record is dead air the borrower can hear.", theme: "preparation" },
  { text: "Momentum doesn't show up first. It shows up two or three dials in.", theme: "momentum" },
  { text: "The notes travel with the lead. Write them so the LO knows the story before they say hello.", theme: "notes" },
  { text: "Speed isn't clarity. Cadence is how the information actually lands.", theme: "cadence" },
  { text: "Ask it open and you get the story. Ask it closed and you get one word.", theme: "open-ended" },
  { text: "A lead who doesn't pick up hasn't turned you down. They just didn't pick up.", theme: "silence" },
  { text: "It isn't a transfer until it's logged in C3 and reassigned in Bonzo. Finish the last step.", theme: "logging" },
  { text: "Say your language out loud until it's memorized. Reading it off the page is not the same thing.", theme: "memorization" },
  { text: "W2, 1099, or self-employed changes the whole picture. Ask it plainly — it's a normal question.", theme: "income" },
  { text: "Replaying the last call while this one is ringing costs you both.", theme: "focus" },
  { text: "Comfortable people open up. That's the whole reason rapport is worth the first two minutes.", theme: "rapport" },
  { text: "Before you hand it over, know the LO is licensed in that borrower's state.", theme: "licensing" },
  { text: "Talk the call through, then dial the next one. Sitting in it longer than that pays nothing.", theme: "reset" },
  { text: "Refinance, HELOC, reverse. Learn what each one sounds like in a borrower's own words.", theme: "scenarios" },
  { text: "Freezing loses more transfers than a wrong answer does. Say something, keep the call moving.", theme: "hesitation" },
  { text: "Nobody is smooth the first time. Smooth is just the tenth time through.", theme: "repetition" },
  { text: "The LO quotes them the moment they pick up. Your job is getting them there ready.", theme: "expectations" },
  { text: "Get the information while you still have them on the phone. That's the part worth being stubborn about.", theme: "persistence" },
  { text: "The month is long. One flat afternoon does not decide it.", theme: "month" },
  { text: "Sound worn out and they hear worn out. Tone carries further than the words do.", theme: "tone" },
  { text: "Write your notes so the LO never has to ask the borrower the same question twice.", theme: "accuracy" },
  { text: "DTI and LTV come up constantly. Get used to hearing them so they don't stop you mid-call.", theme: "vocabulary" },
  { text: "If they won't give you the information, that's not a verdict on you. Ask again, differently.", theme: "asking" },
  { text: "Mic check before the block. Two minutes now beats a call the borrower can't hear.", theme: "setup" },
  { text: "Quality over quantity. One clean transfer beats three the LO has to untangle.", theme: "quality" },
  { text: "Some of them saw the ad and already have something in mind. Let them tell you which one.", theme: "intent" },
  { text: "Something goes sideways on every call. Adapting on the phone is the skill — not avoiding the surprise.", theme: "adapting" },
  { text: "Knowing why a call worked is worth as much as knowing why one didn't.", theme: "debrief" },
  { text: "Listen back to a call and fill out the sheet like you were on it. That's where the muscle comes from.", theme: "practice" },
  { text: "A transfer isn't the end of anything. Somebody starts an application because of it.", theme: "downstream" },
  { text: "Not every good transfer came out of a good call. Plenty came right after a bad one.", theme: "streaks" },
  { text: "Ten minutes of nothing but open-ended questions. Harder than it sounds, and it works.", theme: "listening" },
  { text: "When your language is memorized, you stop thinking about your half and start hearing theirs.", theme: "memory" },
  { text: "An objection isn't the door closing. It's the part of the call you trained for.", theme: "objections" },
  { text: "Know exactly what counts as a transfer and what doesn't. A lot rides on that line.", theme: "definition" },
  { text: "One observation per call. By Friday you've got a week of notes on your own calls.", theme: "observation" },
  { text: "Ask the question in the middle of the day, not at the end of it. None of them are dumb.", theme: "help" },
  { text: "Mornings for learning it, afternoons for dialing. The learning only counts if the dials happen.", theme: "consistency" },
  { text: "Ask an LO what a good transfer feels like on their end. They'll tell you straight.", theme: "perspective" },
  { text: "The one that fell apart is worth a note. Write it down, take the next one.", theme: "fallthrough" },
  { text: "Good call or bad call, and why? Being able to answer that is the craft.", theme: "judgement" },
  { text: "Have a routine before the first dial. Run it the same way every day.", theme: "routine" },
  { text: "Some days the dial block is just a dial block. Work it, log it, go home.", theme: "pace" },
];

/**
 * The quote for a given seed. Deterministic, so two TVs on the same wall show
 * the same one, and a stride coprime to the count so consecutive seeds walk
 * the whole list instead of clustering.
 */
export function pickQuote(seed: number, quotes: TvQuote[] = TV_QUOTES): TvQuote | null {
  if (!quotes.length) return null;
  const n = quotes.length;
  let stride = Math.max(1, Math.floor(n * 0.37));
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
  while (gcd(stride, n) !== 1 && stride > 1) stride -= 1;
  return quotes[((Math.floor(Math.abs(seed)) * stride) % n + n) % n];
}
