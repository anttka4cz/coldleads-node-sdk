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
