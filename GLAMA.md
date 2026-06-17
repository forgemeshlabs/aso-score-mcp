# Glama release build

Use this repository's `Dockerfile` for the Glama Dockerfile admin page:

```text
https://glama.ai/mcp/servers/forgemeshlabs/aso-score-mcp/admin/dockerfile
```

## Build spec

If the admin page lets you use the repository Dockerfile directly, use the `Dockerfile` in this repo.

If the admin page asks for build steps, use:

```text
npm ci
npm run build
npm prune --omit=dev
```

These should be configured in Glama's **Build steps** field. The repository also checks in `dist/` so `node dist/index.js` can start even if Glama skips build steps while testing a release.

CMD arguments:

```json
["node", "dist/index.js"]
```

In the Glama UI this must be entered as command arguments, not placeholder parameters. If the form shows editable rows, add exactly these two rows:

```text
node
dist/index.js
```

Do not leave this field as `[]`; Glama requires at least one command argument even when the repository `Dockerfile` already has a `CMD`.

Environment variables schema:

```json
{
  "type": "object",
  "properties": {},
  "required": []
}
```

Placeholder parameters:

```json
{}
```

## Runtime notes

- Transport: `stdio`
- Authentication: none for local/container stdio use
- Network behavior: outbound `GET` requests only, against URLs provided to the MCP tools
- No inbound HTTP port is required

After Glama's build test succeeds, click **Make Release**, use the current package version, and publish the release.

Local equivalent:

```bash
docker build -t aso-score-mcp .
docker run --rm -i aso-score-mcp
```
