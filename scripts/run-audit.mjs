import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { runAudit } from "../lib/audit/runner.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const value = process.argv[index];
  if (value.startsWith("--")) args.set(value.slice(2), process.argv[index + 1]?.startsWith("--") ? true : process.argv[++index] ?? true);
}
const profile = String(args.get("profile") ?? "smoke");
const targetId = args.get("target");
if (typeof targetId !== "string" || !targetId.trim()) throw new Error("Provide --target with an explicitly authorised target ID.");
const config = JSON.parse(await readFile(path.join(root, "config", "audit-targets.json"), "utf8"));
const target = config.targets.find((candidate) => candidate.id === targetId);
if (!target) throw new Error(`Unknown target: ${targetId}`);
if (target.authorization?.status !== "approved" || !target.authorization?.owner?.trim()) throw new Error(`Target ${targetId} is not marked as approved for passive assessment.`);

const run = await runAudit(target, profile);
const folder = path.join(root, "artifacts", "audits");
await mkdir(folder, { recursive: true });
const stamp = run.startedAt.replace(/[:.]/g, "-");
const output = path.join(folder, `${target.id}-${profile}-${stamp}.json`);
await writeFile(output, `${JSON.stringify(run, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify({ output, runId: run.id, status: run.status, coverage: run.coverage, findings: run.findings.length }, null, 2)}\n`);
