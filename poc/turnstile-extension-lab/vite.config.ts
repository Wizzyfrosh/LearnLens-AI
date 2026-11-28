import { defineConfig, loadEnv } from "vite";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, projectRoot, "VITE_");
  const hostedOrigin = env.VITE_HOSTED_CHALLENGE_ORIGIN || "https://verify.example.test";
  const functionsOrigin = env.VITE_FUNCTIONS_ORIGIN || "https://us-central1-example-test.cloudfunctions.net";

  return {
    root: projectRoot,
    base: "./",
    publicDir: false,
    define: {
      "import.meta.env.VITE_HOSTED_CHALLENGE_ORIGIN": JSON.stringify(hostedOrigin),
      "import.meta.env.VITE_FUNCTIONS_ORIGIN": JSON.stringify(functionsOrigin)
    },
    build: {
      outDir: "dist",
      emptyOutDir: true,
      rollupOptions: {
        input: fileURLToPath(new URL("./index.html", import.meta.url)),
        output: {
          entryFileNames: "assets/[name].js",
          chunkFileNames: "assets/[name]-[hash].js",
          assetFileNames: "assets/[name]-[hash][extname]"
        }
      }
    }
  };
});
