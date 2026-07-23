// In-situ dev tuning panel. A slider per text/sizing knob, wired to
// mount.setDevKnobs so values track live on the real canvas — no
// Studio→export→graft loop. "Copy JSON" emits a stylingConfig fragment ready to
// paste into a bundle (or into liefwork-defaults.ts). Self-contained (inline
// styles), so it never touches the shipped stylesheet.
//
// Two hosts: the public site (gated behind `?dev`) and — since the 21 July
// tuning session — the Obsidian plugin's coral view, so the founder can tune
// against the real vault. The plugin host is why installDevPanel takes a
// container: a coral in a pop-out window lives in a DIFFERENT document, and
// appending to the main `document.body` would put the panel on the wrong
// screen. The container's ownerDocument is used for every createElement.
import type { PlantMountHandle, DevKnobs, EngineKnobs } from "./mount-plant.ts";

interface KnobSpec {
  key: keyof DevKnobs;
  label: string;
  min: number;
  max: number;
  step: number;
}

interface EngineKnobSpec {
  key: keyof EngineKnobs;
  label: string;
  min: number;
  max: number;
  step: number;
}

// Engine-geometry knobs — changing these re-runs the layout engine (see
// mount.setEngineKnobs), so they live in their own group below the styling knobs.
const ENGINE_KNOBS: EngineKnobSpec[] = [
  { key: "branchBuffer", label: "branchBuffer (branch spacing)", min: 0.5, max: 4, step: 0.1 },
  { key: "childScale", label: "childScale (child branch size)", min: 0.3, max: 1.0, step: 0.01 },
];

const SIZING_KNOBS: KnobSpec[] = [
  { key: "titleSize", label: "titleSize (block text / wrap)", min: 0.1, max: 1.0, step: 0.01 },
  { key: "basalMag", label: "basalMag (overview floor)", min: 0.5, max: 6, step: 0.05 },
  { key: "optimalSize", label: "optimalSize (meristem focal)", min: 20, max: 320, step: 2 },
  { key: "liefOptimalSize", label: "liefOptimalSize", min: 10, max: 160, step: 2 },
  { key: "subtreeBoost", label: "subtreeBoost", min: 0, max: 1, step: 0.01 },
  // Was max 4 — raised to 8 so the "sharpen the wide view" end of the range
  // (steeper subtreeNorm curve = only the truly big branches lift) is reachable.
  { key: "subtreeBoostShape", label: "subtreeBoostShape", min: 0.2, max: 8, step: 0.05 },
  { key: "attentionPropagationDecay", label: "attentionPropagationDecay", min: 0, max: 1, step: 0.02 },
  { key: "meristemPeakSize", label: "meristemPeakSize (cull cap)", min: 60, max: 400, step: 10 },
  { key: "liefPeakSize", label: "liefPeakSize (cull cap)", min: 30, max: 240, step: 5 },
  { key: "meristemDistance", label: "meristemDistance (ray)", min: 0.5, max: 6, step: 0.05 },
  // Real outlier at 50 (an empty stalk lifting the root title clear of the
  // plant) — the range has to reach it or opening the panel would snap it back.
  { key: "rootMeristemDistance", label: "rootMeristemDistance (ray)", min: 0.5, max: 60, step: 0.5 },
];

// LOD ladder — WHEN a label switches treatment as it grows/shrinks on screen.
// Per kind: full text above `full`, letter-dots above `dots`, a single dot
// below that, nothing below `cull`. visualTier tests `full` FIRST, so setting
// dots ≥ full deliberately switches the glyph tier OFF for that kind (text →
// single dot, no middle stage) — that is a supported configuration, not a bug.
// Constraint: liefFullAbovePx ≤ liefOptimalSize, or cursor-hover can never
// reveal a lief's text (lit magnification caps at the optimal size).
const LOD_KNOBS: KnobSpec[] = [
  { key: "meristemFullAbovePx", label: "meristem: text above", min: 1, max: 24, step: 0.5 },
  { key: "meristemDotsAbovePx", label: "meristem: glyphs above", min: 0, max: 24, step: 0.5 },
  { key: "meristemCullMinPx", label: "meristem: hide below", min: 0, max: 12, step: 0.5 },
  { key: "liefFullAbovePx", label: "lief: text above", min: 1, max: 24, step: 0.5 },
  { key: "liefDotsAbovePx", label: "lief: glyphs above", min: 0, max: 24, step: 0.5 },
  { key: "liefCullMinPx", label: "lief: hide below", min: 0, max: 12, step: 0.5 },
  // The anti-overlap ceiling. 1 = a lief may never exceed its geometric size
  // (tightest); 0 = off (pre-21-July behaviour, liefs free to pin at optimal).
  { key: "liefMaxLift", label: "lief: crowding cap (× basal)", min: 0, max: 6, step: 0.1 },
];

// Camera framing — these don't repaint; they take effect on the NEXT fit
// (click a meristem to see it). See mount.setDevKnobs / panzoom.setFitPadding.
const CAMERA_KNOBS: KnobSpec[] = [
  { key: "fitPadding", label: "fitPadding (viewport margin)", min: 0, max: 0.4, step: 0.005 },
  { key: "branchFramePad", label: "branchFramePad (meristem click)", min: 1, max: 2.5, step: 0.05 },
  { key: "branchFitPad", label: "branchFitPad (double-click fit)", min: 1, max: 2.5, step: 0.05 },
];

/** Build a stylingConfig fragment from the current knobs — same shape a bundle's
 *  stylingConfig uses, so it can be pasted straight in (projection.* / camera.*
 *  nested). Exported for the paste-shape pin test (dev-panel-camera.test.ts). */
export function knobsToStylingFragment(k: DevKnobs): Record<string, unknown> {
  return {
    basalMag: k.basalMag,
    optimalSize: k.optimalSize,
    liefOptimalSize: k.liefOptimalSize,
    subtreeBoost: k.subtreeBoost,
    subtreeBoostShape: k.subtreeBoostShape,
    attentionPropagationDecay: k.attentionPropagationDecay,
    meristemPeakSize: k.meristemPeakSize,
    liefPeakSize: k.liefPeakSize,
    meristemFullAbovePx: k.meristemFullAbovePx,
    meristemDotsAbovePx: k.meristemDotsAbovePx,
    meristemCullMinPx: k.meristemCullMinPx,
    liefFullAbovePx: k.liefFullAbovePx,
    liefDotsAbovePx: k.liefDotsAbovePx,
    liefCullMinPx: k.liefCullMinPx,
    liefMaxLift: k.liefMaxLift,
    projection: {
      titleSize: k.titleSize,
      meristemDistance: k.meristemDistance,
      rootMeristemDistance: k.rootMeristemDistance,
    },
    camera: {
      fitPadding: k.fitPadding,
      branchFramePad: k.branchFramePad,
      branchFitPad: k.branchFitPad,
    },
  };
}

/** Render one knob group's rows into `body` — a slider + live value label per
 *  spec, seeded from `current` and pushed back via `onInput`. Shared by the
 *  sizing, engine and camera groups so each isn't a copy-pasted render block. */
function renderKnobGroup<T>(
  body: HTMLElement,
  specs: { key: keyof T; label: string; min: number; max: number; step: number }[],
  current: T,
  accentColor: string,
  onInput: (key: keyof T, value: number) => void,
  valueLabels?: Map<keyof T, HTMLSpanElement>,
): void {
  const document = body.ownerDocument;
  for (const spec of specs) {
    const row = document.createElement("label");
    Object.assign(row.style, { display: "block", margin: "7px 0" } as CSSStyleDeclaration);

    const top = document.createElement("div");
    Object.assign(top.style, { display: "flex", justifyContent: "space-between", opacity: "0.85" } as CSSStyleDeclaration);
    const name = document.createElement("span");
    name.textContent = spec.label;
    const val = document.createElement("span");
    val.textContent = String(current[spec.key]);
    valueLabels?.set(spec.key, val);
    top.append(name, val);

    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = String(spec.min);
    slider.max = String(spec.max);
    slider.step = String(spec.step);
    slider.value = String(current[spec.key]);
    Object.assign(slider.style, { width: "100%", marginTop: "2px", accentColor } as CSSStyleDeclaration);
    slider.addEventListener("input", () => {
      const v = Number(slider.value);
      val.textContent = String(v);
      onInput(spec.key, v);
    });

    row.append(top, slider);
    body.appendChild(row);
  }
}

export interface DevPanelOptions {
  /** Show the engine-geometry group. FALSE for the Obsidian plugin: its mount
   *  has no live engine config (mountPlant only keeps one when built via
   *  `unfurl.engineConfig`), so setEngineKnobs is a no-op and getEngineKnobs
   *  reports the library FALLBACKS — the panel would show childScale 0.618
   *  while the plugin actually builds at 1, and dragging would do nothing.
   *  Showing inert sliders that misreport the live value is worse than hiding
   *  them. Default true (the site, which does pass an engine config). */
  showEngineKnobs?: boolean;
  /** Where the panel is appended. Defaults to the global `document.body` (the
   *  site). The plugin passes its coral host so the panel lands in the right
   *  document for pop-out windows and is removed with the view. */
  container?: HTMLElement;
}

export function installDevPanel(
  mount: PlantMountHandle,
  opts: DevPanelOptions = {},
): { destroy: () => void } {
  const container = opts.container ?? window.document.body;
  // Shadows the global for the rest of the function — every element below is
  // created in the CONTAINER's document (a pop-out window has its own).
  const document = container.ownerDocument;
  const el = document.createElement("div");
  el.id = "dev-panel";
  Object.assign(el.style, {
    // absolute (not fixed) when hosted in a pane: the panel then scrolls/clips
    // with its container instead of floating over the whole app chrome.
    position: opts.container ? "absolute" : "fixed", top: "12px", left: "12px", zIndex: "10000",
    // 88vh is right for the site (panel over the whole viewport). In a pane
    // the panel must bound to its CONTAINER, or the footer (copy JSON / fit)
    // ends up below the pane's bottom edge and is unreachable — the container
    // clips it and the panel's own scroll never engages.
    width: "300px", maxHeight: opts.container ? "calc(100% - 24px)" : "88vh", overflowY: "auto",
    padding: "10px 12px 12px", borderRadius: "8px",
    background: "rgba(18,18,22,0.92)", color: "#e8e6df",
    font: "12px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace",
    border: "1px solid rgba(255,255,255,0.12)", boxShadow: "0 6px 24px rgba(0,0,0,0.5)",
    backdropFilter: "blur(6px)", userSelect: "none",
  } as CSSStyleDeclaration);

  // Header: title + collapse toggle.
  const header = document.createElement("div");
  Object.assign(header.style, { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px", cursor: "pointer" } as CSSStyleDeclaration);
  const title = document.createElement("strong");
  title.textContent = "coral dev · text";
  const collapse = document.createElement("span");
  collapse.textContent = "▾";
  header.append(title, collapse);
  el.appendChild(header);

  const body = document.createElement("div");
  el.appendChild(body);
  header.addEventListener("click", () => {
    const hidden = body.style.display === "none";
    body.style.display = hidden ? "block" : "none";
    collapse.textContent = hidden ? "▾" : "▸";
  });

  const current = mount.getDevKnobs();
  const valueLabels = new Map<keyof DevKnobs, HTMLSpanElement>();

  renderKnobGroup<DevKnobs>(
    body, SIZING_KNOBS, current, "#7fd6c2",
    (key, v) => mount.setDevKnobs({ [key]: v }),
    valueLabels,
  );

  // ── LOD ladder (which treatment a label gets at its current screen size) ──
  const lodHeader = document.createElement("div");
  Object.assign(lodHeader.style, {
    marginTop: "12px", marginBottom: "2px", opacity: "0.55",
    fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.07em",
  } as CSSStyleDeclaration);
  lodHeader.textContent = "LOD · glyphs off when dots ≥ text";
  body.appendChild(lodHeader);

  renderKnobGroup<DevKnobs>(
    body, LOD_KNOBS, current, "#e6d27f",
    (key, v) => mount.setDevKnobs({ [key]: v }),
    valueLabels,
  );

  // ── Engine geometry (each change re-runs the layout engine, rAF-coalesced) ──
  if (opts.showEngineKnobs ?? true) {
  const engineHeader = document.createElement("div");
  Object.assign(engineHeader.style, {
    marginTop: "12px", marginBottom: "2px", opacity: "0.55",
    fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.07em",
  } as CSSStyleDeclaration);
  engineHeader.textContent = "engine · rebuilds live";
  body.appendChild(engineHeader);

  const engineCurrent = mount.getEngineKnobs();
  renderKnobGroup<EngineKnobs>(
    body, ENGINE_KNOBS, engineCurrent, "#e6a57f",
    (key, v) => mount.setEngineKnobs({ [key]: v }),
  );
  }

  // ── Camera framing (takes effect on the NEXT fit — click a meristem) ──
  const cameraHeader = document.createElement("div");
  Object.assign(cameraHeader.style, {
    marginTop: "12px", marginBottom: "2px", opacity: "0.55",
    fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.07em",
  } as CSSStyleDeclaration);
  cameraHeader.textContent = "camera · takes effect on next fit";
  body.appendChild(cameraHeader);

  renderKnobGroup<DevKnobs>(
    body, CAMERA_KNOBS, current, "#c2a1e6",
    (key, v) => mount.setDevKnobs({ [key]: v }),
    valueLabels,
  );

  // Footer: copy JSON + fit.
  const footer = document.createElement("div");
  Object.assign(footer.style, { display: "flex", gap: "6px", marginTop: "10px" } as CSSStyleDeclaration);
  const mkBtn = (text: string): HTMLButtonElement => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = text;
    Object.assign(b.style, { flex: "1", padding: "6px", cursor: "pointer", borderRadius: "5px", border: "1px solid rgba(255,255,255,0.18)", background: "rgba(255,255,255,0.06)", color: "inherit", font: "inherit" } as CSSStyleDeclaration);
    return b;
  };
  const copyBtn = mkBtn("copy JSON");
  copyBtn.addEventListener("click", () => {
    const json = JSON.stringify(knobsToStylingFragment(mount.getDevKnobs()), null, 2);
    void navigator.clipboard?.writeText(json);
    copyBtn.textContent = "copied ✓";
    window.setTimeout(() => { copyBtn.textContent = "copy JSON"; }, 1200);
  });
  const fitBtn = mkBtn("fit coral");
  fitBtn.addEventListener("click", () => mount.fitAll());
  footer.append(copyBtn, fitBtn);
  body.appendChild(footer);

  container.appendChild(el);
  return { destroy: () => el.remove() };
}
