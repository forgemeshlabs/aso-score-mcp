import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
export const MAX_URL_LENGTH = 2048;
export const MAX_HOST_LENGTH = 253;
export const MAX_REDIRECTS = 5;
export class UnsafeUrlError extends Error {
    constructor(message) {
        super(message);
        this.name = "UnsafeUrlError";
    }
}
/**
 * Parse + validate a user-supplied URL into something safe to scan.
 * Rejects non-http(s) schemes, embedded credentials, fragments, and overlong hosts.
 */
export function parseScanUrl(input) {
    if (typeof input !== "string")
        throw new UnsafeUrlError("URL must be a string");
    const trimmed = input.trim();
    if (!trimmed)
        throw new UnsafeUrlError("URL is empty");
    if (trimmed.length > MAX_URL_LENGTH)
        throw new UnsafeUrlError(`URL exceeds ${MAX_URL_LENGTH} characters`);
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    let u;
    try {
        u = new URL(withScheme);
    }
    catch {
        throw new UnsafeUrlError(`Not a valid URL: ${trimmed}`);
    }
    if (u.protocol !== "https:" && u.protocol !== "http:") {
        throw new UnsafeUrlError(`Unsupported scheme '${u.protocol}'. Only http and https are allowed.`);
    }
    if (u.username || u.password) {
        throw new UnsafeUrlError("URLs with embedded credentials are not allowed");
    }
    if (!u.hostname)
        throw new UnsafeUrlError("URL has no host");
    if (u.hostname.length > MAX_HOST_LENGTH)
        throw new UnsafeUrlError("Host is too long");
    u.hash = "";
    return u;
}
/** Strip brackets from an IPv6 literal host, if present. */
function unbracket(host) {
    return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
}
/**
 * True if an IP literal is in a range we must never fetch from:
 * loopback, private, link-local, CGNAT, reserved, multicast, broadcast,
 * unspecified, IPv4-mapped/embedded IPv6, and the cloud metadata address.
 */
export function isBlockedIp(ip) {
    const v = isIP(ip);
    if (v === 4)
        return isBlockedV4(ip);
    if (v === 6)
        return isBlockedV6(ip.toLowerCase());
    return true; // not a parseable IP → refuse
}
function isBlockedV4(ip) {
    const parts = ip.split(".").map((p) => Number(p));
    if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255))
        return true;
    const [a, b] = parts;
    if (a === 0)
        return true; // 0.0.0.0/8 "this host"
    if (a === 10)
        return true; // private
    if (a === 127)
        return true; // loopback
    if (a === 169 && b === 254)
        return true; // link-local incl. 169.254.169.254 cloud metadata
    if (a === 172 && b >= 16 && b <= 31)
        return true; // private
    if (a === 192 && b === 168)
        return true; // private
    if (a === 192 && b === 0)
        return true; // 192.0.0.0/24 + 192.0.2.0/24 reserved/TEST-NET
    if (a === 198 && (b === 18 || b === 19))
        return true; // benchmarking
    if (a === 198 && b === 51)
        return true; // TEST-NET-2
    if (a === 203 && b === 0)
        return true; // TEST-NET-3
    if (a === 100 && b >= 64 && b <= 127)
        return true; // CGNAT 100.64.0.0/10
    if (a >= 224)
        return true; // multicast + reserved + 255.255.255.255
    return false;
}
function isBlockedV6(ip) {
    if (ip === "::" || ip === "::1")
        return true; // unspecified, loopback
    if (ip.startsWith("fe80") || ip.startsWith("fe9") || ip.startsWith("fea") || ip.startsWith("feb"))
        return true; // link-local fe80::/10
    if (ip.startsWith("fc") || ip.startsWith("fd"))
        return true; // unique-local fc00::/7
    if (ip.startsWith("ff"))
        return true; // multicast
    // IPv4-mapped / -embedded (::ffff:a.b.c.d, ::a.b.c.d, 64:ff9b::a.b.c.d) → validate the embedded v4
    const tail = ip.split(":").pop() ?? "";
    if (tail.includes("."))
        return isBlockedV4(tail);
    if (ip.includes("::ffff:") || ip.startsWith("64:ff9b:"))
        return true;
    return false;
}
/**
 * Resolve a host and confirm at least one address is public, returning a pinned IP.
 * Literal-IP hosts are checked directly (no DNS). Throws UnsafeUrlError on any private hit.
 */
export async function assertResolvableAndPublic(u) {
    const host = unbracket(u.hostname);
    const literal = isIP(host);
    if (literal) {
        // ASO_SCANNER_TEST_ALLOW_LOOPBACK exists solely so the test suite can run
        // a fixture server on 127.0.0.1. It exempts exactly that one address and
        // nothing else (not the rest of 127/8, not ::1, not other private ranges).
        // Never set it in production.
        const testLoopback = host === "127.0.0.1" && process.env.ASO_SCANNER_TEST_ALLOW_LOOPBACK === "1";
        if (isBlockedIp(host) && !testLoopback) {
            throw new UnsafeUrlError(`Refusing to fetch private/reserved address: ${host}`);
        }
        return { url: u, ip: host, family: literal };
    }
    // Reject obvious local names early.
    if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
        throw new UnsafeUrlError(`Refusing to fetch local hostname: ${host}`);
    }
    let addrs;
    try {
        addrs = await lookup(host, { all: true });
    }
    catch (err) {
        throw new UnsafeUrlError(`DNS resolution failed for ${host}: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!addrs.length)
        throw new UnsafeUrlError(`No DNS records for ${host}`);
    // If ANY resolved address is private, refuse — defends against DNS rebinding to a mixed record set.
    for (const a of addrs) {
        if (isBlockedIp(a.address)) {
            throw new UnsafeUrlError(`Host ${host} resolves to a private/reserved address (${a.address}); refusing to scan.`);
        }
    }
    return { url: u, ip: addrs[0].address, family: addrs[0].family };
}
