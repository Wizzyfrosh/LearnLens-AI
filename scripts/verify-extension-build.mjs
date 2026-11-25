import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const dist = resolve(process.cwd(), "dist");
const fail = (message) => {
  console.error(`[extension-smoke] FAIL: ${message}`);
  process.exitCode = 1;
};
const pass = (message) => console.log(`[extension-smoke] PASS: ${message}`);

const manifestPath = resolve(dist, "manifest.json");
if (!existsSync(manifestPath)) {
  fail("dist/manifest.json is missing; public assets were not copied");
  process.exit(1);
}

let manifest;
try {
  manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
} catch {
  fail("manifest.json is not valid JSON");
  process.exit(1);
}

if (manifest.manifest_version !== 3) fail("manifest_version must be 3");
else pass("Manifest V3");

const requiredPaths = [
  manifest.background?.service_worker,
  manifest.side_panel?.default_path,
  ...(manifest.content_scripts ?? []).flatMap((entry) => entry.js ?? [])
].filter(Boolean);

for (const relativePath of requiredPaths) {
  if (relativePath.startsWith("/") || relativePath.includes("..")) {
    fail(`unsafe or absolute extension path: ${relativePath}`);
    continue;
  }
  if (!existsSync(resolve(dist, relativePath))) fail(`manifest target missing: ${relativePath}`);
  else pass(`manifest target exists: ${relativePath}`);
}

const offscreenPath = resolve(dist, "offscreen.html");
if (!existsSync(offscreenPath)) {
  fail("offscreen.html is missing; tab audio capture cannot start");
} else {
  pass("offscreen audio capture document");
  const html = readFileSync(offscreenPath, "utf8");
  const assetRefs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((match) => match[1]);
  for (const asset of assetRefs) {
    if (/^(https?:)?\\/\\//.test(asset) || asset.startsWith("data:")) continue;
    const normalized = asset.replace(/^\\.\\//, "").replace(/^\\//, "");
    if (!existsSync(resolve(dist, normalized))) fail(`offscreen document asset missing: ${asset}`);
    else pass(`offscreen document asset exists: ${asset}`);
  }
}

const panelPath = manifest.side_panel?.default_path
  ? resolve(dist, manifest.side_panel.default_path)
  : null;
if (panelPath && existsSync(panelPath)) {
  const html = readFileSync(panelPath, "utf8");
  const assetRefs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((match) => match[1]);
  for (const asset of assetRefs) {
    if (/^(https?:)?\/\//.test(asset) || asset.startsWith("data:")) continue;
    const normalized = asset.replace(/^\.\//, "").replace(/^\//, "");
    if (!existsSync(resolve(dist, normalized))) fail(`side panel asset missing: ${asset}`);
    else pass(`side panel asset exists: ${asset}`);
  }
  if (!html.includes('<div id="root"></div>')) fail("side panel root mount element is missing");
  else pass("side panel root mount element");
}

if (!manifest.background?.service_worker) fail("background service worker is not configured");
if (!manifest.side_panel?.default_path) fail("side panel default_path is not configured");
if (!Array.isArray(manifest.content_scripts) || manifest.content_scripts.length === 0) {
  fail("no content script is configured");
}

if (process.exitCode) process.exit(process.exitCode);
console.log("[extension-smoke] Chrome extension package structure looks valid.");
