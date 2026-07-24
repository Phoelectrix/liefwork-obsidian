/** Liefwork Pro entitlement — one-time Lemon Squeezy licence activation.
 *
 *  The whole network story of the plugin lives here: ONE call to the public
 *  licence-activation endpoint when the user pastes a key, an optional
 *  best-effort deactivation when they remove it, and nothing else — no
 *  recurring or startup validation ever. Once activated, the locally persisted
 *  state is trusted.
 *
 *  Obsidian-free by design (mirrors BindingStore): the HTTP transport is
 *  injected (`LicenseHttp`, adapted from `requestUrl` in settings-tab.ts), so
 *  every state transition and response branch is unit-testable offline. */

/** The LIVE Liefwork Pro checkout — founder-provided 23 July 2026, after the
 *  Lemon Squeezy store cleared review (20 July). Note it differs from the
 *  pre-approval uuid that stood in until then: **a placeholder and a live URL
 *  are identical in shape** (same domain, same `/checkout/buy/<uuid>`), which is
 *  why `scripts/verify-plugin-release.ts` pins every known non-live uuid and
 *  fails while one ships. Shape still can't prove liveness — the final proof is
 *  a real purchase.
 *
 *  Store licence config: activation limit **5**, unlimited duration. Five
 *  because every install POSTs its own activation and the plugin deactivates
 *  only best-effort when a key is removed — a reinstall, a second machine or a
 *  rebuilt vault each spend one; a limit of 1 (the common default) would lock a
 *  paying user out on their first reinstall. Unlimited duration matches what
 *  `activate` assumes: it checks only `activated === true` and never
 *  re-validates, so an expiring licence would go on working regardless.
 *
 *  Opened by the settings "Get a licence key" link, the support prompt, and the
 *  Ice Cream Man's "Sure thing" — this constant is the only place it lives.
 *
 *  The flow itself was VERIFIED END-TO-END in test mode, 15 July: buy → key →
 *  activate → Pro surfaces live → remove key → back to free → the Ice Cream Man
 *  returns. */
export const PRO_CHECKOUT_URL =
  "https://liefwork.lemonsqueezy.com/checkout/buy/747d71b4-8a13-4110-a637-a9a43736c0de";

export const LS_ACTIVATE_URL = "https://api.lemonsqueezy.com/v1/licenses/activate";
export const LS_DEACTIVATE_URL = "https://api.lemonsqueezy.com/v1/licenses/deactivate";
/** Instance name shown in the buyer's Lemon Squeezy dashboard. */
export const LS_INSTANCE_NAME = "Liefwork Obsidian";

/** The persisted entitlement — present in plugin data iff Pro is active. */
export interface ProState {
  licenseKey: string;
  /** Lemon Squeezy instance id, needed to deactivate this install later. */
  instanceId: string;
  /** ISO timestamp of when this install was activated. */
  activatedAt: string;
}

/** Minimal slice of Obsidian's `requestUrl` the licence calls depend on.
 *  `throw: false` semantics: non-2xx resolves (with status + parsed body);
 *  only a transport failure (offline, DNS, …) rejects. */
export type LicenseHttp = (req: {
  url: string;
  method: "POST";
  contentType: string;
  headers: Record<string, string>;
  body: string;
  throw: false;
}) => Promise<{ status: number; json: unknown }>;

export type ActivationResult =
  | { ok: true; state: ProState }
  /** The store answered and refused the key (invalid, expired, or at its
   *  activation limit) — `message` carries the store's reason. */
  | { ok: false; reason: "rejected"; message: string }
  /** The store couldn't be reached (or answered nonsense) — worth retrying. */
  | { ok: false; reason: "network"; message: string };

function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
}

/** Classify a licence-activation response. A 5xx (or a "success" missing the
 *  instance id) is a store hiccup, not a verdict on the key → "network". */
export function parseActivationResponse(
  status: number,
  json: unknown,
  licenseKey: string,
  activatedAt: string,
): ActivationResult {
  const body = asRecord(json);
  if (body.activated === true) {
    const instanceId = asRecord(body.instance).id;
    if (typeof instanceId === "string" && instanceId.length > 0) {
      return { ok: true, state: { licenseKey, instanceId, activatedAt } };
    }
    return { ok: false, reason: "network", message: "unexpected response from the store" };
  }
  if (status >= 500 || status === 0) {
    return { ok: false, reason: "network", message: `store error (HTTP ${status})` };
  }
  const message =
    typeof body.error === "string" && body.error.length > 0
      ? body.error
      : `the store rejected the key (HTTP ${status})`;
  return { ok: false, reason: "rejected", message };
}

/** Revive a persisted ProState from plugin data; null on anything malformed. */
export function parseProState(raw: unknown): ProState | null {
  const r = asRecord(raw);
  if (
    typeof r.licenseKey === "string" && r.licenseKey.length > 0 &&
    typeof r.instanceId === "string" && r.instanceId.length > 0 &&
    typeof r.activatedAt === "string" && r.activatedAt.length > 0
  ) {
    return { licenseKey: r.licenseKey, instanceId: r.instanceId, activatedAt: r.activatedAt };
  }
  return null;
}

/** Holds the Pro entitlement for the whole plugin: `isPro()` + a subscribe
 *  change signal (same idiom as BindingStore). Persistence is injected so the
 *  store stays Obsidian-free. */
export class ProStore {
  private state: ProState | null = null;
  private subs = new Set<() => void>();

  constructor(private readonly persist: (state: ProState | null) => Promise<void>) {}

  isPro(): boolean {
    return this.state !== null;
  }

  getState(): ProState | null {
    return this.state;
  }

  subscribe(cb: () => void): () => void {
    this.subs.add(cb);
    return () => this.subs.delete(cb);
  }

  /** Load the persisted entitlement at plugin start — no network, ever. */
  load(raw: unknown): void {
    const next = parseProState(raw);
    const changed = (next === null) !== (this.state === null);
    this.state = next;
    if (changed) this.emit();
  }

  /** The one network call of the plugin: POST the key to the public activation
   *  endpoint; on success persist { licenseKey, instanceId, activatedAt } and
   *  trust it locally from then on. */
  async activate(
    http: LicenseHttp,
    licenseKey: string,
    now: () => string = () => new Date().toISOString(),
  ): Promise<ActivationResult> {
    const key = licenseKey.trim();
    if (key.length === 0) return { ok: false, reason: "rejected", message: "no key entered" };
    let res: { status: number; json: unknown };
    try {
      res = await http({
        url: LS_ACTIVATE_URL,
        method: "POST",
        contentType: "application/json",
        headers: { Accept: "application/json" },
        body: JSON.stringify({ license_key: key, instance_name: LS_INSTANCE_NAME }),
        throw: false,
      });
    } catch {
      return { ok: false, reason: "network", message: "couldn't reach the store" };
    }
    const result = parseActivationResponse(res.status, res.json, key, now());
    if (result.ok) {
      this.state = result.state;
      await this.persist(this.state);
      this.emit();
    }
    return result;
  }

  /** Clear the local entitlement. The deactivation call frees the activation
   *  slot in the buyer's Lemon Squeezy dashboard, but it's best-effort only —
   *  the local state is already gone whether or not the store is reachable. */
  async removeKey(http: LicenseHttp): Promise<void> {
    const prev = this.state;
    this.state = null;
    await this.persist(null);
    if (prev !== null) this.emit();
    if (prev === null) return;
    try {
      await http({
        url: LS_DEACTIVATE_URL,
        method: "POST",
        contentType: "application/json",
        headers: { Accept: "application/json" },
        body: JSON.stringify({ license_key: prev.licenseKey, instance_id: prev.instanceId }),
        throw: false,
      });
    } catch {
      /* best-effort — the slot can be freed from the Lemon Squeezy dashboard */
    }
  }

  private emit(): void {
    for (const cb of this.subs) cb();
  }
}
