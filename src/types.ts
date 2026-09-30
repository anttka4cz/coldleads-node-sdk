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
  /** The domain accepts any address (accept-all); a mailbox cannot be confirmed individually. */
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
