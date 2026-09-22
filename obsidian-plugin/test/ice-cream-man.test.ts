import { test, expect } from "bun:test";
import {
  ICE_CREAM_PANELS,
  ICE_CREAM_START,
  advanceIceCream,
  type IceCreamEvent,
  type IceCreamPanelKey,
  type IceCreamStep,
} from "../src/ice-cream-man.ts";
import { ICE_CREAM_ASSETS } from "../src/ice-cream-man-assets.ts";

const PANEL_KEYS = Object.keys(ICE_CREAM_PANELS) as IceCreamPanelKey[];

const choose = (index: number): IceCreamEvent => ({ kind: "choose", index });

// --- advanceIceCream: single-click rule table -----------------------------------

const STEPS: {
  name: string;
  panel: IceCreamPanelKey;
  event: IceCreamEvent;
  step: IceCreamStep;
}[] = [
  // Each flavour now leads to its OWN cone panel, so the art can hand over the
  // cone that was actually ordered.
  { name: "greeting: Chocolate → the chocolate cone", panel: "greeting", event: choose(0), step: { panel: "coneChocolate", checkout: false } },
  { name: "greeting: Vanilla → the vanilla cone", panel: "greeting", event: choose(1), step: { panel: "coneVanilla", checkout: false } },
  { name: "greeting: Raspberry Swirl → the raspberry cone", panel: "greeting", event: choose(2), step: { panel: "coneRaspberry", checkout: false } },
  { name: "coneChocolate: thank-you → basket", panel: "coneChocolate", event: choose(0), step: { panel: "basket", checkout: false } },
  { name: "coneVanilla: thank-you → basket", panel: "coneVanilla", event: choose(0), step: { panel: "basket", checkout: false } },
  { name: "coneRaspberry: thank-you → basket", panel: "coneRaspberry", event: choose(0), step: { panel: "basket", checkout: false } },
  // "Not now" used to end the vignette dead; it now gets a send-off panel.
  { name: "basket: 'Not now' → goodbye, no checkout", panel: "basket", event: choose(0), step: { panel: "goodbye", checkout: false } },
  { name: "basket: 'Sure thing' → checkout + celebrate", panel: "basket", event: choose(1), step: { panel: "celebrate", checkout: true } },
];

for (const c of STEPS) {
  test(`advance: ${c.name}`, () => {
    expect(advanceIceCream(c.panel, c.event)).toEqual(c.step);
  });
}

test("advance: X dismisses from any panel — end, never checkout", () => {
  for (const panel of PANEL_KEYS) {
    expect(advanceIceCream(panel, { kind: "dismiss" })).toEqual({ panel: null, checkout: false });
  }
});

test("advance: a stray choice index stays on the panel, no checkout", () => {
  for (const panel of PANEL_KEYS) {
    expect(advanceIceCream(panel, choose(99))).toEqual({ panel, checkout: false });
    expect(advanceIceCream(panel, choose(-1))).toEqual({ panel, checkout: false });
  }
});

// --- the whole vignette, click after click ---------------------------------------

test("flow: the generous path — greeting → cone → basket → checkout → celebrate (terminal)", () => {
  let panel: IceCreamPanelKey | null = ICE_CREAM_START;
  const walk: IceCreamStep[] = [];
  for (const index of [1, 0, 1]) {
    if (panel === null) throw new Error("vignette ended early");
    const step: IceCreamStep = advanceIceCream(panel, choose(index));
    walk.push(step);
    panel = step.panel;
  }
  expect(walk).toEqual([
    { panel: "coneVanilla", checkout: false },
    { panel: "basket", checkout: false },
    { panel: "celebrate", checkout: true },
  ]);
  // The celebration is terminal: no dialogue options, only the modal's X.
  expect(ICE_CREAM_PANELS.celebrate.choices).toHaveLength(0);
});

test("flow: the not-now path reaches the goodbye send-off, never a checkout", () => {
  const toCone = advanceIceCream(ICE_CREAM_START, choose(0));
  const toBasket = advanceIceCream(toCone.panel as IceCreamPanelKey, choose(0));
  const toGoodbye = advanceIceCream(toBasket.panel as IceCreamPanelKey, choose(0));
  expect(toGoodbye).toEqual({ panel: "goodbye", checkout: false });
  // Terminal, and reached without ever opening the checkout.
  expect(ICE_CREAM_PANELS.goodbye.choices).toHaveLength(0);
});

test("flow: every flavour leads to its own cone handover", () => {
  const targets = ICE_CREAM_PANELS.greeting.choices.map((c) => c.next);
  expect(targets).toEqual(["coneChocolate", "coneVanilla", "coneRaspberry"]);
});

test("flow: every cone converges on the basket", () => {
  for (const key of ["coneChocolate", "coneVanilla", "coneRaspberry"] as const) {
    expect(ICE_CREAM_PANELS[key].choices.map((c) => c.next)).toEqual(["basket"]);
  }
});

// --- the Pro fork: a supporter is never asked to pay again -----------------------
// Pro SILENCES the support prompts, so the only way a supporter meets the Ice
// Cream Man is the Pro-only "See the Ice Cream Man" menu item. Walking them into
// the collection basket there would ask a paying customer to pay again. So the
// cone's thank-you forks: free -> basket (the ask), Pro -> gratitude (the thanks).

test("flow: with Pro, the cone's thank-you leads to gratitude, never the basket", () => {
  for (const key of ["coneChocolate", "coneVanilla", "coneRaspberry"] as const) {
    expect(advanceIceCream(key, choose(0), true)).toEqual({ panel: "gratitude", checkout: false });
  }
});

test("flow: without Pro, the cone's thank-you still leads to the basket", () => {
  for (const key of ["coneChocolate", "coneVanilla", "coneRaspberry"] as const) {
    expect(advanceIceCream(key, choose(0), false)).toEqual({ panel: "basket", checkout: false });
  }
});

test("flow: the Pro walk — greeting → cone → gratitude, and it never checks out", () => {
  const toCone = advanceIceCream(ICE_CREAM_START, choose(0), true);
  expect(toCone).toEqual({ panel: "coneChocolate", checkout: false });
  const toGratitude = advanceIceCream(toCone.panel as IceCreamPanelKey, choose(0), true);
  expect(toGratitude).toEqual({ panel: "gratitude", checkout: false });
  // Its one button closes the vignette — a send-off, not another step.
  expect(advanceIceCream("gratitude", choose(0), true)).toEqual({ panel: null, checkout: false });
});

test("flow: Pro never reaches the basket, the checkout, or the free endings", () => {
  // Every Pro-reachable panel, walked from the start over every choice.
  const seen = new Set<IceCreamPanelKey>([ICE_CREAM_START]);
  const queue: IceCreamPanelKey[] = [ICE_CREAM_START];
  while (queue.length) {
    const panel = queue.shift()!;
    ICE_CREAM_PANELS[panel].choices.forEach((_, i) => {
      const step = advanceIceCream(panel, choose(i), true);
      expect(step.checkout).toBe(false); // a supporter is never sent to checkout
      if (step.panel && !seen.has(step.panel)) {
        seen.add(step.panel);
        queue.push(step.panel);
      }
    });
  }
  expect(seen.has("basket")).toBe(false);
  expect(seen.has("celebrate")).toBe(false);
  expect(seen.has("goodbye")).toBe(false);
  expect(seen.has("gratitude")).toBe(true);
});

test("copy: the gratitude send-off, verbatim", () => {
  expect(ICE_CREAM_PANELS.gratitude.body).toBe(
    "It is my pleasure to serve such fine members of the community as yourself.\nHave a wonderful day!",
  );
  expect(ICE_CREAM_PANELS.gratitude.choices.map((c) => c.label)).toEqual([
    "You too, Ice Cream Man!",
  ]);
});

// --- the copy ---------------------------------------------------------------------

test("copy: the spec's verbatim dialogue options", () => {
  expect(ICE_CREAM_PANELS.greeting.choices.map((c) => c.label)).toEqual([
    "Chocolate",
    "Vanilla",
    "Raspberry Swirl",
  ]);
  for (const key of ["coneChocolate", "coneVanilla", "coneRaspberry"] as const) {
    expect(ICE_CREAM_PANELS[key].choices.map((c) => c.label)).toEqual(["Thank you, Ice Cream Man!"]);
  }
  expect(ICE_CREAM_PANELS.basket.choices.map((c) => c.label)).toEqual([
    "Not now, Ice Cream Man.",
    "Sure thing, Ice Cream Man!",
  ]);
});

test("copy: the goodbye send-off, verbatim (one sentence per line)", () => {
  expect(ICE_CREAM_PANELS.goodbye.body).toBe(
    "That's ok!\nEnjoy your cone and maybe next time...",
  );
});

// The bodies are authored prose broken into sentences with "\n" so the modal can
// render one per line — a wall of text was hard to read at 360px of art above it.
// The renderer splits on "\n"; these guard the two things that would silently
// undo it: a body that lost its breaks, and the "cane sugar" typo fix.
test("copy: the greeting is broken into lines, and it's CANE sugar", () => {
  const body = ICE_CREAM_PANELS.greeting.body;
  expect(body).toContain("raw cane sugar");
  expect(body).not.toContain("raw can sugar");
  expect(body.split("\n").length).toBeGreaterThan(1);
});

test("copy: no body has a stray blank line or untrimmed edge", () => {
  for (const panel of PANEL_KEYS) {
    const body = ICE_CREAM_PANELS[panel].body;
    expect(body).toBe(body.trim());
    expect(body).not.toContain("\n\n");
    for (const line of body.split("\n")) expect(line).toBe(line.trim());
  }
});

test("copy: no panel or option states a price — digits and currency stay off-screen", () => {
  for (const panel of PANEL_KEYS) {
    const texts = [ICE_CREAM_PANELS[panel].body, ...ICE_CREAM_PANELS[panel].choices.map((c) => c.label)];
    for (const text of texts) {
      expect(text.length).toBeGreaterThan(0);
      expect(text).not.toMatch(/[0-9$€£]/);
    }
  }
});

// --- the art ----------------------------------------------------------------------

test("assets: every panel has bundled inline art — data URI, nothing external", () => {
  for (const panel of PANEL_KEYS) {
    const src = ICE_CREAM_ASSETS[panel];
    // Base64 WEBP: the real illustrations, bundled. Obsidian forbids
    // runtime-fetched promo art, so nothing may reference the network — and a
    // base64 payload cannot smuggle a URL past this check (":" and "/" ordering
    // aside, the alphabet has no ":").
    expect(src.startsWith("data:image/webp;base64,")).toBe(true);
    expect(src).not.toMatch(/https?:\/\//);
  }
});

test("assets: the art is actually decodable WEBP, not a truncated paste", () => {
  for (const panel of PANEL_KEYS) {
    const b64 = ICE_CREAM_ASSETS[panel].slice("data:image/webp;base64,".length);
    const bytes = Buffer.from(b64, "base64");
    // RIFF container: "RIFF" ....size.... "WEBP"
    expect(bytes.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(bytes.subarray(8, 12).toString("ascii")).toBe("WEBP");
    expect(bytes.byteLength).toBeGreaterThan(1000);
  }
});
