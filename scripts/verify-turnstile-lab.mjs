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
assert.deepEqual(manifest.optional_host_permissions, [functionsOrigin + "/*"]);
assert.ok(manifest.content_security_policy.extension_pages.includes("script-src 'self'"));
assert.ok(manifest.content_security_policy.extension_pages.includes(
  "connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com " + functionsOrigin + ";"
));
const connectDirective = manifest.content_security_policy.extension_pages
  .split(";")
  .find((directive) => directive.trim().startsWith("connect-src "));
assert.ok(connectDirective, "The lab CSP must define connect-src.");
assert.ok(!/(?:^|\s)https:(?:\s|$)/.test(connectDirective), "The lab CSP must not allow the generic HTTPS scheme.");
assert.ok(connectDirective.includes("https://identitytoolkit.googleapis.com"));
assert.ok(connectDirective.includes("https://securetoken.googleapis.com"));
assert.ok(connectDirective.includes(functionsOrigin));
assert.ok(!connectDirective.includes("*.cloudfunctions.net"), "The lab CSP must not allow every Firebase Functions host.");
assert.ok(!connectDirective.includes("127.0.0.1") && !connectDirective.includes("localhost"), "The manual browser lab must not allow local emulator connections.");
assert.ok(manifest.content_security_policy.extension_pages.includes("frame-src 'self' " + hostedOrigin));
assert.ok(!manifest.content_security_policy.extension_pages.includes("script-src 'self' https:"));
assert.ok(!html.includes("https://challenges.cloudflare.com/turnstile/v0/api.js"), "Cloudflare's script must run only on the hosted page.");

const assets = await readdir(join(root, "assets"));
assert.ok(assets.some((file) => file.endsWith(".js")), "Expected the packaged extension UI JavaScript bundle.");

console.log("Turnstile lab extension verified: MV3 manifest, exact hosted frame origin, Firebase auth hosts and local-only executable assets.");
