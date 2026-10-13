import { describe, expect, it } from "vitest";
import { ColdLeads, type FetchLike } from "../src/index.js";

// demo: true — crm calls go to /api/mcp/demo without a key, inside one MCP session.
const rpcResult = (result: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), { status: 200, headers: { "content-type": "application/json", ...headers } });
const toolText = (data: unknown) => ({ content: [{ type: "text", text: JSON.stringify(data) }] });

function setup(responder: FetchLike) {
  const calls: { url: string; init: RequestInit; body: { method: string; params: { name?: string } } }[] = [];
  const fetch: FetchLike = async (url, init) => (calls.push({ url, init, body: JSON.parse(String(init.body)) }), responder(url, init));
  return { client: new ColdLeads({ demo: true, apiKey: "", baseUrl: "https://coldleads.test", fetch }), calls };
}
const header = (init: RequestInit, name: string) => (init.headers as Record<string, string>)[name];

describe("demo mode", () => {
  it("initializes once, then sends every tool call with the session id and no API key", async () => {
    const h = setup(async (_u, init) => {
      const body = JSON.parse(String(init.body));
      return body.method === "initialize" ? rpcResult({ protocolVersion: "2025-06-18" }, { "mcp-session-id": "demo_s1" }) : rpcResult(toolText({ status: "success", added: 3 }));
    });
    expect(h.client.demo).toBe(true);
    await h.client.crm.importContacts({ contacts: [{ email: "a@example.org" }] });
    await h.client.crm.contacts({ tag: "q4" });
    expect(h.calls.map((c) => c.body.method)).toEqual(["initialize", "tools/call", "tools/call"]);
    expect(h.calls.every((c) => c.url === "https://coldleads.test/api/mcp/demo")).toBe(true);
    expect(h.calls.every((c) => header(c.init, "Authorization") === undefined)).toBe(true);
    expect(header(h.calls[1]!.init, "Mcp-Session-Id")).toBe("demo_s1");
  });

  it("starts a new session once when the demo session expired (404)", async () => {
    let n = 0;
    const h = setup(async (_u, init) => {
      const body = JSON.parse(String(init.body));
      if (body.method === "initialize") return rpcResult({}, { "mcp-session-id": `demo_s${++n}` });
      if (header(init, "Mcp-Session-Id") === "demo_s1") return new Response(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "Session not found or expired" } }), { status: 404 });
      return rpcResult(toolText({ status: "success", count: 0, contacts: [] }));
    });
    await expect(h.client.crm.contacts()).resolves.toMatchObject({ count: 0 });
    expect(h.calls.map((c) => c.body.method)).toEqual(["initialize", "tools/call", "initialize", "tools/call"]);
  });

  it("tools() returns schemas with side effects and approval flags; verifyEmail and callTool use MCP tools", async () => {
    const h = setup(async (_u, init) => {
      const body = JSON.parse(String(init.body));
      if (body.method === "initialize") return rpcResult({}, { "mcp-session-id": "demo_s1" });
      if (body.method === "tools/list") return rpcResult({ tools: [{ name: "launch_campaign", description: "Start sending", inputSchema: { type: "object" }, _meta: { "coldleads/side_effect": "external_side_effect", "coldleads/cost": "free", "coldleads/requires_approval": true } }, { name: "list_contacts", inputSchema: { type: "object" } }] });
      return rpcResult(toolText({ status: "success", email: "jana@ridgeline.example", validity: "valid", score: 75, reasons: ["smtp_unreachable"] }));
    });
    const tools = await h.client.crm.tools();
    expect(tools[0]).toMatchObject({ name: "launch_campaign", sideEffect: "external_side_effect", requiresApproval: true });
    expect(tools[1]).toMatchObject({ name: "list_contacts", sideEffect: "read", requiresApproval: false });
    await expect(h.client.crm.verifyEmail("jana@ridgeline.example")).resolves.toMatchObject({ validity: "valid" });
    await h.client.crm.callTool("get_sales_next_actions", { limit: 5 });
    expect(h.calls.at(-1)!.body.params).toMatchObject({ name: "get_sales_next_actions" });
  });
});
