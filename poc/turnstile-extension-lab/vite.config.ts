import { defineConfig, loadEnv } from "vite";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, projectRoot, "VITE_");
  const hostedOrigin = env.VITE_HOSTED_CHALLENGE_ORIGIN || "https://verify.example.test";

  return {
    root: projectRoot,
    base: "./",
    publicDir: false,
    define: {
      "import.meta.env.VITE_HOSTED_CHALLENGE_ORIGIN": JSON.stringify(hostedOrigin)
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
