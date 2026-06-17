import { resolveTxt } from "node:dns/promises";
import { ScanContext, looksHtml, tryJson, sanitizeArtifact, type HttpResult } from "./http.js";
import type { CheckDef, CheckResult, CloudflareCategory } from "./types.js";

/** AI crawler user-agents that Cloudflare-style scanners look for in robots.txt */
const AI_BOTS = [
  "gptbot",
  "oai-searchbot",
  "chatgpt-user",
  "claudebot",
  "claude-user",
  "claude-searchbot",
  "claude-web",
  "anthropic-ai",
  "google-extended",
  "google-cloudvertexbot",
  "perplexitybot",
  "perplexity-user",
  "ccbot",
  "bytespider",
  "amazonbot",
  "applebot-extended",
  "meta-externalagent",
  "meta-externalfetcher",
  "cohere-ai",
  "ai2bot",
  "duckassistbot",
  "mistralai-user",
];

type Checker = (ctx: ScanContext) => Promise<CheckResult>;

/** Human-readable description of a non-matching response for evidence strings. */
function describe(r: HttpResult): string {
  if (r.error) return `request failed (${r.error})`;
  if (r.status !== 200) return `HTTP ${r.status}`;
  if (looksHtml(r)) return "200 but returned an HTML page (likely SPA/404 fallback), not the expected machine-readable file";
  return "200 but body is not the expected format";
}

function result(
  def: CheckDef,
  status: CheckResult["status"],
  evidence: string,
  recommendation?: string,
  data?: unknown
): CheckResult {
  return { id: def.id, name: def.name, category: def.category, specUrl: def.specUrl, status, evidence, recommendation, data };
}

function def(
  id: string,
  name: string,
  category: CloudflareCategory,
  description: string,
  specUrl?: string
): CheckDef {
  return { id, name, category, description, specUrl };
}

// ---------------------------------------------------------------------------
// Check definitions (the public catalog)
// ---------------------------------------------------------------------------

export const CHECK_DEFS: CheckDef[] = [
  // Discoverability
  def("robots-txt", "robots.txt", "Discoverability", "robots.txt exists and is parseable"),
  def("sitemap", "Sitemap", "Discoverability", "sitemap.xml exists (direct or via robots.txt Sitemap: directive)"),
  def("link-headers", "Link headers", "Discoverability", "Homepage exposes Link response headers for agent discovery"),
  def("dns-aid", "DNS for AI Discovery (DNS-AID)", "Discoverability", "TXT records at _agent.<domain> / _index._agents.<domain>", "https://datatracker.ietf.org/doc/draft-mozleywilliams-dnsop-dnsaid/"),
  def("well-known-ai", "Well-known AI manifest (/.well-known/ai)", "Discoverability", "ASO well-known AI/agent endpoint", "https://agentsignaloptimization.com"),
  // Content Accessibility
  def("markdown-negotiation", "Markdown negotiation", "Content Accessibility", "Homepage serves text/markdown when requested via Accept header", "https://developers.cloudflare.com/fundamentals/reference/markdown-for-agents/"),
  def("llms-txt", "llms.txt", "Content Accessibility", "/llms.txt published for LLM-readable site overview", "https://llmstxt.org"),
  def("llm-docs", "LLM-readable documentation", "Content Accessibility", "Markdown source available (/index.md, /llms-full.txt or markdown docs)"),
  // Bot Access Control
  def("ai-bot-rules", "AI bot rules", "Bot Access Control", "robots.txt declares explicit rules for AI crawlers (GPTBot, ClaudeBot, etc.)"),
  def("content-signals", "Content Signals", "Bot Access Control", "Content-Signal directives in robots.txt (ai-train, search, ai-input)", "https://contentsignals.org"),
  def("web-bot-auth", "Web Bot Auth", "Bot Access Control", "HTTP Message Signatures directory for verified bot authentication", "https://blog.cloudflare.com/web-bot-auth/"),
  // API / Auth / MCP
  def("api-catalog", "API Catalog", "API / Auth / MCP", "/.well-known/api-catalog (RFC 9727) linkset for API discovery", "https://www.rfc-editor.org/rfc/rfc9727"),
  def("oauth-as", "OAuth discovery", "API / Auth / MCP", "/.well-known/oauth-authorization-server (RFC 8414)", "https://www.rfc-editor.org/rfc/rfc8414"),
  def("oauth-pr", "OAuth Protected Resource", "API / Auth / MCP", "/.well-known/oauth-protected-resource (RFC 9728)", "https://datatracker.ietf.org/doc/html/rfc9728"),
  def("auth-md", "Auth.md", "API / Auth / MCP", "Human/agent-readable auth instructions at /auth.md or /.well-known/auth.md"),
  def("mcp-server-card", "MCP Server Card", "API / Auth / MCP", "/.well-known/mcp/server-card.json (SEP-1649/SEP-2127) or /.well-known/mcp manifest", "https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2127"),
  def("a2a-agent-card", "A2A Agent Card (Google A2A)", "API / Auth / MCP", "/.well-known/agent-card.json per the Agent2Agent protocol, with required fields validated", "https://a2a-protocol.org/latest/specification/"),
  def("agent-skills", "Agent Skills", "API / Auth / MCP", "Agent Skills discovery at /.well-known/skills", "https://agentskills.io"),
  def("webmcp", "WebMCP", "API / Auth / MCP", "WebMCP manifest or in-page declaration", "https://webmcp.org"),
  // Commerce
  def("x402", "x402", "Commerce", "x402 payment manifest / HTTP 402 machine payments", "https://www.x402.org"),
  def("mpp", "MPP (Machine Payments Protocol)", "Commerce", "MPP discovery manifest", "https://mpp.dev"),
  def("ucp", "UCP (Universal Commerce Protocol)", "Commerce", "/.well-known/ucp capability manifest", "https://ucp.dev"),
  def("acp", "ACP (Agentic Commerce Protocol)", "Commerce", "ACP discovery / agentic checkout signals", "https://agenticcommerce.dev"),
  def("pricing", "Machine-readable pricing", "Commerce", "Pricing exposed in machine-readable form"),
  // Identity & Trust (ASO pillars beyond the Cloudflare checks)
  def("https-enforced", "HTTPS enforced", "Identity & Trust (ASO)", "HTTP requests redirect to HTTPS"),
  def("json-ld", "JSON-LD / schema.org", "Identity & Trust (ASO)", "Structured data on the homepage"),
  def("openapi", "OpenAPI spec", "Identity & Trust (ASO)", "Complete OpenAPI spec at a discoverable path"),
  def("agent-json", "agent.json manifest", "Identity & Trust (ASO)", "/agent.json or /.well-known/agent.json identity manifest"),
  def("security-txt", "security.txt", "Identity & Trust (ASO)", "/.well-known/security.txt governance/provenance signal", "https://www.rfc-editor.org/rfc/rfc9116"),
  def("status-endpoint", "Operational status", "Identity & Trust (ASO)", "Status visibility (/.well-known/status, /status, status page link)"),
  def("versioning", "Versioning & return paths", "Identity & Trust (ASO)", "Version fields in manifests, changelog, or versioned docs"),
  def("identity-consistency", "Identity consistency", "Identity & Trust (ASO)", "Service name/identity consistent across published manifests"),
  def("signal-consistency", "Signal consistency", "Identity & Trust (ASO)", "Core signals present and not contradictory (e.g. robots.txt vs llms.txt)"),
  def("agent-friendly-ux", "Agent-friendly UX", "Identity & Trust (ASO)", "Homepage exposes semantic, stable interaction signals for browser agents", "https://web.dev/articles/ai-agent-site-ux"),
];

const D = Object.fromEntries(CHECK_DEFS.map((d) => [d.id, d])) as Record<string, CheckDef>;

// ---------------------------------------------------------------------------
// Individual checks
// ---------------------------------------------------------------------------

const robotsTxt: Checker = async (ctx) => {
  const r = await ctx.robots();
  if (r.status === 200 && !looksHtml(r) && /user-agent\s*:/i.test(r.body)) {
    return result(D["robots-txt"], "pass", `200 OK, ${r.body.length} bytes, has User-agent groups`);
  }
  if (r.status === 200) {
    return result(D["robots-txt"], "partial", "robots.txt returns 200 but has no User-agent groups (or is HTML)", "Publish a valid robots.txt with User-agent groups and a Sitemap directive.");
  }
  return result(D["robots-txt"], "fail", `/robots.txt: ${describe(r)}`, "Publish /robots.txt. It is the first file most agents read.");
};

const aiBotRules: Checker = async (ctx) => {
  const r = await ctx.robots();
  if (r.status !== 200 || looksHtml(r)) {
    return result(D["ai-bot-rules"], "fail", "No robots.txt to declare AI bot rules in", "Publish robots.txt with explicit User-agent groups for AI crawlers (GPTBot, ClaudeBot, Google-Extended, PerplexityBot, CCBot...).");
  }
  const body = r.body.toLowerCase();
  const found = AI_BOTS.filter((b) => body.includes(b));
  if (found.length >= 3) return result(D["ai-bot-rules"], "pass", `Explicit rules for ${found.length} AI crawlers: ${found.slice(0, 8).join(", ")}`);
  if (found.length >= 1) return result(D["ai-bot-rules"], "partial", `Rules for only ${found.length} AI crawler(s): ${found.join(", ")}`, "Add explicit groups for the major AI crawlers so your crawl policy is unambiguous.");
  return result(D["ai-bot-rules"], "fail", "robots.txt exists but names no AI crawlers", "Add explicit User-agent groups for AI crawlers. Wildcard-only rules leave your AI policy ambiguous.");
};

const sitemap: Checker = async (ctx) => {
  const r = await ctx.robots();
  const m = r.body.match(/^sitemap\s*:\s*(\S+)/im);
  const target = m ? m[1] : ctx.origin + "/sitemap.xml";
  const s = await ctx.get(target);
  const isXml = /<(urlset|sitemapindex)[\s>]/i.test(s.body);
  if (s.status === 200 && isXml) {
    return result(D["sitemap"], "pass", `${m ? "Declared in robots.txt: " : "Found at default path: "}${target}`);
  }
  if (m) return result(D["sitemap"], "partial", `robots.txt declares ${target} but it returned ${s.status || s.error}`, "Fix the sitemap URL declared in robots.txt.");
  return result(D["sitemap"], "fail", `No Sitemap directive in robots.txt and /sitemap.xml → ${s.status || s.error}`, "Publish sitemap.xml and declare it in robots.txt.");
};

const linkHeaders: Checker = async (ctx) => {
  const r = await ctx.home();
  const link = r.headers["link"];
  if (!link) return result(D["link-headers"], "fail", "No Link response header on homepage", 'Expose discovery Link headers, e.g. Link: </llms.txt>; rel="llms-txt", or rel="alternate"; type="text/markdown".');
  const agentRel = /llms|markdown|api-catalog|agent|mcp|describedby/i.test(link);
  if (agentRel) return result(D["link-headers"], "pass", `Agent-relevant Link header: ${link.slice(0, 200)}`);
  return result(D["link-headers"], "partial", `Link header present but no agent-discovery relations: ${link.slice(0, 150)}`, "Add agent-discovery relations (llms.txt, markdown alternate, api-catalog) to your Link headers.");
};

const dnsAid: Checker = async (ctx) => {
  const names = [`_agent.${ctx.host}`, `_index._agents.${ctx.host}`, `_agents.${ctx.host}`];
  for (const name of names) {
    try {
      const txt = await resolveTxt(name);
      if (txt.length) {
        return result(D["dns-aid"], "pass", `TXT ${name}: ${txt.map((c) => c.join("")).join(" | ").slice(0, 200)}`);
      }
    } catch {
      // NXDOMAIN / no data — try next label
    }
  }
  return result(D["dns-aid"], "fail", `No TXT records at ${names.join(", ")}`, "Publish DNS-AID records (TXT/SVCB at _agent.<domain>) so agents can discover you via DNS. Emerging IETF draft — optional but differentiating.");
};

const wellKnownAi: Checker = async (ctx) => {
  const hit = await ctx.firstHit(["/.well-known/ai", "/.well-known/ai.json"]);
  if (hit) {
    const json = tryJson(hit.res.body);
    if (json) return result(D["well-known-ai"], "pass", `${hit.path} serves JSON manifest`, undefined, json);
    return result(D["well-known-ai"], "partial", `${hit.path} exists but is not valid JSON`, "Serve a valid JSON manifest describing name, capabilities, and signal locations.");
  }
  return result(D["well-known-ai"], "fail", "/.well-known/ai not found", "Publish /.well-known/ai with your service name, capabilities, and pointers to llms.txt / agent.json.");
};

const markdownNegotiation: Checker = async (ctx) => {
  const r = await ctx.get("/", "text/markdown");
  if (r.status === 200 && r.contentType.includes("text/markdown")) {
    return result(D["markdown-negotiation"], "pass", "Homepage returns text/markdown for Accept: text/markdown");
  }
  return result(D["markdown-negotiation"], "fail", `Accept: text/markdown → content-type: ${r.contentType || r.status || r.error}`, "Support Markdown content negotiation (Cloudflare 'Markdown for agents') so agents get clean text instead of HTML.");
};

const llmsTxt: Checker = async (ctx) => {
  const r = await ctx.get("/llms.txt");
  if (r.status === 200 && !looksHtml(r) && r.body.trim().length > 0) {
    const full = await ctx.get("/llms-full.txt");
    const hasFull = full.status === 200 && !looksHtml(full);
    return result(D["llms-txt"], "pass", `/llms.txt published (${r.body.length} bytes)${hasFull ? ", llms-full.txt also present" : ""}`, undefined, sanitizeArtifact(r.body, 2000));
  }
  return result(D["llms-txt"], "fail", `/llms.txt: ${describe(r)}`, "Publish /llms.txt: a markdown overview of what you do, key links, docs, and pricing — the agent-facing front door.");
};

const llmDocs: Checker = async (ctx) => {
  const md = await ctx.get("/index.md");
  if (md.status === 200 && !looksHtml(md)) return result(D["llm-docs"], "pass", "/index.md serves markdown source");
  const full = await ctx.get("/llms-full.txt");
  if (full.status === 200 && !looksHtml(full)) return result(D["llm-docs"], "pass", "/llms-full.txt provides full LLM-readable documentation");
  const neg = await ctx.get("/", "text/markdown");
  if (neg.status === 200 && neg.contentType.includes("text/markdown")) {
    return result(D["llm-docs"], "pass", "Markdown negotiation provides LLM-readable content");
  }
  return result(D["llm-docs"], "fail", "No /index.md, /llms-full.txt, or markdown negotiation", "Expose markdown source for key pages so agents can read your documentation without scraping HTML.");
};

const contentSignals: Checker = async (ctx) => {
  const r = await ctx.robots();
  if (/content-signal\s*:/i.test(r.body)) {
    const lines = r.body.split(/\r?\n/).filter((l) => /content-signal/i.test(l));
    return result(D["content-signals"], "pass", `Content Signals declared: ${lines.join("; ").slice(0, 200)}`);
  }
  return result(D["content-signals"], "fail", "No Content-Signal directives in robots.txt", "Declare Content Signals (e.g. 'Content-Signal: search=yes, ai-train=no') to express how content may be used.");
};

const webBotAuth: Checker = async (ctx) => {
  const dir = await ctx.get("/.well-known/http-message-signatures-directory");
  if (dir.status === 200 && tryJson(dir.body)) {
    return result(D["web-bot-auth"], "pass", "HTTP Message Signatures directory published");
  }
  const home = await ctx.home();
  if (home.headers["accept-signature"] || home.headers["signature-agent"]) {
    return result(D["web-bot-auth"], "partial", "Signature negotiation headers present on homepage");
  }
  return result(D["web-bot-auth"], "fail", "No Web Bot Auth signals found", "Optional: support Web Bot Auth (HTTP Message Signatures) to verify legitimate agents instead of blocking by UA string.");
};

const apiCatalog: Checker = async (ctx) => {
  const r = await ctx.get("/.well-known/api-catalog", "application/linkset+json");
  if (r.status === 200 && (tryJson(r.body) || r.contentType.includes("linkset"))) {
    return result(D["api-catalog"], "pass", "/.well-known/api-catalog published (RFC 9727)");
  }
  return result(D["api-catalog"], "fail", `/.well-known/api-catalog: ${describe(r)}`, "Publish an RFC 9727 api-catalog linkset so agents can enumerate your APIs.");
};

const oauthAs: Checker = async (ctx) => {
  const r = await ctx.get("/.well-known/oauth-authorization-server");
  const json = tryJson(r.body) as { issuer?: string } | null;
  if (r.status === 200 && json?.issuer) return result(D["oauth-as"], "pass", `OAuth AS metadata, issuer: ${json.issuer}`);
  if (r.status === 200 && json) return result(D["oauth-as"], "partial", "Metadata JSON found but missing 'issuer'", "RFC 8414 metadata must include 'issuer'.");
  return result(D["oauth-as"], "fail", `/.well-known/oauth-authorization-server: ${describe(r)}`, "If you offer OAuth, publish RFC 8414 authorization server metadata.");
};

const oauthPr: Checker = async (ctx) => {
  const r = await ctx.get("/.well-known/oauth-protected-resource");
  const json = tryJson(r.body) as { resource?: string } | null;
  if (r.status === 200 && json?.resource) return result(D["oauth-pr"], "pass", `Protected resource metadata for ${json.resource}`);
  if (r.status === 200 && json) return result(D["oauth-pr"], "partial", "JSON found but missing 'resource'", "RFC 9728 metadata must include 'resource'.");
  return result(D["oauth-pr"], "fail", `/.well-known/oauth-protected-resource: ${describe(r)}`, "If your APIs require OAuth, publish RFC 9728 protected resource metadata (also required for remote MCP auth).");
};

const authMd: Checker = async (ctx) => {
  const hit = await ctx.firstHit(["/auth.md", "/.well-known/auth.md"]);
  if (hit) return result(D["auth-md"], "pass", `${hit.path} published (${hit.res.body.length} bytes)`);
  return result(D["auth-md"], "fail", "No /auth.md or /.well-known/auth.md", "Publish auth.md describing how agents authenticate: token acquisition, scopes, and example requests.");
};

const A2A_REQUIRED = ["name", "description", "url", "version", "capabilities", "skills", "defaultInputModes", "defaultOutputModes"];

const a2aAgentCard: Checker = async (ctx) => {
  const r = await ctx.get("/.well-known/agent-card.json");
  const json = tryJson(r.body) as Record<string, unknown> | null;
  if (r.status === 200 && json) {
    const missing = A2A_REQUIRED.filter((f) => !(f in json));
    if (missing.length === 0) {
      const skills = Array.isArray(json.skills) ? json.skills.length : 0;
      return result(D["a2a-agent-card"], "pass", `Valid A2A Agent Card: "${json.name}" v${json.version}, ${skills} skill(s)`, undefined, json);
    }
    return result(D["a2a-agent-card"], "partial", `Agent Card found but missing required fields: ${missing.join(", ")}`, `Add the missing A2A fields (${missing.join(", ")}) per the A2A specification.`, json);
  }
  const legacy = await ctx.get("/.well-known/agent.json");
  const lj = tryJson(legacy.body) as Record<string, unknown> | null;
  if (legacy.status === 200 && lj && ("skills" in lj || "capabilities" in lj)) {
    return result(D["a2a-agent-card"], "partial", "Legacy /.well-known/agent.json found (pre-0.3 A2A path)", "Move/duplicate your Agent Card to /.well-known/agent-card.json — the current A2A discovery path.", lj);
  }
  return result(D["a2a-agent-card"], "fail", `/.well-known/agent-card.json: ${describe(r)}`, "Publish an A2A Agent Card at /.well-known/agent-card.json (name, description, url, version, capabilities, skills, defaultInputModes, defaultOutputModes).");
};

const mcpServerCard: Checker = async (ctx) => {
  const card = await ctx.get("/.well-known/mcp/server-card.json");
  const cj = tryJson(card.body) as Record<string, unknown> | null;
  if (card.status === 200 && cj) {
    const name = (cj.name as string) ?? (cj as { serverInfo?: { name?: string } }).serverInfo?.name;
    return result(D["mcp-server-card"], "pass", `MCP Server Card published${name ? `: "${name}"` : ""}`, undefined, cj);
  }
  const alt = await ctx.firstHit(["/.well-known/mcp.json", "/.well-known/mcp"]);
  if (alt && tryJson(alt.res.body)) {
    return result(D["mcp-server-card"], "partial", `MCP manifest at ${alt.path} (older convention)`, "Also publish /.well-known/mcp/server-card.json — the SEP-1649/SEP-2127 path clients are standardizing on.", tryJson(alt.res.body));
  }
  return result(D["mcp-server-card"], "fail", "No MCP Server Card found", "If you run an MCP server, publish /.well-known/mcp/server-card.json advertising transport, capabilities, and tools.");
};

const agentSkills: Checker = async (ctx) => {
  const hit = await ctx.firstHit(["/.well-known/skills", "/.well-known/skills/index.json", "/.well-known/skills.json"]);
  if (hit) return result(D["agent-skills"], "pass", `Agent Skills discovery at ${hit.path}`);
  return result(D["agent-skills"], "fail", "No /.well-known/skills endpoint", "Optional: publish Agent Skills so coding/browser agents can load task instructions for your service.");
};

const webmcp: Checker = async (ctx) => {
  const manifest = await ctx.get("/.well-known/webmcp.json");
  if (manifest.status === 200 && tryJson(manifest.body)) return result(D["webmcp"], "pass", "/.well-known/webmcp.json published");
  const home = await ctx.home();
  if (/modelcontext|webmcp/i.test(home.body)) return result(D["webmcp"], "partial", "WebMCP references detected in homepage markup");
  return result(D["webmcp"], "fail", "No WebMCP signals", "Optional: expose in-page tools via WebMCP (navigator.modelContext) for browser agents.");
};

const x402: Checker = async (ctx) => {
  const hit = await ctx.firstHit(["/.well-known/x402", "/.well-known/x402.json"]);
  if (hit && tryJson(hit.res.body)) return result(D["x402"], "pass", `x402 manifest at ${hit.path}`, undefined, tryJson(hit.res.body));
  return result(D["x402"], "fail", "No x402 payment manifest", "If agents can pay you per-request, publish an x402 manifest (/.well-known/x402) describing payable routes and pricing.");
};

const mpp: Checker = async (ctx) => {
  const hit = await ctx.firstHit(["/.well-known/mpp", "/.well-known/mpp.json"]);
  if (hit && tryJson(hit.res.body)) return result(D["mpp"], "pass", `MPP manifest at ${hit.path}`);
  return result(D["mpp"], "fail", "No MPP (Machine Payments Protocol) manifest", "Optional: support Stripe/Tempo MPP for pre-authorized agent spending sessions.");
};

const ucp: Checker = async (ctx) => {
  const hit = await ctx.firstHit(["/.well-known/ucp", "/.well-known/ucp.json"]);
  if (hit && tryJson(hit.res.body)) return result(D["ucp"], "pass", `UCP capability manifest at ${hit.path}`, undefined, tryJson(hit.res.body));
  return result(D["ucp"], "fail", "No UCP manifest at /.well-known/ucp", "If you sell products, publish a Universal Commerce Protocol manifest so shopping agents can discover checkout capabilities.");
};

const acp: Checker = async (ctx) => {
  const hit = await ctx.firstHit(["/.well-known/acp", "/.well-known/acp.json", "/.well-known/agentic-commerce", "/.well-known/agentic-commerce.json"]);
  if (hit && tryJson(hit.res.body)) return result(D["acp"], "pass", `ACP discovery manifest at ${hit.path}`);
  return result(D["acp"], "fail", "No ACP (Agentic Commerce Protocol) discovery signals", "Optional: implement ACP (OpenAI/Stripe agentic checkout) if you want ChatGPT/Copilot instant checkout.");
};

const pricing: Checker = async (ctx) => {
  const hit = await ctx.firstHit(["/.well-known/pricing.json", "/pricing.json", "/.well-known/payments"]);
  if (hit && tryJson(hit.res.body)) return result(D["pricing"], "pass", `Machine-readable pricing at ${hit.path}`);
  const llms = await ctx.get("/llms.txt");
  if (llms.status === 200 && /pricing|price/i.test(llms.body)) {
    return result(D["pricing"], "partial", "Pricing referenced in llms.txt but no machine-readable pricing file", "Publish pricing as JSON (e.g. /pricing.json or an x402 manifest) so agents can compare costs without scraping.");
  }
  return result(D["pricing"], "fail", "No machine-readable pricing signals", "Publish machine-readable pricing. Agents skip services whose cost they cannot determine.");
};

const httpsEnforced: Checker = async (ctx) => {
  if (!ctx.origin.startsWith("https://")) {
    return result(D["https-enforced"], "fail", "Site was scanned over plain HTTP", "Serve over HTTPS and redirect all HTTP traffic.");
  }
  const httpUrl = "http://" + ctx.host + "/";
  const r = await ctx.get(httpUrl);
  if (r.error) return result(D["https-enforced"], "pass", "HTTPS origin; plain-HTTP port unreachable (strict)");
  if (r.finalUrl.startsWith("https://")) return result(D["https-enforced"], "pass", "HTTP redirects to HTTPS");
  return result(D["https-enforced"], "partial", "HTTP does not redirect to HTTPS", "Redirect all plain-HTTP requests to HTTPS.");
};

const jsonLd: Checker = async (ctx) => {
  const home = await ctx.home();
  if (/application\/ld\+json/i.test(home.body)) {
    const types = [...home.body.matchAll(/"@type"\s*:\s*"([^"]+)"/g)].map((m) => m[1]).slice(0, 6);
    return result(D["json-ld"], "pass", `JSON-LD present${types.length ? ` (@type: ${[...new Set(types)].join(", ")})` : ""}`);
  }
  if (/itemscope|property=["']og:/i.test(home.body)) {
    return result(D["json-ld"], "partial", "Microdata/OpenGraph present but no JSON-LD", "Add schema.org JSON-LD (Organization/Product/Service) — the structured identity agents parse first.");
  }
  return result(D["json-ld"], "fail", "No structured data on homepage", "Add schema.org JSON-LD describing your organization, offers, and services.");
};

const agentFriendlyUx: Checker = async (ctx) => {
  const home = await ctx.home();
  if (home.status !== 200 || looksHtml(home) === false && home.body.trim().length === 0) {
    return result(D["agent-friendly-ux"], "fail", `Homepage unavailable for UX scan: ${describe(home)}`, "Ensure the primary page is crawlable and renders meaningful HTML for browser agents.");
  }

  const body = home.body;
  const semanticActions = (body.match(/<(button|a|input|select|textarea)\b/gi) ?? []).length;
  const divButtons = (body.match(/<div\b[^>]*\brole=["']button["']/gi) ?? []).length;
  const unlabeledInputs = (body.match(/<(input|select|textarea)\b/gi) ?? []).length;
  const linkedLabels = (body.match(/<label\b[^>]*\bfor=["'][^"']+["']/gi) ?? []).length;
  const ghostRisk = /\bopacity\s*:\s*0\b|\bdisplay\s*:\s*none\b|\bvisibility\s*:\s*hidden\b|pointer-events\s*:\s*none/i.test(body);
  const hasAria = /\baria-label=|\baria-labelledby=|\brole=/i.test(body);
  const hasCursorPointer = /cursor\s*:\s*pointer/i.test(body);

  const strengths: string[] = [];
  const gaps: string[] = [];
  if (semanticActions > 0) strengths.push(`${semanticActions} semantic interactive element(s)`);
  else gaps.push("no semantic button/link/input elements found");
  if (linkedLabels > 0 || unlabeledInputs === 0) strengths.push(linkedLabels > 0 ? `${linkedLabels} label(s) linked with for=` : "no form controls needing labels detected");
  else gaps.push("form controls found without linked labels");
  if (hasAria || semanticActions > 0) strengths.push("ARIA/semantic action signals present");
  else gaps.push("no ARIA/role fallback signals");
  if (hasCursorPointer) strengths.push("cursor:pointer action cues present");
  if (divButtons > 0) gaps.push(`${divButtons} div role=button fallback(s); prefer native button/a where possible`);
  if (ghostRisk) gaps.push("hidden/transparent/overlay styling patterns detected");

  if (semanticActions > 0 && gaps.length === 0) {
    return result(D["agent-friendly-ux"], "pass", `Agent-friendly homepage signals: ${strengths.join("; ")}`);
  }
  if (semanticActions > 0 || hasAria || linkedLabels > 0) {
    return result(
      D["agent-friendly-ux"],
      "partial",
      `Some agent-friendly signals found (${strengths.join("; ") || "limited"}), gaps: ${gaps.join("; ")}`,
      "Follow Google's agent-friendly website guidance: prefer semantic button/a/input elements, connect labels with for=, keep layouts stable, and avoid ghost overlays."
    );
  }
  return result(
    D["agent-friendly-ux"],
    "fail",
    `No strong browser-agent UX signals. Gaps: ${gaps.join("; ")}`,
    "Use semantic HTML for actions, label form controls, expose meaningful roles/names/states, and keep critical UI stable for screenshot, DOM, and accessibility-tree agents."
  );
};

const openapi: Checker = async (ctx) => {
  const hit = await ctx.firstHit(["/openapi.json", "/.well-known/openapi.json", "/openapi.yaml", "/openapi.yml", "/swagger.json", "/api/openapi.json"]);
  if (hit) {
    const j = tryJson(hit.res.body) as Record<string, unknown> | null;
    if ((j && (j.openapi || j.swagger)) || /^openapi\s*:/m.test(hit.res.body)) {
      return result(D["openapi"], "pass", `OpenAPI spec at ${hit.path}`, undefined, j ?? undefined);
    }
  }
  return result(D["openapi"], "fail", "No OpenAPI spec at common paths", "Publish an OpenAPI spec (and reference it from api-catalog / agent.json) — the canonical invocation contract.");
};

const agentJson: Checker = async (ctx) => {
  const hit = await ctx.firstHit(["/agent.json", "/.well-known/agent.json"]);
  const j = hit ? (tryJson(hit.res.body) as Record<string, unknown> | null) : null;
  if (hit && j && j.name) return result(D["agent-json"], "pass", `agent.json at ${hit.path}: "${j.name}"`, undefined, j);
  if (hit && j) return result(D["agent-json"], "partial", `${hit.path} is JSON but lacks a 'name'`, "Include at least name, description, capabilities, and signal locations.", j);
  return result(D["agent-json"], "fail", "No agent.json manifest", "Publish /agent.json — your service identity manifest (name, capabilities, links to llms.txt, OpenAPI, pricing).");
};

const securityTxt: Checker = async (ctx) => {
  const r = await ctx.get("/.well-known/security.txt");
  if (r.status === 200 && !looksHtml(r) && /contact\s*:/i.test(r.body)) return result(D["security-txt"], "pass", "RFC 9116 security.txt published");
  return result(D["security-txt"], "fail", `/.well-known/security.txt: ${describe(r)}`, "Publish security.txt (RFC 9116) — a cheap, strong governance/provenance signal.");
};

const statusEndpoint: Checker = async (ctx) => {
  const hit = await ctx.firstHit(["/.well-known/status", "/status.json", "/api/status", "/health"]);
  if (hit) return result(D["status-endpoint"], "pass", `Operational status at ${hit.path}`);
  const home = await ctx.home();
  if (/status\.[a-z0-9-]+\.[a-z]{2,}|statuspage|uptime/i.test(home.body)) {
    return result(D["status-endpoint"], "partial", "Status page linked from homepage but no machine endpoint", "Add a machine-readable status endpoint (e.g. /.well-known/status returning JSON uptime).");
  }
  return result(D["status-endpoint"], "fail", "No operational status visibility", "Expose a status endpoint with uptime/health so agents can verify you are operational before invoking.");
};

const versioning = async (ctx: ScanContext, prior?: CheckResult[]): Promise<CheckResult> => {
  const manifests = (prior ?? [])
    .filter((c) => ["agent-json", "a2a-agent-card", "mcp-server-card", "openapi", "well-known-ai"].includes(c.id) && c.data)
    .map((c) => c.data as Record<string, unknown>);
  const versions = manifests
    .map((m) => (m.version as string) ?? (m.info as { version?: string } | undefined)?.version)
    .filter(Boolean);
  if (versions.length) return result(D["versioning"], "pass", `Version fields found in ${versions.length} manifest(s): ${versions.join(", ")}`);
  const changelog = await ctx.firstHit(["/changelog.md", "/CHANGELOG.md", "/changelog"]);
  if (changelog) return result(D["versioning"], "partial", `Changelog found at ${changelog.path} but manifests carry no version fields`, "Add 'version' fields to your agent.json / Agent Card / OpenAPI info block.");
  return result(D["versioning"], "fail", "No versioning signals in manifests or changelog", "Version your manifests and docs so returning agents can detect change and trust stability.");
};

const identityConsistency = async (ctx: ScanContext, prior: CheckResult[]): Promise<CheckResult> => {
  const names: { source: string; name: string }[] = [];
  for (const c of prior) {
    const d = c.data as Record<string, unknown> | undefined;
    if (d && typeof d.name === "string") names.push({ source: c.id, name: d.name });
  }
  const llms = prior.find((c) => c.id === "llms-txt");
  if (llms?.status === "pass" && typeof llms.data === "string") {
    const h1 = (llms.data as string).match(/^#\s+(.+)$/m);
    if (h1) names.push({ source: "llms-txt", name: h1[1].trim() });
  }
  if (names.length === 0) return result(D["identity-consistency"], "fail", "No named manifests published to compare", "Publish agent.json / Agent Card / llms.txt with a consistent service name.");
  if (names.length === 1) return result(D["identity-consistency"], "partial", `Only one named source (${names[0].source}: "${names[0].name}")`, "Publish your identity in at least two signal files (e.g. agent.json + llms.txt) with the same name.");
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const base = norm(names[0].name);
  const consistent = names.every((n) => norm(n.name).includes(base) || base.includes(norm(n.name)));
  if (consistent) return result(D["identity-consistency"], "pass", `Consistent identity across ${names.length} sources: "${names[0].name}"`);
  return result(D["identity-consistency"], "fail", `Conflicting names: ${names.map((n) => `${n.source}="${n.name}"`).join(", ")}`, "Align the service name across all manifests — agents treat conflicting identity as a trust failure.");
};

const signalConsistency = async (ctx: ScanContext, prior: CheckResult[]): Promise<CheckResult> => {
  const ok = (id: string) => prior.find((c) => c.id === id)?.status === "pass";
  const core = ["robots-txt", "sitemap", "llms-txt", "agent-json", "a2a-agent-card", "well-known-ai", "mcp-server-card"];
  const present = core.filter(ok);
  // Contradiction: invites agents via llms.txt while robots.txt disallows all AI crawlers
  const robots = await ctx.robots();
  const body = robots.body.toLowerCase();
  const blocksAll = AI_BOTS.filter((b) => {
    const idx = body.indexOf(b);
    if (idx === -1) return false;
    const after = body.slice(idx, idx + 400);
    return /disallow\s*:\s*\/\s*($|\n)/.test(after);
  });
  if (ok("llms-txt") && blocksAll.length >= 5) {
    return result(D["signal-consistency"], "fail", `Contradiction: llms.txt invites agents but robots.txt fully blocks ${blocksAll.length} AI crawlers`, "Decide your agent policy: either allow AI crawlers you want to serve, or remove the invitation signals.");
  }
  if (present.length >= 3) return result(D["signal-consistency"], "pass", `${present.length} core signals present and coherent: ${present.join(", ")}`);
  if (present.length === 2) return result(D["signal-consistency"], "partial", `Only 2 core signals present (${present.join(", ")})`, "Publish at least robots.txt + sitemap + llms.txt + one identity manifest, all pointing at the same canonical origin.");
  return result(D["signal-consistency"], "fail", `Only ${present.length} core signal(s) present`, "Build the minimum signal stack: robots.txt, sitemap.xml, llms.txt, agent.json.");
};

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

const INDEPENDENT: [string, Checker][] = [
  ["robots-txt", robotsTxt],
  ["ai-bot-rules", aiBotRules],
  ["sitemap", sitemap],
  ["link-headers", linkHeaders],
  ["dns-aid", dnsAid],
  ["well-known-ai", wellKnownAi],
  ["markdown-negotiation", markdownNegotiation],
  ["llms-txt", llmsTxt],
  ["llm-docs", llmDocs],
  ["content-signals", contentSignals],
  ["web-bot-auth", webBotAuth],
  ["api-catalog", apiCatalog],
  ["oauth-as", oauthAs],
  ["oauth-pr", oauthPr],
  ["auth-md", authMd],
  ["mcp-server-card", mcpServerCard],
  ["a2a-agent-card", a2aAgentCard],
  ["agent-skills", agentSkills],
  ["webmcp", webmcp],
  ["x402", x402],
  ["mpp", mpp],
  ["ucp", ucp],
  ["acp", acp],
  ["pricing", pricing],
  ["https-enforced", httpsEnforced],
  ["json-ld", jsonLd],
  ["agent-friendly-ux", agentFriendlyUx],
  ["openapi", openapi],
  ["agent-json", agentJson],
  ["security-txt", securityTxt],
  ["status-endpoint", statusEndpoint],
];

export async function runChecks(ctx: ScanContext, only?: string[]): Promise<CheckResult[]> {
  const selected = INDEPENDENT.filter(([id]) => !only || only.includes(id));
  const results: CheckResult[] = [];
  // bounded concurrency so we don't hammer the target
  const queue = [...selected];
  const workers = Array.from({ length: 6 }, async () => {
    while (queue.length) {
      const item = queue.shift();
      if (!item) break;
      const [id, fn] = item;
      try {
        results.push(await fn(ctx));
      } catch (err) {
        const d = D[id];
        results.push(result(d, "error", `Check crashed: ${err instanceof Error ? err.message : String(err)}`));
      }
    }
  });
  await Promise.all(workers);

  // dependent checks (consume prior results)
  const wantDep = (id: string) => !only || only.includes(id);
  if (wantDep("versioning")) results.push(await versioning(ctx, results));
  if (wantDep("identity-consistency")) results.push(await identityConsistency(ctx, results));
  if (wantDep("signal-consistency")) results.push(await signalConsistency(ctx, results));

  const order = CHECK_DEFS.map((d) => d.id);
  results.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  return results;
}
