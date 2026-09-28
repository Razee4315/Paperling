/// <reference types="vite/client" />

// KaTeX ships its mhchem extension as a side-effect module that patches the
// global KaTeX macro table. There's no public type surface — we just need to
// import it for its side effects. Without this declaration, TS errors on the
// dynamic import inside MarkdownPreview.tsx.
declare module "katex/dist/contrib/mhchem.mjs";
