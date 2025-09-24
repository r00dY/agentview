import tailwindcss from "@tailwindcss/vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [tailwindcss(), tsconfigPaths()],
  server: {
    port: 1989,
  },
  build: {
    outDir: "dist",
    rollupOptions: {
      input: {
        main: "index.html"
      }
    }
  }
});