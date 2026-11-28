import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const configuredOrigin = process.env.VITE_HOSTED_CHALLENGE_ORIGIN || "https://verify.example.test";
let hostedOrigin;
try {
  const parsed = new URL(configuredOrigin);
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  ) throw new Error("The hosted challenge origin must be a clean HTTPS origin with no path.");
  hostedOrigin = parsed.origin;
} catch {
  throw new Error("Set VITE_HOSTED_CHALLENGE_ORIGIN to the exact HTTPS origin of the hosted Turnstile page.");
}

const manifest = {
  manifest_version: 3,
  minimum_chrome_version: "116",
  name: "LearnLens Turnstile CustomProvider Lab",
  version: "0.0.1",
  description: "Isolated manual test harness for LearnLens custom Firebase App Check challenges.",
  options_page: "index.html",
  host_permissions: [
    "https://identitytoolkit.googleapis.com/*",
    "https://securetoken.googleapis.com/*"
  ],
  optional_host_permissions: [
    "https://*/*",
    "http://127.0.0.1:5001/*",
    "http://localhost:5001/*"
  ],
  content_security_policy: {
    extension_pages:
      "script-src 'self'; object-src 'self'; base-uri 'self'; " +
      "connect-src 'self' https: http://127.0.0.1:5001 http://localhost:5001; " +
      "frame-src 'self' " + hostedOrigin + ";"
  }
};

const outputPath = resolve("poc/turnstile-extension-lab/dist/manifest.json");
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
console.log("Wrote test-only MV3 manifest with exact hosted frame origin:", hostedOrigin);
