import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { defineConfig } from "vite";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };
/** The POS Suite's release notes as of this console build (Updates → Load release notes, when GitHub isn't connected). */
const changelog = (() => {
  try {
    return readFileSync(new URL("../../CHANGELOG.md", import.meta.url), "utf8");
  } catch {
    return "";
  }
})();

export default defineConfig({
  plugins: [react()],
  define: { __CONSOLE_VERSION__: JSON.stringify(pkg.version), __POS_CHANGELOG__: JSON.stringify(changelog) },
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("firebase") || id.includes("@firebase")) return "firebase";
          if (id.includes("react") || id.includes("scheduler")) return "react";
          return "vendor";
        },
      },
    },
  },
});
