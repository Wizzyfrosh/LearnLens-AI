import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const root = "poc/turnstile-hosted/dist";
const html = await readFile(join(root, "index.html"), "utf8");
assert.match(html, /https:\/\/challenges\.cloudflare\.com\/turnstile\/v0\/api\.js\?render=explicit/);
assert.match(html, /script-src 'self' https:\/\/challenges\.cloudflare\.com/);
assert.match(html, /frame-src https:\/\/challenges\.cloudflare\.com/);
assert.match(html, /connect-src 'self' https:\/\/challenges\.cloudflare\.com/);
assert.match(html, /name="referrer" content="no-referrer"/);

const assets = await readdir(join(root, "assets"));
const javascript = assets.filter((file) => file.endsWith(".js"));
assert.ok(javascript.length > 0, "Expected a compiled hosted-page JavaScript bundle.");
const bundles = (await Promise.all(
  javascript.map((file) => readFile(join(root, "assets", file), "utf8"))
)).join("\n");

for (const required of [
  "LEARNLENS_TURNSTILE_INIT",
  "LEARNLENS_TURNSTILE_TOKEN",
  "chrome-extension://",
  "turnstile.render"
]) {
  assert.ok(bundles.includes(required), "Hosted page bundle is missing " + required);
}

for (const forbidden of [
  "pollCredential",
  "TURNSTILE_SECRET",
  "serviceAccount",
  "firebase/functions",
  "localStorage",
  "sessionStorage",
  "location.search",
  "URLSearchParams"
]) {
  assert.ok(!bundles.includes(forbidden), "Hosted page bundle unexpectedly contains " + forbidden);
}

console.log("Hosted Turnstile page verified: Cloudflare script/CSP and strict extension protocol present; no Firebase credentials, polling credential or browser storage/query token flow.");
