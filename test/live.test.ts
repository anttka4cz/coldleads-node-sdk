// Live checks against a real Cold Leads server; skipped unless COLDLEADS_LIVE_KEY_FILE is set.
//   COLDLEADS_LIVE_KEY_FILE=path/to/key COLDLEADS_API_BASE=http://localhost:3000 npx vitest run test/live.test.ts
// Optional: COLDLEADS_LIVE_DOMAIN — a domain with contacts in the account.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ColdLeads, InvalidRequestError, NotFoundError } from "../src/index.js";

const keyFile = process.env.COLDLEADS_LIVE_KEY_FILE;
const domain = process.env.COLDLEADS_LIVE_DOMAIN || "acme-mcp.test";

describe.skipIf(!keyFile)("live API", () => {
  const client = new ColdLeads({ apiKey: keyFile ? readFileSync(keyFile, "utf8").trim() : "" });
  it("credits", async () => {
    const c = await client.credits.get();
    expect(c.limit).toBeGreaterThan(0);
    expect(c.left).toBeGreaterThanOrEqual(0);
  });
  it("verify.email answers within the budget", async () => {
    const t = Date.now();
    const r = await client.verify.email("nobody@no-mx-domain-coldleads.invalid", { budgetMs: 4000 });
    expect(Date.now() - t).toBeLessThan(9000);
    expect(r).toMatchObject({ status: "invalid", catch_all: false });
    expect(r.reasons).toContain("no_mx");
  });
  it("leads.search", async () => {
    const r = await client.leads.search({ domain, limit: 5 });
    expect(r.source).toBe("crm");
    expect(r.count).toBe(r.leads.length);
  });
  it("agent onboarding validation and unknown sessions", async () => {
    await expect(new ColdLeads({ apiKey: "" }).agent.provision({ ownerEmail: "not-an-email", agentId: "sdk-live-test" })).rejects.toBeInstanceOf(InvalidRequestError);
    await expect(client.agent.status({ sessionId: "cs_does_not_exist" })).rejects.toBeInstanceOf(NotFoundError);
  });
});
