# Cold Leads Node.js SDK

Official Node.js client for the [Cold Leads](https://coldleads.app) API and CRM: e-mail verification, lead finding, contact import and management, conversations, templates, campaigns, website capture, and AI-agent onboarding.

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

### Contacts, conversations, templates and campaigns

`coldleads.crm` exposes the account-scoped tools from the hosted MCP API. Parse CSV/XLSX files in your application and pass rows (up to 100 per import call); imports deduplicate, skip global do-not-contact records, and never send email. Use `inquiry` for website forms and `b2b_outreach` only where you have a lawful basis.

```ts
const imported = await coldleads.crm.importContacts({
  contacts: [{ email: "person@example.com", name: "Ada", company: "Example", consent: "inquiry" }],
});
const contacts = await coldleads.crm.contacts({ query: "Example", limit: 20 });
await coldleads.crm.updateContact({ contactId: "contact_id", tags: "webinar", stage: "lead" });
const thread = await coldleads.crm.conversation("contact_id");

const template = await coldleads.crm.saveTemplate({ name: "Welcome", subject: "Hello", body: "Hi {name}" });
const draft = await coldleads.crm.createCampaignDraft({ name: "Welcome", templateId: template.template.id, consent: "inquiry" });
// Review the audience/template with the user before launching.
await coldleads.crm.launchCampaign(draft.campaign.id, { confirmLaunch: true });

const websiteForm = await coldleads.crm.setupWebsiteLeadCapture({ site: "https://example.com" });
```

`coldleads.crm.sendMessage({ contactId, message, confirmSend: true })` sends one message only after the user approves its recipient and final text. Campaign sending also requires explicit review and confirmation. Workspace rules, content checks, unsubscribe and DNC safeguards still apply. Website submissions are marked `inquiry` and are not automatic cold-outreach consent. `coldleads.crm.workspace()` returns non-secret account and mailbox status.

### Sales memory for agents: context, next actions, follow-ups

An agent that continues work across sessions can ask Cold Leads what to do next, read everything about one lead in one call, and record the next step. These calls are free and never send e-mail.

```js
const { actions } = await coldleads.crm.nextActions(20);
// [{ contact_id, action: "reply" | "close" | "follow_up", priority: "high" | "medium" | "low", reason, due_at }, …]

const ctx = await coldleads.crm.leadContext({ email: "jane@example.com" });
// ctx.contactability.safe_to_contact, ctx.relationship.last_reply_class, ctx.next_action, ctx.recent_messages

await coldleads.crm.scheduleFollowUp({ contactId: ctx.lead.id, inDays: 3, note: "send pricing" });
await coldleads.crm.scheduleFollowUp({ contactId: ctx.lead.id, clear: true }); // done

const log = await coldleads.crm.activity(20); // this workspace's API and MCP calls, no personal data
```

Reply classes are `positive`, `neutral`, `negative`, `unsubscribe` and `auto`; an unsubscribe reply opts the contact out automatically. REST equivalents: `GET /api/v1/leads/context`, `GET /api/v1/next-actions`, `POST /api/v1/follow-ups`, `GET /api/v1/activity`.

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
