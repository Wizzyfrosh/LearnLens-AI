import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const root = "poc/turnstile-extension-lab/dist";
const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
const html = await readFile(join(root, "index.html"), "utf8");
const hostedOrigin = new URL(process.env.VITE_HOSTED_CHALLENGE_ORIGIN || "https://verify.example.test").origin;
const functionsOrigin = new URL(process.env.VITE_FUNCTIONS_ORIGIN || "https://us-central1-example-test.cloudfunctions.net").origin;

assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.version, "0.0.1");
assert.equal(manifest.options_page, "index.html");
assert.ok(manifest.host_permissions.includes("https://identitytoolkit.googleapis.com/*"));
assert.ok(manifest.host_permissions.includes("https://securetoken.googleapis.com/*"));
assert.ok(manifest.optional_host_permissions.includes("https://*.cloudfunctions.net/*"));
assert.ok(manifest.optional_host_permissions.includes("http://127.0.0.1:5001/*"));
assert.ok(manifest.optional_host_permissions.includes("http://localhost:5001/*"));
assert.ok(!manifest.optional_host_permissions.includes("https://*/*"), "The lab must not request optional access to every HTTPS website.");
assert.ok(manifest.content_security_policy.extension_pages.includes("script-src 'self'"));
assert.ok(manifest.content_security_policy.extension_pages.includes("https://*.cloudfunctions.net"));
const connectDirective = manifest.content_security_policy.extension_pages
  .split(";")
  .find((directive) => directive.trim().startsWith("connect-src "));
assert.ok(connectDirective, "The lab CSP must define connect-src.");
assert.ok(!/(?:^|\\s)https:(?:\\s|$)/.test(connectDirective), "The lab CSP must not allow the generic HTTPS scheme.");
assert.ok(connectDirective.includes("https://identitytoolkit.googleapis.com"));
assert.ok(connectDirective.includes("https://securetoken.googleapis.com"));
assert.ok(connectDirective.includes("https://*.cloudfunctions.net"));
assert.ok(manifest.content_security_policy.extension_pages.includes("frame-src 'self' " + hostedOrigin));
assert.ok(!manifest.content_security_policy.extension_pages.includes("script-src 'self' https:"));
assert.ok(!html.includes("https://challenges.cloudflare.com/turnstile/v0/api.js"), "Cloudflare's script must run only on the hosted page.");

const assets = await readdir(join(root, "assets"));
assert.ok(assets.some((file) => file.endsWith(".js")), "Expected the packaged extension UI JavaScript bundle.");

console.log("Turnstile lab extension verified: MV3 manifest, exact hosted frame origin, Firebase auth hosts and local-only executable assets.");
