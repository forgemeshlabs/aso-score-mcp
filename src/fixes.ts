import type { ScanReport } from "./types.js";

/** Ready-to-paste artifact templates keyed by the check they fix. */
export function templates(siteName: string, origin: string): Record<string, string> {
  return {
    "ai-bot-rules": `# robots.txt — explicit AI crawler policy (adjust allow/disallow to your policy)
User-agent: GPTBot
Allow: /

User-agent: ClaudeBot
Allow: /

User-agent: Google-Extended
Allow: /

User-agent: PerplexityBot
Allow: /

User-agent: CCBot
Allow: /

# Content Signals (contentsignals.org)
Content-Signal: search=yes, ai-input=yes, ai-train=no

User-agent: *
Allow: /

Sitemap: ${origin}/sitemap.xml
`,
    "llms-txt": `# ${siteName}

> One-paragraph description of what this service does and who it is for.

## Docs
- [Getting started](${origin}/docs): How to use the service
- [API reference](${origin}/openapi.json): OpenAPI 3.1 spec
- [Auth](${origin}/auth.md): How agents authenticate

## Pricing
- [Pricing](${origin}/pricing.json): Machine-readable pricing

## Status
- [Status](${origin}/.well-known/status): Operational status
`,
    "agent-json": `{
  "name": "${siteName}",
  "description": "What this service does, in one agent-readable sentence.",
  "url": "${origin}",
  "version": "1.0.0",
  "capabilities": ["describe.what.agents.can.do"],
  "signals": {
    "llms": "/llms.txt",
    "openapi": "/openapi.json",
    "auth": "/auth.md",
    "pricing": "/pricing.json",
    "status": "/.well-known/status"
  }
}
`,
    "a2a-agent-card": `{
  "protocolVersion": "0.3.0",
  "name": "${siteName}",
  "description": "What this agent/service does and the tasks it accepts.",
  "url": "${origin}/a2a",
  "preferredTransport": "JSONRPC",
  "version": "1.0.0",
  "capabilities": {
    "streaming": false,
    "pushNotifications": false,
    "stateTransitionHistory": false
  },
  "defaultInputModes": ["text/plain", "application/json"],
  "defaultOutputModes": ["application/json"],
  "skills": [
    {
      "id": "example-skill",
      "name": "Example skill",
      "description": "Describe one task this agent performs.",
      "tags": ["example"],
      "examples": ["Do the example task for acme.com"]
    }
  ]
}
// Serve at: ${origin}/.well-known/agent-card.json
`,
    "mcp-server-card": `{
  "name": "${siteName}",
  "description": "MCP server for ${siteName}.",
  "version": "1.0.0",
  "endpoint": "${origin}/mcp",
  "transport": ["streamable-http"],
  "capabilities": { "tools": true, "resources": false, "prompts": false },
  "authentication": { "type": "oauth2", "resourceMetadata": "${origin}/.well-known/oauth-protected-resource" }
}
// Serve at: ${origin}/.well-known/mcp/server-card.json
`,
    "well-known-ai": `{
  "name": "${siteName}",
  "framework": "ASO",
  "capabilities": ["describe.your.capabilities"],
  "signals": {
    "llms": "/llms.txt",
    "agent": "/agent.json",
    "a2a": "/.well-known/agent-card.json",
    "openapi": "/openapi.json"
  }
}
// Serve at: ${origin}/.well-known/ai  (content-type: application/json)
`,
    "x402": `{
  "x402Version": 1,
  "accepts": [
    {
      "scheme": "exact",
      "network": "base",
      "resource": "${origin}/api/your-paid-endpoint",
      "description": "What the agent gets for the payment",
      "maxAmountRequired": "10000",
      "asset": "USDC",
      "payTo": "0xYOUR_ADDRESS"
    }
  ]
}
// Serve at: ${origin}/.well-known/x402 — and return HTTP 402 with payment
// requirements on paid routes. See https://www.x402.org
`,
    "pricing": `{
  "currency": "USD",
  "plans": [
    { "id": "free", "price": 0, "unit": "month", "limits": { "requests": 1000 } },
    { "id": "pro", "price": 29, "unit": "month", "limits": { "requests": 100000 } }
  ],
  "perRequest": { "price": 0.001, "via": "x402" }
}
// Serve at: ${origin}/pricing.json
`,
    "security-txt": `Contact: mailto:security@${new URL(origin).hostname}
Expires: 2027-12-31T23:59:59.000Z
Preferred-Languages: en
Canonical: ${origin}/.well-known/security.txt
`,
    "status-endpoint": `{
  "status": "operational",
  "uptime90d": 99.95,
  "p50LatencyMs": 120,
  "updatedAt": "<ISO timestamp>"
}
// Serve at: ${origin}/.well-known/status
`,
  };
}

export function buildFixPlan(report: ScanReport): {
  url: string;
  asoScore: number;
  agentReadiness: string;
  level: string;
  steps: { priority: number; check: string; gain: string; recommendation: string; template?: string }[];
} {
  const siteName = new URL(report.scannedOrigin).hostname;
  const tpl = templates(siteName, report.scannedOrigin);
  const steps = report.topRecommendations.map((rec, i) => {
    const gainMatch = rec.match(/^\[\+([\d.]+) pts\]\s*([^:]+):\s*(.*)$/);
    const checkName = gainMatch?.[2] ?? rec;
    const check = report.checks.find((c) => c.name === checkName);
    return {
      priority: i + 1,
      check: checkName,
      gain: gainMatch ? `+${gainMatch[1]} ASO Score points` : "supporting",
      recommendation: gainMatch?.[3] ?? rec,
      template: check ? tpl[check.id] : undefined,
    };
  });
  return {
    url: report.url,
    asoScore: report.asoScore,
    agentReadiness: report.agentReadiness,
    level: `${report.level.id} ${report.level.name}`,
    steps,
  };
}
