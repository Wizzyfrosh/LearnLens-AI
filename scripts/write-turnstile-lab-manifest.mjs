import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const configuredOrigin = process.env.VITE_HOSTED_CHALLENGE_ORIGIN || "https://verify.example.test";
const configuredFunctionsOrigin = process.env.VITE_FUNCTIONS_ORIGIN || "https://us-central1-example-test.cloudfunctions.net";
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

let functionsOrigin;
try {
  const parsed = new URL(configuredFunctionsOrigin);
  if (
    parsed.protocol !== "https:" ||
    !parsed.hostname.endsWith(".cloudfunctions.net") ||
    parsed.hostname === "cloudfunctions.net" ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  ) throw new Error("The Functions origin must be a clean Firebase Cloud Functions HTTPS origin.");
  functionsOrigin = parsed.origin;
} catch {
  throw new Error("Set VITE_FUNCTIONS_ORIGIN to the exact Firebase Cloud Functions HTTPS origin.");
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
  // Ask only for the one Firebase Functions host selected at build time.
  // Chrome still prompts the tester before this origin is granted.
  optional_host_permissions: [
    functionsOrigin + "/*"
  ],
  content_security_policy: {
    extension_pages:
      "script-src 'self'; object-src 'self'; base-uri 'self'; " +
      "connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com " + functionsOrigin + "; " +
      "frame-src 'self' " + hostedOrigin + ";"
  }
};

const outputPath = resolve("poc/turnstile-extension-lab/dist/manifest.json");
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
console.log("Wrote test-only MV3 manifest with exact hosted frame and Functions origins:", hostedOrigin, functionsOrigin);
