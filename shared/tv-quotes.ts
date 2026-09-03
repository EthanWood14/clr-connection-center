/**
 * The wall quotes.
 *
 * Two registers, one book.
 *
 * The first fifty are unattributed, drawn from the CLR training plan and
 * rewritten so each one stands on its own. The board used to quote the manual
 * directly, which meant lines like "run through the four steps from this
 * morning" landing on a screen with no morning session in sight. These say the
 * same things without needing the manual open beside them: plain, occasionally
 * dry, never a telling-off. The two about a lost deal are deliberately gentle —
 * the whole floor sees this screen, including whoever just lost one.
 *
 * The rest are Ethan's, and they carry a name. They are loud where the training
 * lines are quiet — Rocky, Kratos, a paragraph of Edward Elric, "I'm Batman." —
 * and they range from a Churchill line that has been printed on a thousand
 * office walls to Patrick Star saying nothing at all. Some of them are, frankly,
 * motivational posters. They stay, because Ethan picked them for this wall.
 *
 * Both registers belong on the same screen for the same reason: it is read
 * mid-call, on a day that may be going badly, by someone who did not ask for
 * advice. The quiet ones tell you what to do next. The loud ones tell you the
 * room is on your side, and a line somebody recognises gets looked at — which is
 * how the ones around it get read on the way past. A wall that only ever coaches
 * you is wallpaper by the second week.
 */
export interface TvQuote {
  text: string;
  /**
   * Who said it. Absent on the fifty training lines — those are nobody's
   * quotation and must never grow an attribution — and present on every one of
   * Ethan's, where the name is half of why the line lands. The board prints it
   * only when it is here; see TipPage in client/src/pages/tv.tsx.
   */
  author?: string;
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

  // ── Ethan's, attributed ───────────────────────────────────────────────────
  // Ethan wrote this one down as Kennedy and that is how it goes on the wall.
  // For the record, so nobody has to look it up twice: the line is Phillips
  // Brooks, a Boston clergyman, from the 1880s. Kennedy quoted him.
  { text: "Do not pray for easy lives, my friends. Pray to be stronger men.", author: "John F. Kennedy", theme: "strength" },
  { text: "If you win, you live. If you lose, you die. If you don't fight, you can't win!", author: "Erwin Smith", theme: "commitment" },
  { text: "Success is not final, failure is not fatal: it is the courage to continue that counts.", author: "Winston Churchill", theme: "perseverance" },
  { text: "Always forgive your enemies; nothing annoys them so much.", author: "Oscar Wilde", theme: "forgiveness" },
  { text: "It is better to be hated for what you are than to be loved for what you are not.", author: "Andre Gide", theme: "authenticity" },
  { text: "The world ain't all sunshine and rainbows. It's a very mean and nasty place... It ain't about how hard ya hit. It's about how hard you can get hit and keep moving forward.", author: "Rocky Balboa", theme: "resilience" },
  { text: "Nobody cares if you're tired.", author: "Khabib Nurmagomedov", theme: "grit" },
  { text: "Human beings have a remarkable ability to accept the abnormal and make it normal.", author: "Andy Weir", theme: "adaptation" },
  { text: "You're worth every penny, mate. Don't let anyone tell you different.", author: "Kuben Blisk", theme: "worth" },
  { text: "Welcome back, Pilot. We are a stronger team together.", author: "BT-7274", theme: "teamwork" },
  { text: "I don't want to rule anything. Being King of the Pirates is about being more free than anyone.", author: "Monkey D. Luffy", theme: "freedom" },
  { text: "When you decided to go against the world, you made yourself an enemy of everyone. But that's fine! If you can't protect your friends, you can't protect anything!", author: "Roronoa Zoro", theme: "loyalty" },
  { text: "If we get to the point where we don't help each other anymore, that's when we stop being human.", author: "Matt Dinniman", theme: "kindness" },
  { text: "You will not break me.", author: "Matt Dinniman", theme: "defiance" },
  { text: "You're killin' me, Smalls!", author: "Ham Porter", theme: "levity" },
  { text: "The arrogance of man is thinking nature is in our control, and not the other way around. Let them fight.", author: "Dr. Ishiro Serizawa", theme: "humility" },
  { text: "There's no such thing as a painless lesson, they just don't exist. You can't gain anything without losing something first. But if you can endure that pain and walk from it, you'll find that you now have a heart strong enough to overcome any obstacle.", author: "Edward Elric", theme: "growth" },
  { text: "Humankind cannot gain anything without first giving something in return. To obtain, something of equal value must be lost. That is alchemy's first law of Equivalent Exchange.", author: "Alphonse Elric", theme: "exchange" },
  { text: "I'm Squidward, I'm Squidward. Squidward, Squidward, Squidward.", author: "Patrick Star", theme: "nonsense" },
  { text: "You have to work hard in the dark to shine in the light.", author: "Kobe Bryant", theme: "craft" },
  { text: "It's never as bad as it seems. You're much stronger than you think you are. Trust me.", author: "Superman", theme: "reassurance" },
  { text: "I can do this all day.", author: "Captain America", theme: "endurance" },
  { text: "I'm Batman.", author: "Batman", theme: "identity" },
  { text: "All men have limits. They learn what they are and then learn not to exceed them. I ignore mine.", author: "Batman", theme: "limits" },
  { text: "Freedom is the right of all sentient beings.", author: "Optimus Prime", theme: "dignity" },
  { text: "Be strong enough to be gentle.", author: "Peter Cullen", theme: "gentleness" },
  { text: "Do not be sorry. Be better.", author: "Kratos", theme: "accountability" },
  { text: "The cycle ends here. We must be better than this.", author: "Kratos", theme: "change" },
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
