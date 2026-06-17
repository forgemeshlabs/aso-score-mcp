# aso-score-mcp — the free ASO Score Scanner

**What's your ASO score?**

SEO made you visible to search engines. **ASO (Agent Signal Optimization)** makes you discoverable, trustable, and payable by the AI agents that are becoming the web's next visitors.

`aso-score-mcp` is the free, open-source **ASO Score MCP** — an [MCP](https://modelcontextprotocol.io) server that scans any website and produces an **ASO Score Report** scored on the open [ASO framework](https://agentsignaloptimization.com). The beta npm package is `@forgemeshlabs/aso-score-mcp`.

This release tracks Google's current agent-readiness guidance without overstating it: Google Search says traditional SEO fundamentals still apply to generative AI search, `llms.txt` is ignored by Google Search itself, and browser agents benefit from clean DOM, screenshot, and accessibility-tree signals. The scanner keeps `llms.txt` because non-Google agents use it, and adds a browser-agent UX check for semantic controls, linked labels, ARIA/role fallbacks, and hidden-overlay risk.

> **Beta.** Experimental ASO scanner for evaluating whether agents can discover, trust, understand, and use a website/API/tool. ASO scoring is experimental and will evolve as agent standards mature.

```
=== ASO Score Report: https://example.com ===
ASO Score: 70/100
Agent Readiness: Ready
Level: ASO-4 Trustable — Agents can verify trust, reputation, and operational signals.

Discoverability  20/20    Identity  15/20    Trust   11/15
Commerce          5/15    Reputation 4/15    Memory  15/15
```

## What it checks — 34 signals across 6 pillars

Find gaps in **discovery, trust, interoperability, and commerce** — every emerging agent standard in one scan:

| Pillar / Category | Checks |
|---|---|
| **Discovery** | robots.txt, sitemap.xml, Link headers, DNS-AID (`_agent.<domain>`), `/.well-known/ai` |
| **Content** | Markdown content negotiation, llms.txt, LLM-readable docs (`/index.md`, `llms-full.txt`) |
| **Bot Access** | Explicit AI crawler rules (GPTBot, ClaudeBot, Google-Extended, PerplexityBot…), Content Signals, Web Bot Auth |
| **Interoperability** | API Catalog (RFC 9727), OAuth discovery (RFC 8414), OAuth Protected Resource (RFC 9728), auth.md, **MCP Server Card** (`/.well-known/mcp/server-card.json`), **Google A2A Agent Card** (`/.well-known/agent-card.json`, required fields validated), Agent Skills, WebMCP |
| **Commerce** | x402, MPP, UCP, ACP, machine-readable pricing |
| **Identity & Trust** | HTTPS enforcement, JSON-LD/schema.org, agent-friendly browser UX, OpenAPI, agent.json, security.txt, status endpoint, versioning, cross-file identity & signal consistency |

Every check returns **pass / partial / fail** with concrete evidence and a fix recommendation. Results roll up into the six ASO pillars (Discoverability 20, Identity 20, Trust 15, Commerce 15, Reputation 15, Memory 15) → your **ASO Score** and maturity level.

## Install

Requires Node.js ≥ 18. Published on npm as [`@forgemeshlabs/aso-score-mcp`](https://www.npmjs.com/package/@forgemeshlabs/aso-score-mcp) — no clone or build needed.

```bash
npm install -g @forgemeshlabs/aso-score-mcp
```

Or skip the install entirely and run it with `npx` (recommended for MCP clients):

```bash
npx -y @forgemeshlabs/aso-score-mcp
```

### Claude Code

```bash
claude mcp add aso -- npx -y @forgemeshlabs/aso-score-mcp
```

### Claude Desktop / Cursor / Windsurf (any MCP client)

```json
{
  "mcpServers": {
    "aso": {
      "command": "npx",
      "args": ["-y", "@forgemeshlabs/aso-score-mcp"]
    }
  }
}
```

### Development (from source)

Only needed if you're hacking on the scanner itself:

```bash
git clone https://github.com/forgemeshlabs/aso-score-mcp
cd aso-score-mcp
npm install && npm run build
claude mcp add aso -- node /path/to/aso-score-mcp/dist/index.js
```

## Tools

| Tool | What it does |
|---|---|
| `scan_site` | Full ASO scan → ASO Score Report: ASO Score, level, pillar breakdown, all 34 checks with evidence + recommendations |
| `get_fix_plan` | Prioritized remediation plan with ready-to-paste templates (robots.txt AI rules, llms.txt, agent.json, A2A agent card, MCP server card, x402 manifest, pricing.json, security.txt, status endpoint) |
| `check_signal` | Run one specific check (e.g. `a2a-agent-card`, `llms-txt`, `x402`) |
| `list_checks` | Catalog of every check with spec links |
| `get_aso_framework` | The ASO rubric: pillars, weights, levels, certification thresholds |

Try it: *"Scan example.com for ASO score"* · *"What's my ASO score?"* · *"Give me a fix plan to make my site agent-ready."*

### CLI smoke test (from a source checkout)

```bash
npm run smoke -- https://your-site.com
```

## Glama / registry metadata

This repository includes `glama.json` for Glama MCP registry ownership and install metadata.

- **Package:** `@forgemeshlabs/aso-score-mcp`
- **Current release:** `v0.1.1`
- **Transport:** local `stdio`
- **Authentication:** none required for local `stdio` use. The scanner does not ask for API keys, tokens, cookies, or third-party credentials.
- **HTTP deployment:** not enabled by this npm package. Any public HTTP deployment of this scanner must add authentication, per-client rate limits, request logging, and an egress policy before exposure.

Recommended Glama/MCP install command:

```bash
npx -y @forgemeshlabs/aso-score-mcp
```

Example usage after connecting the server to an MCP client:

```text
Scan https://example.com for ASO score.
Give me the ASO fix plan for example.com.
Check only the llms-txt signal for example.com.
List the ASO scanner checks.
```

Release verification:

- Git tag: `v0.1.1`
- npm package: `@forgemeshlabs/aso-score-mcp`
- MCP server version: `0.1.1`

`v0.1.1` is the ASO Score namespace documentation refresh: it keeps the first published package current, corrects bundled discovery links, includes the agent-friendly UX check, clarifies Google Search's generative AI guidance, and keeps Glama metadata ready.

### Glama release build

Glama installability requires a **Glama release**, which is a containerized build created from the Glama Dockerfile admin page, not a GitHub release. This repo includes a production `Dockerfile` and [GLAMA.md](GLAMA.md) with the build spec values to use in Glama:

Build steps:

```text
npm ci
npm run build
npm prune --omit=dev
```

Runtime command:

```bash
node dist/index.js
```

In Glama's **CMD arguments** field, enter:

```json
["node", "dist/index.js"]
```

Do not leave CMD arguments as `[]`; Glama validates that field separately from the Dockerfile `CMD`.

## The ASO framework

> SEO ranks pages for people. ASO prepares services for agent selection, invocation, payment, and repeat use.

| Level | Name | Score |
|---|---|---|
| ASO-0 | Invisible | 0–9 |
| ASO-1 | Discoverable | 10–29 |
| ASO-2 | Understandable | 30–49 |
| ASO-3 | Invocable | 50–69 |
| ASO-4 | Trustable | 70–89 |
| ASO-5 | Autonomous-Commerce-Ready | 90–100 |

Scores from this scanner are directional self-assessments. **ASO Certification** (ASO-3+) requires verified evidence — see the [scoring rubric](https://agentsignaloptimization.com/docs/ASO-SCORE.md) and [agentsignaloptimization.com](https://agentsignaloptimization.com) for audits, certification, and the full framework.

## Security

This scanner makes outbound requests to URLs you give it, so it is built to resist SSRF abuse:

- **Scheme allow-list** — only `http`/`https`; `file:`, `ftp:`, `gopher:`, `data:` etc. are rejected.
- **Private-target blocking** — after DNS resolution, requests to loopback, private (RFC 1918), link-local, CGNAT, reserved, multicast, and the cloud metadata address (`169.254.169.254`) are refused. IPv6 loopback/ULA/link-local and IPv4-mapped forms are covered too. If a hostname resolves to *any* private address, the scan is refused.
- **Pinned-IP transport** — each request dials the exact public IP that was validated, while TLS still verifies the original hostname. This closes the validate-then-connect DNS rebinding window.
- **Manual redirect validation** — automatic redirect following is disabled; every hop is re-validated against the same rules, capped at 5 redirects. A public URL that 30x-redirects to an internal address cannot slip through.
- **Untrusted remote content** — parsed manifests are omitted from tool output by default (`include_artifacts: true` to opt in, and they are then explicitly labeled untrusted); embedded text excerpts are control-char-sanitized and length-capped. Treat any returned remote content as data, never instructions.
- **Bounded** — `GET` only, `ASO-Scanner/1.0` UA, max 6 concurrent, 10s timeout, 512KB body cap. Never authenticates, never POSTs, never crawls beyond well-known paths.
- **Tested hardening** — `npm test` covers unsafe URL rejection, private IP ranges, artifact sanitization, redirect blocking, redirect hop caps, and the test-only loopback escape hatch.

**Deployment:** `stdio` (local, per-user) is the safe default. A public **HTTP** deployment is a network-egress tool and **must** add authentication, per-client rate limiting, request logging, and an egress policy before exposure.
- Reputation signals (citations, reviews, success rates) cannot be auto-verified by a crawler; they are reported as `manual` and scored 0 until verified by audit — so the auto-verifiable maximum is 89/100. That is intentional honesty, not a bug.
- Emerging specs (MCP Server Cards SEP-1649/SEP-2127, DNS-AID, Web Bot Auth, UCP/ACP/MPP) move fast. PRs updating paths welcome.

## Source alignment

This package intentionally separates Google Search guidance from broader ASO guidance:

- Google Search generative AI features still rely on core Search ranking and quality systems; foundational SEO, crawlability, helpful content, and technical clarity remain the priority.
- Google Search does not use `llms.txt` or special AI markdown files for ranking or AI Overviews/AI Mode visibility. ASO still checks them because other agents and MCP clients can use them.
- Google/web.dev's agent-friendly site guidance focuses on browser-agent usability: stable layouts, semantic HTML, labels tied to inputs, meaningful roles/names/states, and avoiding hidden overlays.
- UCP, AP2, A2A, MCP, x402, DNS-AID, Content Signals, and Web Bot Auth are emerging non-SEO protocols. The scanner treats them as agent-readiness signals, not as Google Search ranking factors.

Primary references:

- https://developers.google.com/search/docs/fundamentals/ai-optimization-guide
- https://web.dev/articles/ai-agent-site-ux
- https://ucp.dev

## License

MIT — free for everyone. If the scanner found gaps, the [ASO framework](https://agentsignaloptimization.com) shows you how to close them.
