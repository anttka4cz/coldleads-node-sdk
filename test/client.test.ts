import { createHash, createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import ColdLeadsDefault, {
  AuthenticationError,
  ColdLeads,
  ColdLeadsError,
  ConnectionError,
  InsufficientCreditsError,
  InvalidRequestError,
  NotFoundError,
  PermissionError,
  RateLimitError,
  ServerError,
  TimeoutError,
  verifyCallbackSignature,
  type FetchLike,
} from "../src/index.js";

type Call = { url: string; init: RequestInit };
const KEY = `sk_${"a".repeat(48)}`;
const json = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

function harness(responder: (call: Call, n: number) => Response | Promise<Response>, options: { apiKey?: string; maxRetries?: number; timeoutMs?: number } = {}) {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init) => {
    const call = { url, init };
    calls.push(call);
    return responder(call, calls.length);
  };
  const client = new ColdLeads({ apiKey: options.apiKey ?? KEY, baseUrl: "https://api.test", fetch, maxRetries: options.maxRetries, timeoutMs: options.timeoutMs });
  const header = (i: number, name: string) => (calls[i]!.init.headers as Record<string, string>)[name];
  const body = (i: number) => JSON.parse(String(calls[i]!.init.body));
  return { client, calls, header, body };
}

const verifyOk = { email: "anna@acme.com", status: "valid", score: 97, reasons: ["ok"], mx: "mx.acme.com", catch_all: false, disposable: false, role: false, checked_at: "2026-09-30T10:00:00.000Z", cached: false };

describe("client basics", () => {
  it("sends the key as a Bearer token with a JSON body and an SDK user agent", async () => {
    const h = harness(() => json(200, verifyOk));
    const r = await h.client.verify.email(" anna@acme.com ");
    expect(r).toEqual(verifyOk);
    expect(h.calls[0]!.url).toBe("https://api.test/api/v1/verify");
    expect(h.calls[0]!.init.method).toBe("POST");
    expect(h.header(0, "Authorization")).toBe(`Bearer ${KEY}`);
    expect(h.header(0, "User-Agent")).toMatch(/^coldleads-node\/\d+\.\d+\.\d+$/);
    expect(h.body(0)).toEqual({ email: "anna@acme.com" });
  });
  it("passes a server-side time budget as timeout_ms", async () => {
    const h = harness(() => json(200, verifyOk));
    await h.client.verify.email("anna@acme.com", { budgetMs: 4000 });
    expect(h.body(0)).toEqual({ email: "anna@acme.com", timeout_ms: 4000 });
  });
  it("without a key, key-protected calls fail locally with AuthenticationError", async () => {
    const h = harness(() => json(200, {}), { apiKey: "" });
    await expect(h.client.credits.get()).rejects.toBeInstanceOf(AuthenticationError);
    await expect(h.client.credits.get()).rejects.toMatchObject({ code: "missing_api_key", status: 401 });
    expect(h.calls).toHaveLength(0);
  });
  it("reads COLDLEADS_API_KEY and COLDLEADS_API_BASE from the environment", async () => {
    process.env.COLDLEADS_API_KEY = "sk_env";
    process.env.COLDLEADS_API_BASE = "https://env.test";
    const calls: Call[] = [];
    const c = new ColdLeadsDefault({ fetch: async (url, init) => (calls.push({ url, init }), json(200, { plan: "business", limit: 10000, used: 1, left: 9999 })) });
    await c.credits.get();
    expect(calls[0]!.url).toBe("https://env.test/api/v1/credits");
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe("Bearer sk_env");
    delete process.env.COLDLEADS_API_KEY;
    delete process.env.COLDLEADS_API_BASE;
  });
});

describe("resources", () => {
  it("find.email posts name and domain; validates input locally", async () => {
    const h = harness(() => json(200, { email: "anna.novak@acme.com", confidence: 90, method: "verified", catch_all: false, candidates: [] }));
    const r = await h.client.find.email({ first: "Anna", last: "Novak", domain: "acme.com" });
    expect(r.email).toBe("anna.novak@acme.com");
    expect(h.calls[0]!.url).toBe("https://api.test/api/v1/find");
    expect(h.body(0)).toEqual({ domain: "acme.com", first: "Anna", last: "Novak" });
    expect(() => h.client.find.email({ domain: "acme.com" })).toThrow(InvalidRequestError);
    expect(() => h.client.find.email({ domain: "", first: "A" })).toThrow(InvalidRequestError);
  });
  it("leads.search sends domain, role and limit as query parameters", async () => {
    const h = harness(() => json(200, { domain: "acme.com", count: 0, source: "crm", leads: [] }));
    await h.client.leads.search({ domain: "acme.com", role: "sales", limit: 5 });
    expect(h.calls[0]!.url).toBe("https://api.test/api/v1/leads?domain=acme.com&role=sales&limit=5");
    expect(h.calls[0]!.init.method).toBe("GET");
    await h.client.leads.search({ domain: "acme.com" });
    expect(h.calls[1]!.url).toBe("https://api.test/api/v1/leads?domain=acme.com");
  });
  it("verify.bulk starts a job; verify.job adds results on request", async () => {
    const h = harness((c) => (c.url.endsWith("/bulk") ? json(202, { id: "job_1", status: "queued", total: 2, poll: "/api/v1/verify/jobs/job_1" }) : json(200, { id: "job_1", status: "done", total: 2, done: 2, counts: { valid: 1, risky: 1, invalid: 0 }, created_at: "", finished_at: "" })));
    expect(await h.client.verify.bulk(["a@x.cz", "b@y.cz"], { name: "September" })).toMatchObject({ id: "job_1", status: "queued" });
    expect(h.body(0)).toEqual({ emails: ["a@x.cz", "b@y.cz"], name: "September" });
    await h.client.verify.job("job_1", { results: true });
    expect(h.calls[1]!.url).toBe("https://api.test/api/v1/verify/jobs/job_1?results=1");
    expect(() => h.client.verify.bulk([])).toThrow(InvalidRequestError);
  });
  it("verify.waitForJob polls until done and then fetches results", async () => {
    const states = ["queued", "running", "done"];
    const progress: string[] = [];
    const h = harness((c, n) => json(200, { id: "job_1", status: c.url.includes("results=1") ? "done" : states[Math.min(n - 1, 2)], total: 2, done: n, counts: { valid: 2, risky: 0, invalid: 0 }, created_at: "", finished_at: null, ...(c.url.includes("results=1") ? { results: [] } : {}) }));
    const job = await h.client.verify.waitForJob("job_1", { pollIntervalMs: 500, results: true, onProgress: (j) => progress.push(j.status) });
    expect(progress).toEqual(["queued", "running", "done"]);
    expect(job.results).toEqual([]);
    expect(h.calls.at(-1)!.url).toContain("results=1");
  }, 10_000);
});

describe("errors", () => {
  it.each([
    [400, { error: "email_required" }, InvalidRequestError],
    [401, { error: "bad_api_key" }, AuthenticationError],
    [402, { error: "no_credits" }, InsufficientCreditsError],
    [403, { error: "api_not_in_plan", hint: "Business plan includes the API" }, PermissionError],
    [404, { error: "not_found" }, NotFoundError],
    [409, { error: "account_exists" }, InvalidRequestError],
    [413, { error: "too_many", max: 5000 }, InvalidRequestError],
    [500, {}, ServerError],
  ])("HTTP %i → %s with code, hint and body", async (status, body, Cls) => {
    const h = harness(() => json(status, body), { maxRetries: 0 });
    const err = await h.client.verify.email("a@b.cz").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Cls);
    expect(err).toBeInstanceOf(ColdLeadsError);
    expect(err).toMatchObject({ status, code: (body as { error?: string }).error ?? `http_${status}` });
    if ((body as { hint?: string }).hint) expect((err as ColdLeadsError).hint).toBe((body as { hint: string }).hint);
    expect((err as Error).name).toBe(Cls.name);
  });
  it("429 carries Retry-After and is retried, even for POST", async () => {
    const h = harness((_c, n) => (n === 1 ? json(429, { error: "rate_limited" }, { "retry-after": "0" }) : json(200, verifyOk)));
    expect(await h.client.verify.email("anna@acme.com")).toEqual(verifyOk);
    expect(h.calls).toHaveLength(2);
    const once = harness(() => json(429, { error: "rate_limited" }, { "retry-after": "7" }), { maxRetries: 0 });
    const err = (await once.client.credits.get().catch((e: unknown) => e)) as RateLimitError;
    expect(err).toBeInstanceOf(RateLimitError);
    expect(err.retryAfterSeconds).toBe(7);
  });
  it("5xx is retried for GET but never for POST (a credit may already be spent)", async () => {
    const get = harness((_c, n) => (n === 1 ? json(503, {}) : json(200, { plan: "business", limit: 1, used: 0, left: 1 })));
    await get.client.credits.get();
    expect(get.calls).toHaveLength(2);
    const post = harness(() => json(503, {}));
    await expect(post.client.verify.email("a@b.cz")).rejects.toBeInstanceOf(ServerError);
    expect(post.calls).toHaveLength(1);
  });
  it("network failures: retried for GET, ConnectionError for POST", async () => {
    const get = harness((_c, n) => {
      if (n === 1) throw new TypeError("fetch failed");
      return json(200, { plan: null, limit: 0, used: 0, left: 0 });
    });
    await get.client.credits.get();
    expect(get.calls).toHaveLength(2);
    const post = harness(() => {
      throw new TypeError("fetch failed");
    });
    await expect(post.client.verify.email("a@b.cz")).rejects.toBeInstanceOf(ConnectionError);
    expect(post.calls).toHaveLength(1);
  });
  it("a hanging request ends with TimeoutError; a caller abort rejects with the caller's reason", async () => {
    const hang: FetchLike = (_u, init) => new Promise((_, reject) => init.signal?.addEventListener("abort", () => reject(init.signal?.reason)));
    const c = new ColdLeads({ apiKey: KEY, baseUrl: "https://api.test", fetch: hang, timeoutMs: 100, maxRetries: 0 });
    await expect(c.credits.get()).rejects.toBeInstanceOf(TimeoutError);
    const ctrl = new AbortController();
    const p = new ColdLeads({ apiKey: KEY, baseUrl: "https://api.test", fetch: hang, timeoutMs: 10_000 }).credits.get({ signal: ctrl.signal });
    ctrl.abort(new Error("stop"));
    await expect(p).rejects.toThrow("stop");
  });
});

describe("agent onboarding", () => {
  it("provision posts without Authorization and is never retried", async () => {
    const payload = { status: "payment_required", checkout_url: "https://checkout.stripe.com/c/pay/cs_1", session_id: "cs_1", claim_token: "clt_x" };
    const h = harness(() => json(200, payload));
    expect(await h.client.agent.provision({ ownerEmail: "boss@acme.com", agentId: "Scout", callbackUrl: "https://agent.example/cb" })).toEqual(payload);
    expect(h.calls[0]!.url).toBe("https://api.test/api/agent/provision");
    expect(h.header(0, "Authorization")).toBeUndefined();
    expect(h.body(0)).toEqual({ owner_email: "boss@acme.com", agent_id: "Scout", callback_url: "https://agent.example/cb" });
    const limited = harness(() => json(429, { error: "rate_limited" }, { "retry-after": "0" }));
    await expect(limited.client.agent.provision({ ownerEmail: "a@b.cz", agentId: "A" })).rejects.toBeInstanceOf(RateLimitError);
    expect(limited.calls).toHaveLength(1);
  });
  it("status sends the claim token as a header; can look up by owner e-mail", async () => {
    const h = harness(() => json(200, { status: "pending_payment" }), { apiKey: "" });
    await h.client.agent.status({ sessionId: "cs_1", claimToken: "clt_secret" });
    expect(h.calls[0]!.url).toBe("https://api.test/api/agent/status?session_id=cs_1");
    expect(h.header(0, "X-Claim-Token")).toBe("clt_secret");
    await h.client.agent.status({ ownerEmail: "boss@acme.com" });
    expect(h.calls[1]!.url).toBe("https://api.test/api/agent/status?owner_email=boss%40acme.com");
    expect(() => h.client.agent.status({})).toThrow(InvalidRequestError);
  });
  it("waitForActivation returns the key once the owner paid and switches the client to it", async () => {
    const issued = `sk_${"c".repeat(48)}`;
    const seen: string[] = [];
    const h = harness((c, n) => {
      if (c.url.includes("/api/agent/status")) return json(200, n === 1 ? { status: "pending_payment" } : { status: "active", api_key: issued, api_key_prefix: "sk_…cccc" });
      return json(200, verifyOk);
    }, { apiKey: "" });
    const { apiKey, status } = await h.client.agent.waitForActivation({ sessionId: "cs_1", claimToken: "clt_secret" }, { pollIntervalMs: 2_000, onStatus: (s) => seen.push(s.status) });
    expect(apiKey).toBe(issued);
    expect(status.status).toBe("active");
    expect(seen).toEqual(["pending_payment", "active"]);
    expect(h.client.hasApiKey).toBe(true);
    await h.client.verify.email("anna@acme.com");
    expect(h.header(2, "Authorization")).toBe(`Bearer ${issued}`);
  }, 10_000);
  it("waitForActivation stops on an expired link or an already collected key", async () => {
    const expired = harness(() => json(200, { status: "expired", message: "The payment link expired" }), { apiKey: "" });
    await expect(expired.client.agent.waitForActivation({ sessionId: "cs_1", claimToken: "clt_x" })).rejects.toMatchObject({ code: "expired" });
    const collected = harness(() => json(200, { status: "active", api_key_prefix: "sk_…cccc" }), { apiKey: "" });
    await expect(collected.client.agent.waitForActivation({ sessionId: "cs_1", claimToken: "clt_x" })).rejects.toMatchObject({ code: "key_already_delivered" });
  });
});

describe("verifyCallbackSignature", () => {
  const claimToken = `clt_${"d".repeat(64)}`;
  const body = JSON.stringify({ event: "coldleads.account.activated", provision_id: "prov_1", session_id: "cs_1", status: "active" });
  const sign = (raw: string, token: string) => `sha256=${createHmac("sha256", createHash("sha256").update(token).digest("hex")).update(raw).digest("hex")}`;
  it("accepts the server's signature and rejects tampering, other tokens and malformed headers", () => {
    expect(verifyCallbackSignature(body, sign(body, claimToken), claimToken)).toBe(true);
    expect(verifyCallbackSignature(body.replace("active", "expired"), sign(body, claimToken), claimToken)).toBe(false);
    expect(verifyCallbackSignature(body, sign(body, `clt_${"e".repeat(64)}`), claimToken)).toBe(false);
    for (const header of [null, "", "sha1=abc", "sha256=zz", `sha256=${"0".repeat(10)}`]) expect(verifyCallbackSignature(body, header, claimToken)).toBe(false);
  });
});
