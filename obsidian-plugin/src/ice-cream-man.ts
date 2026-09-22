/** The Ice Cream Man clickventure — the pure panel flow (dialog in
 *  ice-cream-man-modal.ts, art in ice-cream-man-assets.ts). Fired by the
 *  support-prompt engine on the parity beats after the post-stage-5 quiet
 *  spell (support-prompt.ts → main.ts's openIceCreamMan hook).
 *
 *  The flow: greeting + flavour choice → the cone you ordered, handed over →
 *  the collection-basket ask → and then EITHER the cheer (on yes, via the Pro
 *  checkout page) OR a warm send-off (on no). The modal's X ends the vignette at
 *  any point — the engine's parity advance already happened, so a dismissed
 *  vignette costs its beat like any other.
 *
 *  Both endings are terminal panels, and that is the point of the goodbye: "Not
 *  now" used to close the dialog dead, which read as a door shutting on a
 *  declined ask. The Ice Cream Man doesn't sulk.
 *
 *  All copy is Pavlos's, VERBATIM from the spec note "Payment Prompt &
 *  Mechanics" (Ice Cream Man section) — user-authored creative prose, not UI
 *  chrome: do not rewrite, re-case, or "fix" it. It deliberately names no
 *  price; the only place an amount appears is the checkout page itself.
 *
 *  Obsidian-free by design (mirrors support-prompt.ts): the flow is a data
 *  table plus one pure step function, so every transition is unit-testable
 *  offline. */

export type IceCreamPanelKey =
  | "greeting"
  /** One cone panel per flavour — identical words, different art, so the cone
   *  handed over is the cone that was actually ordered. */
  | "coneChocolate"
  | "coneVanilla"
  | "coneRaspberry"
  | "basket"
  /** The yes: both fists up, the whole queue behind him cheering. (Was "wave",
   *  after the spec's original "a beaming ice cream man waving" — but the art
   *  moved the wave to the goodbye and made this one a cheer.) */
  | "celebrate"
  /** The no, taken kindly — the wave off, not a door closing. */
  | "goodbye"
  /** The PRO ending, in place of the basket ask. Pro silences the support
   *  prompts, so the only way a supporter meets him is the Pro-only "See the Ice
   *  Cream Man" menu item — and walking them into the collection basket there
   *  would ask a paying customer to pay again. They get thanked instead. */
  | "gratitude";

export interface IceCreamChoice {
  /** Verbatim dialogue option — authored prose, hence data here rather than
   *  a literal at the button (keeps the sentence-case lint off the copy). */
  label: string;
  /** Panel shown next, or null to end the vignette. */
  next: IceCreamPanelKey | null;
  /** Where this choice leads for a PRO user, when that differs. Absent = the
   *  same panel either way. Kept as data on the choice (rather than a branch
   *  inside advanceIceCream) so the fork stays legible in the table: the only
   *  divergence is the cone's thank-you, ask → thanks. */
  nextPro?: IceCreamPanelKey | null;
  /** Open the Pro checkout page as part of taking this choice. */
  checkout?: boolean;
  /** Render as the call-to-action button. */
  cta?: boolean;
}

export interface IceCreamPanel {
  body: string;
  /** Empty = terminal panel: only the modal's X remains. */
  choices: readonly IceCreamChoice[];
}

export const ICE_CREAM_START: IceCreamPanelKey = "greeting";

export const ICE_CREAM_PANELS: Record<IceCreamPanelKey, IceCreamPanel> = {
  greeting: {
    body: [
      "Oh hey. I'm the friendly Liefwork Ice Cream Man!",
      "You look like you could use a free ice cream.",
      "It's all made with the freshest ingredients using raw cane sugar and organic milk from grass-fed cows I brush every day and call by name.",
      "There's also a vegan variety.",
      "What would you like?",
    ].join("\n"),
    choices: [
      { label: "Chocolate", next: "coneChocolate" },
      { label: "Vanilla", next: "coneVanilla" },
      { label: "Raspberry Swirl", next: "coneRaspberry" },
    ],
  },
  coneChocolate: {
    body: "There you go, enjoy!",
    choices: [{ label: "Thank you, Ice Cream Man!", next: "basket", nextPro: "gratitude", cta: true }],
  },
  coneVanilla: {
    body: "There you go, enjoy!",
    choices: [{ label: "Thank you, Ice Cream Man!", next: "basket", nextPro: "gratitude", cta: true }],
  },
  coneRaspberry: {
    body: "There you go, enjoy!",
    choices: [{ label: "Thank you, Ice Cream Man!", next: "basket", nextPro: "gratitude", cta: true }],
  },
  basket: {
    body: [
      "Hey, while I have you, do you think you might want to kick in a few bucks?",
      "That helps me make sure everyone in the neighborhood can get free ice cream.",
      "I'll throw in Liefwork Pro too.",
      "What do you say?",
    ].join("\n"),
    choices: [
      { label: "Not now, Ice Cream Man.", next: "goodbye" },
      { label: "Sure thing, Ice Cream Man!", next: "celebrate", checkout: true, cta: true },
    ],
  },
  celebrate: {
    body: ["Thank you!", "Generosity like yours really helps this community thrive."].join("\n"),
    choices: [],
  },
  goodbye: {
    body: ["That's ok!", "Enjoy your cone and maybe next time..."].join("\n"),
    choices: [],
  },
  gratitude: {
    body: [
      "It is my pleasure to serve such fine members of the community as yourself.",
      "Have a wonderful day!",
    ].join("\n"),
    // Unlike celebrate/goodbye (terminal, X only), this one closes on its own
    // button: the supporter gets the last word.
    choices: [{ label: "You too, Ice Cream Man!", next: null, cta: true }],
  },
};

export type IceCreamEvent =
  /** A dialogue option was clicked (index into the panel's choices). */
  | { kind: "choose"; index: number }
  /** The modal's X — ends the vignette from any panel. */
  | { kind: "dismiss" };

export interface IceCreamStep {
  /** Panel to show next; null ends the vignette. */
  panel: IceCreamPanelKey | null;
  /** Whether this step opens the Pro checkout page. */
  checkout: boolean;
}

/** One click's worth of panel flow — the pure rule the modal executes. A
 *  stray choice index (can't happen from the rendered buttons) stays put
 *  rather than deadlock or crash.
 *
 *  `isPro` takes a choice's `nextPro` fork where one exists — today only the
 *  cone's thank-you, which sends a supporter to the gratitude send-off instead of
 *  the collection basket. Defaults false so every non-Pro caller reads as before. */
export function advanceIceCream(
  panel: IceCreamPanelKey,
  event: IceCreamEvent,
  isPro = false,
): IceCreamStep {
  if (event.kind === "dismiss") return { panel: null, checkout: false };
  const choice = ICE_CREAM_PANELS[panel].choices[event.index];
  if (!choice) return { panel, checkout: false };
  // `nextPro` may legitimately be null (end the vignette), so test for the key's
  // PRESENCE, not truthiness — `?? choice.next` would silently ignore a null fork.
  const next = isPro && "nextPro" in choice ? (choice.nextPro ?? null) : choice.next;
  return { panel: next, checkout: choice.checkout === true };
}
