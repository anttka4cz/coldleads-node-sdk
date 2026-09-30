import { ColdLeadsError, ConnectionError, errorFromResponse, AuthenticationError, TimeoutError, type ErrorBody } from "./errors.js";

export const VERSION = "1.0.0";
export const DEFAULT_BASE_URL = "https://coldleads.app";
export const DEFAULT_TIMEOUT_MS = 30_000;
export const DEFAULT_MAX_RETRIES = 2;

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface RequestOptions {
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  headers?: Record<string, string>;
  /** Send the API key (default true). Agent onboarding calls go out without it. */
  auth?: boolean;
  timeoutMs?: number;
  signal?: AbortSignal;
  /**
   * Retry policy. "safe" (default): 429 for every request, plus 502/503/504 and connection errors for GET only —
   * a POST that reached the server may already have spent a credit. "never": no retries.
   */
  retry?: "safe" | "never";
}

export interface HttpConfig {
  apiKey: string;
  baseUrl: string;
  timeoutMs: number;
  maxRetries: number;
  fetch: FetchLike;
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => (clearTimeout(t), reject(signal.reason)), { once: true });
  });

// AbortSignal.any is Node 20.3+; combine by hand to keep Node 18 support.
function withTimeout(timeoutMs: number, outer?: AbortSignal): { signal: AbortSignal; timedOut: () => boolean; done: () => void } {
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort(new DOMException("timeout", "TimeoutError"));
  }, timeoutMs);
  const onAbort = () => ctrl.abort(outer?.reason);
  if (outer) {
    if (outer.aborted) ctrl.abort(outer.reason);
    else outer.addEventListener("abort", onAbort, { once: true });
  }
  return { signal: ctrl.signal, timedOut: () => timedOut, done: () => (clearTimeout(timer), outer?.removeEventListener("abort", onAbort)) };
}

export class HttpClient {
  constructor(public config: HttpConfig) {}

  async request<T>(method: "GET" | "POST", path: string, opts: RequestOptions = {}): Promise<T> {
    const auth = opts.auth !== false;
    if (auth && !this.config.apiKey) {
      throw new AuthenticationError("missing_api_key: pass apiKey or set COLDLEADS_API_KEY (a secret key sk_… from Cold Leads → Settings → API keys, Business plan)", { status: 401, code: "missing_api_key" });
    }
    const url = new URL(path, this.config.baseUrl.replace(/\/+$/, "") + "/");
    for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));
    const headers: Record<string, string> = { Accept: "application/json", "User-Agent": `coldleads-node/${VERSION}`, ...opts.headers };
    if (auth) headers.Authorization = `Bearer ${this.config.apiKey}`;
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";
    const retryPolicy = opts.retry ?? "safe";
    const maxRetries = retryPolicy === "never" ? 0 : this.config.maxRetries;

    for (let attempt = 0; ; attempt++) {
      const t = withTimeout(opts.timeoutMs ?? this.config.timeoutMs, opts.signal);
      let res: Response;
      try {
        res = await this.config.fetch(url.toString(), { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body), signal: t.signal, redirect: "error" });
      } catch (e) {
        t.done();
        if (opts.signal?.aborted) throw opts.signal.reason ?? e;
        if (t.timedOut()) throw new TimeoutError(`timeout: no answer from Cold Leads within ${opts.timeoutMs ?? this.config.timeoutMs} ms`, { status: 0, code: "timeout", cause: e });
        if (method === "GET" && attempt < maxRetries) {
          await sleep(this.backoff(attempt), opts.signal);
          continue;
        }
        throw new ConnectionError(`network_error: ${e instanceof Error ? e.message : String(e)}`, { status: 0, code: "network_error", cause: e });
      }
      t.done();
      let data: unknown = undefined;
      const text = await res.text();
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          data = undefined;
        }
      }
      if (res.ok) return data as T;
      const err = errorFromResponse(res.status, (data && typeof data === "object" ? data : {}) as ErrorBody, res.headers);
      const retryable = res.status === 429 || (method === "GET" && [502, 503, 504].includes(res.status));
      if (retryable && attempt < maxRetries) {
        const retryAfter = res.status === 429 ? (err as { retryAfterSeconds?: number }).retryAfterSeconds : undefined;
        await sleep(retryAfter !== undefined ? Math.min(retryAfter * 1000, 30_000) : this.backoff(attempt), opts.signal);
        continue;
      }
      throw err;
    }
  }

  private backoff(attempt: number): number {
    return Math.min(8_000, 500 * 2 ** attempt) + Math.floor(Math.random() * 250);
  }
}

export function isColdLeadsError(e: unknown): e is ColdLeadsError {
  return e instanceof ColdLeadsError;
}
