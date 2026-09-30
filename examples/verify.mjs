// node examples/verify.mjs anna@acme.com   (COLDLEADS_API_KEY in the environment)
import ColdLeads, { ColdLeadsError } from "@coldleads/sdk";

const coldleads = new ColdLeads();
const email = process.argv[2] ?? "anna@acme.com";
try {
  const r = await coldleads.verify.email(email, { budgetMs: 5000 });
  console.log(`${r.email}: ${r.status} (score ${r.score})${r.catch_all ? ", catch-all domain" : ""} — ${r.reasons.join(", ")}`);
} catch (e) {
  if (e instanceof ColdLeadsError) console.error(`${e.name} ${e.status} ${e.code}${e.hint ? ` — ${e.hint}` : ""}`);
  else throw e;
  process.exitCode = 1;
}
