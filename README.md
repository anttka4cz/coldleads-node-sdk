# Cold Leads Node.js SDK

Official Node.js client for the [Cold Leads](https://coldleads.app) API: e-mail verification, a pattern-based e-mail finder, search of contacts in your own Cold Leads CRM, and onboarding for AI agents with human-approved payment.

- Zero runtime dependencies, Node.js 20+ (built-in `fetch`); CI tests Node 20 and 22
- ESM and CommonJS, full TypeScript types
- Typed errors, timeouts, safe automatic retries
- Responses mirror the [REST API](https://coldleads.app/api/v1) ([OpenAPI](https://coldleads.app/api/v1/openapi.json))

```bash
npm install --allow-git=root github:anttka4cz/coldleads-node-sdk
```

The package is not on npm; this command installs and builds it from GitHub, and you import it as `@coldleads/sdk`. npm 12 blocks installs from git unless you allow them, which `--allow-git=root` does for this command; npm 10 accepts the flag too.

## Quick start

```ts
import ColdLeads from "@coldleads/sdk";

const coldleads = new ColdLeads({ apiKey: process.env.COLDLEADS_API_KEY });

const result = await coldleads.verify.email("anna@example.com");
// { email, status: "valid" | "risky" | "invalid", score, reasons, catch_all, disposable, role, mx, checked_at, cached }
```

CommonJS: `const { ColdLeads } = require("@coldleads/sdk");`

You need a **secret API key** (`sk_…`) from **Cold Leads → Settings → API keys**. The API is included in the **Business** plan (10,000 verification and API credits a month; extra packs available). No key yet? See [Agent onboarding](#agent-onboarding-no-key-yet).

## Usage

### Verify an address (1 credit)

```ts
const r = await coldleads.verify.email("anna@example.com", { budgetMs: 4000 });
if (r.status === "invalid") drop(r.email);        // bad syntax, no mail server or mailbox rejected
else if (r.reasons.includes("ok")) send(r.email); // mailbox confirmed over SMTP, not accept-all
else review(r);                                   // e.g. smtp_unreachable: domain accepts mail, mailbox not checked
```

Syntax, disposable domains, role accounts and MX records are always checked. The SMTP mailbox and accept-all check runs only when Cold Leads can open an SMTP connection to the recipient's mail server; otherwise `reasons` contains `smtp_unreachable` and `catch_all` stays `false` (not checked). `budgetMs` (1,000–30,000) caps the whole server-side check; when it runs out the result is `risky` with reason `timeout`, so interactive flows never hang.

### Bulk verification (1 credit per address)

```ts
const job = await coldleads.verify.bulk(["a@example.com", "b@example.com"], { name: "September list" });
const done = await coldleads.verify.waitForJob(job.id, {
  results: true,
  onProgress: (j) => console.log(`${j.done}/${j.total}`),
});
console.log(done.counts, done.results);
```

### Find an address by name and domain (1 credit)

```ts
const found = await coldleads.find.email({ first: "Anna", last: "Novak", domain: "example.com" });
// { email, confidence, method: "verified" | "pattern" | "none", catch_all, candidates }
```

The finder tries common address patterns (first.last, flast, …) on the domain. `method` is `verified` only when the SMTP check confirmed the mailbox; otherwise it is `pattern`, the most likely guess.

### Search contacts in your CRM (free)

```ts
const { leads } = await coldleads.leads.search({ domain: "example.com", role: "sales", limit: 10 });
const reachable = leads.filter((l) => !l.do_not_contact);
```

Leads come from your own Cold Leads workspace; Cold Leads has no third-party lead database.

### Credits

```ts
const { plan, limit, used, left } = await coldleads.credits.get();
```

## Agent onboarding (no key yet)

An AI agent can set Cold Leads up for its human owner. The human reviews the Business plan on a secure Stripe page and decides whether to pay. The API gives the agent no way to pay, and the agent is told never to open or pay the link.

```ts
import ColdLeads from "@coldleads/sdk";

const coldleads = new ColdLeads(); // no key needed for onboarding

const p = await coldleads.agent.provision({ ownerEmail: "owner@example.com", agentId: "Acme Research Agent" });
showToHuman(p.checkout_url); // and keep p.claim_token secret

const { apiKey } = await coldleads.agent.waitForActivation({ sessionId: p.session_id, claimToken: p.claim_token });
saveSecret("COLDLEADS_API_KEY", apiKey); // delivered exactly once; the client already uses it
await coldleads.verify.email("anna@example.com");
```

Prefer a webhook to polling? Pass `callbackUrl` (public https) to `provision()`. Cold Leads POSTs `{ "event": "coldleads.account.activated", "session_id": … }` with an `X-Coldleads-Signature` header; the payload contains no secrets, so collect the key with `agent.status({ sessionId, claimToken })` afterwards:

```ts
import { verifyCallbackSignature } from "@coldleads/sdk";

app.post("/hooks/coldleads", express.text({ type: "*/*" }), (req, res) => {
  if (!verifyCallbackSignature(req.body, req.get("x-coldleads-signature"), claimToken)) return res.sendStatus(401);
  res.sendStatus(204);
});
```

## Errors

Every error extends `ColdLeadsError` with `status`, `code`, `hint` and the response `body`.

| Class | HTTP | Typical `code` |
| --- | --- | --- |
| `AuthenticationError` | 401 | `missing_api_key`, `bad_api_key` |
| `InsufficientCreditsError` | 402 | `no_credits` |
| `PermissionError` | 403 | `api_not_in_plan`, `account_suspended` |
| `NotFoundError` | 404 | `not_found` |
| `InvalidRequestError` | 400, 409, 413 | `email_required`, `account_exists`, `too_many` |
| `RateLimitError` | 429 | `rate_limited` (with `retryAfterSeconds`), `too_many_jobs` |
| `ServerError` | 5xx | `http_502`, `gateway` |
| `ConnectionError` | — | `network_error` |
| `TimeoutError` | — | `timeout` |

```ts
import { RateLimitError, InsufficientCreditsError } from "@coldleads/sdk";

try {
  await coldleads.verify.email(address);
} catch (e) {
  if (e instanceof InsufficientCreditsError) notifyBilling();
  else if (e instanceof RateLimitError) await sleep((e.retryAfterSeconds ?? 60) * 1000);
  else throw e;
}
```

## Timeouts and retries

| Option | Default | |
| --- | --- | --- |
| `timeoutMs` | 30,000 | per request |
| `maxRetries` | 2 | exponential backoff with jitter |

Rate limits (429) are retried for every call — the limit is checked before a credit is spent — after the Retry-After time the API sends (at most 30 seconds per attempt). Server errors (502/503/504) and network failures are retried only for GET requests, because a POST that reached the server may already have spent a credit. Onboarding (`provision`) is never retried. Every method accepts an `AbortSignal`.

## Configuration

| Option | Environment variable | Default |
| --- | --- | --- |
| `apiKey` | `COLDLEADS_API_KEY` | — |
| `baseUrl` | `COLDLEADS_API_BASE` | `https://coldleads.app` |
| `fetch` | — | global `fetch` |

## Responsible use

- A verified address is not consent: you need a lawful basis to contact each person.
- Never e-mail leads with `do_not_contact: true`.
- Limits: 120 requests per minute per key.

## Related

- [Cold Leads MCP server](https://github.com/anttka4cz/mcp-server-coldleads) for AI agents (Claude, Cursor, VS Code)
- [API reference](https://coldleads.app/api/v1) · [OpenAPI](https://coldleads.app/api/v1/openapi.json) · [llms.txt](https://coldleads.app/llms.txt)

## Development

```bash
npm ci
npm test
npm run build
COLDLEADS_LIVE_KEY_FILE=path/to/key COLDLEADS_API_BASE=http://localhost:3000 npx vitest run test/live.test.ts
```

## License

[MIT](LICENSE) © 2026 Anton Tkachenko
