import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = "poc/app-check-extension/dist";
const manifestPath = join(root, "manifest.json");
const htmlPath = join(root, "index.html");

assert.ok(existsSync(manifestPath), "POC manifest must be present in the built package.");
assert.ok(existsSync(htmlPath), "POC options page must be present in the built package.");

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
assert.equal(manifest.manifest_version, 3, "POC must use Manifest V3.");
assert.equal(manifest.name, "LearnLens App Check Compatibility Lab");
assert.equal(manifest.options_page, "index.html");

const extensionCsp = manifest.content_security_policy?.extension_pages ?? "";
assert.match(extensionCsp, /script-src\s+'self'/, "Extension pages may execute only packaged scripts.");
assert.doesNotMatch(extensionCsp, /script-src[^;]*https?:/i, "Remote script sources must not be allowed by the extension CSP.");
assert.doesNotMatch(extensionCsp, /unsafe-eval|unsafe-inline/i, "The POC must not weaken extension-page script restrictions.");

const html = readFileSync(htmlPath, "utf8");
assert.match(html, /<script[^>]+src="\.\/assets\//, "The built page must load its bundled local entry point.");
assert.doesNotMatch(html, /<script[^>]+src="https?:/i, "The built page must not load remote executable scripts.");

const assetsPath = join(root, "assets");
assert.ok(existsSync(assetsPath), "Bundled POC assets must be present.");
const jsFiles = readdirSync(assetsPath).filter((name) => name.endsWith(".js"));
assert.ok(jsFiles.length > 0, "The Firebase test harness must be bundled locally.");

console.log("App Check POC package verification passed.");
