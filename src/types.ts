// Response types mirror the Cold Leads REST API (https://coldleads.app/api/v1) field for field (snake_case).

export type Validity = "valid" | "risky" | "invalid";

/** Why an address got its verdict. `timeout` means the time budget ran out before the mailbox check finished. */
export type VerifyReason = "ok" | "syntax" | "disposable" | "role" | "no_mx" | "mailbox_missing" | "catch_all" | "smtp_unknown" | "smtp_unreachable" | "timeout" | (string & {});

export interface VerifyResult {
  email: string;
  status: Validity;
  /** 0–100 confidence that a message will be delivered. */
  score: number;
  reasons: VerifyReason[];
  mx: string | null;
  /** `true`: the mail server accepted a made-up address on this domain (accept-all). `false` also when the check did not run — see `reasons` (`smtp_unreachable`, `smtp_unknown`, `timeout`). */
  catch_all: boolean;
  disposable: boolean;
  /** Role account such as info@ or sales@. */
  role: boolean;
  checked_at: string;
  /** Served from the 30-day verification cache. */
  cached: boolean;
}

export interface BulkVerifyJob {
  id: string;
  status: "queued";
  total: number;
  /** Path to poll, e.g. /api/v1/verify/jobs/{id}. */
  poll: string;
}

export interface VerifyJobResult {
  email: string;
  status: Validity;
  score: number;
  reason: string;
}

export interface VerifyJob {
  id: string;
  name: string;
  status: "queued" | "running" | "done" | "failed";
  total: number;
  done: number;
  counts: { valid: number; risky: number; invalid: number };
  created_at: string;
  finished_at: string | null;
  /** Present when requested with `results: true`. */
  results?: VerifyJobResult[];
}

export interface FindResult {
  /** Best guess, or null when nothing plausible was found. */
  email: string | null;
  /** 0–100. */
  confidence: number;
  method: "verified" | "pattern" | "none";
  catch_all: boolean;
  candidates: { email: string; pattern: string; status?: Validity }[];
}

export interface Lead {
  email: string;
  name?: string;
  company?: string;
  phone?: string;
  stage: string;
  tags?: string[];
  verification?: { status: string; score: number | null };
  last_reply_intent?: string;
  next_action_at?: string;
  /** Opted out, bounced or on the do-not-contact list — never e-mail these. */
  do_not_contact: boolean;
}

export interface LeadSearchResult {
  domain: string;
  count: number;
  /** Always "crm": leads come from your own Cold Leads workspace. */
  source: "crm";
  leads: Lead[];
}

export interface Credits {
  plan: string | null;
  /** Monthly allowance of the plan. */
  limit: number;
  used: number;
  /** Remaining this month including purchased packs. */
  left: number;
}

/** Common success envelope returned by hosted Cold Leads MCP tools through this SDK. */
export type McpResult<T = Record<string, unknown>> = {
  status: string;
} & T;

export interface CrmContact {
  id: string; email: string; name: string; company: string; phone?: string; stage: string;
  consent?: string; optedOut?: boolean; bounced?: boolean; do_not_contact?: boolean; tags?: string; notes?: string;
}
export interface ContactsResult { count: number; contacts: CrmContact[] }
export interface ContactImportResult { added: number; skipped: number; imported: string[]; errors: { index: number; reason: string }[] }
export interface ConversationResult { contact: Pick<CrmContact, "id" | "email" | "name"> & { optedOut: boolean }; messages: { direction: "in" | "out"; from: string; to: string; subject: string; text: string; at: string; intent?: string | null }[] }
export interface TemplateResult { template: { id: string; name: string; subject: string; body: string; locale: string } }
export interface TemplatesResult { count: number; templates: TemplateResult["template"][] }
export interface CampaignResult { campaign: { id: string; name: string; status: string; templateId: string }; recipient_estimate: number; note: string }
export interface CampaignsResult { count: number; campaigns: { id: string; name: string; templateId: string; status: string; recipients: number; createdAt: string }[] }
export interface WorkspaceResult { workspace: Record<string, unknown> | null; account: Record<string, unknown> | null; counts: { contacts: number; templates: number; campaigns: number } }
export interface WebsiteLeadCaptureResult { key: string; allowed_origin: string; endpoint: string; html: string; javascript: string; consent: "inquiry"; note: string }

export interface ContactImportInput {
  contacts: Array<{ email: string; name?: string; company?: string; phone?: string; tags?: string; notes?: string; consent?: "inquiry" | "b2b_outreach" }>;
}
export interface ContactUpdateInput {
  contactId: string; name?: string; company?: string; phone?: string; stage?: string; tags?: string; notes?: string; optedOut?: true;
}
export interface SendContactMessageInput { contactId: string; message: string; subject?: string; confirmSend: true }
export interface TemplateInput { templateId?: string; name: string; subject: string; body: string; locale?: string }
export interface CampaignDraftInput { name: string; templateId: string; stage?: string; tag?: string; consent?: "inquiry" | "b2b_outreach" }
export interface WebsiteLeadCaptureInput { site: string; name?: string }

export interface Provisioning {
  status: "payment_required";
  /** Stripe Checkout link for the human owner. Show it; never pay it yourself. */
  checkout_url: string;
  session_id: string;
  provision_id: string;
  /** Secret that collects the API key after payment. Shown only once — keep it private. */
  claim_token: string;
  expires_at: string;
  plan: { id: string; name: string; price: string; amount: number; currency: string; interval: "month"; api: boolean };
  status_url: string;
  instructions_for_agent: string;
}

export interface ProvisioningStatus {
  status: "pending_payment" | "active" | "expired" | "suspended";
  session_id?: string | null;
  plan?: string;
  expires_at?: string;
  checkout_url?: string | null;
  activated_at?: string;
  /** Only in the first `active` answer requested with the claim token. */
  api_key?: string;
  api_key_prefix?: string;
  key_delivered_at?: string | null;
  mcp_url?: string;
  api_base?: string;
  message?: string;
}
