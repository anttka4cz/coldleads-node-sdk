// node examples/agent-onboarding.mjs owner@example.com
// An agent without a key asks its human owner to approve Cold Leads and then receives the API key once.
import ColdLeads from "@coldleads/sdk";

const coldleads = new ColdLeads({ apiKey: "" });
const p = await coldleads.agent.provision({ ownerEmail: process.argv[2] ?? "owner@example.com", agentId: "SDK example agent" });
console.log(`Ask the owner to review and pay: ${p.checkout_url}`);
console.log(`Plan: ${p.plan.name}, ${p.plan.price} per month. Link valid until ${p.expires_at}.`);
const { apiKey } = await coldleads.agent.waitForActivation(
  { sessionId: p.session_id, claimToken: p.claim_token },
  { onStatus: (s) => console.log(`status: ${s.status}`) },
);
console.log(`Active. Store this key securely as COLDLEADS_API_KEY (shown once): ${apiKey.slice(0, 6)}…`);
