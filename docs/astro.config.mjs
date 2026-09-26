import { defineConfig } from "astro/config";

// Deployed to GitHub Pages at https://razee4315.github.io/Paperling/
// `base` must match the repo name so every emitted URL is prefixed correctly.
export default defineConfig({
  site: "https://razee4315.github.io",
  base: "/Paperling/",
  trailingSlash: "always",
  output: "static",
  build: { format: "directory" },
  devToolbar: { enabled: false },
});
