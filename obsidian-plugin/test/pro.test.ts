import { test, expect } from "bun:test";
import {
  LS_ACTIVATE_URL,
  LS_DEACTIVATE_URL,
  LS_INSTANCE_NAME,
  ProStore,
  parseActivationResponse,
  parseProState,
  type LicenseHttp,
  type ProState,
} from "../src/pro.ts";

const NOW = "2026-07-07T12:00:00.000Z";

/** A LicenseHttp mock that records every request and replays canned answers
 *  (a rejected promise stands in for a transport failure). No network. */
function mockHttp(...answers: ({ status: number; json: unknown } | Error)[]) {
  const calls: Parameters<LicenseHttp>[0][] = [];
  const http: LicenseHttp = (req) => {
    calls.push(req);
    const next = answers.shift() ?? new Error("mockHttp: no answer left");
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  };
  return { http, calls };
}

const activatedBody = (instanceId: string) => ({
  activated: true,
  error: null,
  instance: { id: instanceId, name: LS_INSTANCE_NAME, created_at: NOW },
});

function newStore() {
  const persisted: (ProState | null)[] = [];
  const store = new ProStore((s) => {
    persisted.push(s);
    return Promise.resolve();
  });
  return { store, persisted };
}

// --- parseActivationResponse -------------------------------------------------

test("parseActivationResponse: activated:true with an instance id → ok state", () => {
  const r = parseActivationResponse(200, activatedBody("inst-1"), "KEY", NOW);
  expect(r).toEqual({
    ok: true,
    state: { licenseKey: "KEY", instanceId: "inst-1", activatedAt: NOW },
  });
});

test("parseActivationResponse: activated:false carries the store's error → rejected", () => {
  const r = parseActivationResponse(400, { activated: false, error: "license_key not found." }, "K", NOW);
  expect(r).toEqual({ ok: false, reason: "rejected", message: "license_key not found." });
});

test("parseActivationResponse: refusal without an error string → rejected with a fallback", () => {
  const r = parseActivationResponse(404, { activated: false }, "K", NOW);
  expect(r.ok).toBe(false);
  if (!r.ok) {
    expect(r.reason).toBe("rejected");
    expect(r.message).toContain("404");
  }
});

test("parseActivationResponse: a 5xx is a store hiccup, not a verdict on the key → network", () => {
  const r = parseActivationResponse(503, { activated: false }, "K", NOW);
  expect(r).toMatchObject({ ok: false, reason: "network" });
});

test("parseActivationResponse: 'success' missing the instance id → network (retryable)", () => {
  const r = parseActivationResponse(200, { activated: true, instance: {} }, "K", NOW);
  expect(r).toMatchObject({ ok: false, reason: "network" });
});

test("parseActivationResponse: a non-JSON body (null) → rejected, never a crash", () => {
  const r = parseActivationResponse(400, null, "K", NOW);
  expect(r).toMatchObject({ ok: false, reason: "rejected" });
});

// --- parseProState (persisted-data revival) ----------------------------------

test("parseProState: revives a valid persisted state; rejects anything malformed", () => {
  const good = { licenseKey: "K", instanceId: "I", activatedAt: NOW };
  expect(parseProState(good)).toEqual(good);
  expect(parseProState(null)).toBeNull();
  expect(parseProState({})).toBeNull();
  expect(parseProState({ licenseKey: "K", instanceId: "", activatedAt: NOW })).toBeNull();
  expect(parseProState({ licenseKey: "K", instanceId: 7, activatedAt: NOW })).toBeNull();
});

// --- ProStore.activate --------------------------------------------------------

test("activate: success → isPro flips, state persisted, subscriber notified", async () => {
  const { store, persisted } = newStore();
  let notified = 0;
  store.subscribe(() => notified++);
  const { http, calls } = mockHttp({ status: 200, json: activatedBody("inst-9") });

  const r = await store.activate(http, "  MY-KEY  ", () => NOW);
  expect(r.ok).toBe(true);
  expect(store.isPro()).toBe(true);
  expect(persisted).toEqual([{ licenseKey: "MY-KEY", instanceId: "inst-9", activatedAt: NOW }]);
  expect(notified).toBe(1);

  // The one and only call: activation endpoint, JSON body, no auth header.
  expect(calls).toHaveLength(1);
  expect(calls[0]!.url).toBe(LS_ACTIVATE_URL);
  expect(calls[0]!.method).toBe("POST");
  expect(calls[0]!.headers).toEqual({ Accept: "application/json" });
  expect(JSON.parse(calls[0]!.body)).toEqual({ license_key: "MY-KEY", instance_name: LS_INSTANCE_NAME });
});

test("activate: the store refuses the key → rejected, nothing persisted or flipped", async () => {
  const { store, persisted } = newStore();
  let notified = 0;
  store.subscribe(() => notified++);
  const { http } = mockHttp({ status: 400, json: { activated: false, error: "license_key expired." } });

  const r = await store.activate(http, "OLD-KEY", () => NOW);
  expect(r).toEqual({ ok: false, reason: "rejected", message: "license_key expired." });
  expect(store.isPro()).toBe(false);
  expect(persisted).toEqual([]);
  expect(notified).toBe(0);
});

test("activate: transport failure (offline) → network, nothing persisted", async () => {
  const { store, persisted } = newStore();
  const { http } = mockHttp(new Error("net::ERR_INTERNET_DISCONNECTED"));

  const r = await store.activate(http, "KEY", () => NOW);
  expect(r).toMatchObject({ ok: false, reason: "network" });
  expect(store.isPro()).toBe(false);
  expect(persisted).toEqual([]);
});

test("activate: a blank key is rejected locally — no network call at all", async () => {
  const { store } = newStore();
  const { http, calls } = mockHttp();
  const r = await store.activate(http, "   ", () => NOW);
  expect(r).toMatchObject({ ok: false, reason: "rejected" });
  expect(calls).toHaveLength(0);
});

// --- ProStore.removeKey ---------------------------------------------------------

test("removeKey: clears + persists null, notifies, and best-effort deactivates", async () => {
  const { store, persisted } = newStore();
  const { http, calls } = mockHttp(
    { status: 200, json: activatedBody("inst-2") },
    { status: 200, json: { deactivated: true } },
  );
  await store.activate(http, "KEY", () => NOW);
  let notified = 0;
  store.subscribe(() => notified++);

  await store.removeKey(http);
  expect(store.isPro()).toBe(false);
  expect(persisted.at(-1)).toBeNull();
  expect(notified).toBe(1);

  expect(calls).toHaveLength(2);
  expect(calls[1]!.url).toBe(LS_DEACTIVATE_URL);
  expect(JSON.parse(calls[1]!.body)).toEqual({ license_key: "KEY", instance_id: "inst-2" });
});

test("removeKey: a failing deactivation call is ignored — local state still cleared", async () => {
  const { store, persisted } = newStore();
  const { http } = mockHttp({ status: 200, json: activatedBody("inst-3") }, new Error("offline"));
  await store.activate(http, "KEY", () => NOW);

  await store.removeKey(http); // must not throw
  expect(store.isPro()).toBe(false);
  expect(persisted.at(-1)).toBeNull();
});

test("removeKey: without an active key it's a no-op on the network", async () => {
  const { store } = newStore();
  const { http, calls } = mockHttp();
  await store.removeKey(http);
  expect(calls).toHaveLength(0);
  expect(store.isPro()).toBe(false);
});

// --- ProStore.load --------------------------------------------------------------

test("load: revives persisted state (no network) and notifies on a real change", () => {
  const { store } = newStore();
  let notified = 0;
  store.subscribe(() => notified++);

  store.load({ licenseKey: "K", instanceId: "I", activatedAt: NOW });
  expect(store.isPro()).toBe(true);
  expect(notified).toBe(1);

  store.load(null); // e.g. data file hand-edited away
  expect(store.isPro()).toBe(false);
  expect(notified).toBe(2);

  store.load(null); // no change → no signal
  expect(notified).toBe(2);
});

test("load: garbage in plugin data never activates Pro", () => {
  const { store } = newStore();
  store.load({ licenseKey: 42 });
  expect(store.isPro()).toBe(false);
});

test("subscribe: unsubscribe stops the change signal", async () => {
  const { store } = newStore();
  let n = 0;
  const off = store.subscribe(() => n++);
  const { http } = mockHttp({ status: 200, json: activatedBody("i") });
  await store.activate(http, "K", () => NOW);
  expect(n).toBe(1);
  off();
  await store.removeKey(mockHttp({ status: 200, json: {} }).http);
  expect(n).toBe(1);
});
