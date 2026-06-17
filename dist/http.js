import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { gunzipSync, inflateSync, brotliDecompressSync } from "node:zlib";
import { assertResolvableAndPublic, parseScanUrl, UnsafeUrlError, MAX_REDIRECTS, } from "./safeurl.js";
const USER_AGENT = "ASO-Scanner/1.0 (Agent Signal Optimization; +https://agentsignaloptimization.com)";
const TIMEOUT_MS = 10_000;
const MAX_BODY = 512 * 1024;
/**
 * GET a single hop, dialing the exact IP that assertResolvableAndPublic
 * validated instead of re-resolving DNS at connect time. fetch() performs its
 * own lookup, which reopens the validate-then-fetch rebinding window; the
 * custom `lookup` here closes it. TLS still verifies the certificate against
 * the original hostname. Redirects are never followed at this layer.
 */
function pinnedGet(url, pin, accept) {
    const lookup = (_host, options, cb) => {
        if (options.all) {
            cb(null, [{ address: pin.ip, family: pin.family }]);
        }
        else {
            cb(null, pin.ip, pin.family);
        }
    };
    return new Promise((resolve, reject) => {
        const request = url.protocol === "https:" ? httpsRequest : httpRequest;
        const req = request(url, {
            method: "GET",
            headers: {
                "User-Agent": USER_AGENT,
                Accept: accept,
                "Accept-Encoding": "identity",
            },
            lookup,
        }, (res) => {
            const headers = {};
            for (const [k, v] of Object.entries(res.headers)) {
                if (v !== undefined)
                    headers[k.toLowerCase()] = Array.isArray(v) ? v.join(", ") : v;
            }
            const chunks = [];
            let size = 0;
            res.on("data", (chunk) => {
                chunks.push(chunk);
                size += chunk.length;
                if (size >= MAX_BODY)
                    res.destroy(); // cap the download, keep what we have
            });
            const settle = () => {
                clearTimeout(deadline);
                const raw = Buffer.concat(chunks);
                resolve({ status: res.statusCode ?? 0, headers, body: decodeBody(raw, headers) });
            };
            res.on("end", settle);
            res.on("close", settle);
            res.on("error", settle);
        });
        const deadline = setTimeout(() => req.destroy(new Error(`Request timed out after ${TIMEOUT_MS}ms`)), TIMEOUT_MS);
        req.on("error", (err) => {
            clearTimeout(deadline);
            reject(err);
        });
        req.end();
    });
}
/**
 * We ask for identity encoding, but some servers compress anyway; decompress
 * with a hard output cap so a compression bomb cannot expand past MAX_BODY.
 */
function decodeBody(raw, headers) {
    const encoding = (headers["content-encoding"] ?? "").toLowerCase();
    let buf = raw;
    try {
        if (encoding.includes("gzip"))
            buf = gunzipSync(raw, { maxOutputLength: MAX_BODY });
        else if (encoding.includes("br"))
            buf = brotliDecompressSync(raw, { maxOutputLength: MAX_BODY });
        else if (encoding.includes("deflate"))
            buf = inflateSync(raw, { maxOutputLength: MAX_BODY });
    }
    catch {
        return "";
    }
    const text = buf.toString("utf8");
    return text.length > MAX_BODY ? text.slice(0, MAX_BODY) : text;
}
/**
 * SSRF-safe GET. Validates the URL, resolves DNS and rejects private/reserved
 * targets, then follows redirects MANUALLY, re-validating every hop and
 * pinning each connection to the validated IP so a DNS answer cannot change
 * between validation and connect (rebinding TOCTOU).
 */
export async function httpGet(url, opts = {}) {
    let current;
    try {
        current = parseScanUrl(url).toString();
    }
    catch (err) {
        return blockedResult(url, err);
    }
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        let pin;
        try {
            pin = await assertResolvableAndPublic(parseScanUrl(current));
        }
        catch (err) {
            return blockedResult(current, err);
        }
        let res;
        try {
            res = await pinnedGet(new URL(current), pin, opts.accept ?? "*/*");
        }
        catch (err) {
            return {
                ok: false, status: 0, headers: {}, body: "", finalUrl: current, contentType: "",
                error: err instanceof Error ? err.message : String(err),
            };
        }
        // Manual redirect handling.
        if (res.status >= 300 && res.status < 400) {
            const loc = res.headers["location"];
            if (!loc)
                return toResult(res, current);
            if (hop === MAX_REDIRECTS) {
                return { ok: false, status: res.status, headers: {}, body: "", finalUrl: current, contentType: "", error: `Too many redirects (>${MAX_REDIRECTS})` };
            }
            try {
                current = new URL(loc, current).toString();
            }
            catch {
                return { ok: false, status: res.status, headers: {}, body: "", finalUrl: current, contentType: "", error: `Invalid redirect target: ${loc}` };
            }
            continue; // re-validate the new hop at the top of the loop
        }
        return toResult(res, current);
    }
    return { ok: false, status: 0, headers: {}, body: "", finalUrl: current, contentType: "", error: "Redirect loop" };
}
function blockedResult(url, err) {
    return {
        ok: false, status: 0, headers: {}, body: "", finalUrl: url, contentType: "",
        blocked: err instanceof UnsafeUrlError,
        error: err instanceof Error ? err.message : String(err),
    };
}
function toResult(res, url) {
    return {
        ok: res.status >= 200 && res.status < 300,
        status: res.status,
        headers: res.headers,
        body: res.body,
        finalUrl: url,
        contentType: (res.headers["content-type"] ?? "").toLowerCase(),
    };
}
export function tryJson(body) {
    const trimmed = body.trim();
    if (!trimmed || (!trimmed.startsWith("{") && !trimmed.startsWith("[")))
        return null;
    try {
        return JSON.parse(trimmed);
    }
    catch {
        return null;
    }
}
export function looksHtml(r) {
    return (r.contentType.includes("text/html") ||
        /^\s*<!doctype html|^\s*<html/i.test(r.body.slice(0, 300)));
}
/**
 * Neutralize untrusted remote content before it enters MCP tool output.
 * Strips control chars, caps length, and prevents an artifact from breaking
 * out of its labeled context (prompt-injection mitigation). Callers must still
 * present the result as untrusted data, never as instructions.
 */
export function sanitizeArtifact(text, maxLen = 2000) {
    if (typeof text !== "string")
        return "";
    // Drop control chars except tab/newline; collapse excessive blank lines.
    const cleaned = text
        .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "")
        .replace(/\n{4,}/g, "\n\n\n");
    const clipped = cleaned.length > maxLen ? cleaned.slice(0, maxLen) + "\n…[truncated]" : cleaned;
    return clipped;
}
/** Per-scan cache so each URL is fetched at most once per Accept header. */
export class ScanContext {
    origin;
    host;
    cache = new Map();
    constructor(validatedUrl) {
        this.origin = validatedUrl.origin;
        this.host = validatedUrl.hostname;
    }
    get(path, accept) {
        const url = path.startsWith("http") ? path : this.origin + path;
        const key = `${url} ${accept ?? ""}`;
        let p = this.cache.get(key);
        if (!p) {
            p = httpGet(url, { accept });
            this.cache.set(key, p);
        }
        return p;
    }
    home() {
        return this.get("/");
    }
    robots() {
        return this.get("/robots.txt");
    }
    /** Returns the first 200-OK non-HTML response among candidate paths, else null. */
    async firstHit(paths, accept) {
        for (const path of paths) {
            const res = await this.get(path, accept);
            if (res.status === 200 && !looksHtml(res))
                return { path, res };
        }
        return null;
    }
}
