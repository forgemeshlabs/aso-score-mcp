import { ScanContext } from "./http.js";
import { parseScanUrl, assertResolvableAndPublic } from "./safeurl.js";
import { runChecks, CHECK_DEFS } from "./checks.js";
import { score } from "./scoring.js";
import type { CloudflareCategory, ScanReport } from "./types.js";

export { CHECK_DEFS };

/** Validate + DNS-resolve + reject private targets before any scan begins. */
async function safeContext(inputUrl: string): Promise<ScanContext> {
  const u = parseScanUrl(inputUrl);
  await assertResolvableAndPublic(u); // throws UnsafeUrlError on private/reserved
  return new ScanContext(u);
}

export async function scan(inputUrl: string, categories?: CloudflareCategory[]): Promise<ScanReport> {
  const ctx = await safeContext(inputUrl);
  const only = categories?.length
    ? CHECK_DEFS.filter((d) => categories.includes(d.category)).map((d) => d.id)
    : undefined;
  const checks = await runChecks(ctx, only);
  return score(ctx.origin, ctx.origin, checks);
}

export async function scanSingle(inputUrl: string, checkId: string) {
  const ctx = await safeContext(inputUrl);
  const ids = checkId === "identity-consistency" || checkId === "signal-consistency" || checkId === "versioning"
    ? undefined // dependent checks need the full run
    : [checkId];
  const checks = await runChecks(ctx, ids);
  const hit = checks.find((c) => c.id === checkId);
  if (!hit) throw new Error(`Unknown check id: ${checkId}. Use list_checks to see valid ids.`);
  return hit;
}
