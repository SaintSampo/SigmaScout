import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base: "./" keeps all asset URLs relative, so the same build works whether
// it's served from a GitHub Pages project subpath (/SigmaScout/) or a custom
// domain root. No env juggling needed.
export default defineConfig({
  base: "./",
  plugins: [react()],
});
