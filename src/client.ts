import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { ColdLeadsError, InvalidRequestError, TimeoutError } from "./errors.js";
import { DEFAULT_BASE_URL, DEFAULT_MAX_RETRIES, DEFAULT_TIMEOUT_MS, HttpClient, type FetchLike } from "./http.js";
import type { BulkVerifyJob, Credits, FindResult, LeadSearchResult, Provisioning, ProvisioningStatus, VerifyJob, VerifyResult, McpResult, ContactImportInput, ContactUpdateInput, WebsiteLeadCaptureInput, CampaignDraftInput, TemplateInput, SendContactMessageInput, ContactsResult, ContactImportResult, ConversationResult, TemplatesResult, TemplateResult, CampaignsResult, CampaignResult, WorkspaceResult, WebsiteLeadCaptureResult, LeadRef, LeadContextResult, NextActionsResult, FollowUpInput, FollowUpResult, ActivityResult } from "./types.js";

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
    let t: ReturnType<typeof setTimeout>;
    const onAbort = () => {
      clearTimeout(t);
      signal?.removeEventListener("abort", onAbort);
      reject(signal?.reason);
    };
    t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
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
  readonly crm: CrmResource;

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
    this.crm = new CrmResource(this.http);
  }

  /** Replace the API key (for example with the key returned by agent onboarding). */
  setApiKey(apiKey: string): void {
    this.http.config.apiKey = apiKey.trim();
  }

  get hasApiKey(): boolean {
    return this.http.config.apiKey.length > 0;
  }
}

/** Account-scoped CRM, inbox, campaign, template and website-capture tools served by Cold Leads MCP. */
function leadArgs(ref: LeadRef): Record<string, string> {
  if (ref && typeof ref.contactId === "string" && ref.contactId.trim()) return { contact_id: ref.contactId.trim() };
  if (ref && typeof ref.email === "string" && ref.email.includes("@")) return { email: ref.email.trim() };
  throw new InvalidRequestError("invalid_argument: pass contactId or email", { status: 400, code: "invalid_argument" });
}

export class CrmResource {
  private sequence = 0;
  constructor(private readonly http: HttpClient) {}

  private async call<T extends object = Record<string, unknown>>(tool: string, args: Record<string, unknown> = {}, options: { signal?: AbortSignal } = {}): Promise<McpResult<T>> {
    const rpc = await this.http.request<{ result?: { content?: Array<{ type: string; text?: string }>; isError?: boolean }; error?: { message?: string } }>("POST", "/api/mcp", {
      body: { jsonrpc: "2.0", id: ++this.sequence, method: "tools/call", params: { name: tool, arguments: args } },
      retry: "never", signal: options.signal,
    });
    if (rpc.error) throw new ColdLeadsError(rpc.error.message ?? "mcp_error", { status: 0, code: "mcp_error" });
    const block = rpc.result?.content?.find((item) => item.type === "text" && item.text);
    let result: Record<string, unknown> = {};
    try { result = JSON.parse(block?.text ?? "{}"); } catch { throw new ColdLeadsError("invalid_mcp_response", { status: 0, code: "invalid_mcp_response" }); }
    if (rpc.result?.isError || result.status === "error") {
      const code = typeof result.error === "string" ? result.error : "mcp_tool_error";
      throw new ColdLeadsError(typeof result.message === "string" ? result.message : code, { status: 0, code, body: result });
    }
    return result as McpResult<T>;
  }

  /** List/filter contacts already in your own workspace. */
  contacts(input: { query?: string; stage?: string; tag?: string; limit?: number } = {}, options: { signal?: AbortSignal } = {}) {
    return this.call<ContactsResult>("list_contacts", input, options);
  }
  /** Import parsed CSV/XLSX rows; up to 100 contacts per call. File parsing stays in your application. */
  importContacts(input: ContactImportInput, options: { signal?: AbortSignal } = {}) {
    return this.call<ContactImportResult>("import_contacts", input as unknown as Record<string, unknown>, options);
  }
  /** Update contact fields or mark opted out. Opt-out cannot be reversed through this method. */
  updateContact(input: ContactUpdateInput, options: { signal?: AbortSignal } = {}) {
    const { contactId, optedOut, ...fields } = input;
    return this.call<{ contact: Record<string, unknown> }>("update_contact", { contact_id: requireString(contactId, "contactId"), ...fields, ...(optedOut ? { opted_out: true } : {}) }, options);
  }
  /** Read recent messages in a contact conversation. */
  conversation(contactId: string, limit = 50, options: { signal?: AbortSignal } = {}) {
    return this.call<ConversationResult>("get_conversation", { contact_id: requireString(contactId, "contactId"), limit }, options);
  }
  /** Send one email. Set confirm_send only after the user approved the final recipient and message. */
  sendMessage(input: SendContactMessageInput, options: { signal?: AbortSignal } = {}) {
    return this.call<{ contact_id: string; email: string; subject: string }>("send_contact_message", { contact_id: requireString(input.contactId, "contactId"), message: input.message, subject: input.subject, confirm_send: input.confirmSend }, options);
  }
  templates(limit = 50, options: { signal?: AbortSignal } = {}) {
    return this.call<TemplatesResult>("list_templates", { limit }, options);
  }
  saveTemplate(input: TemplateInput, options: { signal?: AbortSignal } = {}) {
    const { templateId, ...fields } = input;
    return this.call<TemplateResult>("save_template", { ...fields, ...(templateId ? { template_id: templateId } : {}) }, options);
  }
  campaigns(limit = 50, options: { signal?: AbortSignal } = {}) {
    return this.call<CampaignsResult>("list_campaigns", { limit }, options);
  }
  createCampaignDraft(input: CampaignDraftInput, options: { signal?: AbortSignal } = {}) {
    const { templateId, ...fields } = input;
    return this.call<CampaignResult>("create_campaign_draft", { ...fields, template_id: requireString(templateId, "templateId") }, options);
  }
  /** Launch only after the user reviewed and approved the campaign and recipient estimate. */
  launchCampaign(campaignId: string, options: { confirmLaunch: true; signal?: AbortSignal }) {
    return this.call<{ campaign_id: string; recipient_estimate: number; note: string }>("launch_campaign", { campaign_id: requireString(campaignId, "campaignId"), confirm_launch: options.confirmLaunch }, options);
  }
  workspace(options: { signal?: AbortSignal } = {}) {
    return this.call<WorkspaceResult>("get_workspace_info", {}, options);
  }
  /** Everything known about one lead in one call: identity, contactability, relationship, next action and the last messages. Read-only, free. */
  leadContext(ref: LeadRef, options: { signal?: AbortSignal } = {}) {
    return this.call<LeadContextResult>("get_lead_context", leadArgs(ref), options);
  }
  /** Replies waiting for an answer and follow-ups that are due — "what should I do next?". Read-only, free. */
  nextActions(limit = 25, options: { signal?: AbortSignal } = {}) {
    return this.call<NextActionsResult>("get_sales_next_actions", { limit }, options);
  }
  /** Set, move or clear a contact's next action (the follow-up date and note shown in the app). Never sends e-mail. */
  scheduleFollowUp(input: FollowUpInput, options: { signal?: AbortSignal } = {}) {
    const args: Record<string, unknown> = { ...leadArgs(input) };
    if ("clear" in input && input.clear) args.clear = true;
    else if ("inDays" in input && input.inDays !== undefined) args.in_days = input.inDays;
    else if ("dueAt" in input && input.dueAt !== undefined) args.due_at = input.dueAt instanceof Date ? input.dueAt.toISOString() : input.dueAt;
    if (input.note !== undefined) args.note = input.note;
    return this.call<FollowUpResult>("schedule_follow_up", args, options);
  }
  /** Audit log of this workspace's API and MCP calls, newest first (no arguments or personal data). Read-only, free. */
  activity(limit = 50, options: { signal?: AbortSignal } = {}) {
    return this.call<ActivityResult>("get_agent_activity", { limit }, options);
  }
  /** Create a public-only lead-form key. The key is returned once and should only be embedded in the site's form. */
  setupWebsiteLeadCapture(input: WebsiteLeadCaptureInput, options: { signal?: AbortSignal } = {}) {
    return this.call<WebsiteLeadCaptureResult>("setup_website_lead_capture", { site: input.site, ...(input.name ? { name: input.name } : {}) }, options);
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
