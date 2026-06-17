# Dogfooded ASO artifacts

The scanner practices what it scans. When this MCP server is hosted, deploy
these files so the deployment is itself fully ASO compliant. `stdio` is the
safe default for local use; any public HTTP deployment must add authentication,
per-client rate limiting, request logging, and an egress policy because the
scanner makes outbound requests.

| File | Serve at |
|---|---|
| `ai` | `/.well-known/ai` (content-type: application/json) |
| `agent.json` | `/agent.json` and `/.well-known/agent.json` |
| `agent-card.json` | `/.well-known/agent-card.json` (A2A) |
| `mcp/server-card.json` | `/.well-known/mcp/server-card.json` |
| `llms.txt` | `/llms.txt` |
| `robots.txt` | `/robots.txt` |

Update `url`/`endpoint` fields to the actual deployment origin before serving.
Keep the MCP server card aligned with `package.json` and `src/index.ts`.
