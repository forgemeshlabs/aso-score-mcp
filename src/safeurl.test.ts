/**
 * Focused security tests — run with: npm test
 * Uses the built-in node:test runner (Node 18+), no extra deps.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseScanUrl, isBlockedIp, assertResolvableAndPublic, UnsafeUrlError, MAX_URL_LENGTH } from "./safeurl.js";
import { sanitizeArtifact } from "./http.js";

test("parseScanUrl adds https:// to bare hosts", () => {
  assert.equal(parseScanUrl("example.com").protocol, "https:");
  assert.equal(parseScanUrl("example.com").hostname, "example.com");
});

test("parseScanUrl rejects non-http schemes", () => {
  for (const bad of ["file:///etc/passwd", "ftp://example.com", "gopher://x", "data:text/plain,hi"]) {
    assert.throws(() => parseScanUrl(bad), UnsafeUrlError, bad);
  }
});

test("parseScanUrl rejects embedded credentials", () => {
  assert.throws(() => parseScanUrl("https://user:pass@example.com"), UnsafeUrlError);
});

test("parseScanUrl rejects overlong input", () => {
  assert.throws(() => parseScanUrl("https://example.com/" + "a".repeat(MAX_URL_LENGTH)), UnsafeUrlError);
});

test("parseScanUrl strips fragments", () => {
  assert.equal(parseScanUrl("https://example.com/x#secret").hash, "");
});

test("isBlockedIp blocks loopback, private, link-local, CGNAT, metadata", () => {
  for (const ip of [
    "127.0.0.1", "127.1.2.3", "0.0.0.0", "10.0.0.1", "172.16.0.1", "172.31.255.255",
    "192.168.1.1", "169.254.169.254", "100.64.0.1", "224.0.0.1", "255.255.255.255",
    "::1", "::", "fe80::1", "fc00::1", "fd12:3456::1", "ff02::1", "::ffff:127.0.0.1",
  ]) {
    assert.equal(isBlockedIp(ip), true, `expected blocked: ${ip}`);
  }
});

test("isBlockedIp allows public addresses", () => {
  for (const ip of ["8.8.8.8", "1.1.1.1", "104.16.0.1", "172.15.0.1", "172.32.0.1", "2606:4700:4700::1111"]) {
    assert.equal(isBlockedIp(ip), false, `expected allowed: ${ip}`);
  }
});

test("isBlockedIp refuses non-IP strings", () => {
  assert.equal(isBlockedIp("not-an-ip"), true);
  assert.equal(isBlockedIp(""), true);
});

test("assertResolvableAndPublic rejects literal private IP hosts without DNS", async () => {
  await assert.rejects(() => assertResolvableAndPublic(parseScanUrl("http://127.0.0.1")), UnsafeUrlError);
  await assert.rejects(() => assertResolvableAndPublic(parseScanUrl("http://169.254.169.254")), UnsafeUrlError);
  await assert.rejects(() => assertResolvableAndPublic(parseScanUrl("http://[::1]")), UnsafeUrlError);
});

test("assertResolvableAndPublic rejects localhost-family names", async () => {
  for (const h of ["http://localhost", "http://foo.local", "http://svc.internal"]) {
    await assert.rejects(() => assertResolvableAndPublic(parseScanUrl(h)), UnsafeUrlError, h);
  }
});

test("sanitizeArtifact strips control chars and caps length", () => {
  const dirty = "hello\x00\x07\x1bworld\x7f";
  assert.equal(sanitizeArtifact(dirty), "helloworld");
  assert.ok(sanitizeArtifact("x".repeat(5000)).length < 5000 + 20);
  assert.match(sanitizeArtifact("x".repeat(5000)), /\[truncated\]$/);
});

test("sanitizeArtifact preserves tabs and newlines", () => {
  assert.equal(sanitizeArtifact("a\tb\nc"), "a\tb\nc");
});
