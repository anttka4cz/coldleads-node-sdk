# Changelog

## 1.1.0 (2026-10-13)

- `new ColdLeads({ demo: true })`: `client.crm` against the no-key demo server `https://coldleads.app/api/mcp/demo` (sample data, never sends e-mail, no credits); the SDK opens and keeps the MCP session and starts a new one when it expires.
- `crm.tools()`: every tool with its JSON input schema, side effect, cost and `requiresApproval`, for agent frameworks.
- `crm.callTool(name, args)`: call any tool by its MCP name.
- `crm.verifyEmail(email)`: verification through the MCP tool (works in demo mode).

## 1.0.1 (2026-10-13)

- The `User-Agent` header now reports the real package version (`coldleads-node/1.0.1`); a test keeps `VERSION` in sync with `package.json`.
- First release published from GitHub Actions with npm trusted publishing (signed provenance, no stored npm token).

## 1.0.0 (2026-10-13)

- First npm release: verification (single and bulk), e-mail finder, CRM lead search, the `crm` resource (contacts, imports, conversations, templates, campaign drafts and launch, lead context, next actions, follow-ups, activity log, website capture) and agent onboarding.
