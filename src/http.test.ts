/**
 * Redirect-handling security tests for httpGet — run with: npm test
 *
 * Spins up a local fixture server on 127.0.0.1, which the SSRF guard would
 * normally refuse; ASO_SCANNER_TEST_ALLOW_LOOPBACK=1 exempts exactly that
 * address for the duration of these tests (see safeurl.ts).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { httpGet } from "./http.js";
import { MAX_REDIRECTS } from "./safeurl.js";

process.env.ASO_SCANNER_TEST_ALLOW_LOOPBACK = "1";

function startFixture(): Promise<{ server: Server; base: string }> {
  const server = createServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0];
    switch (path) {
      case "/ok":
        res.writeHead(200, { "content-type": "text/plain" });
        res.end("hello");
        break;
      case "/relative-redirect":
        res.writeHead(302, { location: "/ok" });
        res.end();
        break;
      case "/to-metadata":
        res.writeHead(302, { location: "http://169.254.169.254/latest/meta-data/" });
        res.end();
        break;
      case "/to-private":
        res.writeHead(301, { location: "http://10.0.0.1/admin" });
        res.end();
        break;
      case "/to-file-scheme":
        res.writeHead(302, { location: "file:///etc/passwd" });
        res.end();
        break;
      case "/loop":
        res.writeHead(302, { location: "/loop" });
        res.end();
        break;
      case "/no-location":
        res.writeHead(302);
        res.end();
        break;
      default:
        res.writeHead(404);
        res.end();
    }
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, base: `http://127.0.0.1:${port}` });
    });
  });
}

test("httpGet redirect handling", async (t) => {
  const { server, base } = await startFixture();
  t.after(() => server.close());

  await t.test("follows a relative redirect to the final page", async () => {
    const r = await httpGet(`${base}/relative-redirect`);
    assert.equal(r.ok, true);
    assert.equal(r.status, 200);
    assert.equal(r.body, "hello");
    assert.equal(r.finalUrl, `${base}/ok`);
  });

  await t.test("blocks a redirect to the cloud metadata address", async () => {
    const r = await httpGet(`${base}/to-metadata`);
    assert.equal(r.ok, false);
    assert.equal(r.blocked, true);
    assert.match(r.error ?? "", /private|reserved/i);
  });

  await t.test("blocks a redirect to a private-range address", async () => {
    const r = await httpGet(`${base}/to-private`);
    assert.equal(r.ok, false);
    assert.equal(r.blocked, true);
  });

  await t.test("blocks a redirect to a non-http scheme", async () => {
    const r = await httpGet(`${base}/to-file-scheme`);
    assert.equal(r.ok, false);
    assert.equal(r.blocked, true);
    assert.match(r.error ?? "", /scheme/i);
  });

  await t.test(`caps redirect chains at ${MAX_REDIRECTS} hops`, async () => {
    const r = await httpGet(`${base}/loop`);
    assert.equal(r.ok, false);
    assert.match(r.error ?? "", /Too many redirects/);
  });

  await t.test("returns the 30x as-is when Location is missing", async () => {
    const r = await httpGet(`${base}/no-location`);
    assert.equal(r.ok, false);
    assert.equal(r.status, 302);
    assert.equal(r.error, undefined);
  });

  await t.test("loopback stays blocked without the test escape hatch", async () => {
    delete process.env.ASO_SCANNER_TEST_ALLOW_LOOPBACK;
    try {
      const r = await httpGet(`${base}/ok`);
      assert.equal(r.ok, false);
      assert.equal(r.blocked, true);
    } finally {
      process.env.ASO_SCANNER_TEST_ALLOW_LOOPBACK = "1";
    }
  });
});
