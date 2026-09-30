/** Body of an error answer from the Cold Leads API: `{ "error": "<code>", "hint"?: "…", …details }`. */
export type ErrorBody = { error?: string; hint?: string; [key: string]: unknown };

export type ErrorInit = { status: number; code: string; hint?: string; body?: ErrorBody; cause?: unknown };

/** Base class for every error thrown by the SDK. `status` is the HTTP status (0 for network problems). */
export class ColdLeadsError extends Error {
  readonly status: number;
  readonly code: string;
  readonly hint?: string;
  readonly body?: ErrorBody;

  constructor(message: string, init: ErrorInit) {
    super(message, init.cause !== undefined ? { cause: init.cause } : undefined);
    this.name = new.target.name;
    this.status = init.status;
    this.code = init.code;
    this.hint = init.hint;
    this.body = init.body;
  }
}

/** 401 — missing, malformed or revoked API key. */
export class AuthenticationError extends ColdLeadsError {}
/** 403 — the plan has no API access (Business plan required) or the account is suspended. */
export class PermissionError extends ColdLeadsError {}
/** 402 — no verification credits left this month. */
export class InsufficientCreditsError extends ColdLeadsError {}
/** 404 — the job, provisioning or resource does not exist for this account. */
export class NotFoundError extends ColdLeadsError {}
/** 400, 409, 413 — the request was rejected as invalid (see `code` and `hint`). */
export class InvalidRequestError extends ColdLeadsError {}
/** 429 — rate limited (120 requests per minute per key, or too many concurrent jobs). */
export class RateLimitError extends ColdLeadsError {
  readonly retryAfterSeconds?: number;
  constructor(message: string, init: ErrorInit & { retryAfterSeconds?: number }) {
    super(message, init);
    this.retryAfterSeconds = init.retryAfterSeconds;
  }
}
/** 5xx — Cold Leads or its payment provider failed; safe to retry idempotent requests. */
export class ServerError extends ColdLeadsError {}
/** The request could not reach Cold Leads (DNS, TLS, connection reset). */
export class ConnectionError extends ColdLeadsError {}
/** The request, a job or an onboarding wait took longer than the configured timeout. */
export class TimeoutError extends ColdLeadsError {}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const n = Number(value);
  if (Number.isFinite(n) && n >= 0) return n;
  const at = Date.parse(value);
  return Number.isFinite(at) ? Math.max(0, Math.round((at - Date.now()) / 1000)) : undefined;
}

export function errorFromResponse(status: number, body: ErrorBody, headers?: Headers): ColdLeadsError {
  const code = typeof body.error === "string" && body.error ? body.error : `http_${status}`;
  const hint = typeof body.hint === "string" ? body.hint : undefined;
  const message = hint ? `${code}: ${hint}` : code;
  const init = { status, code, hint, body };
  if (status === 401) return new AuthenticationError(message, init);
  if (status === 402) return new InsufficientCreditsError(message, init);
  if (status === 403) return new PermissionError(message, init);
  if (status === 404) return new NotFoundError(message, init);
  if (status === 429) return new RateLimitError(message, { ...init, retryAfterSeconds: parseRetryAfter(headers?.get("retry-after") ?? null) });
  if (status >= 500) return new ServerError(message, init);
  return new InvalidRequestError(message, init);
}
