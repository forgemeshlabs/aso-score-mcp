import type { CheckResult, CheckStatus, Pillar, PillarScore, ScanReport, SignalScore } from "./types.js";

/**
 * ASO maturity levels — Agent Readiness Index bands per
 * https://agentsignaloptimization.com/docs/ASO-SCORE.md
 */
export const ASO_LEVELS = [
  { id: "ASO-0", name: "Invisible", min: 0, max: 9, meaning: "Agents cannot reliably find or understand the service." },
  { id: "ASO-1", name: "Discoverable", min: 10, max: 29, meaning: "Basic crawl and discovery signals exist." },
  { id: "ASO-2", name: "Understandable", min: 30, max: 49, meaning: "Agents can understand the service identity and documentation." },
  { id: "ASO-3", name: "Invocable", min: 50, max: 69, meaning: "Agents can understand how to call the service." },
  { id: "ASO-4", name: "Trustable", min: 70, max: 89, meaning: "Agents can verify trust, reputation, and operational signals." },
  { id: "ASO-5", name: "Autonomous-Commerce-Ready", min: 90, max: 100, meaning: "Agents can discover, evaluate, invoke, pay, and return." },
] as const;

interface SignalDef {
  id: string;
  name: string;
  pillar: Pillar;
  maxPoints: number;
  /** check ids that can satisfy this signal (best status wins) */
  sources: string[];
  /** signal cannot be auto-verified by a crawler; needs manual/registry evidence */
  manual?: boolean;
}

/**
 * The ASO scoring rubric. Pillar maxima match ASO-SCORE.md exactly:
 * Discoverability 20, Identity 20, Trust 15, Commerce 15, Reputation 15, Memory 15.
 */
export const SIGNALS: SignalDef[] = [
  // Discoverability — 20
  { id: "ai-crawler-rules", name: "AI crawler rules in robots.txt", pillar: "Discoverability", maxPoints: 4, sources: ["ai-bot-rules", "robots-txt"] },
  { id: "sitemap", name: "Current sitemap.xml", pillar: "Discoverability", maxPoints: 4, sources: ["sitemap"] },
  { id: "llms-txt", name: "Published llms.txt", pillar: "Discoverability", maxPoints: 4, sources: ["llms-txt"] },
  { id: "well-known-agent-endpoint", name: "Well-known AI or agent endpoint", pillar: "Discoverability", maxPoints: 4, sources: ["well-known-ai", "a2a-agent-card", "mcp-server-card", "agent-json", "api-catalog", "agent-skills", "webmcp"] },
  { id: "directory-listings", name: "Directory listings / DNS discovery", pillar: "Discoverability", maxPoints: 4, sources: ["dns-aid", "link-headers"] },
  // Identity — 20
  { id: "json-ld", name: "JSON-LD schema", pillar: "Identity", maxPoints: 5, sources: ["json-ld"] },
  { id: "openapi", name: "Complete OpenAPI spec", pillar: "Identity", maxPoints: 5, sources: ["openapi"] },
  { id: "agent-json", name: "agent.json manifest", pillar: "Identity", maxPoints: 5, sources: ["agent-json", "a2a-agent-card"] },
  { id: "llm-docs", name: "LLM-readable documentation", pillar: "Identity", maxPoints: 5, sources: ["llm-docs", "markdown-negotiation"] },
  // Trust — 15
  { id: "https", name: "HTTPS enforced", pillar: "Trust", maxPoints: 4, sources: ["https-enforced"] },
  { id: "auth-docs", name: "Auth clearly documented", pillar: "Trust", maxPoints: 4, sources: ["auth-md", "oauth-as", "oauth-pr"] },
  { id: "governance", name: "Governance or provenance signals", pillar: "Trust", maxPoints: 4, sources: ["security-txt", "content-signals", "web-bot-auth", "agent-friendly-ux"] },
  { id: "status", name: "Operational status visibility", pillar: "Trust", maxPoints: 3, sources: ["status-endpoint"] },
  // Commerce — 15
  { id: "pricing", name: "Machine-readable pricing", pillar: "Commerce", maxPoints: 5, sources: ["pricing"] },
  { id: "payment-manifest", name: "x402 or payment manifest", pillar: "Commerce", maxPoints: 5, sources: ["x402", "mpp"] },
  { id: "purchase-path", name: "Agent-safe purchase path", pillar: "Commerce", maxPoints: 5, sources: ["ucp", "acp"] },
  // Reputation (emerging) — 15
  { id: "uptime-metrics", name: "Uptime and latency metrics", pillar: "Reputation", maxPoints: 4, sources: ["status-endpoint"] },
  { id: "success-rates", name: "Success or completion rates", pillar: "Reputation", maxPoints: 4, sources: [], manual: true },
  { id: "citations", name: "Citations or third-party mentions", pillar: "Reputation", maxPoints: 4, sources: [], manual: true },
  { id: "reviews", name: "Reviews or endorsements", pillar: "Reputation", maxPoints: 3, sources: [], manual: true },
  // Memory — 15
  { id: "persistent-identity", name: "Stable persistent identity", pillar: "Memory", maxPoints: 5, sources: ["identity-consistency"] },
  { id: "consistent-signals", name: "Consistent signals across files", pillar: "Memory", maxPoints: 5, sources: ["signal-consistency"] },
  { id: "versioning", name: "Versioning and return paths", pillar: "Memory", maxPoints: 5, sources: ["versioning"] },
];

const STATUS_CREDIT: Record<CheckStatus, number> = {
  pass: 1,
  partial: 0.5,
  fail: 0,
  manual: 0,
  error: 0,
};

function bestStatus(statuses: CheckStatus[]): CheckStatus {
  if (statuses.includes("pass")) return "pass";
  if (statuses.includes("partial")) return "partial";
  if (statuses.includes("fail")) return "fail";
  if (statuses.includes("error")) return "error";
  return "manual";
}

export function score(url: string, origin: string, checks: CheckResult[]): ScanReport {
  const byId = new Map(checks.map((c) => [c.id, c]));

  const signals: SignalScore[] = SIGNALS.map((sig) => {
    if (sig.manual) {
      return {
        id: sig.id, name: sig.name, pillar: sig.pillar, maxPoints: sig.maxPoints,
        points: 0, status: "manual", sources: [],
        note: "Not auto-verifiable by a crawler — earns points via manual ASO audit or registry evidence.",
      };
    }
    const hits = sig.sources.map((id) => byId.get(id)).filter((c): c is CheckResult => !!c);
    const st = hits.length ? bestStatus(hits.map((h) => h.status)) : "fail";
    const points = Math.round(sig.maxPoints * STATUS_CREDIT[st] * 2) / 2;
    const winner = hits.find((h) => h.status === st);
    return {
      id: sig.id, name: sig.name, pillar: sig.pillar, maxPoints: sig.maxPoints,
      points, status: st, sources: hits.map((h) => h.id),
      note: winner ? `${winner.name}: ${winner.evidence}` : "No contributing checks ran.",
    };
  });

  const pillarNames: Pillar[] = ["Discoverability", "Identity", "Trust", "Commerce", "Reputation", "Memory"];
  const pillars: PillarScore[] = pillarNames.map((p) => {
    const sigs = signals.filter((s) => s.pillar === p);
    return {
      pillar: p,
      points: sigs.reduce((a, s) => a + s.points, 0),
      maxPoints: sigs.reduce((a, s) => a + s.maxPoints, 0),
      signals: sigs,
    };
  });

  const asoScore = Math.round(pillars.reduce((a, p) => a + p.points, 0));
  const autoVerifiableMax = SIGNALS.filter((s) => !s.manual).reduce((a, s) => a + s.maxPoints, 0);
  const level = ASO_LEVELS.find((l) => asoScore >= l.min && asoScore <= l.max) ?? ASO_LEVELS[0];

  // Certification per ASO-SCORE.md: begins at ASO-3, needs a verified invocation path.
  const invocable = ["openapi", "mcp-server-card", "a2a-agent-card"].some((id) => byId.get(id)?.status === "pass");
  let tier: string | null = null;
  if (asoScore >= 90 && invocable) tier = "ASO Certified Autonomous-Commerce-Ready";
  else if (asoScore >= 70 && invocable) tier = "ASO Certified Trustable";
  else if (asoScore >= 50 && invocable) tier = "ASO Certified Invocable";

  const summary = { pass: 0, partial: 0, fail: 0, manual: 0, error: 0 };
  for (const c of checks) summary[c.status]++;

  const topRecommendations = checks
    .filter((c) => (c.status === "fail" || c.status === "partial") && c.recommendation)
    .map((c) => ({ c, impact: SIGNALS.filter((s) => s.sources.includes(c.id)).reduce((a, s) => a + (s.maxPoints - (signals.find((x) => x.id === s.id)?.points ?? 0)), 0) }))
    .sort((a, b) => b.impact - a.impact)
    .slice(0, 8)
    .map(({ c, impact }) => `[+${impact} pts] ${c.name}: ${c.recommendation}`);

  return {
    report: "Agent Readiness Report",
    url,
    scannedOrigin: origin,
    framework: "ASO (Agent Signal Optimization)",
    asoScore,
    asoMax: 100,
    agentReadiness: asoScore >= 50 && invocable ? "Ready" : "Not ready",
    autoVerifiableMax,
    level: { id: level.id, name: level.name, range: `${level.min}-${level.max}`, meaning: level.meaning },
    certification: {
      eligible: tier !== null,
      tier,
      note: tier
        ? `Score and verified invocation path meet the ${tier} threshold. Formal certification additionally requires registry entry with timestamped verification.`
        : "Certification begins at ASO-3 (score ≥ 50) with a verified OpenAPI, MCP, or A2A invocation path.",
    },
    pillars,
    checks,
    summary,
    topRecommendations,
  };
}
