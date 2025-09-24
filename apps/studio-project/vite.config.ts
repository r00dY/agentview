import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [tailwindcss()],
  server: {
    port: 1989,
  },
  build: {
    outDir: "dist",
    rollupOptions: {
      input: {
        main: "./index.html"
      }
    }
  }
});