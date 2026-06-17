/**
 * Smoke test: scans agentsignaloptimization.com and prints a compact summary.
 * Run: npm run build && npm run smoke [url]
 */
import { scan } from "./scanner.js";

const target = process.argv[2] ?? "https://agentsignaloptimization.com";
const report = await scan(target);

console.log(`\n=== Agent Readiness Report: ${report.scannedOrigin} ===`);
console.log(`ASO Score: ${report.asoScore}/100 (auto-verifiable max ${report.autoVerifiableMax})`);
console.log(`Agent Readiness: ${report.agentReadiness}`);
console.log(`Level: ${report.level.id} ${report.level.name} — ${report.level.meaning}`);
console.log(`Certification: ${report.certification.tier ?? "not yet eligible"}`);
console.log(`\nPillars:`);
for (const p of report.pillars) console.log(`  ${p.pillar.padEnd(16)} ${p.points}/${p.maxPoints}`);
console.log(`\nChecks: ${report.summary.pass} pass, ${report.summary.partial} partial, ${report.summary.fail} fail, ${report.summary.manual} manual, ${report.summary.error} error`);
for (const c of report.checks) {
  const icon = { pass: "✓", partial: "~", fail: "✗", manual: "◌", error: "!" }[c.status];
  console.log(`  ${icon} [${c.status.padEnd(7)}] ${c.id.padEnd(22)} ${c.evidence.slice(0, 90)}`);
}
console.log(`\nTop recommendations:`);
for (const r of report.topRecommendations.slice(0, 5)) console.log(`  - ${r.slice(0, 140)}`);
