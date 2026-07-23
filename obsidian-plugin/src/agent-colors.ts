/** Coral Terminals color rotation — distinct, readable colors from the canonical
 *  Brand Identity palette. Order is the assignment order. (Neon Bio-Light #CCFF00
 *  was dropped — too harsh and too near the amber meristem hue; Peach Rose +
 *  Silver Facade added as the warm + neutral options.)
 *
 *  The last three are the named deep-sea hues — the Pro set (settled 23 July,
 *  refining the 14 July inversion): the five bare accents are free, and Pro is
 *  the named swatches PLUS the arbitrary color wheel (see canSelectColor). A
 *  Pro rotation spans all eight before any repeats; a free rotation cycles the
 *  five accents (see nextAgentColor). */
export const AGENT_COLORS = [
  "#5ECFBE", "#C44848", "#FF3399", "#D4927A", "#A8B4BC",
  "#9C6BFF", "#4DA3FF", "#7FE0A8",
] as const;

/** The free palette: the five bare brand accents. What a free user may pick,
 *  and the palette their auto-rotation draws from. */
export const FREE_AGENT_COLORS = AGENT_COLORS.slice(0, 5);

/** The named swatches: deep-sea hues chosen to stay clear of the amber meristem
 *  (#E8B96A) and periwinkle stems (#8499B8), named like the Meridian palette.
 *  These three are the Pro set — shown to everyone, locked without a key. The
 *  brand accents stay bare: a name marks a perk. */
export const NAMED_AGENT_COLORS = [
  { name: "Abyss violet", hex: "#9C6BFF" },
  { name: "Reef azure", hex: "#4DA3FF" },
  { name: "Sea glass", hex: "#7FE0A8" },
] as const;

/** One picker swatch — `name` is present for the deep-sea hues and null for the
 *  bare brand accents; `pro` marks the locked-without-a-key set. */
export interface ColorSwatch {
  hex: string;
  name: string | null;
  pro: boolean;
}

/** Every picker swatch, in rotation order — free accents first, then the
 *  Pro-tagged named hues (shown to everyone; locked without a key). */
export function colorSwatches(): ColorSwatch[] {
  return AGENT_COLORS.map((hex) => ({
    hex,
    name: NAMED_AGENT_COLORS.find((c) => c.hex === hex)?.name ?? null,
    pro: NAMED_AGENT_COLORS.some((c) => c.hex === hex),
  }));
}

/** Whether a color can be selected. Free: the five accents. Pro: anything —
 *  the named swatches and the whole wheel.
 *
 *  Case-insensitive on purpose: Obsidian's ColorComponent emits lowercase hex
 *  while the palette is written uppercase, and a swatch click round-trips through
 *  the wheel (`wheel.setValue`). An exact compare would read a free user's own
 *  swatch click as an arbitrary color and refuse it. */
export function canSelectColor(hex: string, isPro: boolean): boolean {
  if (isPro) return true;
  const h = hex.toLowerCase();
  return FREE_AGENT_COLORS.some((c) => c.toLowerCase() === h);
}

/** Whether the spectral pulse (hue drift on the agent tint pulse) should run:
 *  it is a Pro perk AND an opt-in setting — losing the entitlement silences
 *  the toggle without flipping it. */
export function spectralShiftActive(isPro: boolean, settingOn: boolean): boolean {
  return isPro && settingOn;
}

/** The next color for a new agent terminal: the first palette color not in
 *  `inUse`; if all are in use, the least-used (earliest in palette order on a
 *  tie). Colors in `inUse` outside the palette (user-picked wheel colors, or a
 *  Pro hue while rotating the free palette) are ignored. Pass
 *  FREE_AGENT_COLORS for a free user so the rotation never auto-assigns a
 *  color they could not pick by hand. */
export function nextAgentColor(
  inUse: readonly string[],
  palette: readonly string[] = AGENT_COLORS,
): string {
  const counts = palette.map((c) => inUse.filter((u) => u === c).length);
  let bestIdx = 0;
  for (let i = 1; i < counts.length; i++) {
    if (counts[i] < counts[bestIdx]) bestIdx = i;
  }
  return palette[bestIdx];
}
