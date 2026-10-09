import { describe, expect, it } from "vitest";
import { ColdLeads, ColdLeadsError, type FetchLike } from "../src/index.js";

const KEY = `sk_${"b".repeat(48)}`;
const ok = (data: Record<string, unknown>) => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: JSON.stringify(data) }] } }), { status: 200, headers: { "content-type": "application/json" } });

function setup(responder: FetchLike) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch: FetchLike = async (url, init) => (calls.push({ url, init }), responder(url, init));
  return { client: new ColdLeads({ apiKey: KEY, baseUrl: "https://coldleads.test", fetch }), calls };
}

describe("SDK CRM/MCP resource", () => {
  it("imports contacts through the authenticated hosted MCP endpoint without retrying writes", async () => {
    const h = setup(async () => ok({ status: "success", added: 1 }));
    const result = await h.client.crm.importContacts({ contacts: [{ email: "a@example.com", consent: "inquiry" }] });
    expect(result).toMatchObject({ status: "success", added: 1 });
    expect(h.calls[0]!.url).toBe("https://coldleads.test/api/mcp");
    expect(h.calls[0]!.init.method).toBe("POST");
    expect((h.calls[0]!.init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);
    expect(JSON.parse(String(h.calls[0]!.init.body))).toMatchObject({ method: "tools/call", params: { name: "import_contacts", arguments: { contacts: [{ email: "a@example.com", consent: "inquiry" }] } } });
  });

  it("maps camelCase SDK fields to MCP fields and requires send approval", async () => {
    const h = setup(async () => ok({ status: "sent" }));
    await h.client.crm.sendMessage({ contactId: "c1", message: "Hello", confirmSend: true });
    expect(JSON.parse(String(h.calls[0]!.init.body)).params).toMatchObject({ name: "send_contact_message", arguments: { contact_id: "c1", message: "Hello", confirm_send: true } });
  });

  it("surfaces tool-level MCP errors as ColdLeadsError and never retries", async () => {
    let requests = 0;
    const h = setup(async () => { requests++; return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { isError: true, content: [{ type: "text", text: JSON.stringify({ status: "error", error: "do_not_contact", message: "This contact cannot be emailed" }) }] } }), { status: 200 }); });
    await expect(h.client.crm.sendMessage({ contactId: "c1", message: "Hi", confirmSend: true })).rejects.toBeInstanceOf(ColdLeadsError);
    await expect(h.client.crm.sendMessage({ contactId: "c1", message: "Hi", confirmSend: true })).rejects.toMatchObject({ code: "do_not_contact" });
    expect(requests).toBe(2);
  });
});

describe("SDK agent sales memory", () => {
  it("leadContext, nextActions, scheduleFollowUp and activity call the matching MCP tools", async () => {
    const h = setup(async () => ok({ status: "success" }));
    await h.client.crm.leadContext({ email: "jane@example.com" });
    await h.client.crm.nextActions(10);
    await h.client.crm.scheduleFollowUp({ contactId: "c1", inDays: 3, note: "send pricing" });
    await h.client.crm.scheduleFollowUp({ email: "jane@example.com", dueAt: new Date("2026-10-14T09:00:00Z") });
    await h.client.crm.scheduleFollowUp({ contactId: "c1", clear: true });
    await h.client.crm.activity(5);
    const params = h.calls.map((c) => JSON.parse(String(c.init.body)).params);
    expect(params).toEqual([
      { name: "get_lead_context", arguments: { email: "jane@example.com" } },
      { name: "get_sales_next_actions", arguments: { limit: 10 } },
      { name: "schedule_follow_up", arguments: { contact_id: "c1", in_days: 3, note: "send pricing" } },
      { name: "schedule_follow_up", arguments: { email: "jane@example.com", due_at: "2026-10-14T09:00:00.000Z" } },
      { name: "schedule_follow_up", arguments: { contact_id: "c1", clear: true } },
      { name: "get_agent_activity", arguments: { limit: 5 } },
    ]);
  });

  it("refuses a lead reference without contactId or email before any request", async () => {
    const h = setup(async () => ok({ status: "success" }));
    expect(() => h.client.crm.leadContext({} as never)).toThrow(/contactId or email/);
    expect(h.calls).toHaveLength(0);
  });
});
