import { defineConfig } from "vite";
export default defineConfig({ root: "web", base: "./", server: { fs: { allow: [".."] } }, build: { outDir: "../dist", emptyOutDir: true } });
