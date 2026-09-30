import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { ColdLeadsError, InvalidRequestError, TimeoutError } from "./errors.js";
import { DEFAULT_BASE_URL, DEFAULT_MAX_RETRIES, DEFAULT_TIMEOUT_MS, HttpClient, type FetchLike } from "./http.js";
import type { BulkVerifyJob, Credits, FindResult, LeadSearchResult, Provisioning, ProvisioningStatus, VerifyJob, VerifyResult } from "./types.js";

export interface ColdLeadsOptions {
  /** Secret API key (sk_…). Defaults to process.env.COLDLEADS_API_KEY. Not needed for agent onboarding. */
  apiKey?: string;
  /** Defaults to process.env.COLDLEADS_API_BASE or https://coldleads.app. */
  baseUrl?: string;
  /** Per-request timeout in milliseconds (default 30 000). */
  timeoutMs?: number;
  /** Retries for rate limits and, for GET requests, transient server or network errors (default 2). */
  maxRetries?: number;
  /** Custom fetch implementation (tests, proxies). Defaults to the global fetch. */
  fetch?: FetchLike;
}

const env = (name: string): string | undefined => (typeof process !== "undefined" ? process.env?.[name] : undefined);
const requireString = (value: unknown, name: string): string => {
  if (typeof value !== "string" || !value.trim()) throw new InvalidRequestError(`invalid_argument: ${name} is required`, { status: 400, code: "invalid_argument" });
  return value.trim();
};
const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => (clearTimeout(t), reject(signal.reason)), { once: true });
  });

/**
 * Cold Leads API client.
 *
 * ```ts
 * const coldleads = new ColdLeads({ apiKey: process.env.COLDLEADS_API_KEY });
 * const r = await coldleads.verify.email("anna@example.com");
 * ```
 */
export class ColdLeads {
  readonly http: HttpClient;
  readonly verify: VerifyResource;
  readonly find: FindResource;
  readonly leads: LeadsResource;
  readonly credits: CreditsResource;
  readonly agent: AgentResource;

  constructor(options: ColdLeadsOptions = {}) {
    const fetchImpl = options.fetch ?? ((input: string, init: RequestInit) => globalThis.fetch(input, init));
    this.http = new HttpClient({
      apiKey: (options.apiKey ?? env("COLDLEADS_API_KEY") ?? "").trim(),
      baseUrl: options.baseUrl ?? env("COLDLEADS_API_BASE") ?? DEFAULT_BASE_URL,
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxRetries: options.maxRetries ?? DEFAULT_MAX_RETRIES,
      fetch: fetchImpl,
    });
    this.verify = new VerifyResource(this.http);
    this.find = new FindResource(this.http);
    this.leads = new LeadsResource(this.http);
    this.credits = new CreditsResource(this.http);
    this.agent = new AgentResource(this.http, (key) => this.setApiKey(key));
  }

  /** Replace the API key (for example with the key returned by agent onboarding). */
  setApiKey(apiKey: string): void {
    this.http.config.apiKey = apiKey.trim();
  }

  get hasApiKey(): boolean {
    return this.http.config.apiKey.length > 0;
  }
}

export class VerifyResource {
  constructor(private readonly http: HttpClient) {}

  /**
   * Verify one address (1 credit): syntax, disposable domain, role account and MX records, plus an SMTP mailbox and
   * catch-all check when the Cold Leads server can reach the recipient's mail server (otherwise reason
   * `smtp_unreachable` and `catch_all: false` = not checked). `budgetMs` (1000–30000) caps the server-side check;
   * when it runs out the result is `risky` with reason `timeout`.
   */
  email(email: string, options: { budgetMs?: number; signal?: AbortSignal } = {}): Promise<VerifyResult> {
    const addr = requireString(email, "email");
    const body: Record<string, unknown> = { email: addr };
    if (options.budgetMs !== undefined) body.timeout_ms = Math.round(options.budgetMs);
    return this.http.request<VerifyResult>("POST", "/api/v1/verify", { body, signal: options.signal, timeoutMs: options.budgetMs !== undefined ? options.budgetMs + 5_000 : undefined });
  }

  /** Start a bulk verification job (1 credit per address). Poll it with `job()` or `waitForJob()`. */
  bulk(emails: string[], options: { name?: string; signal?: AbortSignal } = {}): Promise<BulkVerifyJob> {
    if (!Array.isArray(emails) || emails.length === 0) throw new InvalidRequestError("invalid_argument: emails must be a non-empty array", { status: 400, code: "invalid_argument" });
    return this.http.request<BulkVerifyJob>("POST", "/api/v1/verify/bulk", { body: { emails, ...(options.name ? { name: options.name } : {}) }, signal: options.signal });
  }

  /** Job status; `results: true` adds the per-address results. */
  job(id: string, options: { results?: boolean; signal?: AbortSignal } = {}): Promise<VerifyJob> {
    return this.http.request<VerifyJob>("GET", `/api/v1/verify/jobs/${encodeURIComponent(requireString(id, "id"))}`, { query: options.results ? { results: 1 } : undefined, signal: options.signal });
  }

  /** Poll a job until it is `done` or `failed`. */
  async waitForJob(
    id: string,
    options: { results?: boolean; pollIntervalMs?: number; timeoutMs?: number; signal?: AbortSignal; onProgress?: (job: VerifyJob) => void } = {},
  ): Promise<VerifyJob> {
    const deadline = Date.now() + (options.timeoutMs ?? 15 * 60_000);
    const interval = Math.max(500, options.pollIntervalMs ?? 3_000);
    for (;;) {
      const job = await this.job(id, { results: false, signal: options.signal });
      options.onProgress?.(job);
      if (job.status === "done" || job.status === "failed") return options.results ? this.job(id, { results: true, signal: options.signal }) : job;
      if (Date.now() + interval > deadline) throw new TimeoutError(`timeout: job ${id} did not finish in time`, { status: 0, code: "timeout" });
      await sleep(interval, options.signal);
    }
  }
}

export class FindResource {
  constructor(private readonly http: HttpClient) {}

  /** Find a person's e-mail address from their name and company domain (1 credit). */
  email(input: { domain: string; first?: string; last?: string; name?: string }, options: { signal?: AbortSignal } = {}): Promise<FindResult> {
    const domain = requireString(input?.domain, "domain");
    if (!input.first && !input.last && !input.name) throw new InvalidRequestError("invalid_argument: pass first/last or name", { status: 400, code: "invalid_argument" });
    return this.http.request<FindResult>("POST", "/api/v1/find", { body: { domain, first: input.first, last: input.last, name: input.name }, signal: options.signal });
  }
}

export class LeadsResource {
  constructor(private readonly http: HttpClient) {}

  /**
   * Contacts already in your Cold Leads CRM for a company domain (no credits). `role` is a keyword matched against
   * name, e-mail local part, tags, notes and type. Cold Leads has no third-party lead database.
   */
  search(input: { domain: string; role?: string; limit?: number }, options: { signal?: AbortSignal } = {}): Promise<LeadSearchResult> {
    return this.http.request<LeadSearchResult>("GET", "/api/v1/leads", { query: { domain: requireString(input?.domain, "domain"), role: input.role, limit: input.limit }, signal: options.signal });
  }
}

export class CreditsResource {
  constructor(private readonly http: HttpClient) {}

  /** Plan, monthly allowance, used and remaining credits. */
  get(options: { signal?: AbortSignal } = {}): Promise<Credits> {
    return this.http.request<Credits>("GET", "/api/v1/credits", { signal: options.signal });
  }
}

export class AgentResource {
  constructor(
    private readonly http: HttpClient,
    private readonly onKey: (key: string) => void,
  ) {}

  /**
   * No API key yet? Create a pending account for the human owner and get a Stripe payment link for the Business plan.
   * Show `checkout_url` to the human and let them decide; keep `claim_token` secret. Works without an API key.
   */
  provision(input: { ownerEmail: string; agentId: string; callbackUrl?: string }, options: { signal?: AbortSignal } = {}): Promise<Provisioning> {
    return this.http.request<Provisioning>("POST", "/api/agent/provision", {
      auth: false,
      retry: "never",
      body: { owner_email: requireString(input?.ownerEmail, "ownerEmail"), agent_id: requireString(input?.agentId, "agentId"), ...(input.callbackUrl ? { callback_url: input.callbackUrl } : {}) },
      signal: options.signal,
    });
  }

  /** Status by session id or by owner e-mail. Only a request with the claim token can collect the API key (once). */
  status(input: { sessionId?: string; ownerEmail?: string; claimToken?: string }, options: { signal?: AbortSignal } = {}): Promise<ProvisioningStatus> {
    if (!input?.sessionId && !input?.ownerEmail) throw new InvalidRequestError("invalid_argument: pass sessionId or ownerEmail", { status: 400, code: "invalid_argument" });
    return this.http.request<ProvisioningStatus>("GET", "/api/agent/status", {
      auth: false,
      query: input.sessionId ? { session_id: input.sessionId } : { owner_email: input.ownerEmail },
      headers: input.claimToken ? { "X-Claim-Token": input.claimToken } : undefined,
      signal: options.signal,
    });
  }

  /**
   * Poll until the owner has paid, then return the API key (delivered exactly once) and switch this client to it.
   * Throws when the link expires, the account is suspended, or the key was already collected elsewhere.
   */
  async waitForActivation(
    input: { sessionId: string; claimToken: string },
    options: { pollIntervalMs?: number; timeoutMs?: number; signal?: AbortSignal; onStatus?: (s: ProvisioningStatus) => void } = {},
  ): Promise<{ apiKey: string; status: ProvisioningStatus }> {
    const sessionId = requireString(input?.sessionId, "sessionId");
    const claimToken = requireString(input?.claimToken, "claimToken");
    const deadline = Date.now() + (options.timeoutMs ?? 24 * 3_600_000);
    const interval = Math.max(2_000, options.pollIntervalMs ?? 15_000);
    for (;;) {
      const s = await this.status({ sessionId, claimToken }, { signal: options.signal });
      options.onStatus?.(s);
      if (s.status === "active") {
        if (!s.api_key) throw new ColdLeadsError("key_already_delivered: the key was collected earlier; the owner can rotate it in Settings → API keys", { status: 409, code: "key_already_delivered" });
        this.onKey(s.api_key);
        return { apiKey: s.api_key, status: s };
      }
      if (s.status === "expired" || s.status === "suspended") throw new ColdLeadsError(`${s.status}: ${s.message ?? "the provisioning cannot be activated"}`, { status: 410, code: s.status });
      if (Date.now() + interval > deadline) throw new TimeoutError("timeout: the owner has not paid yet", { status: 0, code: "timeout" });
      await sleep(interval, options.signal);
    }
  }
}

/**
 * Check the `X-Coldleads-Signature` header of an onboarding callback. The key is the SHA-256 hex digest of your
 * claim token; the signature is HMAC-SHA256 over the raw request body.
 */
export function verifyCallbackSignature(rawBody: string, signatureHeader: string | null | undefined, claimToken: string): boolean {
  if (!signatureHeader || !signatureHeader.startsWith("sha256=") || !claimToken) return false;
  const key = createHash("sha256").update(claimToken).digest("hex");
  const expected = createHmac("sha256", key).update(rawBody).digest("hex");
  const given = signatureHeader.slice("sha256=".length);
  if (given.length !== expected.length || !/^[a-f0-9]+$/.test(given)) return false;
  return timingSafeEqual(Buffer.from(given, "hex"), Buffer.from(expected, "hex"));
}
