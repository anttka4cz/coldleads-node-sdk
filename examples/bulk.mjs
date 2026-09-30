// node examples/bulk.mjs emails.txt   (one address per line; COLDLEADS_API_KEY in the environment)
import { readFileSync } from "node:fs";
import ColdLeads from "@coldleads/sdk";

const coldleads = new ColdLeads();
const emails = readFileSync(process.argv[2] ?? "emails.txt", "utf8").split(/\s+/).filter(Boolean);
const job = await coldleads.verify.bulk(emails, { name: "SDK example" });
const done = await coldleads.verify.waitForJob(job.id, { results: true, onProgress: (j) => process.stdout.write(`\r${j.done}/${j.total}`) });
console.log(`\n${JSON.stringify(done.counts)}`);
for (const r of done.results ?? []) console.log(`${r.status.padEnd(8)} ${r.score.toString().padStart(3)}  ${r.email}`);
